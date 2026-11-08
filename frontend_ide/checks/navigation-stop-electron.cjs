// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 手動実機試験用。入力操作は行わず、自分のElectron窓の要求と画面だけを記録する。
const {app}=require('electron');
const {appendFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const output=process.env.AIDIY_STOP_EVIDENCE;
mkdirSync(output,{recursive:true});
const log=(kind,data)=>appendFileSync(join(output,'electron.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n');
app.on('browser-window-created',(_,window)=>{
 const wc=window.webContents;
 wc.debugger.attach('1.3');
 wc.debugger.sendCommand('Network.enable');
 const requests=new Map();
 wc.debugger.on('message',(_,method,p)=>{
  if(method==='Network.requestWillBeSent'){
   const u=new URL(p.request.url);
   if(/\/api\/navigation$/.test(u.pathname)||/\/message$/.test(u.pathname)||/\/api\/navigation\/code$/.test(u.pathname)){
    let body={};try{body=JSON.parse(p.request.postData||'{}');}catch{}
    const entry={requestId:p.requestId,path:u.pathname.startsWith('/panels/')?'code/message':u.pathname,method:p.request.method,action:body.action,type:body.type,clientRequestId:body.clientRequestId,navigationRequestId:body.navigationRequestId};
    requests.set(p.requestId,entry);log('request',entry);
   }
  }
  if(method==='Network.responseReceived'&&requests.has(p.requestId))log('response',{requestId:p.requestId,status:p.response.status});
  if(method==='Network.loadingFinished'&&requests.has(p.requestId)){
   const entry=requests.get(p.requestId);requests.delete(p.requestId);
   if(entry.path==='/api/navigation')void wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId}).then(({body})=>{
    const data=JSON.parse(body);log('navigation-response',{requestId:p.requestId,job:data.job?{id:data.job.id,action:data.job.action,status:data.job.status,clientRequestId:data.job.clientRequestId}:null,resultRequestId:data.result?.requestId,progress:data.result?.overall?.progress});
   }).catch(e=>log('response-body-unavailable',{requestId:p.requestId,message:e.message}));
  }
  // SSE本文全体や認証情報、ランダムな中継URLは公開記録へ出さない。
  if(method==='Network.eventSourceMessageReceived'){
   let data;try{data=JSON.parse(p.data);}catch{return;}
   if(data.type==='state'){
    const value={connected:data.接続済み,connecting:data.接続中,mode:data.実行モード,auto:data.自動接続,sessionConfirmed:!!data.セッションID,projectMatches:data.作業フォルダ?.パス===data.接続プロジェクトパス,epoch:data.接続世代,running:data.実行中,error:data.接続エラー||''};
    const key=JSON.stringify(value);if(key!==wc.stopEvidenceState){wc.stopEvidenceState=key;log('code-state',value);}
   }
   if(data.type==='navigationRunResult')log('code-result',{requestId:data.requestId,status:data.status,settled:data.settled,message:data.message});
   if(data.メッセージ識別==='output_text')log('code-report',{text:data.メッセージ内容});
  }
  if(method==='Network.loadingFailed'&&p.canceled)log('request-aborted',{requestId:p.requestId});
 });
 let last='',serial=0,working=false;
 const timer=setInterval(async()=>{
  if(working||wc.isDestroyed()||wc.isLoadingMainFrame()||wc.getURL()!==process.env.AIDIY_DEVELOPMENT_URL)return;
  working=true;
  try{
   const state=await wc.executeJavaScript(`(()=>{const q=s=>document.querySelector(s),t=q('.navigation-autopilot-toggle');return {title:document.title,on:t?.getAttribute('aria-checked'),disabled:t?.disabled,codeVisible:q('.navigation-code')?getComputedStyle(q('.navigation-code')).display!=='none':false,routing:!!q('.navigation-stop'),status:q('.navigation-autopilot-status')?.textContent||'',overall:q('.navigation-overall')?.innerText||'',tasks:[...document.querySelectorAll('.navigation-tasks li')].map(x=>x.innerText),error:q('.navigation-error')?.textContent||''}})()`);
   const key=JSON.stringify(state);if(key===last)return;last=key;
   log('screen',state);writeFileSync(join(output,'screen.json'),JSON.stringify(state,null,2));
   if(state.on==='true'||state.on==='false'){
    const name=String(++serial).padStart(3,'0')+'-'+(state.codeVisible?'visible':'hidden')+'-'+(state.routing?'evaluating':'code')+'-'+(state.on==='true'?'on':'off')+'.png';
    writeFileSync(join(output,name),(await wc.capturePage()).toPNG());log('screenshot',{file:name,on:state.on,codeVisible:state.codeVisible,routing:state.routing});
   }
  }catch(e){log('observer-error',{message:e.message});}finally{working=false;}
 },300);
 window.on('closed',()=>{clearInterval(timer);log('window-closed',{});});
});
require('../desktop.cjs');
