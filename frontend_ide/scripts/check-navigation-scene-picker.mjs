// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・入力イベントと模擬APIだけで確認。AIやユーザープロジェクトは操作しない。
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
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'navi-picker-'));
const output=join(root,'temp/navigation-scene-picker-check');mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import Panel from './src/components/開発スペース/Navigationパネル.vue';
const project=ref({path:'/fixture',name:'fixture'});window.changeProject=()=>project.value={path:'/changed',name:'changed'};const app=createApp({render:()=>h(Panel,{standalone:true,instance:'navi-1',startedAt:1,project:project.value})});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 if(args.path.endsWith('/コードパネル.vue'))return {contents:'export default {render:()=>null};'};
 const {descriptor}=parse(readFileSync(args.path,'utf8'));
 const compiled=compileScript(descriptor,{id:'picker',inlineTemplate:true});
 return {contents:compiled.content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
const css=readFileSync(join(root,'src/style.css'),'utf8');
const html=`<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body,#app{margin:0;width:100%;height:100%;background:#000;color:#e5edf8}</style><div id="app"></div><script src="/app.js"></script>`;
const result={schemaVersion:3,navigationId:'fixture',requestId:'initial',goal:'保存済みの目標',checkedAt:Date.now(),items:[{id:'first',name:'作業項目',progress:20,reason:'検証用の根拠',weight:100,weightReason:'検証用'}],overall:{progress:20,reason:'検証用の根拠'},nextItemId:'first',nextPrompt:'次の作業'};
let job=null,available=true;const requests=[];
const server=createServer(async(req,res)=>{
 const json=data=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
 if(req.url.startsWith('/api/navigation')){
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));job={id:'run-'+requests.length,status:'running'};return json({job});}
  if(req.method==='DELETE')return json({ok:true});
  return json({result,job,availability:{available,reason:available?'':'試験用の無効状態'},selection:{provider:'fixture',model:'mock'}});
 }
 if(req.url==='/api/connection')return json({active:true,mode:'online',startedAt:1,connected:true});
 if(req.url==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);
 if(req.url!=='/')return res.writeHead(404).end();
 res.writeHead(200,{'content-type':'text/html'}).end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0','--window-size=720,800','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserErrors='';chrome.stderr.on('data',data=>{browserErrors+=String(data);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
async function until(check,label){for(let n=0;n<150;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors);});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 const mouse=async(type,selectorOrPoint)=>{const p=typeof selectorOrPoint==='string'?await point(selectorOrPoint):selectorOrPoint;await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});return p;};
 const click=async selector=>{const p=await mouse('mousePressed',selector);await mouse('mouseReleased',p);};
 const dialog=()=>evaluate(`!!document.querySelector('dialog[open]')`);
 const reset=async()=>{job=null;available=true;await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await until(()=>evaluate(`document.querySelector('.navigation-evaluate')?.disabled===false`),'buttons');};
 const capture=async name=>{writeFileSync(join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');
 for(const selector of ['.navigation-start','.navigation-evaluate']){
  await reset();let before=requests.length;const p=await mouse('mousePressed',selector);await sleep(150);assert.equal(requests.length,before,'押下では実行しない');await mouse('mouseReleased',p);await until(()=>requests.length===before+1,'release');assert.equal(requests.at(-1).action,selector.endsWith('evaluate')?'evaluate':'navigate');
  await reset();before=requests.length;const held=await mouse('mousePressed',selector);await sleep(600);assert.equal(await dialog(),true);assert.equal(requests.length,before);await capture(selector.endsWith('evaluate')?'reevaluate-picker':'navigate-picker');await mouse('mouseReleased',held);await sleep(150);assert.equal(requests.length,before,'長押し後のクリックを消費');assert.equal(await dialog(),true);assert.equal(await evaluate(`document.querySelectorAll('[data-scene]').length`),5);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await until(async()=>!await dialog(),'cancel');assert.equal(requests.length,before);await click(selector);await until(()=>requests.length===before+1,'next short click');
 }
 for(const [scene,selector]of [['ride','.navigation-cruise'],['fireworks','.navigation-fireworks'],['aquarium','.navigation-aquarium'],['kaleidoscope','.navigation-kaleidoscope'],['water','.navigation-water']]){
  await reset();const before=requests.length;await evaluate(`document.querySelector('.navigation-evaluate').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'});await until(dialog,'keyboard picker');await click('[data-scene="'+scene+'"]');await until(()=>requests.length===before+1,'scene run');await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),'selected '+scene);assert.equal(requests.at(-1).action,'evaluate');if(scene==='aquarium')await capture('selected-aquarium');
 }
 await reset();let before=requests.length;let p=await mouse('mousePressed','.navigation-start');await mouse('mouseMoved',{x:10,y:10});await sleep(600);await mouse('mouseReleased',{x:10,y:10});assert.equal(await dialog(),false);assert.equal(requests.length,before,'drag out');
 await reset();before=requests.length;p=await mouse('mousePressed','.navigation-start');await evaluate(`window.dispatchEvent(new Event('blur'))`);await sleep(600);await mouse('mouseReleased',p);assert.equal(await dialog(),false);assert.equal(requests.length,before,'blur');
 await reset();before=requests.length;p=await mouse('mousePressed','.navigation-start');await evaluate('changeProject()');await sleep(600);await mouse('mouseReleased',p);assert.equal(await dialog(),false);assert.equal(requests.length,before,'project change');
 await reset();before=requests.length;await evaluate(`document.querySelector('.navigation-start').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});assert.equal(requests.length,before);await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await until(()=>requests.length===before+1,'Space release');
 await reset();before=requests.length;await send('Emulation.setTouchEmulationEnabled',{enabled:true});p=await point('.navigation-start');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,radiusX:1,radiusY:1,id:1}]});await sleep(600);assert.equal(await dialog(),true);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(150);assert.equal(requests.length,before,'touch hold does not execute');await click('[data-scene="water"]');await until(()=>requests.length===before+1,'touch scene');await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 // DOMを別Documentへ移動した後の最初の操作と、復帰後を確認する。
 await reset();before=requests.length;await evaluate(`(()=>{const frame=document.createElement('iframe');frame.style.cssText='width:680px;height:700px';document.body.append(frame);const doc=frame.contentDocument;for(const style of document.querySelectorAll('style'))doc.head.append(style.cloneNode(true));doc.body.append(document.querySelector('.navigation-panel'));window.testFrame=frame;})()`);
 await evaluate(`(()=>{const win=testFrame.contentWindow,button=win.document.querySelector('.navigation-start');button.focus();button.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));})()`);await until(()=>evaluate(`!!testFrame.contentDocument.querySelector('dialog[open]')`),'detached picker');assert.equal(requests.length,before);await evaluate(`testFrame.contentDocument.querySelector('[data-scene="water"]').click()`);await until(()=>requests.length===before+1,'detached run');await evaluate(`document.querySelector('#app').append(testFrame.contentDocument.querySelector('.navigation-panel'));testFrame.remove()`);
 await reset();before=requests.length;p=await mouse('mousePressed','.navigation-start');await evaluate('dispose()');await sleep(600);await mouse('mouseReleased',p);assert.equal(requests.length,before,'unmount');assert.equal(await dialog(),false);assert.deepEqual(errors,[]);
 console.log('PASS: real Vue short/long clicks, all 5 selected scenes, release suppression, cancel/retry, drag/blur/project/unmount, Space/ArrowDown, touch, cross-document dialog. Screenshots: '+output);
}finally{socket?.close();chrome.kill();await new Promise(resolve=>server.close(resolve));await sleep(200);rmSync(temporary,{recursive:true,force:true});}
