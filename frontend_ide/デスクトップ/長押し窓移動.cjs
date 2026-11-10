// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const movableKinds=new Set(['cpu','ide','code','live','navi','console','task','team','browser','viewer','explorer','panel-viewer','panel-routes','panel-navigation','diag','avatar','discord','slack']);
const {showWindowMoveFeedback}=require('./窓移動表示.cjs');
const {createCodeDrag}=require('./code-drag.cjs');
const {randomUUID}=require('node:crypto');

// ネイティブのselect/datalistを含む通常入力は遮断・再送しない。
// DOMの確認は窓移動の許可だけに使い、確認前・失敗時も元の入力をそのまま渡す。
function backgroundMoveTarget(x,y){
 if(document.querySelector('select:open,input:open,dialog[open]'))return false;
 for(const popup of document.querySelectorAll('[aria-modal="true"],[role="dialog"],[role="combobox"][aria-expanded="true"],[role="listbox"],.config-panel-overlay,.modal-overlay,.dialog-overlay,.selection-popup')){
  // 独立比較ビューのsectionはモーダルではない。内側に別のdialogがあれば従来どおり保護する。
  if(popup.matches?.('section.file-history-dialog.history-embedded[data-aidiy-window-move-surface]'))continue;
  if(popup.getClientRects().length&&getComputedStyle(popup).visibility!=='hidden')return false;
 }
 let node=document.elementFromPoint(x,y);
 if(!node)return false;
 while(node.shadowRoot){const inner=node.shadowRoot.elementFromPoint(x,y);if(!inner||inner===node)break;node=inner;}
 // 小さな軌跡窓はほぼ全幅がボタン。短押しを維持し、同じボタンの静止長押しだけ移動面にする。
 const routeButton=node.closest?.('.native-route-window .route-controls button');
 const naviSummary=node.closest?.('.navigation-panel .navigation-items summary,.navigation-panel .navigation-overall summary');
 const controls='input,textarea,select,option,optgroup,datalist,button,a[href],label,summary,iframe,object,embed,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="combobox"],[role="listbox"],[role="option"],[role="textbox"],[role="slider"],[role="spinbutton"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],[draggable="true"],.scrollbar,.slider,.monaco-editor,.xterm,[data-aidiy-no-window-move]';
 let handle=false;
 for(;node;node=node.parentElement||node.getRootNode?.().host){
  const routeHandle=node===routeButton&&!node.matches?.('[data-aidiy-no-window-move],[draggable="true"]');
  const naviHandle=node===naviSummary&&!node.matches?.('[data-aidiy-no-window-move],[draggable="true"]');
  if(node.isContentEditable||!routeHandle&&!naviHandle&&node.matches?.(controls))return false;
  // 別窓Explorerの一覧はキーボード操作用のtabindexを持つ。例外はこのUL自身だけ。
  const list=node.matches?.('ul[role="tree"][data-aidiy-window-move-list]');
  const fileSurface=node.matches?.('section.file-container[data-aidiy-window-move-surface]');
  if(!list&&!fileSurface&&!routeHandle&&!naviHandle&&node.matches?.('[tabindex]:not([tabindex="-1"])'))return false;
  if(list){
   const rect=node.getBoundingClientRect();
   if(node.clientWidth>0&&node.offsetWidth>node.clientWidth+2&&(x>=rect.left+node.clientLeft+node.clientWidth||x<rect.left+node.clientLeft))return false;
   if(node.clientHeight>0&&node.offsetHeight>node.clientHeight+2&&y>=rect.top+node.clientTop+node.clientHeight)return false;
  }
  if(routeHandle||naviHandle||list||fileSurface||node.matches?.('[data-aidiy-window-move-handle]'))handle=true;
 }
 // mousedown捕捉時は既に閉じたselectにもfocusが残る。専用の移動面だけ初回から扱う。
 // 展開中popupと移動面内の操作部品は上で除外済み。一般背景の保護は変えない。
 let focused=document.activeElement;while(focused?.shadowRoot?.activeElement)focused=focused.shadowRoot.activeElement;
 if(!handle&&focused?.matches('select,input[list],[role="combobox"]'))return false;
 return true;
}
// 隔離world内の受動的な観測。通常のdown/upは一切止めない。
// 移動成立時のclickだけを同一gesture IDで抑止し、pointerupの後始末は画面へ渡す。
function rendererMoveGesture(action,owner,id,backgroundTarget){
 const key='__aidiyNativeWindowMoveGesture';let tracker=globalThis[key];
 if(action==='install'){
  if(tracker?.owner===owner)return true;
  tracker?.dispose();
  let serial=0,current=null,pendingClick=null,pointer=null;const listeners=[];
  const listen=(type,fn)=>{window.addEventListener(type,fn,true);listeners.push(()=>window.removeEventListener(type,fn,true));};
  const eligible=(x,y)=>{try{return backgroundTarget(x,y)===true;}catch{return false;}};
  listen('pointerdown',event=>{if(event.isTrusted&&event.button===0)pointer={id:event.pointerId,target:event.composedPath?.()[0]||event.target,capture:null};});
  listen('gotpointercapture',event=>{if(event.isTrusted&&pointer?.id===event.pointerId)pointer.capture=event.composedPath?.()[0]||event.target;});
  listen('mousedown',event=>{
   if(!event.isTrusted)return;
   pendingClick=null;current=event.button===0?{id:++serial,x:event.clientX,y:event.clientY,allowed:eligible(event.clientX,event.clientY),armed:false,pointer}:null;
  });
  listen('mousemove',event=>{if(event.isTrusted&&current&&!current.armed&&(event.clientX!==current.x||event.clientY!==current.y))current=null;});
  listen('mouseup',event=>{if(!event.isTrusted||event.button!==0)return;pendingClick=current?.armed?current:null;current=null;});
  listen('pointercancel',event=>{if(event.isTrusted){current=null;pendingClick=null;pointer=null;}});
  listen('click',event=>{
   if(!event.isTrusted||event.button!==0||!event.detail||!pendingClick)return;
   pendingClick=null;event.preventDefault();event.stopImmediatePropagation();
  });
  tracker={owner,query(){return current?.allowed&&!current.armed&&eligible(current.x,current.y)?current.id:null;},arm(id){
   if(!current||current.id!==id||!current.allowed||!eligible(current.x,current.y))return false;
   current.armed=true;
   // Canvasなどの元のpointer操作を取消し、解放時の選択・回転の持ち越しを防ぐ。
   // 実際のmouseUp/pointerUpは遮断せず、Chromium自身の押下状態も解放させる。
   const pointer=current.pointer,target=pointer?.capture||pointer?.target;
   if(target){
    target.dispatchEvent(new PointerEvent('pointercancel',{pointerId:pointer.id,pointerType:'mouse',isPrimary:true,clientX:current.x,clientY:current.y,bubbles:true,composed:true}));
    if(target.hasPointerCapture?.(pointer.id))target.releasePointerCapture(pointer.id);
   }
   return true;
  },disarm(id){if(current?.id===id)current.armed=false;if(pendingClick?.id===id)pendingClick=null;},dispose(){for(const remove of listeners)remove();current=null;pendingClick=null;}};
  globalThis[key]=tracker;return true;
 }
 if(tracker?.owner!==owner)return false;
 if(action==='dispose'){tracker.dispose();delete globalThis[key];return true;}
 if(action==='query')return tracker.query();
 if(action==='arm')return tracker.arm(id);
 if(action==='disarm')tracker.disarm(id);
 return false;
}
function installNativeWindowMove({record,contents=record.window.webContents,drag,screen,onMoveStart=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,setTick=setInterval,clearTick=clearInterval}){
 if(!movableKinds.has(record.kind))return()=>{};
 const control=drag.forRecord(record),win=record.window,listeners=[];
 let current=null,disposed=false,replaying=0,owner=randomUUID();
 const listen=(target,event,fn)=>{target.on(event,fn);listeners.push(()=>target.removeListener(event,fn));};
 const renderer=(action,id=null,requestOwner=owner)=>{
  try{if(contents.isDestroyed())return Promise.resolve(false);return Promise.resolve(contents.executeJavaScriptInIsolatedWorld(1004,[{code:`(${rendererMoveGesture.toString()})(${JSON.stringify(action)},${JSON.stringify(requestOwner)},${JSON.stringify(id)},${backgroundMoveTarget.toString()})`}])).catch(()=>false);}catch{return Promise.resolve(false);}
 };
 const installRenderer=()=>{if(!disposed){owner=randomUUID();void renderer('install');}};
 installRenderer();listen(contents,'dom-ready',installRenderer);
 const replay=input=>{if(disposed||contents.isDestroyed())return;replaying++;try{contents.sendInputEvent(input);}finally{replaying--;}};
 function finish(){
  const state=current;current=null;if(!state)return;
  clearTimer(state.timer);clearTick(state.tick);
  if(state.token)control.end(state.token);
  else if(state.gesture)void renderer('disarm',state.gesture,state.owner);
  if(state.feedback)void state.feedback.remove().then(()=>{if(!current)replay({type:'mouseMove',x:state.mouse.x,y:state.mouse.y,modifiers:[]});});
 }
 const cancel=()=>finish();
 function moved(state){const point=screen.getCursorScreenPoint();return point.x!==state.point.x||point.y!==state.point.y;}
 function valid(state){return current===state&&state.owner===owner&&!disposed&&!win.isDestroyed()&&!contents.isDestroyed()&&!win.isMaximized()&&!win.isFullScreen()&&!moved(state);}
 async function activate(state){
  if(current!==state||state.activating)return;state.activating=true;
  if(!valid(state)){finish();return;}
  // 対象のgestureを先に読み、同じ押下がまだ続く場合だけarmする。
  // 遅い結果が解放・別の押下・遷移をまたいでも新しいクリックを抑止しない。
  const gesture=await renderer('query',null,state.owner);
  if(current!==state)return;
  if(!valid(state)||!Number.isSafeInteger(gesture)||gesture<=0){finish();return;}
  state.gesture=gesture;
  const armed=await renderer('arm',gesture,state.owner);
  if(current!==state)return;
  if(!valid(state)||armed!==true){finish();return;}
  state.token=control.begin();
  if(!state.token){finish();return;}
  onMoveStart();
  const zoom=contents.getZoomFactor();
  state.center=control.isCenterMove?.();state.zoom=zoom;state.origin=screen.getCursorScreenPoint();
  state.feedback=showWindowMoveFeedback(contents,{x:state.down.x/zoom,y:state.down.y/zoom});
  // mouseMoveを遮断していても、表示面の作成後にChromiumのカーソルを更新する。
  void state.feedback.ready.then(()=>{if(current===state)replay({type:'mouseMove',x:state.down.x,y:state.down.y,modifiers:[]});});
  state.tick=setTick(()=>{if(current===state)move(state);},16);state.tick?.unref?.();
 }
 function move(state){
  if(!control.move(state.token)){cancel();return;}
  if(state.center){const point=screen.getCursorScreenPoint();state.feedback.move({x:(state.down.x+point.x-state.origin.x)/state.zoom,y:(state.down.y+point.y-state.origin.y)/state.zoom});}
 }
 listen(contents,'before-mouse-event',(event,mouse)=>{
  if(disposed||replaying)return;
  if(mouse.type==='mouseDown'){
   if(mouse.button!=='left'){cancel();return;}
   finish();
   if(win.isDestroyed()||win.isMaximized()||win.isFullScreen())return;
   const down={type:'mouseDown',x:mouse.x,y:mouse.y,button:'left',clickCount:mouse.clickCount||1,modifiers:mouse.modifiers||[]};
   const state={down,mouse:down,point:screen.getCursorScreenPoint(),owner};current=state;
   state.timer=setTimer(()=>{void activate(state);},500);state.timer?.unref?.();
   return;
  }
  if(mouse.type==='mouseUp'&&mouse.button==='left'){
   const state=current;if(state)state.mouse=mouse;
   if(state?.token)move(state);
   finish();return;
  }
  if(!current)return;
  if(mouse.type==='mouseMove'){
   current.mouse=mouse;
   if(current.token){event.preventDefault();move(current);}
   else if(moved(current))finish();
  }else if(['mouseWheel','contextMenu'].includes(mouse.type)||mouse.type==='mouseLeave'&&!current.token)cancel();
 });
 listen(contents,'before-input-event',(event,input)=>{if(input.key==='Escape'){if(current?.token)event.preventDefault?.();cancel();}});
 listen(win,'blur',cancel);
 listen(contents,'did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)cancel();});
 listen(contents,'render-process-gone',cancel);
 const dispose=()=>{if(disposed)return;disposed=true;cancel();for(const remove of listeners)remove();void renderer('dispose');};
 listen(contents,'destroyed',dispose);listen(win,'closed',dispose);
 return dispose;
}
// 他アプリもmainが所有する窓だけを取り付ける。rendererへIPC・座標指定を追加しない。
function attachNativeWindowMove(window,screen,kind,options={}){
 const record={window,kind,revision:0};
 const drag=createCodeDrag({trustedEvent:()=>null,screen});
 return installNativeWindowMove({...options,record,drag,screen});
}
module.exports={installNativeWindowMove,attachNativeWindowMove,backgroundMoveTarget,rendererMoveGesture};
