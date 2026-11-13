// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
// Short drags remain text selection. Only a stationary 500 ms press enters window movement.
export function 長押し移動を作成({host=window,native,changed=()=>{},enabled=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,setLoop=setInterval,clearLoop=clearInterval}){
 let cancel=()=>{};
 function start(event){
  cancel();if(!native||!enabled()||event.button!==0||event.isPrimary===false)return;
  const target=event.target,id=event.pointerId,x=event.clientX,y=event.clientY;
  let ended=false,active=false,token,timer,loop,selection;
  const end=()=>{
   if(ended)return;ended=true;clearTimer(timer);clearLoop(loop);
   if(token)void native.endWindowMove(token);changed(false);
   for(const name of ['pointerup','pointercancel','blur','wheel','scroll','keydown','compositionstart'])host.removeEventListener(name,end,{capture:true});
   host.removeEventListener('pointermove',moving,{capture:true});host.removeEventListener('selectstart',select,{capture:true});
   if(active){try{target.releasePointerCapture(id);}catch{}}
   cancel=()=>{};
  };
  const moving=e=>{if(e.pointerId!==id)return;if(!active){if(Math.hypot(e.clientX-x,e.clientY-y)>5)end();}else{e.preventDefault();e.stopPropagation();if(selection)target.setSelectionRange(...selection);}};
  const select=e=>{if(active)e.preventDefault();};
  for(const name of ['pointerup','pointercancel','blur','wheel','scroll','keydown','compositionstart'])host.addEventListener(name,end,{capture:true});
  host.addEventListener('pointermove',moving,{capture:true});host.addEventListener('selectstart',select,{capture:true});cancel=end;
  timer=setTimer(async()=>{
   if(ended||!enabled()){end();return;}
   // Capture selection after the ordinary click has placed the caret.
   selection=[target.selectionStart,target.selectionEnd,target.selectionDirection];
   active=true;
   try{
    target.setPointerCapture(id);
   }catch{}
   try{
    token=await native.beginWindowMove();
    if(ended){if(token)void native.endWindowMove(token);return;}
    if(!token){end();return;}changed(true);
    loop=setLoop(()=>{void Promise.resolve(native.moveWindow(token)).then(ok=>{if(!ok)end();},end);},16);
   }catch{end();}
  },500);
 }
 return {start,cancel:()=>cancel()};
}
