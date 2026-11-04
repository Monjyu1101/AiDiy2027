// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {showWindowMoveFeedback}=require('./窓移動表示.cjs');
const {setWindowBounds}=require('./全画面横断.cjs');

// 保存するのはVRの位置だけ。窓の作り直しを越えて保持し、IDE終了で忘れる。
function createVRPanelPlacement({windows,screen,isActive,feedback=showWindowMoveFeedback,setBounds=setWindowBounds,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,duration=650}){
 const positions=new WeakMap(),flights=new Map(),kinds=['explorer','panel-routes','panel-navigation'];
 const children=owner=>[...windows.values()].filter(child=>child.owner===owner&&kinds.includes(child.kind)&&child.shown&&!child.window.isDestroyed());
 // 単独パネルは再生成後も種類のキーを共有。複数Navigatorは窓ごとに保持する。
 const key=child=>child.kind==='panel-navigation'?child.window:child.kind;
 function cancel(owner){
  const flight=flights.get(owner);if(!flight)return;
  flight.cancelled=true;clearTimer(flight.timer);flight.wake?.();
  void flight.marker?.remove();
 }
 function remember(owner){
  // 移行を途中で中断したときは、通過点で前回の目的地を上書きしない。
  if(!flights.has(owner)){
   const saved=positions.get(owner)||new Map();
   for(const child of children(owner)){const bounds=child.window.isMaximized()?child.window.getNormalBounds():child.window.getBounds();saved.set(key(child),{x:bounds.x,y:bounds.y});}
   positions.set(owner,saved);
  }
  cancel(owner);
 }
 async function restore(owner){
  const saved=positions.get(owner);if(!saved||flights.has(owner))return;
  const flight={cancelled:false},revision=owner.revision;
  flights.set(owner,flight);owner.vrPanelMoving=true;
  const alive=()=>!flight.cancelled&&!owner.window.isDestroyed()&&owner.revision===revision&&isActive(owner);
  const pause=()=>new Promise(resolve=>{flight.wake=resolve;flight.timer=setTimer(resolve,16);});
  try{
   // pin()でWeb側の元表示を除去済み。その消去が描画されてから別窓を動かす。
   await owner.window.webContents.executeJavaScript('new Promise(resolve=>{const timer=setTimeout(resolve,250);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));})');
   for(const child of children(owner)){
    const point=saved.get(key(child)),win=child.window;if(!point||!alive())continue;
    const start=win.getBounds(),area=screen.getDisplayMatching({...start,...point}).workArea;
    // 消えた画面や配置変更では、現在の大きさを保ち、少なくともバーを画面内に残す。
    const end={...start,x:Math.round(Math.max(area.x+8,Math.min(point.x,area.x+area.width-start.width-8))),y:Math.round(Math.max(area.y+8,Math.min(point.y,area.y+area.height-Math.min(start.height,area.height-16)-8)))};
    if(start.x===end.x&&start.y===end.y)continue;
    // 装飾の登場演出ではなく、部品がどこへ移ったかを示す操作のフィードバック。
    // 軌跡バーにも収まる上端の同じ四方向マーカー。窓と一緒に移動する。
    flight.marker=feedback(win.webContents,{x:0,y:0});await flight.marker.ready;
    // マーカーを描画してから移動を始める。非表示化などでRAFが止まっても待ち続けない。
    if(!win.isDestroyed())await win.webContents.executeJavaScript('new Promise(resolve=>{const timer=setTimeout(resolve,250);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));})').catch(()=>{});
    const started=now();let last={x:start.x,y:start.y};
    try{
     while(alive()&&!win.isDestroyed()){
      const t=Math.min(1,(now()-started)/duration),ease=t*t*(3-2*t);
      const next={...start,x:Math.round(start.x+(end.x-start.x)*ease),y:Math.round(start.y+(end.y-start.y)*ease)};
      if(next.x!==last.x||next.y!==last.y){setBounds(win,next);last=next;}
      if(t===1)break;
      await pause();
     }
    }finally{await flight.marker.remove();flight.marker=null;}
   }
  }finally{
   clearTimer(flight.timer);await flight.marker?.remove();
   flights.delete(owner);owner.vrPanelMoving=false;
  }
 }
 return{remember,restore,cancel,forget(owner){cancel(owner);positions.delete(owner);}};
}
module.exports={createVRPanelPlacement};
