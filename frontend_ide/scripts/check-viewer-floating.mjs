// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実App/Viewer/Dialogと模擬APIで検証。AI・既存プロジェクト・送信は使用しない。
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
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'aidiy-viewer-floating-'));
const output=join(root,'temp/viewer-floating-check');mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{contents:`import {createApp} from 'vue';import App from './src/App.vue';
window.drafts=[];window.aidiyWindow={windowState:async()=>({}),onWindowState:()=>()=>{},draftTargets:async()=>({ok:true,sessionKey:'fixture',projectPath:'/fixture',targets:[{id:'code',kind:'code',label:'Code 1',contextId:'conversation',maxLength:200000}],frontmostTargetId:'code'}),insertDraft:async request=>{window.drafts.push(request);return {ok:true}}};
const app=createApp(App,{config:{kind:'ide'}});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',loader:{'.png':'dataurl'},plugins:[{name:'vue',setup(build){
 build.onLoad({filter:/\.css$/},args=>({contents:`{const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(args.path,'utf8'))};document.head.append(style);}`,loader:'js'}));
 build.onLoad({filter:/コード表示\.js$/},()=>({contents:'export async function loadMonaco(){throw Error("fallback fixture")} export const monacoLanguage=()=>"text";'}));
 build.onLoad({filter:/\.vue$/},args=>{const {descriptor}=parse(readFileSync(args.path,'utf8'));const compiled=compileScript(descriptor,{id:args.path,inlineTemplate:true});return {contents:compiled.content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};});
}}]});
if(process.argv.includes('--compile-only')){rmSync(temporary,{recursive:true,force:true});console.log('PASS: real App, Viewer and dialogs compile in the isolated harness.');process.exit(0);}
const css=readFileSync(join(root,'src/style.css'),'utf8');
const html=`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="/app.js"></script>`;
let saveFails=false,job=null;const requests=[];
const server=createServer(async(req,res)=>{
 const json=value=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
 if(req.url==='/api/connection')return json({active:true,mode:'online',startedAt:1,connected:true,project:{name:'fixture',path:'/fixture'}});
 if(req.url.startsWith('/api/file?'))return json({kind:'text',text:'ファイルの本文は表示したままです。\n\n'+Array.from({length:50},(_,i)=>`読み取り専用のファイル ${i+1}: 本文を見ながら連携先や解析内容を確認できます。`).join('\n'),size:2000});
 if(req.url.startsWith('/api/file-history'))return json({versions:[]});
 if(req.url.startsWith('/api/file-analysis')){
  let data='';for await(const chunk of req)data+=chunk;requests.push({method:req.method,body:data&&JSON.parse(data)});
  if(req.method==='PUT'&&saveFails)return res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'保存失敗テスト'}));
  if(req.method==='POST'){job={id:'fixture-job',path:JSON.parse(data).path,status:'waiting',monitoring:true,message:'模擬解析中'};return json(job);}
  return json({path:new URL(req.url,'http://localhost').searchParams.get('path'),instruction:'保存済みの分析指示',result:job?.status==='complete'?{id:job.id,createdAt:1,content:'模擬解析結果'}:null,job});
 }
 if(req.url==='/app.js')return res.writeHead(200,{'content-type':'application/javascript'}).end(bundle.outputFiles[0].text);
 if(req.url==='/')return res.writeHead(200,{'content-type':'text/html'}).end(html);
 res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1380,980','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,chromeErrors='';chrome.stderr.on('data',data=>chromeErrors+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<160;i++){if(await fn())return;await sleep(50);}throw Error('Timeout: '+label+'\n'+chromeErrors);}
try{
 let port;await until(()=>{try{return port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{return false}},'Chromium');
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');let id=0;const pending=new Map(),errors=[];
 socket.on('message',value=>{const data=JSON.parse(value);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r));return r.result.result.value;};
 const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 const click=async selector=>{const p=await point(selector);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});};
 const screenshot=async name=>writeFileSync(join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot')).result.data,'base64'));
 const escape=async()=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#viewer=sample.txt`});
 await until(()=>evaluate(`!!document.querySelector('.viewer-code pre')`),'Viewer');
 await click('.viewer-handoff');await until(()=>evaluate(`!!document.querySelector('.draft-actions button:not([disabled])')`),'draft');
 assert.equal(await evaluate(`document.querySelector('.model-dialog').matches(':modal')`),false);
 assert.equal(await evaluate(`document.elementFromPoint(innerWidth-80,180).closest('.viewer-pinned')!==null`),true,'背景のファイル本文は遮られない');
 await screenshot('01-draft-file-visible');
 // 背景でコードを選択でき、ダイアログは消えない。
 await click('.viewer-code pre');assert.equal(await evaluate(`!!document.querySelector('.model-dialog[open]')`),true);
 const h=await point('.model-dialog h3');await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...h});await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:h.x+140,y:h.y+30});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',x:h.x+140,y:h.y+30});
 assert.ok(await evaluate(`document.querySelector('.model-dialog').getBoundingClientRect().left>100`),'ドラッグ移動');
 await click('.draft-actions button');await until(()=>evaluate(`!document.querySelector('.model-dialog')`),'insert closes');assert.equal(await evaluate('window.drafts.length'),1);assert.equal(await evaluate('window.drafts[0].text'),'参照ファイル: sample.txt');
 await click('.viewer-handoff');await until(()=>evaluate(`!!document.querySelector('.model-dialog[open]')`),'reopen');await click('.model-dialog h3');await escape();await until(()=>evaluate(`!document.querySelector('.model-dialog')`),'Escape');assert.equal(await evaluate('window.drafts.length'),1);
 await click('.viewer-analysis');await until(()=>evaluate(`document.querySelector('#file-analysis-instruction')?.disabled===false`),'analysis');
 assert.equal(await evaluate(`document.querySelector('.file-analysis-dialog').matches(':modal')`),false);assert.equal(await evaluate(`document.elementFromPoint(innerWidth-80,180).closest('.viewer-pinned')!==null`),true);
 await screenshot('02-analysis-file-visible');
 await click('.analysis-actions button');await until(()=>job?.status==='waiting','background analysis');await until(()=>evaluate(`document.querySelector('.viewer-analysis').textContent==='AI解析中…'`),'viewer analysis running');await screenshot('05-viewer-analysis-running');
 await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('.file-analysis-dialog')`),'close while running');assert.equal(job.status,'waiting');assert.equal(await evaluate(`document.querySelector('.viewer-analysis').textContent`),'AI解析中…');assert.ok(requests.every(r=>r.method!=='DELETE'));
 await click('.viewer-analysis');await until(()=>evaluate(`document.querySelector('.analysis-actions button')?.textContent==='解析中…'`),'reopen running');
 saveFails=true;await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!!document.querySelector('.analysis-save-error')`),'save failure');assert.equal(await evaluate(`document.querySelector('#file-analysis-instruction').value`),'保存済みの分析指示');
 await screenshot('03-save-failure-preserves-file');saveFails=false;await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('.file-analysis-dialog')`),'save retry');
 // 小さな窓でもタイトルと閉じる操作を画面内へ戻す。
 await send('Emulation.setDeviceMetricsOverride',{width:480,height:420,deviceScaleFactor:1,mobile:false});await click('.viewer-analysis');await until(()=>evaluate(`!!document.querySelector('.file-analysis-dialog[open]')`),'small analysis');
 assert.equal(await evaluate(`(()=>{const r=document.querySelector('.file-analysis-dialog').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true);
 await screenshot('04-small-window');await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('.file-analysis-dialog')`),'small analysis closed');job={...job,status:'complete',message:'結果保存済み・実行応答監視中'};await sleep(2200);assert.equal(await evaluate(`document.querySelector('.viewer-analysis').textContent`),'AI解析中…');job={...job,monitoring:false,message:'結果保存済み'};await until(()=>evaluate(`document.querySelector('.viewer-analysis').textContent==='AI解析済'`),'viewer completed');await screenshot('06-viewer-analysis-completed');assert.equal(requests.filter(request=>request.method==='POST').length,1);await evaluate('window.dispose()');assert.equal(await evaluate(`document.querySelectorAll('dialog').length`),0);assert.deepEqual(errors,[]);
 writeFileSync(join(output,'result.json'),JSON.stringify({passed:true,realVueApp:true,realChromium:true,nativeElectron:false,checks:['file remains visible and interactive','no modal/backdrop','drag','draft insert once','reopen/Escape','AI close keeps backend job','viewer progress notification','viewer continues monitoring after partial completion','viewer completed state','saved instruction failure/retry','small window','unmount cleanup']},null,2));
 console.log('PASS: Viewer floating draft and AI analysis, screenshots: '+output);
}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const ended=once(chrome,'exit');chrome.kill();await ended;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(temporary,{recursive:true,force:true});}
