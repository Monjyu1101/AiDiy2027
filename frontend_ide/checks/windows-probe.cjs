// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen,dialog}=require('electron');
dialog.showMessageBox=async()=>({response:0});
if(process.env.AIDIY_TEST_PROFILE)app.setPath('appData',process.env.AIDIY_TEST_PROFILE);
const {windowBounds}=require('../デスクトップ/window-layout.cjs');
// 拡大演出専用の一時窓をアプリ本体として数えない。
const applicationWindows=()=>BrowserWindow.getAllWindows().filter(window=>/^http:/.test(window.webContents.getURL()));
// desktop-probeと同じく、Windowsの小数DPI倍率による外枠の最大2 DIPの丸めを許容する。
function assertBounds(actual,expected){for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=2,`${key}: ${actual[key]} / ${expected[key]}`);}
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<80;i++){if(await check())return;await sleep(100);}throw Error('画面待機タイムアウト');}
const evaluate=(window,script)=>window.webContents.executeJavaScript(script,true);
let started=false;
app.on('browser-window-created',(_event,dev)=>{
 if(started)return;started=true;
 dev.webContents.once('did-finish-load',async()=>{
 try{
  await until(async()=>await evaluate(dev,`!!document.querySelector('.component-toolbar button')`));
  assertBounds(dev.getBounds(),windowBounds('ide',screen.getDisplayMatching(dev.getBounds()).workArea));
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('code')`)).ok,false);
  await evaluate(dev,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  await until(async()=>await evaluate(dev,`!!document.querySelector('.ai-launchers')`));
  assert.deepEqual(await evaluate(dev,`Array.from(document.querySelectorAll('.ai-launchers button')).map(b=>b.textContent)`),['Console','Code','Browser']);
  assert.equal(await evaluate(dev,`!!document.querySelector('.ai-popup')`),false);
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('live')`)).ok,false);
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('bad')`)).ok,false);
  // 実際の「Code」ボタンから起動する。
  await evaluate(dev,`Array.from(document.querySelectorAll('.ai-launchers button')).find(button=>button.textContent==='Code').click()`);
  await until(()=>applicationWindows().length===2);
  let code=applicationWindows().find(window=>window!==dev);
  await until(async()=>await evaluate(code,`!!document.querySelector('[data-component=CodePanel] .connection-bar.offline')`));
  assert.equal(await evaluate(code,`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('自動接続'))`),false);
  assert.equal(code.getTitle(),'AiDiy IDE / Code 1');
  assert.equal(await evaluate(code,`document.querySelector('.panel-brand strong').textContent`),'AiDiy IDE / Code 1');
  const codeUrl=code.webContents.getURL();
  assertBounds(code.getBounds(),windowBounds('code',screen.getDisplayMatching(dev.getBounds()).workArea,dev.getBounds()));
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('code')`)).ok,true);
  const secondCode=applicationWindows().find(window=>window!==dev&&window!==code);
  assert.equal(applicationWindows().length,3);
  assert.notEqual(secondCode.webContents.getURL(),codeUrl);
  assertBounds(secondCode.getBounds(),windowBounds('code',screen.getDisplayMatching(dev.getBounds()).workArea,dev.getBounds(),1));
  secondCode.close();await until(()=>secondCode.isDestroyed());
  assert.notEqual(codeUrl,dev.webContents.getURL());
  assert.equal((await fetch(codeUrl+'api/connection').then(r=>r.json())).project.path,(await fetch(process.env.AIDIY_DEVELOPMENT_URL+'api/connection').then(r=>r.json())).project.path);
  assert.equal((await evaluate(code,`window.aidiyWindow.openApp('code')`)).ok,false);
  await until(async()=>await evaluate(dev,`!!window.aidiyIDE?.world`));
  dev.show();dev.focus();
  await evaluate(dev,`window.aidiyIDE.setAutoSpin(false);window.aidiyIDE.setFilter('');window.aidiyIDE.setViewMode('2d');window.aidiyIDE.goTo({type:'file',path:'package.json'})`);
  await until(async()=>await evaluate(dev,`!!document.querySelector('.viewer-popup button[aria-label="プレビューを閉じる"]')`));
  await sleep(400);
  const closePoint=await evaluate(dev,`(()=>{const button=document.querySelector('.viewer-popup button[aria-label="プレビューを閉じる"]'),rect=button.getBoundingClientRect();const x=Math.floor(rect.x+rect.width/2),y=Math.floor(rect.y+rect.height/2);return{x,y,hit:document.elementFromPoint(x,y)===button};})()`);
  assert.equal(closePoint.hit,true,'Codeボタンがプレビューを閉じるボタンに重ならない');
  writeFileSync(join(__dirname,'../../nn-viewer-close.png'),(await dev.webContents.capturePage()).toPNG());
  dev.webContents.sendInputEvent({type:'mouseDown',x:closePoint.x,y:closePoint.y,button:'left',clickCount:1});
  dev.webContents.sendInputEvent({type:'mouseUp',x:closePoint.x,y:closePoint.y,button:'left',clickCount:1});
  await until(async()=>await evaluate(dev,`!document.querySelector('.viewer-popup')`));
  dev.show();dev.focus();await sleep(2300);
  writeFileSync(join(__dirname,'../../nn-dev-desktop.png'),(await dev.webContents.capturePage()).toPNG());
  code.show();code.focus();await sleep(350);
  writeFileSync(join(__dirname,'../../nn-dev-code.png'),(await code.webContents.capturePage()).toPNG());
  await evaluate(code,`setTimeout(()=>window.aidiyWindow.close(),20);true`);
  await until(()=>code.isDestroyed());assert.equal(dev.isDestroyed(),false);
  await until(async()=>{try{await fetch(codeUrl);return false;}catch{return true;}});
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('code')`)).ok,true);
  code=applicationWindows().find(window=>window!==dev);
  // rendererの通知がなくても、IDEのセッション終了をメイン側が検知する。
  await fetch(process.env.AIDIY_DEVELOPMENT_URL+'api/connection/disconnect',{method:'POST'});
  await until(()=>code.isDestroyed());
  await until(async()=>await evaluate(dev,`Array.from(document.querySelectorAll('.component-toolbar button')).some(b=>b.textContent==='AiDiy接続利用')`));
  await evaluate(dev,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='AiDiy接続利用').click()`);
  await until(async()=>await evaluate(dev,`document.querySelectorAll('.ai-launchers button').length===4`));
  const liveResults=await evaluate(dev,`Promise.all(Array.from({length:5},()=>window.aidiyWindow.openApp('live')))`);
  assert.ok(liveResults.every(result=>result.ok));
  assert.equal(applicationWindows().length,2);
  await until(async()=>await evaluate(dev,`document.querySelectorAll('.ai-launchers button').length===3`));
  let live=applicationWindows().find(window=>window!==dev&&window!==code);
  await until(async()=>await evaluate(live,`!!document.querySelector('[data-component=LivePanel]')`));
  assert.equal(live.getTitle(),'AiDiy IDE / Live');
  assert.equal(await evaluate(live,`document.querySelector('.panel-brand strong').textContent`),'AiDiy IDE / Live');
  const audio=await evaluate(live,`(async()=>{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const count=stream.getAudioTracks().length;stream.getTracks().forEach(track=>track.stop());return count;})()`);
  assert.equal(audio,1);
  dev.show();dev.focus();await sleep(2300);
  writeFileSync(join(__dirname,'../../nn-dev-desktop.png'),(await dev.webContents.capturePage()).toPNG());
  const closedLiveUrl=live.webContents.getURL();
  live.close();await until(()=>live.isDestroyed());
  await until(async()=>await evaluate(dev,`document.querySelectorAll('.ai-launchers button').length===4`));
  await evaluate(dev,`Array.from(document.querySelectorAll('.ai-launchers button')).find(button=>button.textContent==='Live').click()`);
  await until(()=>applicationWindows().length===2);
  live=applicationWindows().find(window=>window!==dev);
  await until(async()=>await evaluate(live,`!!document.querySelector('[data-component=LivePanel]')`));
  await until(async()=>await evaluate(dev,`document.querySelectorAll('.ai-launchers button').length===3`));
  const liveUrl=live.webContents.getURL();assert.notEqual(liveUrl,closedLiveUrl);
  assertBounds(live.getBounds(),windowBounds('live',screen.getDisplayMatching(dev.getBounds()).workArea,dev.getBounds()));
  const opened=await evaluate(dev,`Promise.all(Array.from({length:2},()=>window.aidiyWindow.openApp('code')))`);
  assert.ok(opened.every(result=>result.ok));
  assert.equal(applicationWindows().length,4);
  live.minimize();
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('live')`)).reused,true);
  await until(()=>!live.isMinimized()&&live.isFocused());
  assert.equal(applicationWindows().length,4);
  console.log('LAYOUT '+JSON.stringify(applicationWindows().map(window=>({title:window.getTitle(),bounds:window.getBounds()}))));
  const codeWindows=applicationWindows().filter(window=>window!==dev&&window!==live).sort((a,b)=>a.getBounds().y-b.getBounds().y);
  const visibleCode=codeWindows[0];
  assert.notEqual(codeWindows[0].webContents.getURL(),codeWindows[1].webContents.getURL());
  assert.equal(visibleCode.getBounds().y,live.getBounds().y);
  assert.equal(visibleCode.getBounds().height,live.getBounds().height);
  visibleCode.show();visibleCode.moveTop();codeWindows[1].moveTop();live.moveTop();live.focus();
  await sleep(1000);
  // 3窓の実際の位置をデスクトップ全体の撮影で確認する。
  const display=screen.getDisplayMatching(dev.getBounds());
  const sources=await Promise.race([require('electron').desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:display.size.width,height:display.size.height}}),sleep(10000).then(()=>null)]);
  if(sources){const source=sources.find(item=>item.display_id===String(display.id));assert.ok(source);writeFileSync(join(__dirname,'../../nn-ide-windows.png'),source.thumbnail.toPNG());}
  else console.log('ENV EXCLUDED: DXGIデスクトップ撮影が10秒以内に完了しません。窓配置・終了の検証は継続します。');
  await fetch(process.env.AIDIY_DEVELOPMENT_URL+'api/connection/disconnect',{method:'POST'});
  await until(()=>live.isDestroyed());
  await until(async()=>{try{await fetch(liveUrl);return false;}catch{return true;}});
  await until(async()=>await evaluate(dev,`Array.from(document.querySelectorAll('.component-toolbar button')).some(b=>b.textContent==='オフライン利用')`));
  await evaluate(dev,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
  await until(async()=>await evaluate(dev,`!!document.querySelector('.ai-launchers')`));
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('code')`)).ok,true);
  assert.equal((await evaluate(dev,`window.aidiyWindow.openApp('code')`)).ok,true);
  const children=applicationWindows().filter(window=>window!==dev);
  assert.equal(children.length,2);
  const urls=children.map(window=>window.webContents.getURL());
  dev.once('closed',()=>{
   try{
    assert.ok(children.every(window=>window.isDestroyed()));
    console.log('WINDOWS PASS: Code複数窓・Live単一窓とボタン復帰・IDE連携・全窓終了');
    process.send?.({testPassed:true,urls});
   }catch(error){console.error(error);app.exit(1);}
  });
  if(process.env.AIDIY_TEST_CLOSE==='title')await evaluate(dev,`setTimeout(()=>window.aidiyWindow.close(),20);true`);
  else{
   await evaluate(dev,`Array.from(document.querySelectorAll('.component-toolbar button')).find(b=>b.textContent==='終了').click();true`);
   await until(()=>children.every(window=>window.isDestroyed()));
   await until(async()=>await evaluate(dev,`Array.from(document.querySelectorAll('.component-toolbar button')).some(b=>b.textContent==='AiDiy接続利用'&&!b.disabled)`));
   assert.equal(dev.isDestroyed(),false);dev.close();
  }
 }catch(error){console.error(error);app.exit(1);}
 });
});
require('../desktop.cjs');
setTimeout(()=>app.exit(2),120000).unref();
