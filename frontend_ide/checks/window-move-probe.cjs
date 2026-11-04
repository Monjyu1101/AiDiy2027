// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {screen}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<160;i++){if(await fn())return;await sleep(50);}throw Error('長押し確認: '+label);}
async function point(contents,selector){return contents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+Math.min(30,r.width/2)),y:Math.round(r.y+r.height/2)}})()`);}
async function holdMove(window,contents,selector,label,ending='release'){
 const focus=window.isFocused,cursorRead=screen.getCursorScreenPoint;let cursor=cursorRead();
 window.isFocused=()=>true;screen.getCursorScreenPoint=()=>cursor;
 try{
  await until(()=>contents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`),label+'対象');
  const cssPoint=await point(contents,selector),zoom=contents.getZoomFactor(),p={x:Math.round(cssPoint.x*zoom),y:Math.round(cssPoint.y*zoom)},before=window.getBounds(),url=contents.getURL();
  await contents.executeJavaScript(`window.moveInputs=[];window.moveInput=e=>moveInputs.push(e.type);for(const type of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.addEventListener(type,moveInput,true)`);
  const pressedAt=performance.now();contents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  await sleep(400);assert.deepEqual(await contents.executeJavaScript('moveInputs'),['pointerdown','mousedown'],label+'元の押下を遅延・再送しない');
  assert.deepEqual(window.getBounds(),before,label+'0.5秒未満は移動しない');
  await until(()=>contents.executeJavaScript(`!!document.querySelector('[data-aidiy-window-move]:popover-open')`),label+'移動表示');
  const holdDetectedAfterMs=performance.now()-pressedAt;
  assert.equal(await contents.executeJavaScript(`(()=>{const node=document.elementFromPoint(${cssPoint.x},${cssPoint.y});return node.hasAttribute('data-aidiy-window-move')&&getComputedStyle(node).cursor==='move';})()`),true,label+'押している場所を移動カーソルで覆う');
  const marker=await contents.executeJavaScript(`(()=>{const r=document.querySelector('[data-aidiy-move-marker]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  assert.ok(Math.abs(marker.width-28)<.01&&Math.abs(marker.height-28)<.01);assert.ok(marker.x>=0&&marker.y>=0);
  const directory=join(__dirname,'../../temp/window-move-check/markers');mkdirSync(directory,{recursive:true});const markerShot=join(directory,label.replace(/[^a-zA-Z0-9一-龠ぁ-んァ-ン]/g,'_')+'.png');writeFileSync(markerShot,(await contents.capturePage()).toPNG());
  for(let i=0;i<4;i++){cursor={x:cursor.x+12,y:cursor.y+7};contents.sendInputEvent({type:'mouseMove',...p,button:'left',modifiers:['leftButtonDown']});await sleep(35);}
  await until(()=>Math.abs(window.getBounds().x-before.x-48)<=2,label+'窓移動');
  if(ending==='escape'){contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});}
  if(ending==='blur')window.emit('blur');
  if(ending!=='release')await until(()=>contents.executeJavaScript(`!document.querySelector('[data-aidiy-window-move]')`),label+'取消で表示解除');
  contents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});
  await until(()=>contents.executeJavaScript(`!document.querySelector('[data-aidiy-window-move]')`),label+'移動表示解除');
  await until(async()=> (await contents.executeJavaScript('moveInputs')).includes('mouseup'),label+'元の解放を配信');
  assert.deepEqual(await contents.executeJavaScript('moveInputs'),['pointerdown','mousedown','pointercancel','pointerup','mouseup'],label+'背景操作を取消し、元の解放は渡してclickだけを抑止');assert.equal(contents.getURL(),url);
  const after=window.getBounds();assert.ok(Math.abs(before.width-after.width)<=1&&Math.abs(before.height-after.height)<=1,label+'サイズ維持');
  await contents.executeJavaScript(`for(const type of ['pointerdown','mousedown','pointercancel','pointerup','mouseup','click'])document.removeEventListener(type,moveInput,true)`);
  return{label,before,after,originalPressDelivered:true,pointerGestureCancelled:true,originalReleaseDelivered:true,noClickOnRelease:true,noMoveBeforeMs:400,holdDetectedAfterMs,markerShot,ending};
 }finally{window.isFocused=focus;screen.getCursorScreenPoint=cursorRead;}
}
async function shortClick(contents,selector){const css=await point(contents,selector),zoom=contents.getZoomFactor(),p={x:Math.round(css.x*zoom),y:Math.round(css.y*zoom)};contents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});await sleep(80);contents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await sleep(80);}
// アプリ本文が全面editor/iframeでも、通常背景での移動経路は独立して確認する。
async function probeBackground(contents){
 await contents.executeJavaScript(`(()=>{document.querySelector('#move-probe-background')?.remove();const node=document.createElement('div');node.id='move-probe-background';node.textContent='背景';node.style='position:fixed;right:8px;bottom:8px;width:80px;height:26px;background:#123;color:#fff;z-index:2147483646;-webkit-app-region:no-drag';document.body.append(node);})()`);
 return '#move-probe-background';
}
// 制御面を長押しして動かしても、窓移動マーカーや合成down/upを発生させない。
// frameには同一originのiframe selectorを渡す。opaque iframeはDOMログを取らない。
async function holdUnmoved(window,contents,selector,label,{frame='',dom=true,closePopup=false}={}){
 const originalFocus=window.isFocused,originalCursor=screen.getCursorScreenPoint,originalSend=contents.sendInputEvent;
 let cursor=originalCursor();window.isFocused=()=>true;screen.getCursorScreenPoint=()=>cursor;
 const inputs=[];contents.sendInputEvent=function(input){if(['mouseDown','mouseUp'].includes(input.type))inputs.push(input.type);return originalSend.call(this,input);};
 const doc=frame?`document.querySelector(${JSON.stringify(frame)}).contentDocument`:'document';
 try{
  const css=await contents.executeJavaScript(`(()=>{const doc=${doc},r=doc.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),f=${frame?`document.querySelector(${JSON.stringify(frame)}).getBoundingClientRect()`:'{left:0,top:0}'};return{x:Math.round(f.left+r.left+Math.min(20,r.width/2)),y:Math.round(f.top+r.top+r.height/2)}})()`);
  const zoom=contents.getZoomFactor(),p={x:Math.round(css.x*zoom),y:Math.round(css.y*zoom)},before=window.getBounds();
  if(dom)await contents.executeJavaScript(`(()=>{const doc=${doc};window.controlInputs=[];window.controlInput=e=>controlInputs.push(e.type);for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])doc.addEventListener(type,controlInput,true);})()`);
  contents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});await sleep(100);
  if(dom)assert.deepEqual(await contents.executeJavaScript('controlInputs'),['pointerdown','mousedown'],label+'押下を直ちに一度だけ渡す');
  await sleep(550);assert.equal(await contents.executeJavaScript(`!!document.querySelector('[data-aidiy-window-move]')`),false,label+'長押しでも移動を開始しない');
  cursor={x:cursor.x+30,y:cursor.y+20};contents.sendInputEvent({type:'mouseMove',...p,button:'left',modifiers:['leftButtonDown']});await sleep(50);
  assert.deepEqual(window.getBounds(),before,label+'窓位置とサイズを維持');
  contents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await sleep(80);
  assert.deepEqual(inputs,['mouseDown','mouseUp'],label+'down/upを合成再送しない');
  // native selectのポップアップを閉じ、次の検証へ持ち越さない。
  if(closePopup){contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});}
  return{label,bounds:before,originalPressDelivered:true,noDrag:true,noSyntheticPress:true};
 }finally{
  try{if(dom&&!contents.isDestroyed())await contents.executeJavaScript(`(()=>{const doc=${doc};if(window.controlInput)for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])doc?.removeEventListener(type,window.controlInput,true);})()`);}
  finally{contents.sendInputEvent=originalSend;window.isFocused=originalFocus;screen.getCursorScreenPoint=originalCursor;}
 }
}
// 保存・接続の副作用がない実HTML controlsで、各アプリの取り付けを検査する。
async function checkNativeControls(window,contents,label){
 await contents.executeJavaScript(`(()=>{const node=document.createElement('div');node.id='move-probe-controls';node.style='position:fixed;left:4px;top:36px;height:30px;display:flex;gap:4px;z-index:2147483647;-webkit-app-region:no-drag';node.innerHTML='<button id="move-probe-button" style="width:52px">試験</button><textarea id="move-probe-text" style="width:75px;height:28px;min-height:0;resize:none">保持</textarea><select id="move-probe-select" style="width:120px"><option value="one">モデル1</option><option value="two">モデル2</option></select>';document.body.append(node);window.probeClicks=0;window.probeChanges=0;node.querySelector('button').onclick=()=>probeClicks++;node.querySelector('select').onchange=()=>probeChanges++;})()`);
 try{
  const results=[];
  for(const [selector,suffix]of [['#move-probe-button','button'],['#move-probe-text','textarea'],['#move-probe-select','select']])results.push(await holdUnmoved(window,contents,selector,label+'_'+suffix,{closePopup:suffix==='select'}));
  assert.equal(await contents.executeJavaScript('probeClicks'),1,label+'長押しbuttonも通常clickは一度');
  await shortClick(contents,'#move-probe-text');contents.insertText('入力');
  assert.ok((await contents.executeJavaScript(`document.querySelector('#move-probe-text').value`)).includes('入力'),label+'textareaの通常入力');
  await shortClick(contents,'#move-probe-select');
  for(const keyCode of ['Home','Down','Return']){contents.sendInputEvent({type:'keyDown',keyCode});contents.sendInputEvent({type:'keyUp',keyCode});}
  await until(()=>contents.executeJavaScript(`document.querySelector('#move-probe-select').value==='two'&&probeChanges>0`),label+'native selectでモデルを変更');
  // モーダル表示中は、入力以外の背景もドラッグしない。選択操作自体は維持する。
  await contents.executeJavaScript(`(()=>{const dialog=document.createElement('dialog');dialog.id='move-probe-modal';dialog.style='position:fixed;inset:0;margin:0;width:100%;height:100%;max-width:none;max-height:none;padding:0;border:0;background:#1234';const blank=document.createElement('div');blank.id='move-probe-modal-background';blank.textContent='背景';blank.style='position:fixed;left:4px;top:2px;width:64px;height:26px;-webkit-app-region:no-drag';dialog.append(blank,document.querySelector('#move-probe-controls'));document.body.append(dialog);dialog.showModal();document.querySelector('#move-probe-button').focus();document.querySelector('#move-probe-select').value='one';probeChanges=0;})()`);
  const modalBackground=await holdUnmoved(window,contents,'#move-probe-modal-background',label+'_modal_background');
  await shortClick(contents,'#move-probe-select');
  for(const keyCode of ['Home','Down','Return']){contents.sendInputEvent({type:'keyDown',keyCode});contents.sendInputEvent({type:'keyUp',keyCode});}
  await until(()=>contents.executeJavaScript(`document.querySelector('#move-probe-select').value==='two'&&probeChanges>0`),label+'popup内のnative selectでモデルを変更');
  // 2行表示のnative listboxも、DOM値の代入でなくmouse入力で2行目を選ぶ。
  await contents.executeJavaScript(`(()=>{const select=document.querySelector('#move-probe-select');select.size=2;select.style.height='40px';select.value='one';probeChanges=0;})()`);await sleep(80);
  await shortClick(contents,'#move-probe-select option[value="two"]');
  await until(()=>contents.executeJavaScript(`document.querySelector('#move-probe-select').value==='two'&&probeChanges>0`),label+'2行native selectのmouse選択');
  return{label,controls:results,nativeSelectKeyboardChanged:true,modalBackground,popupSelectKeyboardChanged:true,twoRowSelectMouseChanged:true};
 }finally{if(!contents.isDestroyed())await contents.executeJavaScript(`document.querySelector('#move-probe-controls')?.remove();document.querySelector('#move-probe-modal')?.remove()`);}
}
async function checkMaximizedInput(window,contents,label){
 assert.equal(window.isMaximizable(),true,label+'最大化を検証可能');
 window.maximize();await until(()=>window.isMaximized(),label+'最大化');
 try{
  const controls=await checkNativeControls(window,contents,label+'_maximized');
  const background=await probeBackground(contents);
  const still=await holdUnmoved(window,contents,background,label+'_maximized_background');
  return{label,controls,background:still};
 }finally{await contents.executeJavaScript(`document.querySelector('#move-probe-background')?.remove()`);window.unmaximize();await until(()=>!window.isMaximized(),label+'通常へ復帰');}
}
module.exports={holdMove,holdUnmoved,checkNativeControls,checkMaximizedInput,probeBackground,shortClick,until,sleep};
