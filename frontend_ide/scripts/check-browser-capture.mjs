// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・模擬IPCの隔離確認。配布build、外部サイト、実プロジェクトへの撮影保存は使用しない。
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
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/browser-capture-check');
const bundle=await build({stdin:{contents:`import {createApp,h} from 'vue';import Browser from './src/components/ブラウザ/ブラウザパネル.vue';
const headerOnly=new URLSearchParams(location.search).has('header');let changed,resolveCapture;const state={url:'https://example.test/form',title:'撮影表示の検証',available:true,capturePath:'',fullscreen:headerOnly,headerVisible:true};
window.captureCalls=0;window.finishCapture=ok=>{if(ok){state.capturePath='temp/input/browser-'+captureCalls+'.png';changed?.({...state});resolveCapture({ok:true,path:state.capturePath,message:state.capturePath+' に保存しました。'});}else resolveCapture({ok:false,error:'撮影画像を保存できませんでした。'});};window.repeatState=()=>changed?.({...state});
window.aidiyWindow={title:async()=> 'AiDiy IDE / Browser 1',onBrowserChanged:fn=>{changed=fn;return()=>{changed=null;};},browserAction:async(name)=>{if(name==='capture'){captureCalls++;return new Promise(resolve=>resolveCapture=resolve);}return {ok:true,...state};}};
const app=createApp({setup(){return()=>h(Browser,{headerOnly});}});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'test-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{const {descriptor,errors}=parse(readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const compiled=compileScript(descriptor,{id:'browser-capture-check',inlineTemplate:true});return{contents:compiled.content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: Browser capture UI compiles (no distribution build).');process.exit(0);}
mkdirSync(output,{recursive:true});const temporary=mkdtempSync(join(tmpdir(),'browser-capture-')),css=readFileSync(join(root,'src/style.css'),'utf8');
const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/browser-analysis')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({url:url.searchParams.get('url'),result:null,job:null}));if(url.pathname==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);if(url.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="/app.js"></script>`);res.writeHead(404).end();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1200,600','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let browserErrors='',socket;chrome.stderr.on('data',data=>browserErrors+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors);});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const calls=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){calls.get(data.id)?.(data);calls.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{calls.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 const click=()=>evaluate(`document.querySelector('.browser-capture').click()`),hasStatus=()=>evaluate(`!!document.querySelector('.browser-capture-status')`);
 const capture=async name=>{const clip=await evaluate(`(()=>{const r=document.querySelector('.browser-chrome').getBoundingClientRect();return{x:0,y:0,width:innerWidth,height:Math.ceil(r.bottom)+8,scale:1};})()`);writeFileSync(join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',clip})).result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');
 for(const headerOnly of [false,true])for(const width of [1200,520]){
  const name=(headerOnly?'header':'normal')+'-'+width;await send('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+(headerOnly?'?header':'')});await until(()=>evaluate(`!!document.querySelector('.browser-capture')&&!document.querySelector('.browser-capture').disabled`),'Browser ready');assert.equal(await hasStatus(),false);
  await click();await click();assert.equal(await evaluate('captureCalls'),1);assert.equal(await hasStatus(),false);await capture(name+'-pending');await evaluate('finishCapture(true)');await until(hasStatus,'saved status');
  const layout=await evaluate(`(()=>{const b=document.querySelector('.browser-capture'),s=document.querySelector('.browser-capture-status'),br=b.getBoundingClientRect(),sr=s.getBoundingClientRect();return{next:b.nextElementSibling===s,text:s.textContent,delta:Math.abs((br.top+br.bottom-sr.top-sr.bottom)/2),gap:sr.left-br.right,right:sr.right,width:innerWidth,title:s.title};})()`);
  assert.equal(layout.next,true);assert.equal(layout.text,'保存済み');assert.ok(layout.delta<1,JSON.stringify(layout));assert.ok(layout.gap>=0&&layout.gap<=8);assert.ok(layout.right<=layout.width);assert.match(layout.title,/browser-1.png/);await capture(name+'-saved');
  await click();await evaluate('repeatState()');assert.equal(await hasStatus(),false);await evaluate('finishCapture(false)');await until(()=>evaluate(`!document.querySelector('.browser-capture').disabled&&!!document.querySelector('.browser-error')`),'failure');await evaluate('repeatState()');assert.equal(await hasStatus(),false);await capture(name+'-failed');
  await click();await evaluate('finishCapture(true)');await until(hasStatus,'retry success');assert.equal(await evaluate(`document.querySelector('.browser-error')===null`),true);await evaluate('dispose()');
 }
 assert.deepEqual(errors,[]);console.log('PASS: Browser capture UI normal/F11, 1200/520px, pending, success, repeated click, failure, retry, adjacency. Screenshots: '+output);
}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(100);rmSync(temporary,{recursive:true,force:true});}
