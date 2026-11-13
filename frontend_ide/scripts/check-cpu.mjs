// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 模擬計測を使い、実Vueの描画・取得失敗・非表示・破棄を確認する。配布物は作らない。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
import WebSocket from 'ws';
import {windowBounds} from '../デスクトップ/window-layout.cjs';
const {width:initialWidth,height:initialHeight}=windowBounds('cpu',{x:0,y:0,width:1920,height:1080});
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'cpu-check-'));
assert.equal(dirname(temporary),tmpdir());
const output=join(root,'temp/cpu-check');mkdirSync(output,{recursive:true});
const plugin={name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{const {descriptor}=parse(readFileSync(args.path,'utf8'));const id='data-v-cpu-'+Buffer.from(args.path).toString('hex').slice(-16),compiled=compileScript(descriptor,{id,inlineTemplate:true});const component=compiled.content.replace('export default','const component =')+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;`;return{contents:component+`\nconst style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>compileStyle({source:s.content,filename:args.path,id,scoped:s.scoped}).code).join('\n'))};document.head.append(style);`,resolveDir:dirname(args.path)};});}};
const result=await build({stdin:{contents:`import {createApp,h} from 'vue';import Cpu from './src/components/システム監視/CPUパネル.vue';
let count=0;window.calls=0;window.failed=false;window.gpuMissing=false;const originalTimeout=window.setTimeout,originalNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>originalNow()*50});window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms<=1000?ms/50:ms,...args);
window.fetch=async()=>{window.calls++;if(window.failed)throw Error('offline');count++;return{ok:true,json:async()=>({timestamp:Date.now(),cpu:28+20*Math.sin(count*.37),gpu:window.gpuMissing?null:48+38*Math.sin(count*.21),ram:65+4*Math.sin(count*.08)})};};
const app=createApp({render:()=>h(Cpu)});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,outdir:join(temporary,'panel'),format:'iife',plugins:[plugin],loader:{'.png':'dataurl'}});
const js=result.outputFiles.find(f=>!f.path.endsWith('.css'))?.text||result.outputFiles[0].text;
// Validate whole App import path too without generating distribution assets.
await build({entryPoints:[join(root,'src/App.vue')],bundle:true,write:false,outdir:join(temporary,'compile'),plugins:[plugin],loader:{'.png':'dataurl'}});
if(process.argv.includes('--compile-only')){rmSync(temporary,{recursive:true,force:true});console.log('PASS CPU and App compile');process.exit(0);}
const html=`<!doctype html><meta charset="utf-8"><style>${readFileSync(join(root,'src/style.css'),'utf8')}html,body,#app{width:100%;height:100%;margin:0}</style><div id="app"></div><script src="/app.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--remote-debugging-port=0','--window-size=460,260','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserErrors='';chrome.stderr.on('data',d=>browserErrors+=String(d));const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
 let port;for(let i=0;i<200;i++){try{port=Number(readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{}if(port)break;await sleep(50);}assert.ok(port,browserErrors);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',value=>{const d=JSON.parse(value);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params);});
 const send=(method,params={})=>new Promise(r=>{pending.set(++id,r);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r));return r.result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:initialWidth,height:initialHeight,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await sleep(1600);
 assert.equal(await evaluate('document.documentElement.scrollWidth'),initialWidth);
 assert.equal(await evaluate('document.documentElement.scrollHeight'),initialHeight);
 assert.equal(await evaluate('document.querySelectorAll(".cpu-label text").length'),3);assert.equal(await evaluate('document.querySelectorAll("path[fill-opacity]").length'),2);
 assert.equal(await evaluate(`[...document.querySelectorAll('.cpu-label')].every(label=>{
  const badge=label.querySelector('rect'),text=label.querySelector('text');
  return getComputedStyle(badge).fill===getComputedStyle(label).color&&getComputedStyle(text).fill==='rgb(0, 0, 0)';
 })`),true);
 assert.equal(await evaluate(`[...document.querySelectorAll('.cpu-label')].every(label=>{
  const badge=label.querySelector('rect').getBBox(),text=label.querySelector('text').getBBox();
  return Math.abs((text.x+text.width/2)-(badge.x+badge.width/2))<1&&
   Math.abs((text.y+text.height/2)-(badge.y+badge.height/2))<1;
 })`),true);
 const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'cpu-gpu-ram.png'),Buffer.from(shot.result.data,'base64'));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:initialWidth-1,y:initialHeight-1});
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-title')).opacity"),'1');
 await evaluate("document.querySelector('.cpu-panel').focus()");
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-title')).opacity"),'1');
 assert.equal(await evaluate("document.querySelector('.connection-bar')"),null);
 const chart=await evaluate("document.querySelector('.cpu-chart').getBoundingClientRect().height");
 for(let index=0;index<6;index++){
  await evaluate("document.querySelector('.cpu-display-toggle').click()");
  assert.equal(await evaluate("document.querySelector('.cpu-display-mark').textContent"),'▷');
  assert.equal(await evaluate("getComputedStyle(document.documentElement).backgroundColor"),'rgba(0, 0, 0, 0)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-panel')).backgroundColor"),'rgba(0, 0, 0, 0)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-title')).backgroundColor"),'rgb(48, 52, 58)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-title')).opacity"),'1');
  assert.equal(await evaluate("document.querySelector('.cpu-chart').getBoundingClientRect().height"),chart);
  await evaluate("document.querySelector('.cpu-display-toggle').click()");
  assert.equal(await evaluate("document.querySelector('.cpu-display-mark').textContent"),'▽');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cpu-panel')).backgroundColor"),'rgb(0, 0, 0)');
 }
 await evaluate('gpuMissing=true');await sleep(100);assert.equal(await evaluate(`[...document.querySelectorAll('.cpu-label text')].some(el=>el.textContent.startsWith('GPU'))`),false);assert.equal(await evaluate("document.querySelector('.cpu-caption')"),null);
 await evaluate('failed=true');await sleep(100);assert.match(await evaluate('document.body.textContent'),/CPU —/);
 await evaluate('failed=false;gpuMissing=false');await sleep(100);assert.doesNotMatch(await evaluate('document.body.textContent'),/再試行中/);assert.equal(await evaluate(`[...document.querySelectorAll('.cpu-label text')].some(el=>el.textContent.startsWith('GPU'))`),true);
 await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);const before=await evaluate('calls');
 const retainedGraph=await evaluate(`document.querySelector('.cpu-chart svg').innerHTML`);await sleep(100);assert.equal(await evaluate('calls'),before);
 assert.equal(await evaluate(`document.querySelector('.cpu-chart svg').innerHTML`),retainedGraph);
 await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))`);await sleep(100);assert.ok(await evaluate('calls')>before);
 // A cleared history would contain only the few samples since resume, not the retained graph.
 assert.ok(await evaluate(`document.querySelector('.cpu-chart path[stroke="currentColor"]').getAttribute('d').split(/[ML]/).length`)>30);
 await send('Emulation.setDeviceMetricsOverride',{width:240,height:125,deviceScaleFactor:1,mobile:false});await sleep(100);assert.equal(await evaluate('document.documentElement.scrollWidth'),240);assert.equal(await evaluate('document.documentElement.scrollHeight'),125);
 const small=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'cpu-small.png'),Buffer.from(small.result.data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
 await evaluate("document.querySelector('.cpu-panel').classList.add('cpu-floating')");
 assert.deepEqual(await evaluate("(()=>{const r=document.querySelector('.cpu-panel').getBoundingClientRect();return{width:r.width,height:r.height};})()"),{width:400,height:125});
 await send('Emulation.setDeviceMetricsOverride',{width:320,height:250,deviceScaleFactor:1,mobile:false});
 assert.equal(await evaluate("document.querySelector('.cpu-panel').getBoundingClientRect().width"),304);
 assert.equal(await evaluate('document.documentElement.scrollWidth'),320);
 await evaluate('dispose()');const stopped=await evaluate('calls');await sleep(100);assert.equal(await evaluate('calls'),stopped);assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS CPU render, GPU unavailable, request failure/recovery, hidden/resume, small size and disposal');
}finally{socket?.close();chrome.kill();server.close();await sleep(200);rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:150});}
