// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 模擬画面のみ。AI、業務API、配布用サーバーを起動しない。
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
const root=fileURLToPath(new URL('..',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'navi-scenery-'));
const output=join(root,'temp/navigation-scenery-check');mkdirSync(output,{recursive:true});
const result=await build({stdin:{contents:`import {createApp,h} from 'vue';import Scene from './src/components/開発スペース/ナビ風景.vue';
const apps=[];for(const kind of ['aquarium','kaleidoscope','water']){const box=document.createElement('section');box.id=kind;document.body.append(box);const app=createApp({render:()=>h(Scene,{kind})});app.mount(box);apps.push(app);}window.dispose=()=>apps.forEach(app=>app.unmount());`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor}=parse(readFileSync(args.path,'utf8'));
 const compiled=compileScript(descriptor,{id:'scenery',inlineTemplate:true});
 return {contents:compiled.content+`\nconst style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);`,resolveDir:dirname(args.path)};
});}}]});
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000;color:white;font-family:sans-serif;display:flex;flex-wrap:wrap}section{position:relative;width:400px;height:320px;border:1px solid #263845}input{position:fixed;top:330px;left:10px}iframe{width:420px;height:350px;border:0}</style><input aria-label="目標" value="入力を維持"><script src="/app.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--remote-debugging-port=0','--window-size=1240,760','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserErrors='';chrome.stderr.on('data',data=>{browserErrors+=String(data);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
try{
 let port;for(let i=0;i<200;i++){try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await sleep(50);}}
 assert.ok(port,'Chromium起動: '+browserErrors);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await sleep(1800);
 assert.equal(await evaluate('document.querySelectorAll("canvas").length'),3);
 const pixels=await evaluate(`[...document.querySelectorAll('canvas')].map(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0,black=0;for(let i=0;i<p.length;i+=4){if(p[i]+p[i+1]+p[i+2]>0)lit++;else black++;}return {lit,black};})`);
 for(const p of pixels){assert.ok(p.lit>100,JSON.stringify(p));assert.ok(p.black>1000,JSON.stringify(p));}
 assert.equal(await evaluate(`(()=>{const e=document.querySelector('.navigation-water');e.focus();const key=new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),true);
 assert.equal(await evaluate(`(()=>{const e=document.querySelector('input');e.focus();const key=new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),false);
 assert.equal(await evaluate(`(()=>{const e=document.querySelector('.navigation-water');e.focus();const key=new KeyboardEvent('keydown',{code:'Space',repeat:true,bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),false);
 const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'three-scenes.png'),Buffer.from(screenshot.result.data,'base64'));
 // 同一オリジンの別Documentへ実DOMを移動し、フォーカスと所有窓のキーを検証。
 await evaluate(`(()=>{const frame=document.createElement('iframe');document.body.append(frame);const doc=frame.contentDocument;for(const style of document.querySelectorAll('style'))doc.head.append(style.cloneNode(true));const section=document.querySelector('#water');doc.body.append(section);section.querySelector('[tabindex]').focus();window.testFrame=frame;})()`);await sleep(300);
 assert.equal(await evaluate(`(()=>{const doc=testFrame.contentDocument,e=doc.querySelector('.navigation-water');const key=new testFrame.contentWindow.KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),true);
 assert.equal(await evaluate(`(()=>{const doc=testFrame.contentDocument,e=doc.createElement('div');e.contentEditable='plaintext-only';doc.body.append(e);e.focus();const key=new testFrame.contentWindow.KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),false);
 await evaluate(`document.body.append(testFrame.contentDocument.querySelector('#water'));document.querySelector('.navigation-water').focus()`);await sleep(200);
 assert.equal(await evaluate(`(()=>{const e=document.querySelector('.navigation-water'),key=new KeyboardEvent('keydown',{code:'Space',bubbles:true,cancelable:true});e.dispatchEvent(key);return key.defaultPrevented;})()`),true);
 await evaluate('dispose()');await sleep(100);assert.equal(await evaluate('document.querySelectorAll("canvas").length'),0);assert.deepEqual(errors,[]);
 console.log('PASS: three black scenes render; Space, repeat, editable input, cross-document move/restore, and unmount; screenshot: '+join(output,'three-scenes.png'));
}finally{socket?.close();chrome.kill();await new Promise(resolve=>server.close(resolve));await sleep(200);rmSync(temporary,{recursive:true,force:true});}
