// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 模擬画面のみ。AI、業務API、配布用サーバーを起動しない。
import {mockOutput,mockStage,removeMockDirectory,readMockDebugPort} from '../checks/navigation-mock-support.mjs';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
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
const root=fileURLToPath(new URL('..',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'navi-scenery-'));
const output=mockOutput(join(root,'temp/navigation-scenery-check'));mkdirSync(output,{recursive:true});
const result=await build({stdin:{contents:`import {ナビ万華鏡2D描画を作成} from './src/components/開発スペース/ナビ万華鏡2D.js';window.makeKaleidoscope=ナビ万華鏡2D描画を作成;import {createApp,h} from 'vue';import Kaleidoscope from './src/components/開発スペース/ナビ万華鏡2D.vue';import Clock from './src/components/開発スペース/ナビ時計2D.vue';
const app=createApp({render:()=>h('div',{style:'display:flex'},[h('section',{style:'position:relative;width:400px;height:320px'},[h(Kaleidoscope)]),h('section',{style:'position:relative;width:400px;height:320px'},[h(Clock)])])});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor}=parse(readFileSync(args.path,'utf8')),compiled=compileScript(descriptor,{id:'scenery2d',inlineTemplate:true});
 const instrumented=compiled.content.replace('const ナビ万華鏡2D描画=ナビ万華鏡2D描画を作成();',`const ナビ万華鏡2D描画=ナビ万華鏡2D描画を作成();globalThis.kaleidoscopeRuntime=ナビ万華鏡2D描画;globalThis.kaleidoscopeFrames=[];const originalDraw=ナビ万華鏡2D描画.draw;ナビ万華鏡2D描画.draw=(...args)=>{const at=performance.now();originalDraw(...args);kaleidoscopeFrames.push({at,time:args[3],ms:performance.now()-at});};`);
 return {contents:instrumented+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.src?readFileSync(join(dirname(args.path),s.src),'utf8'):s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){
 removeMockDirectory(temporary);
 console.log('PASS: 2D kaleidoscope and clock compile');process.exit(0);
}
const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;color:white;font-family:sans-serif}#app{position:relative;width:960px;height:600px}input{position:absolute;top:610px}iframe{width:450px;height:400px;border:0}</style><div id="app"></div><input aria-label="目標" value="入力を維持"><script src="/app.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'),['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0','--window-size=1240,760','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserErrors='';chrome.stderr.on('data',data=>{browserErrors+=String(data);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
try{
 let port;for(let i=0;i<200;i++){port=readMockDebugPort(join(temporary,'DevToolsActivePort'));if(port)break;await sleep(50);}
 assert.ok(port,'Chromium起動: '+browserErrors);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await sleep(1800);
 const wait=async(expr,label)=>{for(let n=0;n<300;n++){if(await evaluate(expr))return;await sleep(60);}throw Error('Timeout: '+label);};
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(shot.result.data,'base64'));};
 await wait('document.querySelectorAll("#app canvas").length===2','2D scenes');
 assert.equal(await evaluate(`[...document.querySelectorAll('#app canvas')].every(c=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>0)lit++;return lit>100;})`),true);
 await capture('two-scenes-2d');
 const initial=await evaluate(`document.querySelector('.ナビ万華鏡2D').dataset.pattern`);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:240,y:160});await sleep(250);
 await capture('kaleidoscope2d-hover');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:240,y:160});
 await wait(`document.querySelector('.ナビ万華鏡2D').dataset.pattern!==${JSON.stringify(initial)}`,'click changes glass');
 await wait('kaleidoscopeRuntime.state.transition===1','slow glass transition complete');
 const clicked=await evaluate(`document.querySelector('.ナビ万華鏡2D').dataset.pattern`);
 await evaluate(`document.querySelector('input').focus();document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));`);
 assert.equal(await evaluate(`document.querySelector('.ナビ万華鏡2D').dataset.pattern`),clicked,'入力中のSpaceは奪わない');
 await evaluate(`const el=document.querySelector('.ナビ万華鏡2D');el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',repeat:true,bubbles:true}));`);
 assert.equal(await evaluate(`document.querySelector('.ナビ万華鏡2D').dataset.pattern`),clicked,'長押しを無視');
 await evaluate(`document.querySelector('.ナビ万華鏡2D').dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true}));`);
 await wait(`document.querySelector('.ナビ万華鏡2D').dataset.pattern!==${JSON.stringify(clicked)}`,'Space changes glass');
 await sleep(1000);assert.ok(await evaluate(`(()=>{const frames=kaleidoscopeFrames.slice(-20);return (frames.at(-1).time-frames[0].time)/((frames.at(-1).at-frames[0].at)/1000)<.4;})()`),'表示時計は実時間の約1/3で進む');console.log('VISIBLE_RENDER '+JSON.stringify(await evaluate(`(()=>{const frames=kaleidoscopeFrames.slice(-30);return {count:frames.length,meanDrawMs:frames.reduce((n,f)=>n+f.ms,0)/frames.length,meanIntervalMs:(frames.at(-1).at-frames[0].at)/(frames.length-1)};})()`)));
 // 同じ実装を決まった時刻で描き、全表情・遷移・フルサイズの画像を比較する。
 await evaluate(`window.optics=makeKaleidoscope();window.proof=document.createElement('canvas');proof.width=960;proof.height=680;proof.style.cssText='position:fixed;inset:0;width:960px;height:680px;z-index:100';document.body.append(proof);window.proofCtx=proof.getContext('2d');window.pixels=()=>proofCtx.getImageData(0,0,960,680).data;`);
 await send('Emulation.setDeviceMetricsOverride',{width:960,height:680,deviceScaleFactor:1,mobile:false});
 const names=[];
 for(let n=0;n<6;n++){
   await evaluate(`optics.draw(proofCtx,960,680,${n*9});optics.draw(proofCtx,960,680,${n*9+2.4});`);
   names.push(await evaluate('optics.state.name'));
   assert.ok(await evaluate(`(()=>{const data=pixels();let lit=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>65)lit++;return lit/data.length*4})()`)> .25,'画面全体にガラス模様がある');
   await capture('kaleidoscope2d-pattern-'+n);
 }
 assert.equal(new Set(names).size,6);
 await evaluate(`window.before=pixels();optics.setPointer({x:.9,y:.1});for(let t=47.5;t<=48.5;t+=.1)optics.draw(proofCtx,960,680,t);`);
 assert.ok(await evaluate(`(()=>{const after=pixels();let changed=0;for(let i=0;i<after.length;i+=4)if(Math.abs(after[i]-before[i])+Math.abs(after[i+1]-before[i+1])+Math.abs(after[i+2]-before[i+2])>35)changed++;return changed/(after.length/4);})()`)> .3,'ガラスの位置で模様そのものが組み替わる');
 await capture('kaleidoscope2d-glass-shift');
 const performance=await evaluate(`(()=>{const started=window.performance.now();for(let i=0;i<18;i++){optics.draw(proofCtx,960,680,48.6+i/30);proofCtx.getImageData(480,340,1,1);}return {meanFrameMs:(window.performance.now()-started)/18,patterns:6};})()`);
 console.log('OPTICAL_RENDER '+JSON.stringify(performance));

 await evaluate('optics.dispose();proof.remove()');
 await evaluate('dispose()');assert.equal(await evaluate('document.querySelectorAll("#app canvas").length'),0);assert.deepEqual(errors,[]);
 console.log('PASS: kaleidoscope2D: six optical patterns, mirror motion, click/Space, input/repeat exclusion, resource disposal; clock2D drawing');

}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}await new Promise(resolve=>server.close(resolve));await sleep(200);removeMockDirectory(temporary);}
