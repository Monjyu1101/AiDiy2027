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
const output=mockOutput(join(root,'temp/navigation-aquarium3d-check'));mkdirSync(output,{recursive:true});
const result=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import Aquarium from './src/components/開発スペース/ナビアクアリウム3D.vue';
window.unsupportedCount=0;const shown=ref(true),app=createApp({render:()=>shown.value?h(Aquarium,{onUnsupported:()=>{window.unsupportedCount++;shown.value=false}}):null});app.mount('#app');window.hide=()=>shown.value=false;window.show=()=>shown.value=true;window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(build){
 build.onLoad({filter:/ナビアクアリウム3D描画\.js$/},args=>({contents:readFileSync(args.path,'utf8').replace('return {resize,render,dispose:release,','globalThis.ナビアクアリウム3D検証={renderer,scene,camera};return {resize,render,dispose:release,'),resolveDir:dirname(args.path)}));
 build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor}=parse(readFileSync(args.path,'utf8'));
 const compiled=compileScript(descriptor,{id:'aquarium3d',inlineTemplate:true});
 return {contents:compiled.content.replace('let ナビアクアリウム3D描画;','globalThis.ナビアクアリウム3D状態=ナビアクアリウム3D状態;let ナビアクアリウム3D描画;')+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.src?readFileSync(join(dirname(args.path),s.src),'utf8'):s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){
 removeMockDirectory(temporary);
 console.log('PASS: 3D aquarium compiles');process.exit(0);
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
 await wait('!!document.querySelector(".ナビアクアリウム3D.ready")','WebGL ready');
 assert.equal(await evaluate('ナビアクアリウム3D検証.renderer.info.programs.every(p=>p.diagnostics?.runnable!==false)'),true,'shaders compile');
 assert.equal(await evaluate('ナビアクアリウム3D状態.fish.length'),24);
 await capture('aquarium3d-wide');
 console.log('RENDER',await evaluate('JSON.stringify({calls:ナビアクアリウム3D検証.renderer.info.render.calls,triangles:ナビアクアリウム3D検証.renderer.info.render.triangles,geometries:ナビアクアリウム3D検証.renderer.info.memory.geometries})'));
 // 実入力から水面に4粒。深いクリックでも水面から落ちる。
 await evaluate(`document.querySelector('.ナビアクアリウム3D').dispatchEvent(new MouseEvent('click',{button:0,clientX:700,clientY:500}));`);
 assert.equal(await evaluate('ナビアクアリウム3D状態.food.length'),4);
 assert.ok(await evaluate('ナビアクアリウム3D状態.food.every(p=>p.y>4.6&&p.x>0)'));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:700,y:350});await sleep(900);
 assert.ok(await evaluate('ナビアクアリウム3D状態.bubbles.length>0'));
 await capture('aquarium3d-feeding');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:980,y:620});
 await evaluate('ナビアクアリウム3D状態.food.length=0');
 await evaluate(`document.querySelector('input').focus()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
 assert.equal(await evaluate('ナビアクアリウム3D状態.food.length'),0,'input must not feed');
 await evaluate(`document.querySelector('.ナビアクアリウム3D').focus()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
 assert.equal(await evaluate('ナビアクアリウム3D状態.food.length'),4,'keyboard feeds');
 // 小さい待機パネル・縦長窓とDPR変更。
 await evaluate(`document.querySelector('#app').style.cssText='position:relative;width:360px;height:420px'`);await sleep(500);await capture('aquarium3d-narrow');
 assert.equal(await evaluate('document.querySelector("canvas").width'),360);
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:2,mobile:false});await sleep(500);
 assert.equal(await evaluate('document.querySelector("canvas").width'),540,'DPR capped at 1.5');
 await send('Emulation.clearDeviceMetricsOverride');
 // 折り畳み中は描画しない。再表示で再開。
 await evaluate(`document.querySelector('#app').style.display='none'`);await sleep(150);
 const frame=await evaluate('ナビアクアリウム3D検証.renderer.info.render.frame');await sleep(250);assert.equal(await evaluate('ナビアクアリウム3D検証.renderer.info.render.frame'),frame);
 await evaluate(`document.querySelector('#app').style.display='block'`);await sleep(300);assert.ok(await evaluate('ナビアクアリウム3D検証.renderer.info.render.frame')>frame);
 // ownerDocument変更でRAF・入力を移し、元へ戻す。
 await evaluate(`window.testFrame=document.createElement('iframe');document.body.append(testFrame);testFrame.contentDocument.head.innerHTML='<style>body{margin:0}#app{position:relative;width:400px;height:360px}.ナビアクアリウム3D{position:absolute;inset:0}.ナビアクアリウム3D canvas{width:100%;height:100%}</style>';testFrame.contentDocument.body.append(document.querySelector('#app'));`);
 await sleep(500);const moved=await evaluate('ナビアクアリウム3D検証.renderer.info.render.frame');await sleep(200);assert.ok(await evaluate('ナビアクアリウム3D検証.renderer.info.render.frame')>moved);
 await evaluate(`document.body.prepend(testFrame.contentDocument.querySelector('#app'));testFrame.remove()`);await sleep(300);
 // コンテキスト喪失では開始表示へ戻すイベントを通知し、資源を解放。
 await evaluate(`window.oldScene=ナビアクアリウム3D検証;document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`);
 await wait('unsupportedCount===1&&!document.querySelector("canvas")','context-loss unsupported');
 assert.equal(await evaluate('ナビアクアリウム3D状態.fish.length'),0);assert.equal(await evaluate('oldScene.renderer.info.memory.geometries'),0);
 await evaluate('show()');await wait('!!document.querySelector(".ナビアクアリウム3D.ready")','remount');
 await evaluate('hide()');await sleep(100);
 await evaluate(`window.originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:originalContext.call(this,type,...args)};show()`);
 await wait('unsupportedCount===2&&!document.querySelector("canvas")','initial WebGL unsupported');
 await evaluate('HTMLCanvasElement.prototype.getContext=originalContext;dispose()');await sleep(200);
 assert.equal(await evaluate('ナビアクアリウム3D状態.fish.length'),0);assert.equal(await evaluate('ナビアクアリウム3D検証.renderer.info.memory.geometries'),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: 3D drawing, feed, hover, keyboard, resize, DPR, hidden, document move, unsupported notification and disposal');

}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}await new Promise(resolve=>server.close(resolve));await sleep(200);removeMockDirectory(temporary);}
