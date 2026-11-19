// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 親プロセス専用。rendererへ公開せず、認証・セッション情報は扱わない。
const panelRoles=new Set(['chat','file','image','code1','code2','code3','code4','code5','code6']);
const roles=new Set(['core',...panelRoles]);
const coreDisplays=new Set(['アバター','カレンダーα','xneko','xeyes','アナログ時計','デジタル時計','デジアナ時計','カレンダー','無し']);
const isCoreDisplay=value=>coreDisplays.has(value);
function sanitizeSnapshot(value){
 if(!value||!Array.isArray(value.windows)||value.windows.length>12)return null;
 const windows=[],seen=new Set();
 for(const item of value.windows){
  const b=item?.bounds;
  if(!roles.has(item?.role)||seen.has(item.role)||!b||!['x','y','width','height'].every(key=>Number.isSafeInteger(b[key])&&Math.abs(b[key])<=100000)||b.width<1||b.height<1)return null;
  seen.add(item.role);windows.push({role:item.role,bounds:{x:b.x,y:b.y,width:b.width,height:b.height}});
 }
 const {visiblePanels,coreDisplay}=value;
 if(visiblePanels!==undefined&&(!Array.isArray(visiblePanels)||visiblePanels.length>panelRoles.size||
    !Array.from(visiblePanels).every(role=>panelRoles.has(role))||new Set(visiblePanels).size!==visiblePanels.length))return null;
 if(coreDisplay!==undefined&&!isCoreDisplay(coreDisplay))return null;
 return {windows,...(visiblePanels===undefined?{}:{visiblePanels:[...visiblePanels]}),...(coreDisplay===undefined?{}:{coreDisplay})};
}
// 旧形式は表示中の窓だけを記録していたので、位置情報から開くパネルを復元する。
async function restorePanelLayout(value,{prepare,hide,show,place,isVisible}){
 const snapshot=sanitizeSnapshot(value);
 if(!snapshot)return false;
 const panels=snapshot.visiblePanels??snapshot.windows.map(item=>item.role).filter(role=>panelRoles.has(role));
 const open=new Set(panels);
 for(const role of panelRoles)if(!open.has(role))hide(role);
 await Promise.all(panels.map(prepare));
 if(!place({...snapshot,windows:snapshot.windows.filter(item=>item.role==='core'||open.has(item.role))}))return false;
 await Promise.all(panels.map(show));
 return panels.every(isVisible)&&(!snapshot.windows.some(item=>item.role==='core')||isVisible('core'));
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
function createLayoutController({windows,roleOf,screen,initialBoundsOf=window=>window.getBounds(),panelOpen,coreDisplay=()=>undefined}){
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
 function capture(){
  const entries=windows().filter(w=>!w.isDestroyed()&&roles.has(roleOf(w))).map(w=>({window:w,role:roleOf(w)}));
  const open=entries.filter(({role,window})=>panelOpen&&panelRoles.has(role)?panelOpen(role):window.isVisible());
  return sanitizeSnapshot({windows:open.map(({role,window})=>({role,bounds:window.getNormalBounds?.()||window.getBounds()})),visiblePanels:open.map(({role})=>role).filter(role=>panelRoles.has(role)),coreDisplay:coreDisplay()});
 }
 function restore(value){
  const snapshot=sanitizeSnapshot(value);
  if(!snapshot)return false;
  pending.clear();for(const item of snapshot.windows)pending.set(item.role,item.bounds);
  for(const window of windows())apply(window);
  return true;
 }
 return {capture,restore,apply};
}
module.exports={sanitizeSnapshot,fitsWorkAreas,createLayoutController,restorePanelLayout,isCoreDisplay};
