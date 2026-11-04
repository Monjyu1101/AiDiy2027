// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const controls='input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="textbox"],[draggable="true"],.scrollbar,.slider';
const movableKinds=new Set(['code','live','navi','console','browser','viewer','explorer','panel-viewer','panel-routes','panel-navigation']);
// ピン留めは所有元の限定APIを渡す。iframeにも同じ窓のAPIだけを使う。
export function installWindowMove({kind,host=false,win=window,api=win.aidiyWindow}){
 if(!movableKinds.has(kind)||host||api?.nativeWindowMove||!api?.beginWindowMove||!api?.moveWindow||!api?.endWindowMove)return()=>{};
 const surfaces=new Map();let disposed=false,activeFinish=()=>{};
 const onBegin=finish=>{activeFinish();activeFinish=finish;};
 function refresh(){
  if(disposed)return;
  const seen=new Set();
  function visit(target){
   let doc;try{doc=target.document;if(!doc?.documentElement)return;}catch{return;}
   if(seen.has(doc))return;seen.add(doc);
   if(!surfaces.has(doc)){
    const stop=installSurfaceMove({win:target,api,onBegin});
    let style;
    if(target!==win){style=doc.createElement('style');style.textContent='.window-moving,.window-moving *{user-select:none!important;cursor:move!important}';doc.head?.append(style);}
    const loaded=event=>{if(event.target?.tagName==='IFRAME')refresh();};
    doc.addEventListener('load',loaded,true);
    const observer=target.MutationObserver?new target.MutationObserver(records=>{
     if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.tagName==='IFRAME'||node.querySelector?.('iframe'))))refresh();
    }):null;
    observer?.observe(doc.documentElement,{childList:true,subtree:true});
    surfaces.set(doc,()=>{observer?.disconnect();doc.removeEventListener('load',loaded,true);stop();style?.remove();});
   }
   for(const frame of doc.querySelectorAll?.('iframe')||[])try{visit(frame.contentWindow);}catch{}
  }
  visit(win);
  for(const [doc,stop]of surfaces)if(!seen.has(doc)){stop();surfaces.delete(doc);}
 }
 refresh();
 return()=>{if(disposed)return;disposed=true;for(const stop of surfaces.values())stop();surfaces.clear();activeFinish=()=>{};};
}
export function windowMoveTarget(target,x,y,win){
 if(!target?.closest)return false;
 const control=target.closest(controls);
 if(control&&!control.matches('.navigation-panel .navigation-items summary,.navigation-panel .navigation-overall summary'))return false;
 for(let node=target;node&&node!==win.document.documentElement;node=node.parentElement){
  if(win.getComputedStyle(node).webkitAppRegion==='drag')return false;
  const rect=node.getBoundingClientRect();
  // inlineの文字spanはclientWidth/Heightが0。スクロールバーと誤認しない。
  if(node.clientWidth>0&&node.offsetWidth>node.clientWidth+2&&(x>=rect.left+node.clientLeft+node.clientWidth||x<rect.left+node.clientLeft))return false;
  if(node.clientHeight>0&&node.offsetHeight>node.clientHeight+2&&y>=rect.top+node.clientTop+node.clientHeight)return false;
 }
 return true;
}
function installSurfaceMove({win,api,onBegin}){
 const doc=win.document,listeners=[];let current=null,disposed=false,sequence=0;
 const listen=(target,type,fn)=>{target.addEventListener(type,fn,true);listeners.push(()=>target.removeEventListener(type,fn,true));};
 const finish=()=>{
  sequence++;const drag=current;current=null;if(!drag)return;
  win.clearTimeout(drag.timer);win.clearInterval(drag.heartbeat);win.cancelAnimationFrame(drag.frame);
  if(drag.active)doc.documentElement.classList.remove('window-moving');
  try{if(drag.target.hasPointerCapture?.(drag.id))drag.target.releasePointerCapture(drag.id);}catch{}
  if(drag.token)void Promise.resolve(api.endWindowMove(drag.token)).catch(()=>{});
 };
 const send=async drag=>{
  if(current!==drag||!drag.token||drag.sending)return;
  drag.sending=true;
  try{if(!await api.moveWindow(drag.token)&&current===drag)finish();}catch{if(current===drag)finish();}
  finally{drag.sending=false;}
 };
 async function activate(drag,run){
  if(current!==drag||disposed||sequence!==run)return;
  try{
   drag.target.setPointerCapture(drag.id);
   const token=await api.beginWindowMove();
   if(current!==drag||disposed||sequence!==run){if(token)await api.endWindowMove(token);return;}
   if(!token){finish();return;}
   // nativeが拒否した場合は選択を維持する。成功後だけ通常の選択/dragを止める。
   drag.token=token;drag.active=true;doc.documentElement.classList.add('window-moving');doc.getSelection()?.removeAllRanges();
   drag.heartbeat=win.setInterval(()=>void send(drag),250);
  }catch{if(current===drag)finish();}
 }
 listen(doc,'pointerdown',event=>{
  if(event.isTrusted===false)return;
  if(current)finish();
  if(event.button!==0||event.isPrimary===false||event.pointerType!=='mouse'||!windowMoveTarget(event.target,event.clientX,event.clientY,win))return;
  onBegin(finish);
  // Monaco / Consoleは押下後の再描画で文字DOMを差し替える。存続するDocumentの根で捕捉する。
  const drag={id:event.pointerId,target:doc.documentElement,sx:event.screenX,sy:event.screenY};
  current=drag;const run=++sequence;drag.timer=win.setTimeout(()=>void activate(drag,run),500);
 });
 listen(doc,'pointermove',event=>{
  const drag=current;if(!drag||event.pointerId!==drag.id)return;
  if(!(event.buttons&1)){finish();return;}
  if(!drag.active){if(event.screenX!==drag.sx||event.screenY!==drag.sy)finish();return;}
  event.preventDefault();event.stopPropagation();
  if(!drag.frame)drag.frame=win.requestAnimationFrame(()=>{drag.frame=0;void send(drag);});
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(doc,type,event=>{if(current&&event.pointerId===current.id)finish();});
 listen(doc,'dragstart',event=>{if(current?.active){event.preventDefault();event.stopPropagation();}else finish();});
 for(const type of ['selectstart','click','contextmenu'])listen(doc,type,event=>{if(current?.active){event.preventDefault();event.stopPropagation();}});
 listen(doc,'keydown',event=>{if(event.key==='Escape')finish();});
 listen(doc,'wheel',()=>{if(current&&!current.active)finish();});
 listen(win,'blur',finish);listen(win,'pagehide',finish);
 listen(doc,'visibilitychange',()=>{if(doc.hidden)finish();});
 return()=>{if(disposed)return;disposed=true;finish();for(const remove of listeners)remove();};
}
