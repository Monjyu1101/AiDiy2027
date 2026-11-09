// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// show() は背景をinertにせず、backdropも作らない。別DocumentのViewerも同じ扱いにする。
export function openFloatingDialog(dialog,{sourceElement,onCancel}={}){
 const doc=dialog.ownerDocument,win=doc.defaultView;
 let drag=null,resizeObserver;
 const clamp=(value,min,max)=>Math.max(min,Math.min(value,Math.max(min,max)));
 const place=(left,top)=>{
  const rect=dialog.getBoundingClientRect();
  dialog.style.left=clamp(left,8,win.innerWidth-rect.width-8)+'px';
  dialog.style.top=clamp(top,8,win.innerHeight-rect.height-8)+'px';
 };
 dialog.show();
 const rect=dialog.getBoundingClientRect(),source=sourceElement?.getBoundingClientRect();
 const left=source&&source.left>=rect.width+24?source.left-rect.width-12:source&&win.innerWidth-source.right>=rect.width+24?source.right+12:16;
 place(left,Math.min(source?.top||76,76));
 function end(){drag=null;doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',end,true);doc.removeEventListener('pointercancel',end,true);}
 function move(event){if(!drag||event.pointerId!==drag.id)return;place(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);event.preventDefault();}
 function start(event){
  if(event.button!==0||!event.target.closest('[data-dialog-drag]')||event.target.closest('button,input,textarea,select,a'))return;
  const rect=dialog.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',end,true);doc.addEventListener('pointercancel',end,true);event.preventDefault();event.stopPropagation();
 }
 function key(event){if(event.key!=='Escape')return;event.preventDefault();event.stopPropagation();onCancel?.();}
 function resize(){const rect=dialog.getBoundingClientRect();place(rect.left,rect.top);}
 dialog.addEventListener('pointerdown',start);dialog.addEventListener('keydown',key);
 win.addEventListener('resize',resize);
 if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(resize);resizeObserver.observe(dialog);}
 return()=>{end();resizeObserver?.disconnect();dialog.removeEventListener('pointerdown',start);dialog.removeEventListener('keydown',key);win.removeEventListener('resize',resize);};
}
