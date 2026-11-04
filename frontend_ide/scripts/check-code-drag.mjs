// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Code UIは実bundle、窓移動IPCと通信だけ模擬。Electronや外部AIは起動しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createServer} from 'node:http';
const chromePath=process.env.CHROME_PATH||[
 [process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],
 [process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'],
 [process.env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe'],
].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)
 || ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
assert.ok(chromePath,'Chrome / Edge が必要です。CHROME_PATH で指定できます。');
const profile=mkdtempSync(join(tmpdir(),'aidiy-code-drag-'));
const dist=new URL('../dist/',import.meta.url);
const server=createServer((req,res)=>{
 try{const name=req.url==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]).replace(/^\/development\//,'');if(name.includes('..'))throw Error();const data=readFileSync(new URL(name,dist));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'})[extname(name)]||'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sockets=[],errors=[],shots=[];
const output=resolve('temp/code-drag-check');mkdirSync(output,{recursive:true});
const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(r.error,undefined);assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;}
 async function until(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail('画面待機: '+expression+' '+JSON.stringify(await evaluate('({text:document.body.innerText,errors:'+JSON.stringify(errors)+'})')));}
 async function capture(name){const r=await send('Page.captureScreenshot',{format:'png'});const file=join(output,`${stamp}-${shots.length+1}-${name}.png`);writeFileSync(file,Buffer.from(r.result.data,'base64'));shots.push(file);}
 await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 return {send,evaluate,until,capture};
}

try{
 let port;for(let i=0;i<80&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port);const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const main=await connect(targets.find(t=>t.type==='page'));
 await main.send('Page.enable');
 await main.send('Emulation.setDeviceMetricsOverride',{width:800,height:850,deviceScaleFactor:1.5,mobile:false});
 await main.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.moves=[];window.messages=[];
  window.aidiyWindow={title:async()=> 'AiDiy Code',isMaximized:async()=>false,minimize:async()=>{},maximize:async()=>{},close:async()=>{},beginWindowMove:async()=>{moves.push('begin');return 'mock-code';},moveWindow:async token=>{moves.push('move');return true;},endWindowMove:async token=>{moves.push('end');}};
  window.fixtureState={type:'state',会話ID:'fixture-code',信頼済み:true,接続済み:true,自動接続:true,実行モード:'online',作業フォルダ:{名前:'fixture',パス:'/fixture'},メッセージ:[{種別:'assistant',本文:'窓の中央にある読み取り専用の回答です。通常の文字選択も維持します。\\n\\nconst result = 42;'}],履歴:[],進捗:[],provider:'codex_cli',model:'auto'};
  window.EventSource=class{constructor(){window.fixtureNotify=packet=>this.onmessage?.({data:JSON.stringify(packet)});setTimeout(()=>fixtureNotify(fixtureState),40);}close(){}};
  const original=window.fetch;
  window.fetch=(input,options)=>{
   if(input==='/development/config')return Promise.resolve(new Response(JSON.stringify({kind:'code',base:'/fixture/',icon:'/development/AiDiy.png'})));
   if(String(input).includes('/fixture/message')){const message=JSON.parse(options.body);messages.push(message);return Promise.resolve(new Response('{}'));}
   if(String(input).includes('/fixture/catalog'))return Promise.resolve(new Response(JSON.stringify({providers:[],models:[]})));
   return original(input,options);
  };
 `});
 await main.send('Page.navigate',{url});await main.until(`!!document.querySelector('.message.assistant p')&&!!document.querySelector('textarea')`);
 // 開いた後の光沢は表示しない。通常のフェード・寸法・入力・ヒット判定は維持する。
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const beforeOpening=await main.evaluate(`JSON.stringify(document.querySelector('.development-app').getBoundingClientRect().toJSON())`);
 await main.evaluate(`window.openingShines=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.classList.contains('opening-shine'))window.openingShines++;}).observe(document.body,{childList:true,subtree:true})`);
 assert.equal(await main.evaluate(`document.querySelectorAll('.opening-shine').length`),0);
 await main.evaluate(`document.querySelector('.code-component').style.animation='startup-fade-in 2s linear both';window.startupAnimation=document.querySelector('.code-component').getAnimations()[0];startupAnimation.pause();window.dispatchEvent(new Event('aidiy-window-shown'));`);
 assert.equal(await main.evaluate(`document.querySelectorAll('.opening-shine').length`),0,'登場フェード中にも光らせない');
 await main.evaluate(`startupAnimation.finish()`);await sleep(800);
 assert.equal(await main.evaluate(`window.openingShines`),0,'登場完了後も光沢を生成しない');
 assert.equal(await main.evaluate(`document.querySelectorAll('.opening-shine,.opening-shine-band').length`),0);
 await main.capture('code-opening-clean');
 assert.equal(await main.evaluate(`JSON.stringify(document.querySelector('.development-app').getBoundingClientRect().toJSON())`),beforeOpening);
 assert.ok(await main.evaluate(`(()=>{const input=document.querySelector('textarea'),r=input.getBoundingClientRect();return document.elementFromPoint(r.left+10,r.top+10)===input;})()`));
 await main.evaluate(`document.querySelector('.code-component').style.animation=''`);
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await main.evaluate(`window.dispatchEvent(new Event('aidiy-window-shown'))`);
 assert.equal(await main.evaluate(`document.querySelectorAll('.opening-shine').length`),0);
 const point=await main.evaluate(`(()=>{const r=document.querySelector('.message.assistant p').getBoundingClientRect();return{x:r.left+Math.min(r.width/2,180),y:r.top+r.height/2};})()`);
 const mouse=(type,x=point.x,y=point.y,buttons=1)=>main.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:type==='mouseMoved'?0:1});
 for(const preference of ['reduce','no-preference']){
  await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:preference}]});
  await mouse('mousePressed');await sleep(600);await main.until(`document.documentElement.classList.contains('window-moving')`);
  assert.equal(await main.evaluate(`getComputedStyle(document.querySelector('.message.assistant p')).cursor`),'move');
  assert.equal(await main.evaluate(`document.querySelectorAll('.code-move-indicator,.code-move-pair,.code-move-direction').length`),0);
  await mouse('mouseMoved',point.x+70,point.y+20);await sleep(80);
  assert.ok(await main.evaluate(`moves.includes('move')`));
  await main.capture('code-drag-'+preference);
  if(preference==='no-preference'){
   await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
  await mouse('mouseReleased',point.x+70,point.y+20,0);
  await main.until(`!document.documentElement.classList.contains('window-moving')`);
 }
 const starts=await main.evaluate(`moves.filter(x=>x==='begin').length`);
 // 0.5秒前の通常選択は止めない。
 await mouse('mousePressed');await mouse('mouseMoved',point.x+100,point.y);await sleep(600);assert.equal(await main.evaluate(`moves.filter(x=>x==='begin').length`),starts);await mouse('mouseReleased',point.x+100,point.y,0);assert.ok(await main.evaluate(`getSelection().toString().length>0`));
 const input=await main.evaluate(`(()=>{const r=document.querySelector('textarea').getBoundingClientRect();return{x:r.left+30,y:r.top+15};})()`);
 await mouse('mousePressed',input.x,input.y);await sleep(600);await mouse('mouseReleased',input.x,input.y,0);assert.equal(await main.evaluate(`moves.filter(x=>x==='begin').length`),starts);
 await main.send('Input.insertText',{text:'送信とストリームの確認'});
 const sendPoint=await main.evaluate(`(()=>{const r=document.querySelector('.send').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 await mouse('mousePressed',sendPoint.x,sendPoint.y);await sleep(600);await mouse('mouseReleased',sendPoint.x,sendPoint.y,0);await main.until(`messages.some(m=>m.type==='input_text')`);assert.equal(await main.evaluate(`moves.filter(x=>x==='begin').length`),starts);
 await main.evaluate(`fixtureNotify({type:'accepted'});fixtureState.実行中=true;fixtureState.メッセージ.push({種別:'user',本文:'送信とストリームの確認'});fixtureNotify({...fixtureState});fixtureNotify({メッセージ識別:'output_stream',メッセージ内容:'\\u0002検証ストリーム'});`);
 await main.until(`document.querySelector('.progress pre')?.textContent.includes('検証ストリーム')`);await main.capture('code-input-stream');
 assert.deepEqual(errors,[]);const result={ok:true,native:'mock only; Electron execution not attempted',starts,sendCount:await main.evaluate(`messages.filter(m=>m.type==='input_text').length`),errors,shots};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(400);try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{}
}
