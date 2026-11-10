// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VueとChromiumでURL欄を検証。IPCと表示ページは模擬し、外部サイトへ通信しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
import browserTools from '../デスクトップ/ブラウザ.cjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=join(root,'temp/browser-address-check'),profile=mkdtempSync(join(tmpdir(),'aidiy-address-browser-'));
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
const initial='https://example.test/'+encodeURIComponent('日本語の資料')+'?q='+encodeURIComponent('東京');
let server,browser,ws;
try{
 const bundle=await build({
  stdin:{contents:`import {createApp} from 'vue';import Panel from './src/components/ブラウザ/ブラウザパネル.vue';import './src/style.css';
const headerOnly=location.search==='?header';let state={ok:true,url:${JSON.stringify(initial)},available:true,connected:true,back:true,forward:true,headerVisible:true,fullscreen:headerOnly};
window.navigationCalls=[];let listener;
window.notifyURL=url=>{state={...state,url};listener?.(state);};
window.aidiyWindow={title:async()=>'AiDiy Browser',pinState:async()=>({pinned:false}),onPinChanged:()=>()=>{},onBrowserHeaderFrame:()=>()=>{},onBrowserChanged:fn=>{listener=fn;return()=>{listener=null;};},async browserAction(name,value){if(name==='navigate'){navigationCalls.push(value);const response=await fetch('/target',{method:'POST',body:JSON.stringify({value})});state={...state,...await response.json()};}return {...state};}};
const app=createApp(Panel,{standalone:true,headerOnly});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},
  bundle:true,write:false,outdir:output,format:'iife',
  plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
   const {descriptor,errors}=parse(readFileSync(args.path,'utf8'));assert.deepEqual(errors,[]);
   const id='data-v-'+createHash('sha256').update(args.path).digest('hex').slice(0,8);
   const compiled=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'component'});
   const css=descriptor.styles.map(style=>{const result=compileStyle({source:style.content,id,scoped:style.scoped});assert.deepEqual(result.errors,[]);return result.code;}).join('\n');
   return{contents:compiled.content+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);`,resolveDir:dirname(args.path)};
  });}}],
 });
 if(process.argv.includes('--compile-only'))console.log('PASS: Browser URL入力のVue・スタイルをコンパイルしました。');
 else{
  server=createServer(async(req,res)=>{
   const request=new URL(req.url,'http://127.0.0.1');
   if(request.pathname==='/target'){
    try{let body='';for await(const chunk of req)body+=chunk;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({url:browserTools.browserURL(JSON.parse(body).value)}));}
    catch(error){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({ok:false,error:error.message}));}return;
   }
   if(request.pathname==='/api/browser-analysis')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({url:request.searchParams.get('url')}));
   const file=request.pathname==='/app.js'?bundle.outputFiles.find(f=>f.path.endsWith('.js')):request.pathname==='/app.css'?bundle.outputFiles.find(f=>f.path.endsWith('.css')):null;
   if(file)return res.writeHead(200,{'content-type':request.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(file.text);
   if(request.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>html,body,#app{margin:0;height:100%;background:#000}</style><div id="app"></div><script src="/app.js"></script>');
   res.writeHead(404).end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const executable=process.env.CHROME_PATH||['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
  assert.ok(executable,'CHROME_PATH にChromiumの実行ファイルを指定してください。');
  let browserError='',browserStarted=false;
  browser=spawn(executable,['--headless=new',...(process.platform==='linux'?['--no-sandbox']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  browser.on('error',error=>{browserError=error.message;});browser.on('spawn',()=>{browserStarted=true;});
  browser.stderr.on('data',data=>{browserError=(browserError+data.toString()).slice(-4000);});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let port;for(let i=0;i<100&&!port;i++){if(browser.exitCode!==null||browser.signalCode!==null||!browserStarted&&browserError)throw Error(`Chrome did not start: ${browser.exitCode??browser.signalCode??browserError}\n${browserError}`);try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{}if(!port)await sleep(100);}assert.ok(port,`Chrome did not start\n${browserError}`);
  const target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let id=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
  const send=async(method,params={})=>{const result=await new Promise(resolve=>{pending.set(++id,resolve);ws.send(JSON.stringify({id,method,params}));});if(result.error)throw Error(JSON.stringify(result.error));return result.result;};
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(30);}throw Error(expression);};
  const input=`document.querySelector('.browser-toolbar input')`;
  const selected=()=>evaluate(`(()=>{const e=${input};return e===document.activeElement&&e.selectionStart===0&&e.selectionEnd===e.value.length;})()`);
  const key=async(key,code,keyCode)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:keyCode,...(key==='Enter'?{text:'\r'}:{})});};
  const click=async()=>{const point=await evaluate(`(()=>{const r=${input}.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});};
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  mkdirSync(output,{recursive:true});
  for(const headerOnly of [false,true]){
   await send('Emulation.setDeviceMetricsOverride',{width:headerOnly?800:1200,height:500,deviceScaleFactor:1,mobile:false});
   await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${headerOnly?'?header':''}`});await until(`${input}?.value.includes('日本語')`);
   await click();assert.equal(await selected(),true,'最初のクリックで全選択');
   const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,`${stamp}_${headerOnly?'02_header':'01_normal'}-selected.png`),Buffer.from(screenshot.data,'base64'));
   await click();assert.equal(await selected(),false,'フォーカス済みの再クリックは部分編集を許す');
   await evaluate(`${input}.blur()`);await click();assert.equal(await selected(),true,'再フォーカスでも全選択');
   await send('Input.imeSetComposition',{text:'にほんご',selectionStart:5,selectionEnd:5});
   assert.equal(await evaluate(`(()=>{const e=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});${input}.dispatchEvent(e);return e.defaultPrevented;})()`),true);
   await evaluate(`document.querySelector('form').requestSubmit()`);assert.equal(await evaluate('navigationCalls.length'),0,'変換途中の送信を抑止');
   await send('Input.insertText',{text:'日本語 検索'});assert.equal(await evaluate(`${input}.value`),'日本語 検索','選択URLを日本語で置換');
   await key('Enter','Enter',13);await until('navigationCalls.length===1');await until(`${input}.value.includes('google.com/ai')`);
   assert.equal(await evaluate('navigationCalls[0]'),'日本語 検索');
   await evaluate(`document.querySelector('[aria-label="Google検索"]').focus()`);await key('Tab','Tab',9);assert.equal(await selected(),true,'Tab移動でも全選択');
   await send('Input.insertText',{text:'127.0.0.1:8090'});await key('Enter','Enter',13);await until(`${input}.value==='http://127.0.0.1:8090/'`);
   await evaluate(`${input}.blur();${input}.focus()`);await send('Input.insertText',{text:'https://example.test/資料?q=東京'});
   await evaluate(`notifyURL('https://other.test/')`);assert.equal(await evaluate(`${input}.value`),'https://example.test/資料?q=東京','状態更新で編集を失わない');
   await evaluate(`document.querySelector('[type="submit"]').click()`);await until('navigationCalls.length===3');await until(`${input}.value==='https://example.test/資料?q=東京'`);
   assert.equal(await evaluate('navigationCalls[2]'),'https://example.test/資料?q=東京');
   await evaluate('dispose()');await sleep(40);assert.equal(await evaluate(`document.querySelector('.browser-panel')`),null);
  }
  assert.deepEqual(errors,[]);console.log('PASS: 通常欄とF11ヘッダーのクリック・Tab全選択、部分編集、IMEイベント、Google検索、URL、破棄。OSの日本語IMEは別途確認。画像: '+output);
 }
}finally{
 ws?.close();
 if(browser?.pid&&browser.exitCode===null&&browser.signalCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
