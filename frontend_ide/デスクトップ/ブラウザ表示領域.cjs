// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {setWindowBounds}=require('./全画面横断.cjs');
const PRESETS={fhd:{width:1920,height:945},portrait:{width:1080,height:1785}};

// 本文の寸法と外窓の寸法を分離する。Electronの窓/ViewはDIP、hostの測定値はCSS px。
function createBrowserSizing({window,view,screen,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,duration=220}){
 let panelCollapsed=false;
 let insets,request,expected,applying=false,fullscreenTransition,fullscreenTarget,waitingRestore=false,waitingMaximize=false,pendingMaximize,disposed=false,latestMeasurement=-Infinity,flight;
 function stop(){if(flight){clearTimer(flight.timer);flight=undefined;}}
 function complete(error){const pending=request?.completion;if(request)request.completion=undefined;if(pending){if(error)pending.reject(error);else pending.resolve();}}
 const actual=()=>{stop();complete();request=undefined;expected=undefined;pendingMaximize=undefined;};
 function layout(){
  if(disposed||window.isDestroyed())return;
  const b=window.getContentBounds();
  if(window.isFullScreen())view.setBounds({x:0,y:0,width:b.width,height:b.height});
  else if(insets)view.setBounds({x:insets.left,y:insets.top,width:Math.max(0,b.width-insets.left-insets.right),height:Math.max(0,b.height-insets.top-insets.bottom)});
 }
 function place(bounds){
  expected={width:bounds.width,height:bounds.height};applying=true;
  try{setWindowBounds(window,bounds);}finally{applying=false;}
  layout();
 }
 function animate(bounds){
  if(flight&&Object.keys(bounds).every(key=>bounds[key]===flight.end[key]))return;
  stop();const current=flight={start:window.getBounds(),end:bounds,started:now(),request};
  function step(){
   if(flight!==current||disposed||window.isDestroyed()||request!==current.request)return;
   try{
    const t=Math.min(1,(now()-current.started)/duration),ease=1-Math.pow(1-t,3);
    const next=Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(current.start[key]+(current.end[key]-current.start[key])*ease)]));
    place(t===1?current.end:next);
    if(t===1){flight=undefined;request.animate=false;complete();}
    else current.timer=setTimer(step,16);
   }catch(error){stop();complete(error);request=undefined;}
  }
  current.timer=setTimer(step,16);
 }
 function apply(){
  if(disposed||!request||!insets||fullscreenTransition||waitingRestore||waitingMaximize||window.isDestroyed()||window.isFullScreen()||window.isMaximized())return;
  const outer=window.getBounds(),content=window.getContentBounds();
  const width=request.width+insets.left+insets.right+Math.max(0,outer.width-content.width);
  const height=request.height+insets.top+insets.bottom+Math.max(0,outer.height-content.height);
  // 入るときは中央へ。入らない場合も本文を縮めず、操作欄の左上だけ画面内へ残す。
  const area=request.area,position=flight?.end||outer,bounds={x:request.placed?position.x:area.x+Math.max(0,Math.floor((area.width-width)/2)),y:request.placed?position.y:area.y+Math.max(0,Math.floor((area.height-height)/2)),width,height};
  request.placed=true;
  if(Object.keys(bounds).some(key=>outer[key]!==bounds[key])){
   // 起動画像ではなく生きたパネル自体を変形。🔲/F11はCode同様にOSの処理へ任せる。
   if(request.animate&&duration>0){animate(bounds);return;}
   place(bounds);
  }else layout();
  stop();request.animate=false;complete();
 }
 function normal(){
  if(!request||fullscreenTransition||waitingMaximize)return;
  if(window.isMaximized()){
   if(!waitingRestore)restore();
   return;
  }
  apply();
 }
 function measure(value){
  if(!value||!['left','top','width','height'].every(key=>Number.isFinite(value[key])&&value[key]>=0&&value[key]<100000))throw Error('表示領域が不正です。');
  if(disposed||window.isDestroyed()||panelCollapsed)return false;
  if(Number.isFinite(value.measuredAt)&&value.measuredAt<latestMeasurement)return false;
  const fullscreen=window.isFullScreen(),zoom=window.webContents.getZoomFactor(),b=window.getContentBounds();
  if(typeof value.fullscreen==='boolean'&&value.fullscreen!==fullscreen)return false;
  const measuredWidth=value.viewportWidth??b.width/zoom,measuredHeight=value.viewportHeight??b.height/zoom;
  if(![measuredWidth,measuredHeight].every(n=>Number.isFinite(n)&&n>=0&&n<100000))throw Error('表示領域が不正です。');
  // リサイズ前に発行されたIPCから余白を再計算しない（外窓の連続膨張を防ぐ）。
  if(Math.abs(measuredWidth*zoom-b.width)>1.5||Math.abs(measuredHeight*zoom-b.height)>1.5)return false;
  if(Number.isFinite(value.measuredAt))latestMeasurement=value.measuredAt;
  if(!fullscreen){
   insets={left:Math.round(value.left*zoom),top:Math.round(value.top*zoom),right:Math.max(0,Math.round((measuredWidth-value.left-value.width)*zoom)),bottom:Math.max(0,Math.round((measuredHeight-value.top-value.height)*zoom))};
   apply();
  }
  layout();return true;
 }
 function setFullscreen(value){
  fullscreenTarget=value;
  if(fullscreenTransition)return;
  if(window.isFullScreen()===value){fullscreenTarget=undefined;return;}
  fullscreenTransition=value?'enter':'leave';window.setFullScreen(value);
 }
 function toggleFullscreen(){const value=!(fullscreenTarget??window.isFullScreen());actual();setFullscreen(value);}
 function preset(name){
  const size=PRESETS[name];if(!size)throw Error('対応していないウィンドウサイズです。');
  actual();let resolve,reject;const result=new Promise((a,b)=>{resolve=a;reject=b;});request={...size,animate:true,completion:{resolve,reject},area:screen.getDisplayMatching(window.getBounds()).workArea};
  // プリセットは本文のCSS viewportを等倍にする。DPR・UA・touchは変更しない。
  try{view.webContents.setZoomFactor?.(1);if(window.isFullScreen()||fullscreenTransition)setFullscreen(false);else normal();}catch(error){complete(error);request=undefined;}
  return result;
 }
 function restore(){waitingRestore=true;window.unmaximize();}
 function expand(){waitingMaximize=true;window.maximize();}
 function maximize(){
  const value=pendingMaximize!==undefined?!pendingMaximize:waitingMaximize?false:waitingRestore||!window.isMaximized();actual();
  if(window.isFullScreen()||fullscreenTransition||waitingRestore||waitingMaximize){pendingMaximize=value;if(window.isFullScreen()||fullscreenTransition)setFullscreen(false);}
  else if(value)expand();else restore();
  return window.isMaximized();
 }
 function finishNormal(){
  if(fullscreenTransition||waitingRestore||waitingMaximize)return;
  if(pendingMaximize!==undefined){const value=pendingMaximize;pendingMaximize=undefined;if(value&&!window.isMaximized())expand();else if(!value&&window.isMaximized())restore();}
  else normal();
  layout();
 }
 function resized(){
  if(!applying&&request&&!fullscreenTransition&&!waitingRestore&&!waitingMaximize&&expected){const b=window.getBounds();if(b.width!==expected.width||b.height!==expected.height)actual();}
  layout();
 }
 function expanded(){const requested=waitingMaximize;waitingMaximize=false;if(requested)finishNormal();else{actual();layout();}}
 function restored(){waitingRestore=false;finishNormal();}
 function entered(){
  fullscreenTransition=undefined;
  if(fullscreenTarget===false){layout();setFullscreen(false);}
  else{fullscreenTarget=undefined;actual();layout();}
 }
 function left(){
  fullscreenTransition=undefined;
  if(fullscreenTarget===true){setFullscreen(true);return;}
  fullscreenTarget=undefined;finishNormal();
 }
 const listeners={resize:resized,'will-resize':actual,'will-move':actual,close:actual,maximize:expanded,unmaximize:restored,'enter-full-screen':entered,'leave-full-screen':left};
 for(const [event,fn]of Object.entries(listeners))window.on(event,fn);
 function dispose(){disposed=true;actual();for(const [event,fn]of Object.entries(listeners))window.removeListener(event,fn);}
 function setPanelCollapsed(value){panelCollapsed=!!value;if(panelCollapsed)actual();}
 return{setPanelCollapsed,measure,preset,maximize,toggleFullscreen,actual,layout,dispose,isSettled:()=>!flight&&!fullscreenTransition&&!waitingRestore&&!waitingMaximize&&!request?.completion};
}
module.exports={createBrowserSizing};
