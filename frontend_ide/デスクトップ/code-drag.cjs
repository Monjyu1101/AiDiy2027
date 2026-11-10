// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');
// カーソルと窓位置を同じDIP座標で扱う。rendererから窓IDや座標は受け取らない。
function createCodeDrag({trustedEvent,screen,resolvePanel=()=>null,isCenterMove=()=>false,setTimer=setTimeout,clearTimer=clearTimeout}){
 const active=new Map();
 const localEvents=new WeakMap();
 const localStarts=new WeakMap();
 const sizes=new WeakMap();
 const movableKinds=new Set(['cpu','ide','code','live','navi','console','task','team','browser','viewer','explorer','panel-viewer','panel-routes','panel-navigation','diag','avatar','discord','slack']);
 const centerMode=record=>record.kind==='ide'&&isCenterMove(record);
 function notifyCenter(record,drag,phase,x=0,y=0){if(!record.window.webContents.isDestroyed())record.window.webContents.send('development:space-center-move',{id:drag.token,phase,x,y});}
 function target(event,name){const source=localEvents.get(event)||trustedEvent(event);return name===undefined?source:source?.kind==='ide'&&typeof name==='string'?resolvePanel(source,name):null;}
 function stop(record){
  const drag=active.get(record);if(!drag)return;
  active.delete(record);clearTimer(drag.timer);
  for(const [target,event,listener]of drag.listeners)target.removeListener(event,listener);
  if(drag.center)notifyCenter(record,drag,'end');
 }
 function lease(record,drag){const generation=drag.lease=(drag.lease||0)+1;clearTimer(drag.timer);drag.timer=setTimer(()=>{if(active.get(record)===drag&&drag.lease===generation)stop(record);},2000);drag.timer?.unref?.();}
 function valid(event,token,name){
  const record=target(event,name),drag=active.get(record);
  if(!record||!movableKinds.has(record.kind)||!drag||drag.token!==token)return null;
  if(record.revision!==drag.revision||record.window.isDestroyed()||record.window.isMaximized()||record.window.isFullScreen()||!record.window.isFocused()||drag.center!==centerMode(record)){stop(record);return null;}
  return{record,drag};
 }
 const controller={
  begin(event,name){
   const record=target(event,name);
   if(record?.vrPanelMoving||record?.owner?.vrPanelMoving)return null;
   if(!record||!movableKinds.has(record.kind)||record.window.isDestroyed()||record.window.isMaximized()||record.window.isFullScreen()||!record.window.isFocused())return null;
   stop(record);
   const drag={token:randomUUID(),revision:record.revision,cursor:localStarts.get(event)||screen.getCursorScreenPoint(),bounds:record.window.getBounds(),listeners:[],center:centerMode(record),zoom:record.window.webContents.getZoomFactor?.()||1};
   const size=sizes.get(record.window);
   // 前回の移動で生じた1 DIP程度の端数を、次の長押しの基準寸法に足さない。
   // 利用者が窓サイズを変更していた場合は、その新しい寸法を採用する。
   if(size&&size.actualWidth===drag.bounds.width&&size.actualHeight===drag.bounds.height){drag.bounds.width=size.width;drag.bounds.height=size.height;}
   drag.position={x:drag.bounds.x,y:drag.bounds.y};
   active.set(record,drag);
   if(drag.center)notifyCenter(record,drag,'start');
   for(const [target,name]of [[record.window,'blur'],[record.window,'closed'],[record.window.webContents,'did-start-navigation'],[record.window.webContents,'render-process-gone']]){
    const listener=()=>stop(record);target.on(name,listener);drag.listeners.push([target,name,listener]);
   }
   lease(record,drag);return drag.token;
  },
  move(event,token,name){
   const current=valid(event,token,name);if(!current)return false;
   const {record,drag}=current,cursor=screen.getCursorScreenPoint();
   if(drag.center){
    // VR窓は全画面を覆ったまま、DIPの移動量を描画面のCSS座標へ変換する。
    const x=(cursor.x-drag.cursor.x)/drag.zoom,y=(cursor.y-drag.cursor.y)/drag.zoom;
    if(x!==drag.dx||y!==drag.dy){notifyCenter(record,drag,'move',x,y);drag.dx=x;drag.dy=y;}
    lease(record,drag);return true;
   }
   const bounds={...drag.bounds,x:Math.round(drag.bounds.x+cursor.x-drag.cursor.x),y:Math.round(drag.bounds.y+cursor.y-drag.cursor.y)};
   if(bounds.x!==drag.position.x||bounds.y!==drag.position.y){
    // Windowsの端数DPIではsetPosition内のサイズ再設定でも丸め誤差が累積する。
    // 開始時の寸法を固定し、実OSの丸め差分を補正する。静止中はlease更新だけ。
    record.window.setBounds(bounds,false);
    const actual=record.window.getBounds(),corrected={};let changed=false;
    for(const key of ['x','y','width','height']){
     const delta=bounds[key]-actual[key];corrected[key]=bounds[key]+delta;changed ||= delta!==0;
    }
    // 整数DIPでは完全一致できない座標もある。補正を反復してサイズを振動させない。
    if(changed&&corrected.width>0&&corrected.height>0)record.window.setBounds(corrected,false);
    const result=record.window.getBounds();
    sizes.set(record.window,{width:bounds.width,height:bounds.height,actualWidth:result.width,actualHeight:result.height});
    drag.position={x:bounds.x,y:bounds.y};
   }
   lease(record,drag);return true;
  },
  end(event,token,name){const current=valid(event,token,name);if(current)stop(current.record);},
 };
 // mainで所有確認した窓専用。rendererへrecordやこの入口を公開しない。
 return{...controller,forRecord(record){const event={};localEvents.set(event,record);return{isCenterMove:()=>centerMode(record),begin:()=>controller.begin(event),
  // mainが受け取ったnative mouseDownの座標だけを渡す。renderer IPCには公開しない。
  beginAt(point){if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;localStarts.set(event,{x:point.x,y:point.y});try{return controller.begin(event);}finally{localStarts.delete(event);}},
  move:token=>controller.move(event,token),end:token=>controller.end(event,token)};}};
}
module.exports={createCodeDrag};
