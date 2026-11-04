// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {PassThrough} from 'node:stream';
import {createStartManager} from '../起動/サービス管理.mjs';
import {createServer,autoStart} from '../diag_main.mjs';

const targets=JSON.parse(await readFile(new URL('../../scripts/起動対象.json',import.meta.url),'utf8')).filter(target=>target.起動管理!==false);
async function fixture(t,{hold=false,fail=false,open=[],stopFailure,portStatusFn,onSpawn}={}){
 const root=await mkdtemp(join(tmpdir(),'aidiy-start-'));await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts','起動対象.json'),JSON.stringify(targets));
 const calls=[],children=[];
 const spawnFn=(command,args,options)=>{
  onSpawn?.();
  calls.push({command,args,options,id:args.at(-1)});
  const child=new EventEmitter();child.pid=100000+children.length;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.closed=false;
  child.stdin.on('data',data=>{if(JSON.parse(data).action==='stop'&&!child.closed){child.closed=true;setImmediate(()=>child.emit('close',0));}});
  child.ready=()=>{child.stdout.write(JSON.stringify({type:'log',data:'日本語の出力\n'})+'\n');child.stdout.write(JSON.stringify(fail?{type:'error',message:'fixture failure'}:{type:'ready'})+'\n');};
  children.push(child);if(!hold)setImmediate(child.ready);return child;
 };
 const openPorts=new Set(open),stops=[];
 const manager=createStartManager({root,python:'fixture-python',spawnFn,stopTimeout:200,readyTimeout:500,
  portStatusFn:portStatusFn|| (async()=>({対象:targets.map(target=>({...target,開放:openPorts.has(target.id)}))})),
  forceStopFn:async target=>{stops.push(target.id);if(target.id===stopFailure)throw Error('fixture stop failure');openPorts.delete(target.id);}});
 t.after(async()=>{await manager.close();await rm(root,{recursive:true,force:true});});
 return {root,manager,calls,children,openPorts,stops};
}
test('--auto waits for released ports, then runs the saved start once',async t=>{
 const {manager,calls,openPorts}=await fixture(t,{open:['tools']});let waits=0,progressId;
 assert.equal(await autoStart(manager,{retries:5,wait:async()=>{
  const progress=(await manager.snapshot()).一括進捗;
  assert.equal(progress.種別,'start');assert.equal(progress.状態,'running');assert.match(progress.通知,/自動起動/);
  progressId??=progress.実行ID;assert.equal(progress.実行ID,progressId);
  if(++waits===2)openPorts.delete('tools');
 }}),true);
 await manager.settled();assert.equal(waits,2);assert.equal((await manager.snapshot()).一括進捗.実行ID,progressId);assert.equal((await manager.snapshot()).一括進捗.状態,'done');
 assert.deepEqual(calls.map(call=>call.id),targets.filter(target=>target.初期設定.起動対象).map(target=>target.id));
});
test('--auto gives up on a lasting conflict and shows the reason without starting',async t=>{
 const {manager,calls}=await fixture(t,{open:['web']});
 assert.equal(await autoStart(manager,{retries:2,wait:async()=>{}}),false);
 assert.equal(calls.length,0);assert.match((await manager.snapshot()).通知,/^自動起動できませんでした。.*強制停止/);assert.equal((await manager.snapshot()).一括進捗.状態,'error');
});
for(const action of ['forceStopAll','stop','restart','close']){
 test(`--auto retry is cancelled by explicit ${action} without overwriting its result`,async t=>{
  const {manager,calls,openPorts}=await fixture(t,{open:['tools']});let waits=0,notice;
  const result=await autoStart(manager,{wait:async()=>{
   waits++;
   if(action==='stop')await manager.stop('tools');
   else if(action==='restart')await manager.restart('local');
   else await manager[action]();
   await manager.settled();notice=(await manager.snapshot()).通知;
   openPorts.clear();
  }});
  assert.equal(result,false);assert.equal(waits,1);
  assert.deepEqual(calls.map(call=>call.id),action==='restart'?['local']:[]);
  assert.equal((await manager.snapshot()).通知,notice);
  const progress=(await manager.snapshot()).一括進捗;
  if(action==='forceStopAll'){assert.equal(progress.種別,'stop');assert.equal(progress.状態,'done');}else assert.equal(progress,null);
  // 明示的な次の起動は妨げず、古い auto だけを取り消す。
  if(action!=='close'){
   await manager.restart('web');await manager.settled();assert.equal(calls.at(-1).id,'web');
  }
 });
}
for(const action of ['forceStopAll','stop','restart','close']){
 test(`--auto pending port check cannot accept startup after ${action}`,async t=>{
  let release,entered;
  const portEntered=new Promise(resolve=>{entered=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});let first=true;
  const {manager,calls}=await fixture(t,{portStatusFn:async()=>{
   if(first){first=false;entered();await blocked;}
   return {対象:targets.map(target=>({...target,開放:false}))};
  }});
  const automatic=autoStart(manager,{wait:async()=>assert.fail('cancelled startup must not retry')});
  await portEntered;
  if(action==='stop')await manager.stop('tools');
  else if(action==='restart')await manager.restart('local');
  else await manager[action]();
  await manager.settled();release();
  assert.equal(await automatic,false);await manager.settled();
  assert.deepEqual(calls.map(call=>call.id),action==='restart'?['local']:[]);
 });
}
test('auto defaults are shared, ordered, and viewing never starts a process',async t=>{
 const {manager,calls}=await fixture(t);const snapshot=await manager.snapshot();
 assert.deepEqual(snapshot.対象.filter(item=>item.設定.起動対象).map(item=>item.id),['tools','core','apps','taskteam','web']);assert.equal(calls.length,0);
 assert.deepEqual(snapshot.対象.map(item=>item.id),targets.map(item=>item.id));
 assert.equal(snapshot.終了時停止あり,false);
});
test('settings persist across manager instances and reject arbitrary commands',async t=>{
 const {root,manager,calls}=await fixture(t);const defaults=targets.find(item=>item.id==='local').初期設定;
 await manager.save('local',{...defaults,起動対象:true});
 const other=createStartManager({root});t.after(()=>other.close());assert.equal((await other.snapshot()).対象.find(item=>item.id==='local').設定.起動対象,true);
 for(const value of [{起動対象:true,自動再起動:true,command:'evil'},{起動対象:'true',自動再起動:true}])await assert.rejects(()=>manager.save('local',value),{status:400});
 await assert.rejects(()=>manager.save('../unknown',defaults),{status:400});assert.equal(calls.length,0);
 await assert.rejects(()=>manager.restart('avatar'),{status:400});
 await assert.rejects(()=>manager.restart('ide'),{status:400});
});

test('Web has one browser option and migrates saved chrome_devtools settings',async t=>{
 const {root,manager}=await fixture(t);
 await mkdir(join(root,'_config'));await writeFile(join(root,'_config','AiDiy_diag_start.json'),JSON.stringify({version:1,設定:{web:{起動対象:true,自動再起動:false,ブラウザ表示:true,'chrome_devtoolsで開く':false}}}));
 const web=(await manager.snapshot()).対象.find(item=>item.id==='web');
 assert.deepEqual(web.設定,{起動対象:true,自動再起動:false,ブラウザ表示:true});
 await manager.save('web',{...web.設定,ブラウザ表示:false});
 const other=createStartManager({root});t.after(()=>other.close());
 assert.deepEqual((await other.snapshot()).対象.find(item=>item.id==='web').設定,{起動対象:true,自動再起動:false,ブラウザ表示:false});
 assert.equal(Object.hasOwn(JSON.parse(await readFile(join(root,'_config','AiDiy_diag_start.json'),'utf8')).設定.web,'chrome_devtoolsで開く'),false);
});
test('bulk restart waits for each target and follows root order without a shell',async t=>{
 const {manager,calls}=await fixture(t);await manager.restart();await manager.settled();
 assert.deepEqual(calls.map(call=>call.id),['tools','core','apps','taskteam','web']);
 for(const call of calls){assert.equal(call.options.shell,false);assert.equal(call.args.at(-2),'--diag-start');assert.ok(call.args[3].endsWith('_start.py'));}
 const tail=await manager.logSnapshot('core');assert.match(tail.ログ,/日本語の出力/);assert.equal((await manager.logSnapshot('core',tail.位置)).ログ,'');
 assert.equal((await manager.snapshot()).実行中,false);
});

test('startup focus follows each target and distinguishes another run of the same target',async t=>{
 const {manager,children}=await fixture(t,{hold:true});assert.equal((await manager.snapshot()).起動表示,null);
 await manager.restart();const ids=['tools','core','apps','taskteam','web'],runs=new Set();
 for(let index=0;index<ids.length;index++){
  while(children.length<=index)await new Promise(resolve=>setTimeout(resolve,2));
  const snapshot=await manager.snapshot();assert.equal(snapshot.実行中,true);assert.equal(snapshot.起動表示.対象,ids[index]);
  assert.ok(snapshot.起動表示.実行ID);runs.add(snapshot.起動表示.実行ID);children[index].ready();
 }
 await manager.settled();assert.equal(runs.size,5);assert.equal((await manager.snapshot()).起動表示.対象,'web');
 const previous=(await manager.snapshot()).起動表示.実行ID;
 await manager.restart('web');while(children.length<6)await new Promise(resolve=>setTimeout(resolve,2));
 assert.notEqual((await manager.snapshot()).起動表示.実行ID,previous);children[5].ready();await manager.settled();
});
test('restart closes the old owned console before creating another',async t=>{
 const {manager,calls,children}=await fixture(t);await manager.restart('local');await manager.settled();
 await manager.restart('local');await manager.settled();assert.equal(children[0].closed,true);assert.equal(calls.length,2);assert.equal(children[1].closed,false);
 assert.equal((await manager.snapshot()).終了時停止あり,true,'起動処理完了後も稼働中なら終了確認が必要');
 await manager.stop('local');assert.equal(children[1].closed,true);assert.equal((await manager.snapshot()).対象.find(item=>item.id==='local').状態,'停止済み');
 assert.equal((await manager.snapshot()).終了時停止あり,false);
});
test('individual restart clears only its console and invalidates previous log cursors',async t=>{
 const {manager,children}=await fixture(t);await manager.restart();await manager.settled();
 const toolsBefore=await manager.logSnapshot('tools');
 children[4].stdout.write(JSON.stringify({type:'log',data:'前回だけの出力\n'})+'\n');
 const before=await manager.logSnapshot('web');await manager.restart('web');await manager.settled();
 const after=await manager.logSnapshot('web',before.位置);
 assert.equal(after.切替,true);assert.ok(after.位置>before.位置);assert.doesNotMatch(after.ログ,/前回だけの出力/);assert.match(after.ログ,/日本語の出力/);
 assert.deepEqual(await manager.logSnapshot('tools'),toolsBefore);
 assert.doesNotMatch((await manager.logSnapshot('web',0)).ログ,/前回だけの出力/);
 await assert.rejects(()=>manager.restart(),{status:409});
 await manager.forceStopAll();await manager.settled();
 await manager.restart();await manager.settled();
 assert.ok((await manager.logSnapshot('tools')).ログ.startsWith(toolsBefore.ログ),'一括起動では履歴を維持する');
});

test('bulk start rejects externally running services and force stop skips idle targets in reverse tab order',async t=>{
 const {manager,calls,stops,openPorts}=await fixture(t,{open:['local','tools','core','apps','taskteam','web']});
 await assert.rejects(()=>manager.restart(),{status:409});assert.equal(calls.length,0);
 await manager.forceStopAll();await manager.settled();
 assert.deepEqual(stops,['web','taskteam','apps','core','tools','local']);assert.equal(openPorts.size,0);
 assert.equal((await manager.snapshot()).一括停止中,false);assert.match((await manager.snapshot()).通知,/すべて停止/);
 openPorts.add('tools');openPorts.add('web');stops.length=0;
 await manager.forceStopAll();await manager.settled();assert.deepEqual(stops,['web','tools']);
 await manager.restart();await manager.settled();assert.equal(calls.length,5);
});

test('force stop cancels startup and owned auto-restart sessions without launching later targets',async t=>{
 const {manager,calls,children}=await fixture(t,{hold:true});await manager.restart();
 while(!children.length)await new Promise(resolve=>setTimeout(resolve,2));
 await manager.forceStopAll();await assert.rejects(()=>manager.forceStopAll(),{status:409});
 await manager.settled();assert.equal(calls.length,1);assert.ok(children.every(child=>child.closed));
 assert.equal((await manager.snapshot()).実行中,false);assert.match((await manager.snapshot()).通知,/すべて停止/);
});

test('force stop continues after a failed target and reports the remaining service',async t=>{
 const {manager,stops,openPorts}=await fixture(t,{open:['web','tools','core'],stopFailure:'web'});
 await manager.forceStopAll();await manager.settled();assert.deepEqual(stops,['web','core','tools']);
 assert.deepEqual([...openPorts],['web']);assert.match((await manager.snapshot()).通知,/停止できない.*fixture stop failure/);assert.equal((await manager.snapshot()).一括進捗.状態,'error');
 await assert.rejects(()=>manager.restart(),{status:409});
});

test('an errored but live managed process remains stoppable and force stop clears its running flag',async t=>{
 const {manager,children}=await fixture(t);await manager.restart('tools');await manager.settled();
 children[0].stdout.write(JSON.stringify({type:'error',message:'接続エラー'})+'\n');
 assert.equal((await manager.snapshot()).対象.find(item=>item.id==='tools').管理中,true);
 await manager.forceStopAll();await manager.settled();
 const stopped=(await manager.snapshot()).対象.find(item=>item.id==='tools');assert.equal(stopped.管理中,false);assert.equal(stopped.状態,'停止済み');
});
test('a duplicate bulk action is rejected and a stop cancels pending startup',async t=>{
 const {manager,calls,children}=await fixture(t,{hold:true});await manager.restart();
 assert.equal((await manager.snapshot()).終了時停止あり,true,'準備中で子がまだ無い場合も確認する');
 while(!children.length)await new Promise(resolve=>setTimeout(resolve,5));
 await assert.rejects(()=>manager.restart(),{status:409});await manager.stop('tools');await manager.settled();assert.equal(calls.length,1);assert.equal(children[0].closed,true);
});
test('a startup failure stops later targets and reports the failure',async t=>{
 const {manager,calls}=await fixture(t,{fail:true});await manager.restart();await manager.settled();assert.equal(calls.length,1);assert.match((await manager.snapshot()).通知,/fixture failure/);assert.equal((await manager.snapshot()).一括進捗.状態,'error');
});
test('bounded per-feature console logs do not leak to other consoles',async t=>{
 const {manager,children}=await fixture(t);await manager.restart('local');await manager.settled();
 children[0].stdout.write(JSON.stringify({type:'log',data:'x'.repeat(125000)})+'\n');
 const log=await manager.logSnapshot('local',0);assert.ok(log.ログ.length<=120000);assert.equal(log.切替,true);assert.equal((await manager.logSnapshot('apps',0)).ログ,'');
});
test('the start API requires auth, JSON and fixed inputs; read-only calls do not restart',async t=>{
 const {manager,calls}=await fixture(t);const server=createServer({token:'fixture-auth',startManager:manager,modelTrials:{close(){}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture-auth','Content-Type':'application/json'};
 assert.equal((await fetch(url+'api/'+encodeURIComponent('起動'))).status,401);
 assert.equal((await fetch(url+'api/'+encodeURIComponent('起動'),{headers})).status,200);assert.equal(calls.length,0);
 const endpoint='api/'+encodeURIComponent('起動')+'/'+encodeURIComponent('再起動');
 assert.equal((await fetch(url+endpoint,{method:'POST',headers,body:JSON.stringify({対象:'../bad'})})).status,400);
 assert.equal((await fetch(url+endpoint,{method:'POST',headers,body:JSON.stringify({command:'evil'})})).status,400);
 assert.equal((await fetch(url+endpoint,{method:'POST',headers,body:JSON.stringify({対象:'local'})})).status,202);await manager.settled();assert.equal(calls.length,1);
 const stopEndpoint=url+'api/'+encodeURIComponent('起動')+'/'+encodeURIComponent('強制停止');
 assert.equal((await fetch(stopEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(stopEndpoint,{method:'POST',headers,body:'{"対象":"web"}'})).status,400);
 assert.equal((await fetch(stopEndpoint,{method:'POST',headers,body:'{}'})).status,202);await manager.settled();
 assert.equal((await manager.snapshot()).終了時停止あり,false);
});


test('batch progress is stable and isolated from snapshots; force stop supersedes startup completion',async t=>{
 const {manager,children}=await fixture(t,{hold:true});
 assert.equal((await manager.snapshot()).一括進捗,null);
 await manager.restart();
 const start=(await manager.snapshot()).一括進捗;
 assert.equal(start.種別,'start');assert.equal(start.状態,'running');assert.ok(start.実行ID);
 start.状態='error';assert.equal((await manager.snapshot()).一括進捗.状態,'running','snapshot cannot mutate the operation');
 while(!children.length)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await manager.snapshot()).一括進捗.実行ID,start.実行ID);
 await manager.forceStopAll();
 const stop=(await manager.snapshot()).一括進捗;
 assert.equal(stop.種別,'stop');assert.equal(stop.状態,'running');assert.notEqual(stop.実行ID,start.実行ID);
 await manager.settled();
 const done=(await manager.snapshot()).一括進捗;
 assert.equal(done.実行ID,stop.実行ID);assert.equal(done.種別,'stop');assert.equal(done.状態,'done');assert.match(done.通知,/すべて停止/);
 await manager.close();assert.equal((await manager.snapshot()).一括進捗,null);
});

test('individual restart does not create batch progress',async t=>{
 const {manager}=await fixture(t);await manager.restart('local');await manager.settled();assert.equal((await manager.snapshot()).一括進捗,null);
});

const rebootPaths=[['backend_server','reboot_core.txt'],['backend_server','reboot_apps.txt'],['backend_server','reboot_apps_code_base_path.txt'],['backend_tools','reboot_tools.txt'],['backend_local','reboot_local.txt'],['backend_taskteam','reboot_taskteam.txt'],['backend_taskteam','reboot_task.txt'],['backend_taskteam','reboot_team.txt']];
for(const mode of ['manual','auto'])test(`${mode} removes all reboot inputs before first spawn, including unselected Local`,async t=>{
 let paths=[];
 const {root,manager,calls}=await fixture(t,{onSpawn:()=>{for(const p of paths)assert.equal(existsSync(p),false,p);}});
 for(const [folder,name] of rebootPaths){const dir=join(root,folder,'temp');await mkdir(dir,{recursive:true});const p=join(dir,name);await writeFile(p,'test');paths.push(p);}
 const keep=join(root,'backend_server','temp','keep.txt');await writeFile(keep,'keep');
 if(mode==='auto')await autoStart(manager);else await manager.restart();
 await manager.settled();assert.ok(calls.length>0);assert.equal(await readFile(keep,'utf8'),'keep');assert.equal((await manager.snapshot()).一括進捗.状態,'done');
});
test('failed reboot cleanup prevents every service launch',async t=>{
 const {root,manager,calls}=await fixture(t);await mkdir(join(root,'backend_server','temp','reboot_core.txt'),{recursive:true});
 await manager.restart();await manager.settled();assert.equal(calls.length,0);assert.equal((await manager.snapshot()).一括進捗.状態,'error');
});
test('individual restart preserves unrelated reboot requests',async t=>{
 const {root,manager}=await fixture(t);const dir=join(root,'backend_server','temp');await mkdir(dir,{recursive:true});const p=join(dir,'reboot_core.txt');await writeFile(p,'test');
 await manager.restart('local');await manager.settled();await access(p);
});

test('cleanup covers every reboot txt literal emitted or consumed by current backends',async t=>{
 const sources=[['backend_server','core_main.py'],['backend_server','apps_main.py'],['backend_server','core_router/AIコア.py'],['backend_tools','tools_main.py'],['backend_local','local_main.py'],['backend_taskteam','taskteam_proc/runtime.py']];
 const emitted=new Set();
 for(const [folder,file] of sources){const code=await readFile(new URL(`../../${folder}/${file}`,import.meta.url),'utf8');for(const m of code.matchAll(/["'](reboot_[a-z_]+\.txt)["']/g))emitted.add(m[1]);}
 assert.deepEqual([...emitted].sort(),rebootPaths.map(([,name])=>name).sort(),'new reboot input requires cleanup coverage');
 const {root,manager}=await fixture(t);
 for(const [folder,name] of rebootPaths){await mkdir(join(root,folder,'temp'),{recursive:true});await writeFile(join(root,folder,'temp',name),'test');}
 await manager.restart();await manager.settled();
 for(const [folder,name] of rebootPaths)assert.equal(existsSync(join(root,folder,'temp',name)),false,name);
});
