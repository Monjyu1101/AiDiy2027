// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {glide,defaults,sanitizeMotion}=require('../デスクトップ/配置移動.cjs');

test('layout participants that become ready at different times use the same absolute motion timeline',async()=>{
 const start={x:0,y:0,width:600,height:700},end={x:200,y:100,width:800,height:500};
 const motion={...defaults,startAt:200};
 const timelines=await Promise.all([100,150].map(async now=>{
  const output=[];
  const win={isDestroyed:()=>false,getBounds:()=>start,setBounds:value=>output.push([now,value])};
  await glide([{win,end}],()=>{},motion,()=>now,async ms=>{now+=Math.max(0,ms);});
  win.setBounds(end);return output;
 }));
 assert.deepEqual(timelines[0],timelines[1]);
 assert.equal(timelines[0].length,20);
 assert.deepEqual(timelines[0][0],[200,{x:10,y:5,width:610,height:690}]);
 assert.deepEqual(timelines[0][19],[3050,end]);
 assert.deepEqual(sanitizeMotion({...motion,token:'ignored'}),motion);
 assert.equal(sanitizeMotion({...motion,steps:0}),null);
});
