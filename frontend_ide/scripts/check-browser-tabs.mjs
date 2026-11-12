// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue＋本番CSS、模擬IPC。外部ページや実プロフィールは使わない。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/browser-tabs-check');
const bundle=await build({stdin:{contents:`import {createApp,h} from 'vue';import Browser from './src/components/ブラウザ/ブラウザパネル.vue';import './src/components/共通表示/会話表示.css';
const headerOnly=new URLSearchParams(location.search).has('header');let changed,serial=2;const state={tabs:[{id:'a',url:'https://example.test/a',title:'ページA'},{id:'b',url:'https://example.test/b',title:'長い日本語のページタイトルを表示するタブ'}],activeTabId:'a',available:true,connected:false,mode:'offline',stateRevision:0,navigationRevision:0,fullscreen:headerOnly,headerVisible:true};
const snapshot=()=>({...state,...state.tabs.find(t=>t.id===state.activeTabId),stateRevision:++state.stateRevision});window.tabCalls=[];
window.aidiyWindow={title:async()=> 'AiDiy Browser',onBrowserChanged:fn=>{changed=fn;return()=>changed=null;},browserAction:async(name,value)=>{window.tabCalls.push({name,value});if(name==='tab-new'){const id=String(++serial);state.tabs.push({id,url:'about:blank',title:'新しいタブ'});state.activeTabId=id;}if(name==='tab-select')state.activeTabId=value;if(name==='tab-close'){const index=state.tabs.findIndex(t=>t.id===value);state.tabs.splice(index,1);if(!state.tabs.length)state.tabs.push({id:String(++serial),url:'about:blank',title:'新しいタブ'});if(state.activeTabId===value)state.activeTabId=state.tabs[Math.min(index,state.tabs.length-1)].id;}if(name.startsWith('tab-')){state.navigationRevision++;changed?.(snapshot());}return{ok:true,...snapshot()};}};
const app=createApp({setup(){return()=>h(Browser,{headerOnly});}});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,outfile:'app.js',format:'iife',plugins:[{name:'test-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor,errors}=parse(readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const id='tabs-'+createHash('sha1').update(args.path).digest('hex').slice(0,8);const compiled=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'Component'});
 const css=descriptor.styles.map(style=>{const result=compileStyle({source:style.content,filename:args.path,id:'data-v-'+id,scoped:style.scoped});assert.deepEqual(result.errors,[]);return result.code;}).join('\n');
 return{contents:compiled.content+`\nComponent.__scopeId='data-v-${id}';export default Component;{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);}`,resolveDir:dirname(args.path)};
 });}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: Browser tabs real Vue compiles.');process.exit(0);}
mkdirSync(output,{recursive:true});const temporary=mkdtempSync(join(tmpdir(),'browser-tabs-')),css=readFileSync(join(root,'src/style.css'),'utf8');
const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles.find(f=>f.path.endsWith('.js'))?.text||bundle.outputFiles[0].text);if(url.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><meta charset="utf-8"><style>${css}\n${bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')}</style><div id="app"></div><script src="/app.js"></script>`);res.writeHead(404).end();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1200,700','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let browserErrors='',socket;chrome.stderr.on('data',data=>browserErrors+=data);const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors);});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');let id=0;const calls=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){calls.get(data.id)?.(data);calls.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{calls.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 await send('Runtime.enable');await send('Page.enable');
 for(const header of [false,true]){
  await send('Page.navigate',{url:origin+(header?'?header':'')});await until(()=>evaluate(`document.querySelectorAll('[role=tab]').length===2`),'tabs ready');
  await evaluate(`document.querySelectorAll('[role=tab]')[1].click()`);await until(()=>evaluate(`document.querySelector('input').value==='https://example.test/b'`),'switch address');
  await evaluate(`document.querySelector('.browser-tab-new').click()`);await until(()=>evaluate(`document.querySelectorAll('[role=tab]').length===3`),'new tab');assert.equal(await evaluate(`document.activeElement===document.querySelector('input')`),true);
  await evaluate(`document.querySelector('.browser-tab-active .browser-tab-close').click()`);await until(()=>evaluate(`document.querySelectorAll('[role=tab]').length===2`),'close tab');assert.equal(await evaluate(`document.activeElement.getAttribute('role')`),'tab');
  await evaluate(`document.querySelector('[aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);await until(()=>evaluate(`document.querySelector('input').value==='https://example.test/a'`),'keyboard select');
  for(const width of [360,800,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});await sleep(100);const geometry=await evaluate(`(()=>{const row=document.querySelector('.browser-tabs-row').getBoundingClientRect(),input=document.querySelector('input').getBoundingClientRect();return{right:row.right,width:innerWidth,input:input.width};})()`);assert.ok(geometry.right<=geometry.width+1);assert.ok(geometry.input>0);writeFileSync(join(output,(header?'header':'normal')+'-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));}
 }
 assert.deepEqual(errors,[]);console.log('PASS: tabs creation/selection/closing/keyboard, normal and fullscreen header, 3 widths. '+output);
}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(temporary,{recursive:true,force:true});}
