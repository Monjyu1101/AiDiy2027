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
const output=mockOutput(join(root,'temp/navigation-water3d-check'));mkdirSync(output,{recursive:true});
const result=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import Aquarium from './src/components/開発スペース/ナビ水面波紋3D.vue';
window.unsupportedCount=0;const shown=ref(true),app=createApp({render:()=>shown.value?h(Aquarium,{onUnsupported:()=>{window.unsupportedCount++;shown.value=false}}):null});app.mount('#app');window.hide=()=>shown.value=false;window.show=()=>shown.value=true;window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(build){
 build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor}=parse(readFileSync(args.path,'utf8'));
 const compiled=compileScript(descriptor,{id:'aquarium3d',inlineTemplate:true});
 return {contents:compiled.content.replace('const water=new THREE.Mesh','globalThis.waterTest={renderer,scene,camera,ripples,uniforms};const water=new THREE.Mesh')+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.src?readFileSync(join(dirname(args.path),s.src),'utf8'):s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){
 removeMockDirectory(temporary);
 console.log('PASS: 3D water ripples compile');process.exit(0);
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
 const wait=async(expr,label)=>{for(let n=0;n<150;n++){if(await evaluate(expr))return;await sleep(60);}throw Error('Timeout: '+label);};
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(shot.result.data,'base64'));};
 await wait('!!document.querySelector(".ナビ水面波紋3D.ready")','water WebGL ready');
 assert.equal(await evaluate('waterTest.renderer.info.programs.every(p=>p.diagnostics?.runnable!==false)'),true);
 await capture('water3d-wide');
 const first=await evaluate('waterTest.uniforms.time.value');await sleep(350);assert.ok(await evaluate('waterTest.uniforms.time.value')>first);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:480,y:300});await sleep(250);
 assert.ok(await evaluate('waterTest.ripples.points.some(p=>Math.abs(p.x-.5)<.01&&Math.abs(p.y-.5)<.01)'),'hover hits water surface');
 await evaluate(`(()=>{const el=document.querySelector('.ナビ水面波紋3D');el.dispatchEvent(new MouseEvent('click',{button:0,clientX:680,clientY:420}));})()`);
 await sleep(600);await capture('water3d-ripples');
 for(const [target,repeat,expected]of [['input',false,false],['.ナビ水面波紋3D',true,false],['.ナビ水面波紋3D',false,true]]){
   const prevented=await evaluate(`(()=>{const el=document.querySelector('${target}');el.focus();const event=new KeyboardEvent('keydown',{code:'Space',repeat:${repeat},bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;})()`);assert.equal(prevented,expected);
 }
 await evaluate(`(()=>{const el=document.querySelector('.ナビ水面波紋3D');for(let i=0;i<100;i++)el.dispatchEvent(new MouseEvent('click',{button:0,clientX:400,clientY:350}));})()`);
 assert.equal(await evaluate('waterTest.ripples.points.length'),32);
 await evaluate(`document.querySelector('#app').style.cssText='position:relative;width:360px;height:420px'`);await sleep(500);await capture('water3d-narrow');
 assert.equal(await evaluate('document.querySelector("canvas").width'),360);
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:2,mobile:false});await sleep(400);assert.equal(await evaluate('document.querySelector("canvas").width'),540);await send('Emulation.clearDeviceMetricsOverride');
 await evaluate(`document.querySelector('#app').style.display='none'`);await sleep(150);const paused=await evaluate('waterTest.uniforms.time.value');await sleep(150);assert.equal(await evaluate('waterTest.uniforms.time.value'),paused);
 await evaluate(`document.querySelector('#app').style.display='block'`);await sleep(300);assert.ok(await evaluate('waterTest.uniforms.time.value')>paused);
 await evaluate(`window.testFrame=document.createElement('iframe');document.body.append(testFrame);for(const style of document.querySelectorAll('style'))testFrame.contentDocument.head.append(style.cloneNode(true));testFrame.contentDocument.body.append(document.querySelector('#app'));`);
 await sleep(300);const moved=await evaluate('waterTest.uniforms.time.value');await sleep(150);assert.ok(await evaluate('waterTest.uniforms.time.value')>moved);
 await evaluate(`document.body.prepend(testFrame.contentDocument.querySelector('#app'));testFrame.remove()`);await sleep(250);
 await evaluate(`document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`);
 await wait('unsupportedCount===1&&!document.querySelector("canvas")','water unsupported notification');
 assert.equal(await evaluate('waterTest.renderer.info.memory.geometries'),0);assert.equal(await evaluate('waterTest.ripples.points.length'),0);
 await evaluate('show()');await wait('!!document.querySelector(".ナビ水面波紋3D.ready")','water remount');
 await evaluate('dispose()');await sleep(100);assert.equal(await evaluate('waterTest.renderer.info.memory.geometries'),0);assert.equal(await evaluate('document.querySelectorAll("canvas").length'),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: 3D water render, projected hover, click, Space, editable/repeat exclusion, 32-wave limit, resize/DPR, hidden, document move, unsupported and disposal');

}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}await new Promise(resolve=>server.close(resolve));await sleep(200);removeMockDirectory(temporary);}
