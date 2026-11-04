// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {app,BrowserWindow,screen}=require('electron');
const {createServer}=require('node:http');
const {WebSocketServer}=require('ws');
const {readFileSync,mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const Module=require('node:module');
const assert=require('node:assert/strict');
const {holdMove,holdUnmoved,checkNativeControls,checkMaximizedInput,probeBackground,shortClick,until,sleep}=require('./window-move-probe.cjs');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);app.disableHardwareAcceleration();
const nativeShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive=function(){if(!this.isAiDiyOpeningCanvas){this.setIgnoreMouseEvents(true);this.setSkipTaskbar(true);}nativeShow.call(this);};BrowserWindow.prototype.focus=function(){};
const evaluate=(win,code)=>win.webContents.executeJavaScript(code,true);
const output=join(__dirname,'../../temp/window-move-check');mkdirSync(output,{recursive:true});
const results=[],shots=[];
// 本物のVue・xterm・Electronを使い、外部AI・PTY・マイクの通信だけを固定する。
async function moduleServer(kind){
 const settings={LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'test-model',LIVE_FREEAI_VOICE:'Zephyr'};
 const server=createServer(async(req,res)=>{
  const json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
  if(req.url==='/development/config')return json({kind,base:'/fixture/',icon:'/development/AiDiy.png'});
  if(req.url==='/api/panels/console')return json({url:`http://127.0.0.1:${server.address().port}/fixture/`});
  if(req.url==='/fixture/config')return json({自動接続:false,作業フォルダ:{名前:'fixture',パス:'/fixture'}});
  if(req.url.startsWith('/fixture/api/'))return json({status:'OK',data:{モデル設定:settings,available_models:{live_models:{freeai_live:{'test-model':'試験モデル'}},live_voices:{freeai_live:{Zephyr:'Zephyr'}}}}});
  if(req.url==='/fixture/message')return json({});
  if(req.url==='/fixture/events'||req.url==='/fixture/presence'){
   res.writeHead(200,{'content-type':'text/event-stream'});
   if(kind==='code')res.write('data: '+JSON.stringify({type:'state',会話ID:'move-fixture',信頼済み:true,接続済み:true,実行モード:'offline',作業フォルダ:{名前:'fixture',パス:'/fixture'},メッセージ:[{種別:'assistant',本文:'長押しで窓を移動します。素早くドラッグした場合は通常の文字選択です。'}],履歴:[],進捗:[],provider:'codex_cli',model:'auto'})+'\n\n');else res.write(': ready\n\n');return;
  }
  try{const reply=await fetch(new URL(req.url,process.env.AIDIY_DEVELOPMENT_URL));res.writeHead(reply.status,{'content-type':reply.headers.get('content-type')||'text/plain'});res.end(Buffer.from(await reply.arrayBuffer()));}catch{res.writeHead(500).end();}
 });
 const sockets=new WebSocketServer({server});sockets.on('connection',socket=>socket.on('message',data=>{if(JSON.parse(data).type==='start'){socket.send(JSON.stringify({type:'ready',project:'/fixture',shell:'fixture',toolsOnline:true,toolsEnabled:true}));socket.send(JSON.stringify({type:'data',data:'長押し移動テスト\r\nPS fixture> '}));}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:`http://127.0.0.1:${server.address().port}/`,close(){for(const client of sockets.clients)client.terminate();sockets.close();server.closeAllConnections();server.close();}};
}
let running=false;
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>evaluate(owner,`!!document.querySelector('.ide-heading')`),'IDE');
   await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);
   await until(()=>evaluate(owner,`!!window.aidiyIDE`),'利用開始');
   const state=await evaluate(owner,`fetch('/api/connection').then(r=>r.json())`),parent=globalThis.moveDesktop.windows.get(owner.webContents),key=`${state.mode}:${state.startedAt}`;
   for(const kind of ['code','live','console'])for(const linked of [false,true]){
    const server=await moduleServer(kind),window=await globalThis.moveDesktop.createWindow(kind,server.url,undefined,linked?parent:undefined,linked?key:undefined);
    try{
     const selector=kind==='code'?'.message.assistant p':kind==='live'?'.live-conversation':'.xterm-screen';
     await until(()=>evaluate(window,`!!document.querySelector(${JSON.stringify(selector)})&&!document.documentElement.classList.contains('desktop-opening')`),kind+'描画');
     const label=kind+(linked?' IDE起動':' 単独起動');
     const background=kind==='console'?await probeBackground(window.webContents):selector;
     results.push(await holdMove(window,window.webContents,background,label+'背景'));
     results.push(await checkNativeControls(window,window.webContents,label));
     if(kind==='console')results.push(await holdUnmoved(window,window.webContents,'.xterm-screen',label+'端末入力'));
     if(kind==='code'&&!linked)results.push(await checkMaximizedInput(window,window.webContents,label));
     if(kind!=='console'){
      results.push(await holdUnmoved(window,window.webContents,'textarea',label+'入力欄'));
      await shortClick(window.webContents,'textarea');assert.equal(await evaluate(window,`document.activeElement.tagName`),'TEXTAREA');
      window.webContents.insertText('入力は維持');assert.equal(await evaluate(window,`document.querySelector('textarea').value`),'入力は維持');
     }
     if(kind==='code'){
      const originalCursor=screen.getCursorScreenPoint,originalFocus=window.isFocused;let cursor=originalCursor();screen.getCursorScreenPoint=()=>cursor;window.isFocused=()=>true;
      try{
       const p=await evaluate(window,`(()=>{const r=document.querySelector('.message.assistant p').getBoundingClientRect();return{x:Math.round(r.left+3),y:Math.round(r.top+10)}})()`);
       window.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});cursor={x:cursor.x+70,y:cursor.y};window.webContents.sendInputEvent({type:'mouseMove',x:p.x+70,y:p.y,button:'left',modifiers:['leftButtonDown']});window.webContents.sendInputEvent({type:'mouseUp',x:p.x+70,y:p.y,button:'left',clickCount:1});await sleep(150);
       assert.ok((await evaluate(window,'getSelection().toString()')).length>0,'Codeの文字選択を維持');
      }finally{screen.getCursorScreenPoint=originalCursor;window.isFocused=originalFocus;}
     }
     const file=join(output,`${kind}-${linked?'ide':'standalone'}.png`);writeFileSync(file,(await window.webContents.capturePage()).toPNG());shots.push(file);
    }finally{window.destroy();server.close();}
   }
   const viewer=await globalThis.moveDesktop.createWindow('viewer',parent.url+'#viewer=sample.txt',undefined,parent,key);
   await until(()=>evaluate(viewer,`!!document.querySelector('.viewer-code .view-line')&&!document.documentElement.classList.contains('desktop-opening')`),'独立ビューア');
   results.push(await holdUnmoved(viewer,viewer.webContents,'.viewer-code .view-line','独立ファイルビューアeditor'));
   const viewerBackground=await probeBackground(viewer.webContents);
   results.push(await holdMove(viewer,viewer.webContents,viewerBackground,'独立ファイルビューア背景'));
   for(const ending of ['escape','blur'])results.push(await holdMove(viewer,viewer.webContents,viewerBackground,'独立Viewer取消_'+ending,ending));viewer.destroy();
   const result={testPassed:true,scope:'Code / Live / Console の単独・IDE起動、独立ファイルビューア',input:'Electron実入力。カーソル位置とフォーカスだけfixture、OS窓サイズは実測。',results,shots};writeFileSync(join(output,'modules-result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
 });
});
setTimeout(()=>app.exit(2),180000).unref();
const filename=require.resolve('../desktop.cjs'),desktop=new Module(filename,module);desktop.filename=filename;desktop.paths=Module._nodeModulePaths(join(__dirname,'..'));
desktop._compile(readFileSync(filename,'utf8')+'\nglobalThis.moveDesktop={createWindow,windows};',filename);
