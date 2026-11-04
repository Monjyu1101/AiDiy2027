// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// Explorer・軌跡・Viewer・Code・Live・Console等のピンON子窓を同じmainで管理する。
// OS親子関係・上位topmost層・focus()・定期監視は使わず、VR本体との相対順だけ直す。
function createVRPanelStacking({windows,isActive,isPinned=()=>true,platform=process.platform,schedule=callback=>setTimeout(callback,100),cancel=clearTimeout,onError=error=>console.warn('VRパネルの前面配置:',error.message)}){
 const entries=new WeakMap(),pending=new Map(),running=new Set();
 const alive=record=>record&&!record.window.isDestroyed();
 const visible=record=>alive(record)&&record.window.isVisible?.()!==false&&record.window.isMinimized?.()!==true;
 const panel=record=>!!record.owner;
 function refresh(owner){
  if(!visible(owner)||!isActive(owner)||running.has(owner))return;
  running.add(owner);
  try{
   const children=[...windows.values()].filter(record=>record.owner===owner&&panel(record)&&visible(record)&&isPinned(record));
   // 選択中のパネルが他のパネルに隠れないよう、最後に積む。
   children.sort((a,b)=>Number(!!a.window.isFocused?.())-Number(!!b.window.isFocused?.()));
   let below=owner.window;
   for(const child of children){
    // Windowsでは同じ最前面層の先頭へ移す。
    // moveTopはフォーカスを変えず、通常の別窓を選ぶ操作も妨げない。
    try{if(platform==='win32')child.window.moveTop();else child.window.moveAbove(below.getMediaSourceId());below=child.window;}
    catch(error){onError(error);}
   }
  }finally{running.delete(owner);}
 }
 function request(owner){
  if(!alive(owner)||!isActive(owner)||running.has(owner))return;
  refresh(owner);
  // Windowsのfocus通知はOSの前面化より先に届く。完了を待ち一度だけ補正する。ポーリングはしない。
  if(!pending.has(owner))pending.set(owner,schedule(()=>{pending.delete(owner);refresh(owner);}));
 }
 function unregister(record){
  const entry=entries.get(record);if(!entry)return;
  for(const event of entry.events)record.window.removeListener(event,entry.refresh);
  record.window.removeListener('closed',entry.closed);entries.delete(record);
  if(entry.native&&alive(record))record.window.unhookWindowMessage(0x0047);
  if(pending.has(record)){cancel(pending.get(record));pending.delete(record);}
 }
 function register(record){
  if(entries.has(record)||!alive(record)||!(record.kind==='ide'&&!record.owner||panel(record)&&record.owner))return;
  const owner=record.owner||record;
  // 本体のfocusリスナーは共通ピン制御のmoveTopより後に登録する。
  const events=record===owner?['focus','show','restore','maximize','unmaximize','enter-full-screen','leave-full-screen']:['show','restore','maximize','unmaximize'];
  const entry={events,refresh:()=>request(owner),closed:()=>unregister(record)};entries.set(record,entry);
  for(const event of events)record.window.on(event,entry.refresh);
  // 選択済みの本体を再度前面化するとfocusイベントは出ない。Windowsの位置/Z順通知も拾う。
  if(platform==='win32'&&record===owner&&record.window.hookWindowMessage){
   entry.native=true;record.window.hookWindowMessage(0x0047,()=>{
    if(alive(owner)&&isActive(owner)&&!running.has(owner)&&!pending.has(owner))pending.set(owner,schedule(()=>{pending.delete(owner);refresh(owner);}));
   });
  }
  record.window.once('closed',entry.closed);
  request(owner);
 }
 return{register,refresh:request,unregister};
}
module.exports={createVRPanelStacking};
