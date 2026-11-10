// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 親プロセス専用。rendererへ公開せず、認証・セッション情報は扱わない。
const roles=new Set(['core','chat','file','image','code1','code2','code3','code4','code5','code6']);
function sanitizeSnapshot(value){
 if(!value||!Array.isArray(value.windows)||value.windows.length>12)return null;
 const windows=[],seen=new Set();
 for(const item of value.windows){
  const b=item?.bounds;
  if(!roles.has(item?.role)||seen.has(item.role)||!b||!['x','y','width','height'].every(key=>Number.isSafeInteger(b[key])&&Math.abs(b[key])<=100000)||b.width<1||b.height<1)return null;
  seen.add(item.role);windows.push({role:item.role,bounds:{x:b.x,y:b.y,width:b.width,height:b.height}});
 }
 return {windows};
}
// 隣接画面をまたぐ窓は可。画面の隙間・タスクバー領域が残れば初期位置に戻す。
function fitsWorkAreas(bounds,areas){
 let uncovered=[bounds];
 for(const area of areas){
  const next=[];
  for(const part of uncovered){
   const left=Math.max(part.x,area.x),top=Math.max(part.y,area.y);
   const right=Math.min(part.x+part.width,area.x+area.width),bottom=Math.min(part.y+part.height,area.y+area.height);
   if(left>=right||top>=bottom){next.push(part);continue;}
   if(part.y<top)next.push({...part,height:top-part.y});
   if(bottom<part.y+part.height)next.push({...part,y:bottom,height:part.y+part.height-bottom});
   if(part.x<left)next.push({x:part.x,y:top,width:left-part.x,height:bottom-top});
   if(right<part.x+part.width)next.push({x:right,y:top,width:part.x+part.width-right,height:bottom-top});
  }
  uncovered=next;
  if(!uncovered.length)return true;
 }
 return false;
}
function createLayoutController({windows,roleOf,screen,initialBoundsOf=window=>window.getBounds()}){
 const pending=new Map();
 function apply(window){
  const role=roleOf(window),bounds=pending.get(role);
  if(!bounds||window.isDestroyed())return;
  pending.delete(role);
  const areas=screen.getAllDisplays().map(display=>display.workArea);
  if(window.isFullScreen?.())window.setFullScreen(false);
  if(window.isMaximized?.())window.unmaximize();
  window.setBounds(fitsWorkAreas(bounds,areas)?bounds:initialBoundsOf(window));
 }
 function capture(){return sanitizeSnapshot({windows:windows().filter(w=>!w.isDestroyed()&&w.isVisible()&&roles.has(roleOf(w))).map(w=>({role:roleOf(w),bounds:w.getNormalBounds?.()||w.getBounds()}))});}
 function restore(value){
  const snapshot=sanitizeSnapshot(value);
  if(!snapshot)return false;
  pending.clear();for(const item of snapshot.windows)pending.set(item.role,item.bounds);
  for(const window of windows())apply(window);
  return true;
 }
 return {capture,restore,apply};
}
module.exports={sanitizeSnapshot,fitsWorkAreas,createLayoutController};
