// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 座標は移動開始の判定にだけ使用。実際の窓位置はmainがOSカーソルから計算する。
export function アイコン移動(api,{開始=()=>{},終了=()=>{}}={}){
 let current,suppress=false,lastDrag=0;
 async function send(state){
  if(current!==state||!state.token||state.sending)return;state.sending=true;
  try{if(!await api.moveMicro(state.token)&&current===state)finish();}
  catch{if(current===state)finish();}finally{state.sending=false;}
 }
 function start(state){if(current!==state||!state.active||!state.token||state.timer)return;state.timer=setInterval(()=>void send(state),16);void send(state);}
 function finish(event){
  const state=current;if(!state||event&&event.pointerId!==state.id)return;current=undefined;
  state.commit=state.active&&event?.type==='pointerup';
  clearInterval(state.timer);
  if(state.active){suppress=true;lastDrag=Date.now();終了();}
  if(state.token)void (async()=>{try{if(state.commit)await api.moveMicro(state.token);}finally{await api.endMicroMove(state.token);}})().catch(()=>{});
  try{if(state.target.hasPointerCapture?.(state.id))state.target.releasePointerCapture(state.id);}catch{}
 }
 return {
  down(event){
   if(event.button!==0||!api?.beginMicroMove)return;finish();suppress=false;
   current={id:event.pointerId,target:event.currentTarget,x:event.screenX,y:event.screenY};
   event.currentTarget.setPointerCapture?.(event.pointerId);
   // OSの開始位置は押下時に記録する。閾値到達後に記録すると速いドラッグの移動分を失う。
   const state=current;
   state.ready=Promise.resolve(api.beginMicroMove()).then(async token=>{
    if(current!==state){if(token){try{if(state.commit)await api.moveMicro(token);}finally{await api.endMicroMove(token);}}return;}
    if(!token){finish();return;}state.token=token;start(state);
   }).catch(()=>{if(current===state)finish();});
  },
  async move(event){
   const state=current;if(!state||event.pointerId!==state.id)return;
   if(!(event.buttons&1)){finish();return;}
   if(state.active)return;
   if(Math.hypot(event.screenX-state.x,event.screenY-state.y)<4)return;
   state.active=true;開始();event.preventDefault();
   await state.ready;start(state);
  },
  finish,
  click(){const value=suppress;suppress=false;return value;},
  double(){return Date.now()-lastDrag<500;},
 };
}
