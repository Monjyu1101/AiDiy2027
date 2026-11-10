// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {初期右下位置,表示切替位置,角判定距離}=require('../起動/表示切替位置.cjs');
const area={x:0,y:28,width:1920,height:1012};
const screen={getDisplayMatching:()=>({workArea:area,scaleFactor:1.25})};
const size={width:360,height:186};
const corner=(right,bottom)=>({x:area.x+area.width-800-right,y:area.y+area.height-600-bottom,width:800,height:600});

test('右下付近では右・下の余白を維持し、96 DIPの境界を含む',()=>{
 for(const right of [0,8,48,角判定距離])for(const bottom of [0,8,48,角判定距離]){
  const origin=corner(right,bottom),result=表示切替位置(origin,size,screen);
  assert.deepEqual(result,{x:area.x+area.width-size.width-right,y:area.y+area.height-size.height-bottom,...size});
  assert.deepEqual(表示切替位置(result,origin,screen),origin,'反復切替で座標がずれない');
 }
});
test('四隅の余白0・8・48・96 DIPを保ち、反復切替で位置がずれない',()=>{
 for(const right of [false,true])for(const bottom of [false,true])for(const gapX of [0,8,48,96])for(const gapY of [0,8,48,96]){
  const origin={x:right?1920-800-gapX:gapX,y:bottom?1040-600-gapY:28+gapY,width:800,height:600};
  const result=表示切替位置(origin,size,screen);
  assert.deepEqual(result,{x:right?1920-360-gapX:gapX,y:bottom?1040-186-gapY:28+gapY,...size});
  assert.deepEqual(表示切替位置(result,origin,screen),origin);
 }
});
test('四隅の判定は両辺が必要で、片辺が97 DIPなら左肩を維持',()=>{
 for(const right of [false,true])for(const bottom of [false,true])for(const [gapX,gapY] of [[97,8],[8,97]]){
  const origin={x:right?1920-800-gapX:gapX,y:bottom?1040-600-gapY:28+gapY,width:800,height:600};
  assert.deepEqual(表示切替位置(origin,size,screen),{x:origin.x,y:origin.y,...size});
 }
});
test('片辺だけ・閾値外・中央・最大化は従来の左肩を維持',()=>{
 for(const origin of [corner(97,8),corner(8,97),corner(0,250),corner(600,0),{x:560,y:234,width:800,height:600},area]){
  assert.deepEqual(表示切替位置(origin,size,screen),{x:origin.x,y:origin.y,...size});
 }
});
test('少し画面外なら右下を内側へ補正するが、大幅に外れた窓は自動判定しない',()=>{
 assert.deepEqual(表示切替位置(corner(-12,-6),size,screen),{x:1560,y:854,...size});
 const outside=corner(-97,-6);assert.deepEqual(表示切替位置(outside,size,screen),{x:outside.x,y:outside.y,...size});
});
test('負座標・上下にずれた副画面とタスクバーの作業領域を元窓から選ぶ',()=>{
 for(const workArea of [{x:-1920,y:-1060,width:1920,height:1020},{x:1920,y:80,width:1440,height:860}]){
  const origin={x:workArea.x+workArea.width-128-20,y:workArea.y+workArea.height-138-32,width:128,height:138};
  const screens={getDisplayMatching:b=>{assert.deepEqual(b,origin);return{workArea,scaleFactor:2};},getPrimaryDisplay:()=>{assert.fail('主画面を使わない');}};
  assert.deepEqual(表示切替位置(origin,{width:800,height:600},screens),{x:workArea.x+workArea.width-820,y:workArea.y+workArea.height-632,width:800,height:600});
 }
});
test('移動先より大きい通常寸法は維持し、左上の操作領域を隠さない',()=>{
 const workArea={x:-640,y:40,width:640,height:480},origin={x:-136,y:374,width:128,height:138};
 assert.deepEqual(表示切替位置(origin,{width:800,height:600},{getDisplayMatching:()=>({workArea})}),{x:-640,y:40,width:800,height:600});
});
test('画面情報なしは左肩維持、アイコンだけの画面内補正は通常基準でも使える',()=>{
 const origin={x:-10,y:10,width:800,height:600};
 for(const missing of [undefined,{}, {getDisplayMatching:()=>({workArea:{x:0,y:0}})}])assert.deepEqual(表示切替位置(origin,size,missing),{x:-10,y:10,...size});
 assert.deepEqual(表示切替位置(origin,size,screen,{画面内:true}),{x:0,y:28,...size});
});

 test('初期右下位置は作業領域の原点とDIPを使い、小画面で左上を保つ',()=>{
 for(const area of [{x:0,y:28,width:1920,height:1052},{x:-1920,y:-1040,width:1920,height:1040}])for(const margin of [8,48]){
  const size={width:360,height:134};assert.deepEqual(初期右下位置(area,size,margin),{x:area.x+area.width-size.width-margin,y:area.y+area.height-size.height-margin,...size});
 }
 assert.deepEqual(初期右下位置({x:-500,y:32,width:400,height:300},{width:800,height:600},48),{x:-500,y:32,width:800,height:600});
});
