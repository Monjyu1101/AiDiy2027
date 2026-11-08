// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実ChromiumのCDP検査と隔離DOM取得を確認する。外部サイト・AI・本番設定を使わない。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import WebSocket from 'ws';
import {createBrowserElementLink} from '../デスクトップ/ブラウザ要素連携.cjs';
import {createBrowserElementPanel,PANEL_HTML} from '../デスクトップ/ブラウザ要素パネル.cjs';
const output=new URL('../temp/browser-element-check/',import.meta.url);mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(tmpdir(),'aidiy-element-check-'));
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><style>body{font:18px system-ui;background:#ecf4fa;padding:40px}#target{border:2px solid #2988ad;padding:30px;width:420px}button{font:20px system-ui;background:#236b99;color:white;padding:16px;margin:8px}input{margin:8px}</style><h1>要素連携 検証ページ</h1><section id="target" data-token="data-secret"><h2>商品フォーム</h2><label>名前<input value="input-secret" type="text"></label><input type="password" value="password-secret"><input type="hidden" value="hidden-secret"><textarea>textarea-secret</textarea><div contenteditable="true">editable-secret</div><span hidden>hidden-note-secret</span><span style="display:none">display-secret</span><span style="visibility:hidden">visibility-secret</span><pre>{"password":"json-secret"}</pre><button id="save" onclick="window.clicks++">保存</button><a href="/next?token=query-secret#fragment-secret">次の画面</a><script>window.clicks=0;window.secret='script-secret';</script></section><div id="huge"></div><iframe src="/frame"></iframe><script>document.querySelector('#huge').innerHTML='<span>item</span>'.repeat(400);window.__aidiyElement={fake:'page spoof'};</script></html>`;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(req.url==='/panel'?PANEL_HTML:req.url==='/frame'?'<button id="inside">フレーム内</button>':html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1280,900','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
const sockets=[];let picker,port,errors='';chrome.stderr.on('data',data=>errors+=data);
async function connect(target){
 const socket=new WebSocket(target.webSocketDebuggerUrl);sockets.push(socket);await once(socket,'open');let next=0;const calls=new Map(),events=new EventEmitter();
 socket.on('message',raw=>{const data=JSON.parse(raw);if(data.id){const call=calls.get(data.id);calls.delete(data.id);if(data.error)call?.reject(Error(JSON.stringify(data.error)));else call?.resolve(data.result);}else events.emit('message',{},data.method,data.params);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;calls.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result));return result.result?.value;};
 return{events,send,evaluate};
}
try{
 await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+errors);});
 const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=await connect(tabs.find(t=>t.type==='page'));
 const panelTarget=await(await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin+'/panel')}`,{method:'PUT'})).json();const panelPage=await connect(panelTarget);
 await page.send('Page.enable');await page.send('Runtime.enable');await page.send('Page.navigate',{url:origin+'/?token=page-secret#private'});await until(()=>page.evaluate('!!document.querySelector("#save")'),'fixture loaded');
 let attached=false,selected=0,popupClosed=false,last,panelUpdate,available=true;const failure=[];
 const debug=Object.assign(page.events,{isAttached:()=>attached,attach(){attached=true;},sendCommand:page.send});
 const contents=Object.assign(new EventEmitter(),{debugger:debug,getURL:()=>origin+'/?token=page-secret#private',isDestroyed:()=>false,focus(){}});
 const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,webContents:new EventEmitter(),getBounds:()=>({x:0,y:0,width:1280,height:900})});
 // nativeウィンドウのAPIだけを置換し、実パネルのHTMLと更新処理をChromiumで実行する。
 class PanelWindow extends EventEmitter{
  constructor(){super();this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){},executeJavaScript:async script=>{panelUpdate=script;await panelPage.evaluate(script);}});}
  isDestroyed(){return popupClosed;}showInactive(){}destroy(){popupClosed=true;this.emit('closed');}
  async loadURL(url){popupClosed=false;await panelPage.send('Page.navigate',{url});await until(()=>panelPage.evaluate('!!document.querySelector("#html")'),'panel loaded');}
 }
 picker=createBrowserElementLink({contents,record:{window},BrowserWindow:PanelWindow,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1280,height:900}})},available:()=>available,onChange(){},onSelected(){selected++;},onError:error=>{if(error)failure.push(error);},panelFactory:options=>{const actual=createBrowserElementPanel(options);return{...actual,update(value){last=value;actual.update(value);}};}});
 const move=async(x,y)=>page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
 const bounds=selector=>page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+Math.min(8,r.width/2),y:r.y+Math.min(8,r.height/2)}})()`);
 await picker.start();const target=await bounds('#target');await move(target.x,target.y);await until(()=>last?.tag==='section','hover section');
 const serialized=JSON.stringify(last);for(const secret of ['input-secret','password-secret','hidden-secret','textarea-secret','editable-secret','data-secret','query-secret','fragment-secret','script-secret','page-secret','hidden-note-secret','display-secret','visibility-secret','json-secret'])assert.ok(!serialized.includes(secret),'redacted '+secret);
 assert.match(last.html,/商品フォーム/);assert.match(last.css.display,/block/);assert.match(last.notice,/元のVue/);
 await until(()=>panelPage.evaluate('document.querySelector("#html").textContent.includes("商品フォーム")'),'source panel');
 writeFileSync(new URL('01-html-css-panel.png',output),Buffer.from((await panelPage.send('Page.captureScreenshot')).data,'base64'));
 writeFileSync(new URL('02-element-highlight.png',output),Buffer.from((await page.send('Page.captureScreenshot')).data,'base64'));
 const save=await bounds('#save');await move(save.x,save.y);await until(()=>last?.selector==='button#save','hover button');
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:save.x,y:save.y,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:save.x,y:save.y,button:'left',clickCount:1});await until(()=>selected===1,'selection');
 assert.equal(await page.evaluate('window.clicks'),0,'選択クリックがページの保存処理を実行しない');assert.equal(picker.active,false);
 const draft=picker.request('/project',{session:'aidiy_browser fixture',tabId:'fixture'});assert.match(draft.text,/#save/);assert.match(draft.text,/保存/);assert.ok(!draft.text.includes('page-secret'));
 contents.emit('did-start-navigation',{},origin+'/',false,true);await sleep(80);assert.throws(()=>picker.request('/project',{session:'s',tabId:'t'}));
 // 実CDPのEscape（本文・入力フォーカス）とElectron購読の模擬経路を分けて確認する。
 let clicks=0;
 for(const focus of ['body','input','electron-event']){
  await picker.start();
  if(focus==='electron-event'){
   let prevented=false;contents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'Escape'});assert.equal(prevented,true);
  }else{
   await page.evaluate(focus==='input'?`document.querySelector('input[type="text"]').focus()`:`document.activeElement.blur()`);
   await page.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
  await until(()=>!picker.active,'Esc '+focus);await sleep(80);
  // UIの解除だけで合格にせず、選択overlayのクリック抑止も消えたことを確認する。
  await move(save.x,save.y);await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:save.x,y:save.y,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:save.x,y:save.y,button:'left',clickCount:1});assert.equal(await page.evaluate('window.clicks'),++clicks,focus+' restores normal clicks');assert.equal(selected,1,'解除後のクリックで下書きを再選択しない');
 }
 writeFileSync(new URL('03-after-escape.png',output),Buffer.from((await page.send('Page.captureScreenshot')).data,'base64'));
 await picker.start();available=false;await picker.stop();assert.equal(picker.active,false);assert.throws(()=>picker.request('/project',{session:'s',tabId:'t'}));
 assert.deepEqual(failure,[]);assert.ok(panelUpdate.includes('textContent'));writeFileSync(new URL('result.json',output),JSON.stringify({passed:true,checks:['CDP hover','isolated DOM and computed CSS','private inputs omitted','URL tokens omitted','native panel HTML and safe text rendering','click consumed','draft identity','navigation invalidation','CDP Escape on body and input','simulated Electron Escape event','normal click after each cancel','disconnect'],nativeElectron:false},null,2));
 console.log('PASS: real Chromium element inspection, source panel, redaction, click suppression, draft, Esc/navigation/disconnect. Screenshots: '+output.pathname);
}finally{
 picker?.dispose();for(const socket of sockets)socket.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(100);rmSync(temporary,{recursive:true,force:true});
}
