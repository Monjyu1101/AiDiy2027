// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vueと共通CSSで接続バーの三状態・繰り返し切替・脈動を検証する。配布物は作らない。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'connection-bar-check-'));
const output=join(root,'temp/connection-bar-check');mkdirSync(output,{recursive:true});
const plugin={name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{const {descriptor}=parse(readFileSync(args.path,'utf8'));const compiled=compileScript(descriptor,{id:args.path,inlineTemplate:true});return{contents:compiled.content+`\nconst style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);`,resolveDir:dirname(args.path)};});}};
const result=await build({stdin:{contents:`import {createApp,h,reactive,nextTick} from 'vue';import StatusBar from './src/components/共通表示/状態バー.vue';import './src/style.css';
window.state=reactive({mode:'online',connected:false});window.tick=nextTick;
const app=createApp({render:()=>h('main',[true,false].map(clockPulse=>h('section',{style:'margin:24px 0'},[h(StatusBar,{title:clockPulse?'Code / IDE (clockPulse)':'CSS fallback',...window.state,clockPulse})])))});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,outdir:join(temporary,'panel'),format:'iife',plugins:[plugin],loader:{'.png':'dataurl'}});
const js=result.outputFiles.find(f=>!f.path.endsWith('.css')).text;
const css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
await build({entryPoints:[join(root,'src/App.vue')],bundle:true,write:false,outdir:join(temporary,'compile'),plugins:[plugin],loader:{'.png':'dataurl'}});
if(process.argv.includes('--compile-only')){rmSync(temporary,{recursive:true,force:true});console.log('PASS StatusBar and App compile');process.exit(0);}
const html=`<!doctype html><meta charset="utf-8"><style>${css}html,body,#app{width:100%;height:100%;margin:0}</style><div id="app"></div><script src="/app.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--remote-debugging-port=0','--window-size=900,300','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserErrors='';chrome.stderr.on('data',d=>browserErrors+=String(d));const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let port;for(let i=0;i<200;i++){try{port=Number(readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{}if(port)break;await sleep(50);}assert.ok(port,browserErrors);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',value=>{const d=JSON.parse(value);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params);});
 const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r));return r.result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await sleep(500);
 const colors=()=>evaluate(`[...document.querySelectorAll('.connection-bar')].map(el=>getComputedStyle(el).backgroundColor)`);
 const set=async(mode,connected)=>{await evaluate(`Object.assign(window.state,${JSON.stringify({mode,connected})});window.tick()`);};
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(shot.result.data,'base64'));};
 for(let repeat=0;repeat<2;repeat++){
  for(const connected of [false,true]){
   await set('online',connected);await sleep(250);
   const samples=[];for(let n=0;n<4;n++){samples.push(await colors());await sleep(200);}
   for(let index=0;index<2;index++){
    assert.ok(new Set(samples.map(row=>row[index])).size>1,'脈動で色が変わる');
    for(const row of samples){const channels=row[index].match(/\d+/g).map(Number);if(connected){assert.equal(channels[0],0);assert.equal(channels[1],channels[2]);}else{assert.equal(channels[1],0);assert.equal(channels[2],0);}}
   }
   if(!repeat)await capture(connected?'connected-cyan':'disconnected-red');
  }
  // connected=true が遅れて残ってもOFFが優先される。
  await set('offline',true);
  for(let n=0;n<3;n++){assert.deepEqual(await colors(),['rgb(0, 0, 0)','rgb(0, 0, 0)']);await sleep(200);}
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.connection-bar')].map(el=>getComputedStyle(el).animationName)`),['none','none']);
  if(!repeat)await capture('offline-black');
 }
 await evaluate('window.dispose()');assert.equal(await evaluate(`document.querySelectorAll('.connection-bar').length`),0);assert.deepEqual(errors,[]);
 console.log('PASS connection bar: cyan/red pulse, static black OFF, stale connection, repeated toggles, CSS fallback, App compile. Screenshots: '+output);
}finally{socket?.close();chrome.kill();await new Promise(r=>server.close(r));rmSync(temporary,{recursive:true,force:true});}
