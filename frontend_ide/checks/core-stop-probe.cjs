// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,dialog}=require('electron');
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(await check())return;await sleep(100);}throw Error('画面待機タイムアウト');}
const evaluate=(window,script)=>window.webContents.executeJavaScript(script,true);
const state=()=>fetch(process.env.AIDIY_DEVELOPMENT_URL+'api/connection').then(r=>r.json());
let started=false;
let confirmation,confirmationCount=0;
// OSダイアログの選択だけを代行し、実窓のcloseイベント・IPC・後片付けを検証する。
dialog.showMessageBox=(window,options)=>{confirmationCount++;assert.equal(options.message,'AiDiy IDE を終了しますか？');assert.deepEqual(options.buttons,['終了する','キャンセル']);assert.equal(options.defaultId,1);assert.equal(options.cancelId,1);return new Promise(resolve=>{confirmation={window,resolve};});};
app.on('browser-window-created',(_event,ide)=>{
 if(started)return;started=true;
 ide.webContents.once('did-finish-load',async()=>{
  try{
   await sleep(1800);
   await evaluate(ide,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='AiDiy接続利用').click()`);
   await until(async()=>(await state()).connected);
   const startedAt=(await state()).startedAt;
   assert.equal((await evaluate(ide,`window.aidiyWindow.openApp('code')`)).ok,true);
   const code=BrowserWindow.getAllWindows().find(window=>window!==ide&&window.webContents.getURL().startsWith('http://127.0.0.1:'));
   assert.ok(code);const codeUrl=code.webContents.getURL();
   await until(async()=>await evaluate(code,`!!document.querySelector('textarea')`));
   await evaluate(code,`const input=document.querySelector('textarea');input.value='開発中の下書きを保持する';input.dispatchEvent(new Event('input',{bubbles:true}));`);
   await until(async()=>await evaluate(ide,`!!window.aidiyIDE?.world`));
   await evaluate(ide,`window.aidiyIDE.goTo({type:'file',path:'package.json'})`);
   await until(async()=>await evaluate(ide,`!!document.querySelector('.viewer-popup')`));
   process.send({core:'stop'});
   await until(async()=>!(await state()).connected);
   await sleep(1600); // メイン側の子窓監視とVue側の状態ポーリングを通す。
   const disconnected=await state();assert.equal(disconnected.active,true);assert.equal(disconnected.startedAt,startedAt);
   assert.equal(ide.isDestroyed(),false);assert.equal(code.isDestroyed(),false);
   assert.equal(await evaluate(code,`document.querySelector('textarea').value`),'開発中の下書きを保持する');
   assert.equal(await evaluate(ide,`!!document.querySelector('.viewer-popup')`),true);
   assert.equal((await fetch(codeUrl)).status,200);
   assert.equal((await fetch(process.env.AIDIY_DEVELOPMENT_URL+'api/galaxy')).status,200);
   writeFileSync(join(__dirname,'../../nn-core-stop-code.png'),(await code.webContents.capturePage()).toPNG());
   writeFileSync(join(__dirname,'../../nn-core-stop-ide.png'),(await ide.webContents.capturePage()).toPNG());
   process.send({core:'restart'});
   await until(async()=>(await state()).connected);
   assert.equal((await state()).startedAt,startedAt);assert.equal(code.isDestroyed(),false);
   assert.equal(await evaluate(code,`document.querySelector('textarea').value`),'開発中の下書きを保持する');
   const extra=await evaluate(ide,`window.aidiyWindow.openApp('code')`);assert.equal(extra.ok,true);
   assert.equal((await evaluate(ide,`window.aidiyWindow.openApp('live')`)).ok,true);
   const children=BrowserWindow.getAllWindows().filter(window=>window!==ide&&window.webContents.getURL().startsWith('http://127.0.0.1:'));
   assert.equal(children.length,3);
   assert.equal(ide.isAlwaysOnTop(),false);
   assert.ok(children.every(window=>window.isAlwaysOnTop()),'IDE配下のCode / Liveは常に最前面');
   const urls=children.map(window=>window.webContents.getURL());
   console.log('CORE STOP PASS: コア停止・復帰でIDEのファイル表示とCodeの窓・下書きを維持');
   // 「終了」は全子窓を閉じ、IDE本体とサーバーは起動画面のまま残す。
   await evaluate(ide,`document.querySelector('.component-toolbar nav button').click()`);
   await until(async()=>!(await state()).active&&children.every(window=>window.isDestroyed()));
   await until(async()=>await evaluate(ide,`Array.from(document.querySelectorAll('.ide-start-actions button')).some(b=>b.textContent==='AiDiy接続利用'&&!b.disabled)`));
   assert.equal(ide.isDestroyed(),false);assert.equal(confirmationCount,0);
   assert.equal((await state()).startedAt,null);
   assert.equal((await fetch(process.env.AIDIY_DEVELOPMENT_URL)).status,200);
   for(const url of urls)await until(async()=>{try{await fetch(url);return false;}catch{return true;}});
   await sleep(800);
   writeFileSync(join(__dirname,'../../nn-ide-session-ended.png'),(await ide.webContents.capturePage()).toPNG());
   // 起動画面から再び利用できる。利用中の×は確認し、キャンセルで作業を保つ（二重表示しない）。
   await evaluate(ide,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='AiDiy接続利用').click()`);
   await until(async()=>(await state()).connected);assert.notEqual((await state()).startedAt,startedAt);
   for(const type of ['code','live'])assert.equal((await evaluate(ide,`window.aidiyWindow.openApp('${type}')`)).ok,true);
   const reopened=BrowserWindow.getAllWindows().filter(window=>window!==ide&&window.webContents.getURL().startsWith('http://127.0.0.1:'));
   assert.equal(reopened.length,2);urls.push(...reopened.map(window=>window.webContents.getURL()));
   await evaluate(ide,`document.querySelector('.window-actions button[aria-label="終了"]').click()`);
   await until(()=>!!confirmation);assert.equal(confirmation.window,ide);ide.close();await sleep(300);assert.equal(confirmationCount,1,'確認ダイアログを重複表示しない');
   confirmation.resolve({response:1});confirmation=undefined;await sleep(100);
   assert.ok(reopened.every(window=>!window.isDestroyed()));assert.equal((await state()).active,true);
   // 「終了」で起動画面へ戻った後の×は、確認なしで閉じる。
   await evaluate(ide,`document.querySelector('.component-toolbar nav button').click()`);
   await until(async()=>!(await state()).active&&reopened.every(window=>window.isDestroyed()));
   ide.once('closed',()=>{try{assert.equal(confirmationCount,1,'起動画面の×は確認しない');process.send({testPassed:true,urls});}catch(error){console.error(error);app.exit(1);}});
   await evaluate(ide,`document.querySelector('.window-actions button[aria-label="終了"]').click()`);
   console.log('IDE EXIT PASS: 終了で起動画面へ復帰、再利用、利用中の×の取消・重複防止、起動画面の×は確認なしで終了');
  }catch(error){console.error(error);app.exit(1);}
 });
});
require('../desktop.cjs');
setTimeout(()=>app.exit(2),60000).unref();
