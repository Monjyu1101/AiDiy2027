// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// パネル内の小さなメニュー。座標と購読先は表示先のDocumentに従う。
export function navigationMenuPosition({point, anchor, bounds, width, height}) {
  const x = Number.isFinite(point?.x) ? point.x : anchor.left;
  const y = Number.isFinite(point?.y) ? point.y : anchor.bottom;
  return {
    left:Math.max(4, Math.min(x-bounds.left, bounds.width-width-4)),
    top:Math.max(4, Math.min(y-bounds.top, bounds.height-height-4)),
  };
}
export function bindNavigationMenu(menu, {anchor, point}, close) {
  const doc=menu.ownerDocument, owner=doc.defaultView, parent=menu.offsetParent||menu.parentElement;
  let disposed=false;
  const listeners=[];
  const listen=(target,type,handler,capture=false)=>{target?.addEventListener(type,handler,capture);listeners.push(()=>target?.removeEventListener(type,handler,capture));};
  const buttons=()=>[...menu.querySelectorAll('button:not(:disabled)')];
  const restore=()=>{if(anchor?.isConnected&&!anchor.disabled&&anchor.ownerDocument===doc)anchor.focus({preventScroll:true});};
  const dispose=(restoreFocus=false)=>{if(disposed)return;disposed=true;listeners.forEach(remove=>remove());if(restoreFocus)restore();};
  const dismiss=(restoreFocus=false)=>{if(disposed)return;dispose(restoreFocus);close();};
  const outside=event=>{if(!menu.contains(event.target))dismiss();};
  const rect=parent.getBoundingClientRect();
  const position=navigationMenuPosition({point,anchor:anchor?.getBoundingClientRect()||rect,
    bounds:{left:rect.left+parent.clientLeft,top:rect.top+parent.clientTop,width:parent.clientWidth,height:parent.clientHeight},width:menu.offsetWidth,height:menu.offsetHeight});
  // 狭いCode表示でパネルが横スクロール済みでも、見えている位置に収める。
  menu.style.left=(position.left+(parent.scrollLeft||0))+'px';menu.style.top=(position.top+(parent.scrollTop||0))+'px';
  listen(doc,'pointerdown',outside,true);
  listen(doc,'contextmenu',outside,true);
  listen(doc,'focusin',outside,true);
  listen(doc,'scroll',outside,true);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)dismiss();});
  listen(owner,'blur',()=>dismiss());listen(owner,'pagehide',()=>dismiss());listen(owner,'resize',()=>dismiss());
  listen(menu,'keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss(true);return;}
    if(event.key==='Tab'){dismiss(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const items=buttons(),index=items.indexOf(doc.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;
    items[next]?.focus({preventScroll:true});
  });
  buttons()[0]?.focus({preventScroll:true});
  return {dispose};
}
