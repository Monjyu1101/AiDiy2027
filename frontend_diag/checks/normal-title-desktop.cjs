// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成画面 + 実Electron trusted入力・isolated DOM。OSのカーソル/フォーカスのみ模擬。
// Windows実機のnativeジェスチャー・DPI・複数画面の代用ではない。
'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const {通常窓サイズを作成}=require('../diag/起動/通常窓サイズ.cjs');
const {標準タイトル操作を取り付け}=require('../diag/起動/標準タイトル操作.cjs');
const profile=mkdtempSync(join(tmpdir(),'diag-standard-title-'));
app.setPath('userData',profile);app.setPath('sessionData',profile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 let window;
 try{
  window=new BrowserWindow({x:40,y:40,width:800,height:600,frame:false,transparent:true,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
  // headlessではOSフォーカスがない。ユーザーの窓・マウスを動かさず固定DIPを供給する。
  const headless=app.commandLine.getSwitchValue('ozone-platform')==='headless';
  if(headless){
   // Ozoneの実窓は1px。座標の契約は合成bounds、DOMは明示viewportで検証する。
   let bounds={x:40,y:40,width:800,height:600};
   window.getBounds=window.getNormalBounds=()=>({...bounds});window.setBounds=value=>{bounds={...value};};
  }
  window.isFocused=()=>true;let cursor={x:440,y:55},enabled=true,toggles=0;
  const screen={getCursorScreenPoint:()=>cursor,getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:800}})};
  const sizing=通常窓サイズを作成(window,screen,'win32');
  const controller=標準タイトル操作を取り付け(sizing,screen,{platform:'win32',enabled:()=>enabled,toggleMaximize:()=>{toggles++;sizing.isMaximized()?sizing.unmaximize():sizing.maximize();}});
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><style>html,body{margin:0}header{height:32px;background:#222;color:white;user-select:none}button{margin-left:10px}input{width:80px}</style><header data-aidiy-standard-title data-aidiy-no-window-move>title <button>button</button><input><select><option>one</option></select></header><main>body</main>'));
  window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:1200,height:800},viewPosition:{x:0,y:0},viewSize:{width:1200,height:800},deviceScaleFactor:1,scale:1});window.webContents.focus();
  await sleep(150);
  const send=async(type,x=400,y=15,clickCount=1)=>{window.webContents.sendInputEvent({type,x,y,button:'left',clickCount,...(type==='mouseMove'?{modifiers:['leftButtonDown']}: {})});await sleep(70);};
  const original=window.getBounds();
  for(let i=0;i<2;i++){
   cursor={x:original.x+400,y:original.y+15};await send('mouseDown',400,15,2);await send('mouseUp');assert.equal(sizing.isMaximized(),true);
   cursor={x:400,y:15};await send('mouseDown',400,15,2);await send('mouseUp');assert.equal(sizing.isMaximized(),false);assert.deepEqual(window.getBounds(),original);
  }
  const before=toggles;
  const controls=await window.webContents.executeJavaScript("[...document.querySelectorAll('button,input,select')].map(n=>{const r=n.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})");
  for(const point of [...controls,{x:400,y:100}]){await send('mouseDown',point.x,point.y,2);await send('mouseUp',point.x,point.y);}
  assert.equal(toggles,before);
  // selectのpopupを閉じ、標準タイトルを新しいgestureで操作する。
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
  sizing.maximize();cursor={x:600,y:15};await send('mouseDown',600,15);
  cursor={x:620,y:35};await send('mouseMove',620,35);assert.equal(sizing.isMaximized(),false);assert.deepEqual(window.getBounds(),{x:220,y:20,width:original.width,height:original.height});
  await send('mouseUp',400,15);const released=window.getBounds();cursor={x:900,y:200};await send('mouseMove');assert.deepEqual(window.getBounds(),released);
  // DOM pointercancel/capture喪失の後も遅いmouseMoveで移動しない。
  cursor={x:released.x+400,y:released.y+15};await send('mouseDown');
  await window.webContents.executeJavaScript("for(const n of document.querySelectorAll('*'))for(let id=0;id<8;id++)if(n.hasPointerCapture(id))n.releasePointerCapture(id)");
  await sleep(50);cursor={x:1000,y:300};await send('mouseMove');assert.deepEqual(window.getBounds(),released);await send('mouseUp');
  // pending captureの解除後、lostpointercapture通知より先にmove/upが並んでも復活しない。
  cursor={x:released.x+400,y:released.y+15};await send('mouseDown');
  await window.webContents.executeJavaScript("for(const n of document.querySelectorAll('*'))for(let id=0;id<8;id++)if(n.hasPointerCapture(id))n.releasePointerCapture(id)");
  cursor={x:1100,y:400};window.webContents.sendInputEvent({type:'mouseMove',x:450,y:20,modifiers:['leftButtonDown']});window.webContents.sendInputEvent({type:'mouseUp',x:450,y:20,button:'left'});await sleep(100);assert.deepEqual(window.getBounds(),released);
  enabled=false;await send('mouseDown',400,15,2);await send('mouseUp');assert.equal(toggles,before);controller.dispose();
  console.log(JSON.stringify({passed:true,trustedElectronInput:true,isolatedTitleHitTest:true,doubleClickRepeat:true,restoreAnchor:true,negativeTargets:true,releasedAndLostCapture:true,nativeWindowsDesktop:false,geometry:headless?'synthetic headless bounds':'Electron bounds'}));
 }catch(error){console.error(error);process.exitCode=1;}finally{if(window&&!window.isDestroyed())window.destroy();app.quit();}
});
app.on('quit',()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}});
