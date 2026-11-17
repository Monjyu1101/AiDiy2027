// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 実VueとWebGLだけの隔離画面。AI・DB・ユーザー設定への接続なし。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/navigation-origami-check');mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{contents:`import {createApp,h} from 'vue';import Origami from './src/components/開発スペース/ナビ折り紙3D.vue';const app=createApp({render:()=>h(Origami,{onUnsupported:()=>window.unsupported=true})});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(b){b.onLoad({filter:/\.vue$/},args=>{
  const {descriptor}=parse(readFileSync(args.path,'utf8')),compiled=compileScript(descriptor,{id:'origami',inlineTemplate:true});
  const content=compiled.content.replace('shallowRef(折り紙を選ぶ())','shallowRef(折り紙を選ぶ(()=>0))').replace('redraw=()=>draw();',`redraw=()=>draw();window.origami={choose(id){work.value=折り紙を選ぶ(()=>id==='crane'?.75:.25);steps=work.value.steps;runtime=再生状態を作る(steps);loaded=-1;fitKey='';sync();draw();},finish(){runtime=再生状態を作る(steps,steps.length-1);runtime.phase='turn';runtime.elapsed=1.8;playing.value=true;},get work(){return work.value.id;},get state(){return {...runtime};},get count(){return steps.length;},seek(n,t=0,phase='fold'){playing.value=false;runtime=再生状態を作る(steps,n);runtime.yaw=steps[n].view;runtime.elevation=steps[n].elevation;runtime.amount=t;runtime.phase=phase;sync();draw();},advance(dt){再生を進める(runtime,steps,dt);sync();draw();},get memory(){return {...renderer.info.memory};}};`);
  return {contents:content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: origami Vue compiles');process.exit(0);}
const html=`<!doctype html><meta charset="utf-8"><style>html,body,#app{margin:0;width:100%;height:100%;background:#0b1013}input{position:fixed;left:0;bottom:0;width:1px;opacity:0}</style><div id="app"></div><input aria-label="試験入力"><script src="/app.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=mkdtempSync(join(tmpdir(),'navi-origami-'));
const chrome=spawn(process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'),['--headless=new','--enable-unsafe-swiftshader','--remote-debugging-port=0','--window-size=960,820','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
  let port;for(let n=0;n<300;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{}if(/^\d+$/.test(port||''))break;await sleep(100);}
  assert.ok(port,'Chromium starts');const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');let id=0;const pending=new Map(),errors=[];
  socket.on('message',raw=>{const data=JSON.parse(raw);if(data.id)pending.get(data.id)?.(data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},20000);pending.set(n,value=>{clearTimeout(timer);pending.delete(n);resolve(value);});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r));return r.result.result.value;};
  const capture=async name=>{await sleep(160);const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(r.result.data,'base64'));};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:800,height:760,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  for(let i=0;i<300;i++){if(await evaluate('!!window.origami&&!!document.querySelector(".ready")'))break;await sleep(100);}
  assert.equal(await evaluate('!!window.origami&&!window.unsupported'),true,'WebGL supported');
  for(const [n,t,name] of [[0,0,'01-square'],[1,.5,'02-first-fold'],[3,.5,'03-unfold'],[7,1,'04-flaps'],[8,.5,'05-horn-fold'],[12,.5,'06-front-sheet'],[14,.5,'07-back-sheet'],[15,0,'08-complete']]){
    await evaluate(`origami.seek(${n},${t},${n===0||n===15?"'hold'":"'fold'"})`);await capture(name);
  }
  await evaluate("origami.choose('crane')");
  for(const [n,t,name] of [[6,.5,'11-crane-square-base'],[14,.5,'12-crane-petal'],[21,1,'13-crane-bird-base'],[24,.6,'14-crane-neck'],[33,0,'15-crane-complete']]){
    await evaluate(`origami.seek(${n},${t},${n===33?"'hold'":"'fold'"})`);await capture(name);
  }
  assert.equal(await evaluate("document.querySelector('header strong').textContent"),'折り鶴');
  await evaluate('window.savedRandom=Math.random;Math.random=()=>.25;origami.finish()');
  for(let n=0;n<100;n++){if(await evaluate("origami.work==='kabuto'"))break;await sleep(50);}
  assert.equal(await evaluate('origami.work'),'kabuto','completed crane randomly selects helmet');
  await evaluate('Math.random=()=>.75;origami.finish()');
  for(let n=0;n<100;n++){if(await evaluate("origami.work==='crane'"))break;await sleep(50);}
  assert.equal(await evaluate('origami.work'),'crane','completed helmet randomly selects crane');
  await evaluate("Math.random=savedRandom;origami.choose('kabuto');origami.seek(15,0,'hold')");
  const initialMemory=await evaluate('origami.memory');
  for(let repeat=0;repeat<2;repeat++)for(let n=0;n<16;n++)await evaluate(`origami.seek(${n},.5)`);
  const finalMemory=await evaluate('origami.memory');assert.ok(finalMemory.geometries<=initialMemory.geometries+8,'geometry does not accumulate');
  await evaluate('origami.seek(8,0,"guide")');await capture('09-fold-guide');
  const paused=await evaluate('origami.state');await sleep(400);assert.deepEqual(await evaluate('origami.state'),paused,'pause freezes paper and camera');
  await evaluate(`document.querySelector('input').focus();document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true}))`);await sleep(150);assert.deepEqual(await evaluate('origami.state'),paused,'text input keeps Space');
  await evaluate(`document.querySelector('section').focus();document.querySelector('section').dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',bubbles:true,cancelable:true}))`);assert.equal(await evaluate('origami.state.index'),9);
  await evaluate(`document.querySelector('[aria-label="再生"]').click()`);await sleep(600);assert.notDeepEqual(await evaluate('origami.state'),paused,'resume advances');
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:400,deviceScaleFactor:1,mobile:false});await evaluate('origami.seek(15,0,"hold")');await capture('10-small');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');
  assert.equal(await evaluate(`(()=>{const c=document.querySelector('canvas').getBoundingClientRect(),f=document.querySelector('footer').getBoundingClientRect();return c.height>80&&c.bottom<=f.top+1;})()`),true,'caption does not cover paper');
  await evaluate("origami.choose('crane');origami.seek(33,0,'hold')");await capture('16-crane-small');
  await evaluate('dispose()');assert.equal(await evaluate('document.querySelectorAll("canvas").length'),0);assert.deepEqual(errors,[]);
  // reduced-motion は開始時停止。明示再生は利用できる。
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await send('Page.reload');await sleep(1800);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="再生"]')`),true);
  console.log('PASS: real WebGL, key/input handling, pause/resume, small layout, reduced motion, disposal and bounded resources. Screenshots: '+output);
}finally{
  socket?.close();
  // この試験で作ったChromeだけを子も含めて終了し、通常のChromeには触れない。
  if(chrome.exitCode===null&&chrome.signalCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});else chrome.kill();}
  server.closeAllConnections();await new Promise(r=>server.close(r));await sleep(300);
  const rel=relative(resolve(tmpdir()),resolve(profile));if(rel.startsWith('navi-origami-')&&!rel.includes('..')&&existsSync(profile))try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{}
}
