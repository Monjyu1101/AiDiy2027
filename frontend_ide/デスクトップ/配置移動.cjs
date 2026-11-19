// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const rectKeys=['x','y','width','height'];
const defaults=Object.freeze({steps:20,stepDelay:25,duration:3000});
const pause=ms=>ms>0?new Promise(resolve=>setTimeout(resolve,ms)):Promise.resolve();
// IDEと別プロセスのAvatarが、同じ時刻の同じ分割点を使う。IPCの値は有限範囲に絞る。
function sanitizeMotion(value){
 if(!value||!Number.isSafeInteger(value.startAt)||value.startAt<0||value.startAt>Date.now()+10000||
    !Number.isInteger(value.steps)||value.steps<1||value.steps>100||
    !Number.isInteger(value.stepDelay)||value.stepDelay<0||value.stepDelay>1000||
    !Number.isInteger(value.duration)||value.duration<0||value.duration>10000)return null;
 return {steps:value.steps,stepDelay:value.stepDelay,duration:value.duration,startAt:value.startAt};
}
async function glide(moves,guard,{steps=defaults.steps,stepDelay=defaults.stepDelay,duration=0,startAt}={},now=Date.now,wait=pause){
 const flights=[];
 guard();
 for(const {win,end} of moves){
  if(win.isDestroyed()||!end)continue;
  const start=win.getBounds();
  if(rectKeys.some(key=>start[key]!==end[key]))flights.push({win,start,end});
 }
 if(!flights.length)return;
 const started=startAt??now();
 if(started>now())await wait(started-now());
 for(let step=1;step<steps;step++){
  guard();
  for(const {win,start,end} of flights)if(!win.isDestroyed())win.setBounds(Object.fromEntries(rectKeys.map(key=>[key,Math.round(start[key]+(end[key]-start[key])*step/steps)])));
  await wait(duration>0?started+duration*step/steps-now():stepDelay);
 }
 guard();
}
module.exports={glide,defaults,sanitizeMotion};
