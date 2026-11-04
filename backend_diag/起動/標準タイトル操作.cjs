// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {randomUUID}=require('node:crypto');
const {setWindowBounds}=require('../../frontend_ide/デスクトップ/全画面横断.cjs');
// 透明なアイコン表示と窓を共用するため、標準タイトルだけ同じ最大化状態で扱う。
// IPCやrenderer指定座標は追加せず、mainが受け取った入力とscreenのDIP座標を使う。
function 標準タイトル対象(x,y){
 const node=document.elementFromPoint(x,y);
 if(!node?.closest('header[data-aidiy-standard-title]'))return false;
 if(node.closest('button,input,textarea,select,option,label,a,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="combobox"],[tabindex]'))return false;
 for(const popup of document.querySelectorAll('dialog[open],[aria-modal="true"],.modal-overlay,.dialog-overlay,.config-panel-overlay'))if(popup.getClientRects().length&&getComputedStyle(popup).visibility!=='hidden')return false;
 return true;
}
function 標準タイトル捕捉(owner,eligible){
 if(globalThis.__aidiyDiagTitleCapture?.owner===owner)return;
 globalThis.__aidiyDiagTitleCapture?.dispose();
 let current,completed,serial=0;const listeners=[];
 const listen=(name,fn)=>{window.addEventListener(name,fn,true);listeners.push(()=>window.removeEventListener(name,fn,true));};
 const cancel=id=>{
  if(current?.id===id){const old=current;current=undefined;try{if(old.target.hasPointerCapture(old.pointer))old.target.releasePointerCapture(old.pointer);}catch{}}
  if(completed?.id===id)completed=undefined;
 };
 const activeId=()=>{if(current&&!current.target.hasPointerCapture(current.pointer))current=undefined;return current?.id||0;};
 globalThis.__aidiyDiagTitleCapture={owner,id:activeId,last:()=>activeId()||completed?.id||0,cancel,dispose(){if(current)cancel(current.id);completed=undefined;for(const remove of listeners)remove();delete globalThis.__aidiyDiagTitleCapture;}};
 listen('pointerdown',event=>{
  if(!event.isTrusted)return;current=completed=undefined;
  if(event.button===0&&eligible(event.clientX,event.clientY)){
   try{event.target.setPointerCapture(event.pointerId);current={id:++serial,pointer:event.pointerId,target:event.target};}catch{}
  }
 });
 listen('pointerup',event=>{if(event.isTrusted&&current?.pointer===event.pointerId){completed=current.target.hasPointerCapture(current.pointer)?current:undefined;current=undefined;}});
 const end=event=>{if(event.isTrusted&&current?.pointer===event.pointerId){current=completed=undefined;}};
 for(const name of ['pointercancel','lostpointercapture'])listen(name,end);
 listen('blur',()=>{current=completed=undefined;});
}
function 標準タイトル操作を取り付け(window,screen,{enabled,toggleMaximize,platform=process.platform}){
 if(platform!=='win32')return {cancel(){},dispose(){}};
 const contents=window.webContents,listeners=[];let current,disposed=false,applying=false,owner=randomUUID();
 const listen=(object,name,callback)=>{object.on(name,callback);listeners.push(()=>object.removeListener(name,callback));};
 const cancel=()=>{const old=current;current=undefined;if(old?.id&&!contents.isDestroyed())void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`if(globalThis.__aidiyDiagTitleCapture?.owner===${JSON.stringify(old.owner)})globalThis.__aidiyDiagTitleCapture.cancel(${old.id})`}]).catch(()=>{});};
 const allowed=()=>!disposed&&!window.isDestroyed()&&!contents.isDestroyed()&&enabled()&&!window.isMinimized()&&!window.isFullScreen()&&window.isFocused();
 const install=()=>{if(disposed||contents.isDestroyed())return;owner=randomUUID();void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`(${標準タイトル捕捉.toString()})(${JSON.stringify(owner)},${標準タイトル対象.toString()})`}]).catch(()=>{});};
 function move(state){
  if(current!==state||!allowed()){cancel();return;}
  const cursor=state.releaseCursor||screen.getCursorScreenPoint(),dx=cursor.x-state.cursor.x,dy=cursor.y-state.cursor.y;
  if(!state.moving&&Math.hypot(dx,dy)<4)return;
  if(!state.moving){
   state.moving=true;
   if(state.maximized){
    const normal=state.normal;
    // 最大化した画面で押した水平比率を、復元後のタイトル上でも維持する。
    const anchorX=Math.max(0,Math.min(1,(state.cursor.x-state.bounds.x)/state.bounds.width))*normal.width;
    const anchorY=Math.max(0,Math.min(normal.height-1,state.cursor.y-state.bounds.y));
    applying=true;try{window.unmaximize();}finally{applying=false;}
    state.bounds={...normal,x:Math.round(cursor.x-anchorX),y:Math.round(cursor.y-anchorY)};
    state.cursor={...cursor};
   }
  }
  applying=true;try{setWindowBounds(window,{...state.bounds,x:Math.round(state.bounds.x+cursor.x-state.cursor.x),y:Math.round(state.bounds.y+cursor.y-state.cursor.y)});state.applied=window.getBounds();}finally{applying=false;}
 }
 listen(contents,'before-mouse-event',(_event,input)=>{
  if(input.type==='mouseDown'){
   cancel();if(input.button!=='left'||!allowed())return;
   const state={owner,cursor:screen.getCursorScreenPoint(),bounds:window.getBounds(),normal:window.getNormalBounds(),maximized:window.isMaximized(),double:input.clickCount===2,released:false,checked:false,revision:0};current=state;
   if(!Number.isFinite(input.x)||!Number.isFinite(input.y)){cancel();return;}
   const zoom=contents.getZoomFactor?.()||1;
   void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`new Promise(resolve=>requestAnimationFrame(()=>resolve(globalThis.__aidiyDiagTitleCapture?.owner===${JSON.stringify(state.owner)}&&(${標準タイトル対象.toString()})(${input.x/zoom},${input.y/zoom})&&globalThis.__aidiyDiagTitleCapture?.last())))`}]).then(eligible=>{
    if(current!==state)return;
    if(!Number.isInteger(eligible)||eligible<=0||!allowed()){cancel();return;}
    state.checked=true;state.id=eligible;
    if(state.double){cancel();void Promise.resolve(toggleMaximize()).catch(()=>{});return;}
    if(!state.released||state.moveRequested)move(state);
    if(state.released)cancel();
   }).catch(()=>{if(current===state)cancel();});
  }else if(input.type==='mouseMove'){
   const state=current;if(!state||state.released)return;state.moveRequested=true;if(!state.checked)return;const revision=++state.revision;
   // 窓外での解放・capture喪失も隔離worldのtrusted pointer状態で確認する。
   // cursorのpollingだけでドラッグを延命しない。
   void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`new Promise(resolve=>requestAnimationFrame(()=>resolve(globalThis.__aidiyDiagTitleCapture?.owner===${JSON.stringify(state.owner)}&&globalThis.__aidiyDiagTitleCapture.id())))`}]).then(id=>{
    if(current!==state||revision!==state.revision)return;
    if(id!==state.id){cancel();return;}move(state);
   }).catch(()=>{if(current===state)cancel();});
  }else if(input.type==='mouseUp'&&input.button==='left'){
   const state=current;if(!state)return;
   state.released=true;state.releaseCursor=screen.getCursorScreenPoint();
   if(state.checked){
    const revision=++state.revision;
    void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`new Promise(resolve=>requestAnimationFrame(()=>resolve(globalThis.__aidiyDiagTitleCapture?.owner===${JSON.stringify(state.owner)}&&globalThis.__aidiyDiagTitleCapture.last())))`}]).then(id=>{
     if(current!==state||revision!==state.revision)return;
     if(id===state.id&&state.moveRequested)move(state);cancel();
    }).catch(()=>{if(current===state)cancel();});
   }
  }else if(input.type==='mouseWheel'||input.type==='contextMenu')cancel();
 });
 listen(contents,'before-input-event',(_event,input)=>{if(input.key==='Escape')cancel();});
 listen(window,'blur',cancel);listen(window,'resize',()=>{
  if(applying)return;
  const expected=current?.applied,actual=window.getBounds();
  // Electronのresize通知はsetBoundsの後のtickにも届く。自分が適用した寸法なら継続。
  if(expected&&['x','y','width','height'].every(key=>actual[key]===expected[key]))return;
  cancel();
 });
 listen(contents,'did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace){cancel();owner=randomUUID();}});
 listen(contents,'did-finish-load',install);listen(contents,'render-process-gone',cancel);
 const dispose=()=>{if(disposed)return;disposed=true;cancel();for(const remove of listeners)remove();if(!contents.isDestroyed())void contents.executeJavaScriptInIsolatedWorld(1005,[{code:`if(globalThis.__aidiyDiagTitleCapture?.owner===${JSON.stringify(owner)})globalThis.__aidiyDiagTitleCapture.dispose()`}]).catch(()=>{});};
 listen(contents,'destroyed',dispose);listen(window,'closed',dispose);
 return {cancel,dispose};
}
module.exports={標準タイトル操作を取り付け,標準タイトル対象};
