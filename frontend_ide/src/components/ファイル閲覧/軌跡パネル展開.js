// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export const ROUTE_EXPAND_MS=260;
// 本体と別窓で同じ状態機械を使う。窓の透明な領域を確保してから下へ伸ばす。
export function createRouteExpansion({measure,reserve,changed,report=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let disposed=false,generation=0,timer,wanted=null,state={height:0,visible:false,phase:'closed'};
 const publish=value=>{state={...state,...value};changed({...state});};
 const valid=run=>!disposed&&run===generation;
 function later(run,delay,fn){timer=schedule(()=>{timer=undefined;if(valid(run))fn();},delay);}
 async function set(open,{restart=false}={}){
  if(disposed||wanted===open&&!restart)return;
  wanted=open;const run=++generation;cancel(timer);timer=undefined;
  const {bar,target}=measure();
  if(!open){
   const moving=state.height>0;publish({height:0,visible:false,phase:moving?'closing':'closed'});
   const shrink=async()=>{try{await reserve(bar);if(valid(run))publish({phase:'closed'});}catch(error){if(valid(run))report(error.message);}};
   if(moving)later(run,ROUTE_EXPAND_MS+34,()=>void shrink());else await shrink();return;
  }
  publish({visible:false,phase:'preparing',...(restart?{height:0}:{})});
  try{
   const result=await reserve(bar+target);if(!valid(run))return;
   const height=Math.max(0,Math.min(target,(result?.height??measure().available+bar)-bar));
   const expand=()=>{publish({height,phase:'opening',visible:false});later(run,ROUTE_EXPAND_MS+34,()=>publish({phase:'open',visible:true}));};
   // DOMが別Documentへ移った直後も高さ0を一度確定させる。
   later(run,32,expand);
  }catch(error){if(valid(run)){wanted=null;publish({height:0,visible:false,phase:'closed'});report(error.message);}}
 }
 return{set,refresh(){if(!disposed&&state.phase==='open'){const m=measure();publish({height:Math.max(0,Math.min(m.target,m.available))});}},dispose(){disposed=true;generation++;cancel(timer);timer=undefined;},get state(){return{...state};}};
}
