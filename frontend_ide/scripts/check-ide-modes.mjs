// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実App/タイトル開閉を使用し、宇宙表示とIPCだけを模擬してモード選択を確認する。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/ide-modes-check');
for(const name of ['App.vue','components/開発スペース/Naviパネル.vue','components/開発スペース/開発スペース.vue','components/ファイル閲覧/ファイル一覧.vue','components/ファイル閲覧/閲覧セッション.vue']){
 const {descriptor,errors}=parse(readFileSync(join(root,'src',name),'utf8'),{filename:name});assert.deepEqual(errors,[]);compileScript(descriptor,{id:name,inlineTemplate:true});
}
const bundle=await build({stdin:{resolveDir:root,contents:`import {createApp,h,nextTick} from 'vue';import App from './src/App.vue';
window.fixture={mode:'online',active:true,calls:[],deny:false};const f=window.fixture;
window.fetch=async()=>({ok:true,json:async()=>({active:f.active,mode:f.mode,connected:true,startedAt:1,project:{path:'/fixture',name:'IDE fixture'}})});
if(!location.search.includes('web'))window.aidiyWindow={collapsePanel:async collapsed=>{f.calls.push(collapsed);await new Promise(r=>setTimeout(r,220));return{ok:!f.deny};},childWindows:async()=>({}),allDisplays:async()=>({ok:true,active:false}),onAllDisplaysChanged:()=>()=>{}};
createApp({render:()=>h(App,{config:{kind:'ide'}})}).mount('#app');window.refreshFixture=async()=>{document.querySelector('.ide-toolbar-right').dispatchEvent(new MouseEvent('mouseenter'));await nextTick();};`},bundle:true,write:false,format:'iife',plugins:[{name:'layout-fixture',setup(b){b.onLoad({filter:/\.vue$/},args=>{
 if(basename(args.path)==='開発スペース.vue')return{contents:`import {h} from 'vue';export default {props:['viewMode'],setup(p){return()=>h('div',{class:'space-view','data-mode':p.viewMode},[h('input',{value:'保持した選択'}),h('p','開発スペース本文')]);}}`};
 if(!['App.vue','起動メニュー.vue','状態バー.vue','開始表示.vue','パネル表示切替.vue'].includes(basename(args.path)))return{contents:`export default {setup(p,{expose}){expose({captureLayout:()=>({explorer:{},viewers:[]}),restoreLayout:async()=>[]});return()=>null;}};`};
 const {descriptor}=parse(readFileSync(args.path,'utf8'));const script=compileScript(descriptor,{id:args.path,inlineTemplate:true});const styles=descriptor.styles.map(style=>compileStyle({source:style.content,id:args.path,scoped:false}).code).join('\n');return{contents:script.content+`\n{const s=document.createElement('style');s.textContent=${JSON.stringify(styles)};document.head.append(s);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: real App/title/toggle compile; SpaceView and native IPC are mocked (no screenshot in compile-only mode).');process.exit(0);}
mkdirSync(output,{recursive:true});const temporary=mkdtempSync(join(tmpdir(),'ide-modes-'));
const css=readFileSync(join(root,'src/style.css'),'utf8')+readFileSync(join(root,'src/components/共通表示/会話表示.css'),'utf8');
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
 await send('Runtime.enable');await width(1000);
 for(const mode of ['native','web']){
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?${mode}`});await until(()=>evaluate(`!!document.querySelector('.space-view')`),'IDE');
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.ide-view-modes').length`),1);
  assert.equal(await evaluate(`!!document.querySelector('.panel-brand .ide-view-modes')`),true);
  await evaluate(`window.retained=document.querySelector('.space-view');document.querySelector('.space-view input').value='選択を保持';`);
  await screenshot(mode+'-01-expanded');
  await click('.code-panel-toggle');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.code-panel-toggle').getAttribute('aria-expanded')`),'false');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.connection-bar')).display`),'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.space-view')).display`),'none');
  if(mode==='web')assert.equal(await evaluate(`document.querySelector('.development-app').getBoundingClientRect().height`),31);
  await screenshot(mode+'-02-collapsed');
  await click('.ide-view-modes button:nth-child(2)');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.space-view').dataset.mode`),'2d');
  assert.equal(await evaluate(`document.querySelector('.code-panel-toggle').getAttribute('aria-expanded')`),'true');
  assert.equal(await evaluate(`window.retained===document.querySelector('.space-view')`),true);
  assert.equal(await evaluate(`document.querySelector('.space-view input').value`),'選択を保持');
  await click('.code-panel-toggle');await sleep(300);await click('.ide-view-modes button:first-child');await sleep(40);await click('.ide-view-modes button:nth-child(2)');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.space-view').dataset.mode`),'2d');
  await click('.code-panel-toggle');await sleep(40);await click('.code-panel-toggle');await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.code-panel-toggle').getAttribute('aria-expanded')`),'true');
  await click('.ide-view-modes button:first-child');assert.equal(await evaluate(`document.querySelector('.space-view').dataset.mode`),'3d');
  if(mode==='native'){await evaluate('fixture.deny=true');await click('.code-panel-toggle');await sleep(300);assert.equal(await evaluate(`document.querySelector('.code-panel-toggle').getAttribute('aria-expanded')`),'true');}
  await screenshot(mode+'-03-restored');
 }
 assert.deepEqual(errors,[]);console.log('PASS: real App title modes and shared toggle, native mock/Web collapse, 2D/3D expand, latest click, rapid reversal, rejected IPC, retained DOM/input. Screenshots: '+output);

}finally{socket?.close();chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));await sleep(200);rmSync(temporary,{recursive:true,force:true});}
