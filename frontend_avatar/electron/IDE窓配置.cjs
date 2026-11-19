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
function visiblePanelRoles(snapshot){
 return snapshot.visiblePanels??snapshot.windows.map(item=>item.role).filter(role=>panelRoles.has(role));
}
function readInitialLayout(raw){
 if(typeof raw!=='string'||raw.length>4096)return null;
 try{return sanitizeSnapshot(JSON.parse(raw));}catch{return null;}
}
async function showInitialPanels(snapshot,{show,isVisible}){
 const panels=visiblePanelRoles(snapshot);
 await Promise.all(panels.map(show));
 return isVisible('core')&&panels.every(isVisible);
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
 function capture(){
  const entries=windows().filter(w=>!w.isDestroyed()&&roles.has(roleOf(w))).map(w=>({window:w,role:roleOf(w)}));
  const open=entries.filter(({role,window})=>panelOpen&&panelRoles.has(role)?panelOpen(role):window.isVisible());
  return sanitizeSnapshot({windows:open.map(({role,window})=>({role,bounds:window.getNormalBounds?.()||window.getBounds()})),visiblePanels:open.map(({role})=>role).filter(role=>panelRoles.has(role)),coreDisplay:coreDisplay()});
 }
 // 初期位置で表示済みの窓だけを、IDE本体の子窓と同じタイムラインで動かす。
 async function restore(value,timing,guard=()=>{}){
  // 単体Avatarの起動・配置取得ではIDEの移動処理を読み込まない。
  const {glide,sanitizeMotion}=require('../../frontend_ide/デスクトップ/配置移動.cjs');
  const snapshot=sanitizeSnapshot(value),motion=sanitizeMotion(timing);
  if(!snapshot||!motion)return false;
  guard();
  const wanted=new Set(['core',...visiblePanelRoles(snapshot)]);
  const shown=new Map(windows().filter(w=>!w.isDestroyed()&&!w.isMinimized?.()&&w.isVisible()).map(w=>[roleOf(w),w]));
  if([...wanted].some(role=>!shown.has(role)))return false;
  const areas=screen.getAllDisplays().map(display=>display.workArea);
  const flights=[];
  for(const {role,bounds} of snapshot.windows){
   if(!wanted.has(role))continue;
   const win=shown.get(role);
   if(win.isFullScreen?.())win.setFullScreen(false);
   if(win.isMaximized?.())win.unmaximize();
   flights.push({win,end:fitsWorkAreas(bounds,areas)?bounds:initialBoundsOf(win)});
  }
  await glide(flights,guard,motion);
  guard();
  if([...wanted].some(role=>shown.get(role).isDestroyed()||!shown.get(role).isVisible()))return false;
  for(const {win,end} of flights)win.setBounds(end);
  return true;
 }
 return {capture,restore};
}
module.exports={sanitizeSnapshot,fitsWorkAreas,createLayoutController,showInitialPanels,readInitialLayout,isCoreDisplay};
