// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAppLauncher} from '../起動/アプリ起動.mjs';
import {createServer} from '../diag_main.mjs';
import {createWebBrowserOpener} from '../起動/Webブラウザ.mjs';
import {アプリ状態を作成} from '../ui/src/components/アプリ起動/アプリ状態.mjs';
import {アプリアイコン} from '../ui/src/components/アプリ起動/アプリアイコン.mjs';

test('Chrome has the manual Web gate and fixed MCP call; no project, process spawn or service start',async t=>{
 const root=await mkdtemp(join(tmpdir(),'diag-chrome-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let online=false,calls=0;
 const portStatusFn=async()=>({対象:['tools','web'].map(id=>({id,開放:online,ポート:id==='tools'?8095:8090}))});
 const webBrowserOpenFn=createWebBrowserOpener({portStatusFn,fetchFn:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:8095/aidiy_chrome_devtools/new_page');assert.deepEqual(JSON.parse(options.body),{url:'http://localhost:8090/',show_automation_banner:false});return {ok:true,json:async()=>({id:'tab-1'})};}});
 const manager=createAppLauncher({root,chromeInstalled:async()=>true,taskTeamStatus:async()=>({利用可能:false}),portStatusFn,webBrowserOpenFn,spawnFn(){assert.fail('Chrome must use existing Tools');}});
 assert.equal((await manager.catalog()).対象.find(x=>x.id==='chrome').利用可能,false);
 await assert.rejects(manager.launch('chrome'),{status:409});assert.equal(calls,0);
 online=true;assert.equal((await manager.catalog()).対象.find(x=>x.id==='chrome').利用可能,true);
 assert.equal((await manager.launch('chrome')).URL,'http://localhost:8090/');assert.equal(calls,1);
});
test('standalone Browser receives exact project and independent window args without Chrome debugger flags',async t=>{
 const root=await mkdtemp(join(tmpdir(),'diag-browser-')),project=join(root,'日本語 project');await mkdir(project);t.after(()=>rm(root,{recursive:true,force:true}));
 let toolsOnline=true;const calls=[];const manager=createAppLauncher({root,portStatusFn:async()=>({対象:[{id:"tools",開放:toolsOnline}]}),spawnFn(command,args,options){calls.push({command,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
 await assert.rejects(manager.launch('browser',''),{status:400});
 await manager.launch('browser',project);await manager.launch('browser',project);
 toolsOnline=false;assert.equal((await manager.catalog()).対象.find(x=>x.id==='browser').利用可能,false);await assert.rejects(manager.launch('browser',project),{status:409});
 assert.equal(calls.length,2);for(const call of calls){assert.deepEqual(call.args,[join(root,'frontend_ide','launch.mjs'),'--app','browser','--project',project,'--new-window']);assert.equal(call.options.cwd,project);assert.equal(call.options.detached,true);assert.equal(call.options.shell,false);}
 assert.equal(アプリアイコン.browser,'AiDiy_browser.png');assert.equal(アプリアイコン.chrome,'Chrome.svg');
});
test('all launcher sizes share Chrome state: exact manual endpoint, no project requirement, duplicate lock, disconnect fail closed',async()=>{
 let release,calls=[];const state=アプリ状態を作成({api:async(route,method,signal,format,body)=>{calls.push({route,body});if(route==='api/アプリ起動')return {対象:[{id:'chrome',利用可能:true},{id:'browser'}],フォルダ:''};return new Promise(resolve=>release=resolve);}});
 await state.読込();assert.equal(state.フォルダ必要('chrome'),false);assert.equal(state.フォルダ必要('browser'),true);
 await state.起動('browser');assert.equal(calls.length,1);
 const one=state.起動('chrome');await state.起動('chrome');assert.equal(calls.length,2);assert.deepEqual(calls.at(-1),{route:'api/起動/ブラウザ',body:{}});
 release({メッセージ:'opened'});await one;assert.equal(state.結果.value.chrome.通知,'opened');
 state.終了();assert.equal(state.利用可能('chrome'),false);await state.起動('chrome');assert.equal(calls.length,2);
});


test('Chrome launcher and manual Web API share opener and concurrent request lock',async t=>{
 let release,calls=0;const portStatusFn=async()=>({対象:[{id:'tools',開放:true,ポート:8095},{id:'web',開放:true,ポート:8090}]});
 const webBrowserOpenFn=createWebBrowserOpener({portStatusFn,fetchFn:()=>{calls++;return new Promise(resolve=>release=()=>resolve({ok:true,json:async()=>({id:'tab'})}));}});
 const server=createServer({token:'fixture',portStatusFn,webBrowserOpenFn,modelTrials:{close(){}},startManager:{close(){}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 for(const asset of ['Chrome.svg','AiDiy_browser.png'])assert.equal((await fetch(base+asset)).status,200);
 const one=fetch(base+'api/起動/ブラウザ',{method:'POST',headers,body:'{}'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const second=await fetch(base+'api/アプリ起動/開始',{method:'POST',headers,body:JSON.stringify({対象:'chrome'})});
 assert.equal(second.status,409);assert.equal(calls,1);release();assert.equal((await one).status,200);
});
