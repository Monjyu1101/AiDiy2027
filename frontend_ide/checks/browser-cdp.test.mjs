// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter,once} from 'node:events';
import {WebSocket} from 'ws';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import bridgeModule from '../デスクトップ/ブラウザCDP.cjs';
test('Browser CDP: 専用ページだけ公開、tools切断・別ドメイン拒否、所有パネルだけ終了',{timeout:5000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-cdp-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let connected=true,closed=0,destroyed=false;const commands=[];
 const contents=new EventEmitter();Object.assign(contents,{getTitle:()=> 'test',getURL:()=> 'https://example.com/',isDestroyed:()=>destroyed});
 const debuggerAPI=new EventEmitter();Object.assign(debuggerAPI,{isAttached:()=>true,sendCommand:async(method,params)=>{commands.push({method,params});return{ok:true};}});
 Object.defineProperty(contents,'debugger',{get(){if(destroyed)throw Error('Object has been destroyed');return debuggerAPI;}});
 const record={window:{close(){closed++;destroyed=true;contents.emit('destroyed');},isMinimized:()=>false,show(){},focus(){}}};
 const bridge=await bridgeModule.createBrowserCDP({directory,canUse:async()=>connected,openPanel:async()=>record,allowedURL:url=>/^https?:/.test(url)});t.after(()=>bridge.close());bridge.add(record,contents);
 assert.equal(bridge.name,'aidiy_ide 1');
 const manifest=JSON.parse(await readFile(join(directory,bridge.name+'.json'),'utf8')),base=`http://127.0.0.1:${manifest.port}/${manifest.token}`;
 assert.equal((await fetch(base+'/json',{headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await fetch(`http://127.0.0.1:${manifest.port}/json`)).status,404);
 const tabs=await(await fetch(base+'/json')).json();assert.equal(tabs.length,1);assert.equal(tabs[0].title,'test');assert.equal(tabs[0].type,'page');
 assert.equal(record.browserSession,bridge.name);assert.equal(record.browserTabId,tabs[0].id);
 const socket=new WebSocket(tabs[0].webSocketDebuggerUrl);await once(socket,'open');t.after(()=>socket.terminate());
 let id=0;const call=async(method,params={})=>{const pending=once(socket,'message');socket.send(JSON.stringify({id:++id,method,params}));return JSON.parse((await pending)[0]);};
 assert.equal((await call('Runtime.evaluate',{expression:'1+1'})).result.ok,true);
 for(const method of ['Target.getTargets','Browser.close','Page.navigate'])assert.ok((await call(method,{url:'file:///secret'})).error);
 assert.equal(commands.length,1);
 connected=false;assert.equal((await fetch(base+'/json')).status,409);assert.ok((await call('Runtime.evaluate')).error);
 // クライアントのclose受信とサーバーのclose処理は別イベント。
 // 固定時間待ちではなく、サーバーが購読を解除したことも確認する。
 connected=true;const ended=once(socket,'close'),released=once(debuggerAPI,'removeListener');
 await fetch(base+'/close');await ended;assert.equal((await released)[0],'message');
 assert.equal(closed,1);assert.equal(debuggerAPI.listenerCount('message'),0);
 bridge.close();assert.deepEqual(await readdir(directory),[]);
});

test('Browser CDP: IDE同時採番と番号再利用、単独起動ごとの固定UUID、登録解除',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-browser-cdp-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const options={directory,canUse:async()=>true,openPanel:async()=>{},allowedURL:()=>true};
 const bridges=[];t.after(()=>bridges.forEach(bridge=>bridge.close()));
 bridges.push(...await Promise.all(['aidiy_ide','aidiy_ide','aidiy_ide','aidiy_browser','aidiy_browser'].map(sessionPrefix=>bridgeModule.createBrowserCDP({...options,sessionPrefix}))));
 assert.deepEqual(bridges.slice(0,3).map(bridge=>bridge.name).sort(),['aidiy_ide 1','aidiy_ide 2','aidiy_ide 3']);
 for(const bridge of bridges.slice(3))assert.match(bridge.name,/^aidiy_browser [a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
 assert.equal(new Set(bridges.map(bridge=>bridge.name)).size,bridges.length);
 const manifests=await Promise.all(bridges.map(async bridge=>JSON.parse(await readFile(join(directory,bridge.name+'.json'),'utf8'))));
 assert.equal(new Set(manifests.map(value=>value.port)).size,5);assert.equal(new Set(manifests.map(value=>value.token)).size,5);
 assert.equal((await fetch(`http://127.0.0.1:${manifests[0].port}/${manifests[1].token}/json`)).status,404);
 for(const manifest of manifests)for(let n=0;n<2;n++){
  const response=await fetch(`http://127.0.0.1:${manifest.port}/${manifest.token}/json/version`);
  assert.equal((await response.json())['AiDiy-Session'],manifest.name,'同じ起動では再要求してもsessionを再生成しない');
 }
 await assert.rejects(bridgeModule.createBrowserCDP({...options,sessionPrefix:'../../bad'}),/セッション名/);
 const released=bridges.find(bridge=>bridge.name==='aidiy_ide 2');released.close();
 const replacement=await bridgeModule.createBrowserCDP(options);bridges.push(replacement);assert.equal(replacement.name,'aidiy_ide 2');
 released.close();assert.ok((await readdir(directory)).includes('aidiy_ide 2.json'),'終了済みbridgeは再利用後の登録を消さない');
 const standalone=bridges[3];standalone.close();
 assert.deepEqual((await readdir(directory)).sort(),bridges.filter(bridge=>bridge!==released&&bridge!==standalone).map(bridge=>bridge.name+'.json').sort());
});

test('Browser CDP: 各bridge内の別tab_idを区別し、他sessionの窓へ操作しない',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-browser-tabs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bridges=[];t.after(()=>bridges.forEach(bridge=>bridge.close()));
 function page(label){
  const contents=Object.assign(new EventEmitter(),{getTitle:()=>label,getURL:()=>`https://example.test/${label}`,isDestroyed:()=>false,focus(){}});
  const record={window:{close(){record.closed=true;contents.emit('destroyed');},isMinimized:()=>false,show(){},focus(){record.focused=true;}}};return{record,contents};
 }
 for(const sessionPrefix of ['aidiy_ide','aidiy_ide','aidiy_browser'])bridges.push(await bridgeModule.createBrowserCDP({directory,sessionPrefix,canUse:async()=>true,openPanel:async()=>{},allowedURL:()=>true}));
 const groups=bridges.map((bridge,i)=>{const values=[page('first-'+i),page('second-'+i)];for(const value of values)bridge.add(value.record,value.contents);return values;});
 const endpoints=await Promise.all(bridges.map(async bridge=>{const m=JSON.parse(await readFile(join(directory,bridge.name+'.json'),'utf8'));return`http://127.0.0.1:${m.port}/${m.token}`;}));
 const ids=[];
 for(let i=0;i<bridges.length;i++){
  const tabs=await(await fetch(endpoints[i]+'/json/list')).json();assert.equal(tabs.length,2);
  for(let n=0;n<2;n++){assert.equal(groups[i][n].record.browserSession,bridges[i].name);assert.equal(groups[i][n].record.browserTabId,tabs[n].id);ids.push(tabs[n].id);}
  assert.equal((await fetch(endpoints[i]+'/json/activate/'+groups[(i+1)%3][0].record.browserTabId)).status,409);
  assert.equal((await fetch(endpoints[i]+'/json/activate/'+groups[i][1].record.browserTabId)).status,200);
  assert.equal(groups[i][1].record.focused,true);assert.equal(groups[i][0].record.focused,undefined);
 }
 assert.equal(new Set(ids).size,6);
 assert.equal((await fetch(endpoints[0]+'/json/close/'+groups[0][0].record.browserTabId)).status,200);
 assert.equal((await(await fetch(endpoints[0]+'/json')).json()).length,1);
 assert.equal(groups.flat().filter(value=>value.record.closed).length,1);
});


test('Browser CDP: 別Nodeプロセスの同時起動でも同じregistryのIDE番号を奪い合わない',{timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-browser-processes-')),children=[];
 t.after(async()=>{
  await Promise.all(children.filter(child=>child.exitCode===null).map(async child=>{const ended=once(child,'exit');child.kill();await ended;}));
  await rm(directory,{recursive:true,force:true});
 });
 const source=`
  const {createBrowserCDP}=require(process.argv[1]);
  process.send({ready:true});
  process.once('message',async()=>{
   try{
    const bridge=await createBrowserCDP({directory:process.argv[2],sessionPrefix:process.argv[3],canUse:async()=>true,openPanel:async()=>{},allowedURL:()=>true});
    process.send({name:bridge.name});
    process.once('message',()=>{bridge.close();process.disconnect();});
   }catch(error){process.send({error:error.message});process.exitCode=1;process.disconnect();}
  });`;
 const modulePath=fileURLToPath(new URL('../デスクトップ/ブラウザCDP.cjs',import.meta.url));
 const pending=[];
 for(const prefix of ['aidiy_ide','aidiy_ide','aidiy_ide','aidiy_browser','aidiy_browser']){
  const child=spawn(process.execPath,['-e',source,modulePath,directory,prefix],{stdio:['ignore','ignore','inherit','ipc']});children.push(child);pending.push(once(child,'message'));
 }
 assert.ok((await Promise.all(pending)).every(([value])=>value.ready));
 // 全ワーカーの準備後にまとめて採番を開始する。wxの排他性は実プロセス間で検証する。
 const allocated=children.map(child=>once(child,'message'));for(const child of children)child.send('start');
 const names=(await Promise.all(allocated)).map(([value])=>{assert.equal(value.error,undefined);return value.name;});
 assert.equal(new Set(names).size,children.length);
 assert.deepEqual(names.filter(name=>name.startsWith('aidiy_ide ')).sort(),['aidiy_ide 1','aidiy_ide 2','aidiy_ide 3']);
 for(const name of names.filter(name=>name.startsWith('aidiy_browser ')))assert.match(name,/^aidiy_browser [a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
 for(let i=0;i<children.length;i++)assert.equal(JSON.parse(await readFile(join(directory,names[i]+'.json'),'utf8')).pid,children[i].pid);
 const ended=children.map(child=>once(child,'exit'));for(const child of children)child.send('close');
 for(const [code]of await Promise.all(ended))assert.equal(code,0);
 assert.deepEqual(await readdir(directory),[]);
});


test('Browser CDP: new_tabは別bridgeで登録した実sessionを返し、未登録/破棄/終了済みrecordを返さない',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-browser-new-target-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let opened;const bridges=[];t.after(()=>bridges.forEach(bridge=>bridge.close()));
 const options={directory,canUse:async()=>true,allowedURL:()=>true,openPanel:async()=>opened};
 const source=await bridgeModule.createBrowserCDP(options),target=await bridgeModule.createBrowserCDP(options);bridges.push(source,target);
 const m=JSON.parse(await readFile(join(directory,source.name+'.json'),'utf8')),base=`http://127.0.0.1:${m.port}/${m.token}`;
 opened={};assert.equal((await fetch(base+'/json/new')).status,409);
 let destroyed=false;const contents=Object.assign(new EventEmitter(),{getTitle:()=> 'target',getURL:()=> 'https://example.test/new',isDestroyed:()=>destroyed});
 target.add(opened,contents);
 const created=await(await fetch(base+'/json/new')).json();assert.equal(created.id,opened.browserTabId);assert.equal(created.session,target.name);
 assert.equal((await fetch(base+'/json/activate/'+created.id)).status,409,'新sessionの窓を元bridgeへ登録しない');
 destroyed=true;contents.emit('destroyed');assert.equal((await fetch(base+'/json/new')).status,409);
 destroyed=false;opened={};target.add(opened,contents);target.close();assert.equal((await fetch(base+'/json/new')).status,409);
});
