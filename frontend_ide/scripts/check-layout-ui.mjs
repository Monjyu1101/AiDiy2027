// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 配布物を変更せず実App/起動メニューと模擬IPCで配置操作を確認する。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/layout-ui-check');
for(const name of ['App.vue','components/開発スペース/Naviパネル.vue','components/開発スペース/開発スペース.vue','components/ファイル閲覧/ファイル一覧.vue','components/ファイル閲覧/閲覧セッション.vue']){
 const {descriptor,errors}=parse(readFileSync(join(root,'src',name),'utf8'),{filename:name});assert.deepEqual(errors,[]);compileScript(descriptor,{id:name,inlineTemplate:true});
}
const bundle=await build({stdin:{resolveDir:root,contents:`import {createApp,h,nextTick} from 'vue';import App from './src/App.vue';
window.fixture={mode:'online',count:0,saved:false,calls:[],active:true};let handler;const f=window.fixture;
window.fetch=async()=>({ok:true,json:async()=>({active:f.active,mode:f.mode,connected:true,startedAt:1,project:{path:'/fixture',name:'Layout fixture'}})});
window.aidiyWindow={childWindows:async()=>({}),onLayoutRequest:fn=>{handler=fn;return()=>{};},layout:async action=>{f.calls.push(action);if(action==='load'){await handler({action:'restore',payload:{version:1,viewMode:'3d',navigation:[],space:{}}});f.count=3;}if(action==='save')f.snapshot=await handler({action:'capture'});return{ok:true,count:f.count,saved:f.saved};},allDisplays:async()=>({ok:true,active:false}),onAllDisplaysChanged:()=>()=>{}};
createApp({render:()=>h(App,{config:{kind:'ide'}})}).mount('#app');window.refreshFixture=async()=>{document.querySelector('.ide-toolbar-right').dispatchEvent(new MouseEvent('mouseenter'));await nextTick();};`},bundle:true,write:false,format:'iife',plugins:[{name:'layout-fixture',setup(b){b.onLoad({filter:/\.vue$/},args=>{
 if(!['App.vue','起動メニュー.vue','状態バー.vue','開始表示.vue'].includes(basename(args.path)))return{contents:`export default {setup(p,{expose}){expose({captureLayout:()=>({explorer:{},viewers:[]}),restoreLayout:async()=>[]});return()=>null;}};`};
 const {descriptor}=parse(readFileSync(args.path,'utf8'));const script=compileScript(descriptor,{id:args.path,inlineTemplate:true});return{contents:script.content,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: touched Vue components and isolated App imports compile.');process.exit(0);}
mkdirSync(output,{recursive:true});const temporary=mkdtempSync(join(tmpdir(),'layout-ui-'));
const css=readFileSync(join(root,'src/style.css'),'utf8');
const server=createServer((req,res)=>{if(req.url==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);res.writeHead(200,{'content-type':'text/html'}).end(`<meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="/app.js"></script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let socket,browserErrors='';chrome.stderr.on('data',data=>browserErrors+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<160;i++){if(await fn())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return port;}catch{}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors);});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',data=>{const value=JSON.parse(data);if(pending.has(value.id)){pending.get(value.id)(value);pending.delete(value.id);}if(value.method==='Runtime.exceptionThrown')errors.push(value.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(result.result?.exceptionDetails,undefined,JSON.stringify(result.result?.exceptionDetails));return result.result?.result?.value;};
 const width=width=>send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});
 const labels=()=>evaluate(`[...document.querySelectorAll('.ai-launchers button:not(.launch-plus)')].map(b=>b.getAttribute('aria-label')||b.textContent)`);
 const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(shot.result.data,'base64'));};
 await send('Runtime.enable');await width(1440);await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await until(()=>evaluate(`!!document.querySelector('.ai-launchers')`),'menu');
 assert.ok(!(await labels()).includes('Load'));await screenshot('00-no-saved-layout');
 await evaluate(`fixture.saved=true;refreshFixture()`);await until(async()=> (await labels()).includes('Load'),'Load');
 assert.equal((await labels())[0],'Load');await screenshot('01-online-empty-load-left');
 await evaluate(`[...document.querySelectorAll('.ai-launchers button')].find(b=>b.getAttribute('aria-label')==='Load').click()`);await until(async()=> (await labels()).at(-1)==='Save','restored');await screenshot('02-restored-save-right');
 await evaluate(`[...document.querySelectorAll('.ai-launchers button')].find(b=>b.getAttribute('aria-label')==='Save').click()`);await until(()=>evaluate('!!fixture.snapshot'),'capture');assert.equal(await evaluate('fixture.snapshot.version'),1);
 for(const count of [1,2]){await evaluate(`fixture.count=${count};refreshFixture()`);await until(async()=>!(await labels()).some(v=>v==='Save'||v==='Load'),'one/two panels');await screenshot('02-count-'+count+'-no-layout-actions');}
 await evaluate(`fixture.count=3;refreshFixture()`);await until(async()=> (await labels()).at(-1)==='Save','three panels');
 await width(700);await sleep(100);await evaluate(`document.querySelector('.launch-plus').click()`);assert.equal((await labels()).at(-1),'Save');await screenshot('03-compact-save-last');
 await evaluate(`document.querySelector('.launch-plus').click();fixture.count=0;refreshFixture()`);await sleep(100);await evaluate(`document.querySelector('.launch-plus').click()`);assert.equal((await labels())[0],'Load');await screenshot('04-compact-load-first');
 await evaluate(`fixture.mode='offline';refreshFixture()`);await until(async()=>!(await labels()).some(v=>v==='Save'||v==='Load'),'offline');await screenshot('05-offline-no-layout');
 assert.deepEqual(errors,[]);console.log('PASS: 5 Vue components compile; real App menu ordering, compact popup, online-only, Load→Save restore and capture verified. Screenshots: '+output);
}finally{socket?.close();chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));await sleep(200);rmSync(temporary,{recursive:true,force:true});}
