// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VueとChromiumで確認。AI・利用者ファイルには触れずAPIとCode通知だけを模擬する。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,existsSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=mkdtempSync(join(tmpdir(),'navi-auto-ui-')),out=join(root,'../temp/navigation-autopilot-check');mkdirSync(out,{recursive:true});
const calls=[],streams=new Set();let evaluations=0,hold=false,failNext=false,runTimer,job=null,appKind='navi';
const makeResult=progress=>({schemaVersion:3,requestId:job?.id||'initial',navigationId:'navigation-ui-test',checkedAt:Date.UTC(2026,10,5,0,evaluations,0),goal:'安全な自動航行の画面を確認する',items:[{id:'work',name:'動作と表示を確認する',progress,reason:'模擬APIによる試験です。',weight:100,weightReason:'今回の対象はこの項目です。'}],overall:{progress,reason:'実AIの評価ではなく試験用の値です。'},nextItemId:progress===100?null:'work',nextPrompt:progress===100?'':'今回の目標は安全な自動航行です。\n今回の作業では画面と停止操作を確認してください。'});
let result=makeResult(20),codeState={type:'state',navigationRunSupported:true,メッセージ:[],履歴:[],進捗:[],信頼済み:true,自動接続:true,接続済み:true,画面接続済み:true,実行モード:'online',作業フォルダ:{パス:'/fixture',名前:'fixture'},接続プロジェクトパス:'/fixture',会話ID:'conversation',セッションID:'session',接続世代:1,実行中:false,停止中:false,provider:'fixture',model:'mock'};
const emit=packet=>{for(const res of streams)res.write('data: '+JSON.stringify(packet)+'\n\n');};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),json=data=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
 if(url.pathname==='/development/config')return json({kind:appKind,base:appKind==='code'?'/standalone-code/':undefined,navigationInstance:'navi-1',project:{name:'fixture',path:'/fixture'},icon:'/development/AiDiy.png'});
 if(url.pathname==='/api/connection')return json({active:true,mode:'online',startedAt:1,connected:true,project:{path:'/fixture',name:'fixture'}});
 if(url.pathname==='/api/navigation/code'){calls.push(req.method+' Code');return json({url:'/panels/code/navi-1/fixture/'});}
 if(url.pathname==='/api/navigation'){
  if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push(body.action);job={id:'evaluate-'+(++evaluations),status:'complete'};result=makeResult(Math.min(100,20+evaluations*40));return json({job});}
  return json({result,job,availability:{available:true},selection:{provider:'fixture',model:'mock'}});
 }
 if(url.pathname.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});streams.add(res);res.write('data: '+JSON.stringify(codeState)+'\n\n');req.on('close',()=>streams.delete(res));return;}
 if(url.pathname.endsWith('/message')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push(body.type);
  if(body.type==='input_text'){
   emit({type:'navigationRunResult',requestId:body.navigationRequestId,status:'accepted'});codeState={...codeState,実行中:true,メッセージ:[{種別:'user',本文:body.メッセージ内容}]};emit(codeState);
   if(!hold)runTimer=setTimeout(()=>{
    if(failNext){failNext=false;emit({メッセージ識別:'error',メッセージ内容:'試験用のCode実行エラー'});codeState={...codeState,実行中:false};emit({type:'navigationRunResult',requestId:body.navigationRequestId,status:'failed',message:'試験用のCode実行エラー',settled:true});emit(codeState);return;}
    codeState={...codeState,実行中:false,メッセージ:[...codeState.メッセージ,{種別:'assistant',本文:'試験用の作業が完了しました。'}]};emit(codeState);emit({type:'navigationRunResult',requestId:body.navigationRequestId,status:'succeeded',settled:true});
   },180);
  }
  if(body.type==='cancel_run'){clearTimeout(runTimer);codeState={...codeState,実行中:false};emit(codeState);emit({type:'navigationRunResult',requestId:body.navigationRequestId,status:'cancelled',settled:true});}
  return json({ok:true});
 }
 try{const name=url.pathname==='/'?'index.html':url.pathname.replace(/^\/development\//,'');if(name.includes('..'))throw Error();const content=readFileSync(join(root,'dist',name));res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png'}).end(content);}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--remote-debugging-port=0','--window-size=1000,700','--user-data-dir='+join(temporary,'browser'),'about:blank'],{stdio:['ignore','ignore','pipe']});
chrome.stderr.on('data',data=>{if(!String(data).includes('dbus'))process.stderr.write(data);});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
let socket;
try{
 await until(()=>existsSync(join(temporary,'browser/DevToolsActivePort')),'chrome');const port=readFileSync(join(temporary,'browser/DevToolsActivePort'),'utf8').split('\n')[0];const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
 const send=(method,params={})=>new Promise(done=>{pending.set(++id,done);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const data=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});assert.equal(data.result?.exceptionDetails,undefined,JSON.stringify(data));return data.result?.result?.value;};
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}).click()`);
 const checkCodeFrame=async(checked,desktop=false)=>{
  const frame=await evaluate(`(()=>{const button=document.querySelector('.navigation-code-toggle'),style=getComputedStyle(button);return {label:button.textContent.trim(),ariaLabel:button.getAttribute('aria-label'),checked:button.getAttribute('aria-checked'),desktop:!!button.closest('.window-actions'),widths:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],styles:[style.borderTopStyle,style.borderRightStyle,style.borderBottomStyle,style.borderLeftStyle],radii:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius],color:style.borderTopColor}})()`);
  assert.equal(frame.label,checked?'CODE非表示':'CODE表示');assert.equal(frame.ariaLabel,frame.label);assert.equal(frame.checked,String(checked));assert.equal(frame.desktop,desktop);assert.deepEqual(frame.widths,['1px','1px','1px','1px']);assert.deepEqual(frame.styles,['solid','solid','solid','solid']);assert.deepEqual(frame.radii,['0px','0px','0px','0px']);assert.equal(frame.color,checked?'rgb(125, 226, 207)':'rgb(139, 155, 170)');
 };
 const checkAutopilotToggle=async active=>{
  await until(()=>evaluate(`(()=>{const button=document.querySelector('.navigation-autopilot-toggle'),track=button?.querySelector('.motion-switch');return !!track&&getComputedStyle(track,'::after').transform===${JSON.stringify(active?'matrix(1, 0, 0, 1, 14, 0)':'none')}})()`),'autopilot toggle position');
  const toggle=await evaluate(`(()=>{const button=document.querySelector('.navigation-autopilot-toggle'),track=button.querySelector('.motion-switch');return {role:button.getAttribute('role'),checked:button.getAttribute('aria-checked'),state:button.querySelector('.navigation-autopilot-state').textContent,label:button.firstElementChild.textContent,hidden:track.getAttribute('aria-hidden'),radius:getComputedStyle(button).borderTopLeftRadius,trackWidth:getComputedStyle(track).width}})()`);
  assert.equal(toggle.role,'switch');assert.equal(toggle.checked,String(active));assert.equal(toggle.state,active?'オン':'オフ');assert.equal(toggle.label,'自動航行');assert.equal(toggle.hidden,'true');assert.equal(toggle.radius,'0px');assert.equal(toggle.trackWidth,'28px');
 };
 const checkEmbeddedHeader=async active=>{
  const header=await evaluate(`(()=>{const pane=document.querySelector('.navigation-code'),header=pane.querySelector(':scope>header');return {title:pane.querySelector(':scope>header strong')?.textContent??null,header:!!header,stop:header?.querySelector('button')?.textContent??null,mainTitle:document.title}})()`);
  assert.equal(header.title,null,'Navigator右側にはCodeタイトルを表示しない');
  assert.equal(header.header,false,'右側Codeには重複する操作行を残さない');
  assert.equal(header.stop,null);
  assert.equal(header.mainTitle,active?'AiDiy Navigation Cruise':'AiDiy Navigator');
 };
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
 await until(()=>evaluate(`!!document.querySelector('.navigation-autopilot-toggle')`),'toggle');
 assert.equal(await evaluate(`document.querySelector('.navigation-task-heading time').dateTime`),'2026-11-05T00:00:00.000Z');assert.match(await evaluate(`document.querySelector('.navigation-task-heading time').textContent`),/^ \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/);
 assert.equal(await evaluate(`document.querySelectorAll('.navigation-task-heading time').length`),1);assert.equal(await evaluate(`document.querySelector('.navigation-items time')===null`),true);
 await checkCodeFrame(false);await checkAutopilotToggle(false);
 assert.equal(calls.length,0,'opening Navigator must not launch Code');await click('CODE表示');await until(()=>evaluate(`!!document.querySelector('.code-component textarea')`),'embedded Code');assert.equal(calls.filter(x=>x==='input_text').length,0,'manual open does not execute');
 await checkCodeFrame(true);
 await checkEmbeddedHeader(false);
 assert.equal(await evaluate(`document.querySelector('.navigation-code .code-component>.panel-brand,.navigation-code .code-component>.connection-bar')===null`),true,'embedded Code omits only its duplicate title and connection strip');
 await until(()=>evaluate(`(()=>{const image=document.querySelector('.navigation-code .welcome-mark img');return image?.complete&&image.naturalWidth>0&&image.naturalHeight>0})()`),'embedded AiDiy image loaded');
 const geometry=await evaluate(`(()=>{const a=document.querySelector('.navigation-goal-form').getBoundingClientRect(),b=document.querySelector('.navigation-code').getBoundingClientRect();return {left:a.x,right:a.right,codeLeft:b.x,codeRight:b.right,width:innerWidth}})()`);assert.ok(geometry.codeLeft>=geometry.right-1,JSON.stringify(geometry));assert.ok(geometry.codeRight<=geometry.width);
 writeFileSync(join(out,'embedded-code.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 await click('CODE非表示');await until(()=>evaluate(`getComputedStyle(document.querySelector('.navigation-code')).display==='none'`),'hide Code');
 await click('自動航行 オフ');await click('CODE非表示');await until(()=>evaluate(`getComputedStyle(document.querySelector('.navigation-code')).display==='none'`),'hide active Code');await until(()=>evaluate(`document.querySelector('.navigation-autopilot-status')?.textContent.includes('100%')`),'autopilot complete');assert.equal(evaluations,2);assert.equal(calls.filter(x=>x==='input_text').length,2);assert.equal(await evaluate(`document.querySelector('.navigation-autopilot-toggle').getAttribute('aria-checked')`),'false');
 assert.equal(calls.filter(x=>x==='POST Code').length,1,'hiding and resuming must reuse the same Code');await click('CODE表示');assert.equal(calls.filter(x=>x==='input_text').length,2,'showing completed Code must not submit');
 assert.equal(await evaluate(`document.querySelector('.navigation-task-heading time').dateTime`),'2026-11-05T00:02:00.000Z');
 writeFileSync(join(out,'completed.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 // Reload restores only the record, never the permission to execute. Stop before completion.
 result=makeResult(20);job=null;hold=true;await send('Page.reload');await until(()=>evaluate(`!!document.querySelector('.navigation-autopilot-toggle')&&!document.querySelector('.navigation-autopilot-toggle').disabled`),'reload');const count=calls.filter(x=>x==='input_text').length;await click('自動航行 オフ');await until(()=>calls.filter(x=>x==='input_text').length===count+1,'running');
 await checkAutopilotToggle(true);await checkEmbeddedHeader(true);writeFileSync(join(out,'cruise-without-code-title.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 await click('自動航行 オン');await until(()=>calls.includes('cancel_run'),'visible Code stop');await checkEmbeddedHeader(false);
 await click('自動航行 オフ');await until(()=>calls.filter(x=>x==='input_text').length===count+2,'running again');await click('CODE非表示');await click('自動航行 オン');await until(()=>calls.filter(x=>x==='cancel_run').length===2,'hidden Code stop');await sleep(1700);assert.equal(evaluations,2,'OFF must not reevaluate');assert.equal(calls.filter(x=>x==='input_text').length,count+2);assert.equal(await evaluate(`document.querySelector('.navigation-autopilot-toggle').getAttribute('aria-checked')`),'false');
 // 実行エラーで停止した後、同じ埋込Codeを閉じずに明示オンから再開できる。
 result=makeResult(20);job=null;hold=false;failNext=true;const beforeFailure=calls.filter(x=>x==='input_text').length,beforeEvaluations=evaluations;
 await send('Page.reload');await until(()=>evaluate(`!!document.querySelector('.navigation-autopilot-toggle')&&!document.querySelector('.navigation-autopilot-toggle').disabled`),'failure scenario ready');
 await click('自動航行 オフ');await until(()=>evaluate(`document.querySelector('.navigation-autopilot-status')?.textContent.includes('試験用のCode実行エラー')`),'failure reported');
 assert.equal(await evaluate(`document.querySelector('.navigation-autopilot-toggle').getAttribute('aria-checked')`),'false');
 await sleep(300);assert.equal(calls.filter(x=>x==='input_text').length,beforeFailure+1,'failure must not automatically retry');assert.equal(evaluations,beforeEvaluations,'failure must not reevaluate');
 writeFileSync(join(out,'code-error-stopped.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 await click('自動航行 オフ');await until(()=>evaluate(`document.querySelector('.navigation-autopilot-status')?.textContent.includes('100%')`),'manual restart after Code failure');
 assert.equal(calls.filter(x=>x==='input_text').length,beforeFailure+2,'explicit restart sends a new request');
 assert.equal(evaluations,beforeEvaluations+1);await checkEmbeddedHeader(false);
 writeFileSync(join(out,'code-error-recovered.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 // Electronの窓APIだけを模擬し、実際のタイトル用slotと共通CSSの組合せでも両状態を確認する。
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.aidiyWindow={navigationCode:async()=>({ok:true}),pinState:async()=>({pinned:false,locked:false})};`});
 await send('Page.reload');await until(()=>evaluate(`!!document.querySelector('.window-actions .navigation-code-toggle')`),'desktop title');await checkCodeFrame(false,true);
 writeFileSync(join(out,'title-code-hidden.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 const sent=calls.filter(x=>x==='input_text').length;await click('CODE表示');await until(()=>evaluate(`!!document.querySelector('.code-component textarea')`),'desktop embedded Code');await checkCodeFrame(true,true);
 await checkEmbeddedHeader(false);
 writeFileSync(join(out,'title-code-visible.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 await click('CODE非表示');await until(()=>evaluate(`getComputedStyle(document.querySelector('.navigation-code')).display==='none'`),'desktop hide Code');await checkCodeFrame(false,true);assert.equal(calls.filter(x=>x==='input_text').length,sent,'title visibility toggle must not submit');
 // 共通Codeは変更せず、単独版のタイトル・接続バー・入力操作も維持する。
 appKind='code';await send('Page.reload');await until(()=>evaluate(`!!document.querySelector('.code-component>.panel-brand')&&!!document.querySelector('.code-component textarea')`),'standalone Code title');
 assert.equal(await evaluate(`document.querySelector('.code-component>.panel-brand strong').textContent`),'AiDiy Code');assert.equal(await evaluate(`document.title`),'AiDiy Code');
 assert.equal(await evaluate(`!!document.querySelector('.code-component>.connection-bar')&&!!document.querySelector('.code-component .auto-connect')`),true);
 writeFileSync(join(out,'standalone-code-title.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 assert.deepEqual(errors,[]);writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,geometry,calls,evaluations,errors},null,2));console.log(JSON.stringify({passed:true,geometry,calls,evaluations}));
}finally{clearTimeout(runTimer);socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}for(const res of streams)res.end();server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
