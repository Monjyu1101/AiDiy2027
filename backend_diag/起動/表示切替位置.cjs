// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';

// Electron の座標・寸法・作業領域はすべて DIP。倍率を重ねて適用しない。
const 角判定距離=96;
// 初回だけ作業領域の右下へ配置する。小さい画面でも左上の操作領域は隠さない。
function 初期右下位置(area,size,margin){
 return {x:Math.max(area.x,area.x+area.width-size.width-margin),y:Math.max(area.y,area.y+area.height-size.height-margin),width:size.width,height:size.height};
}
function 角を選ぶ(origin,area){
 if(!area)return null;
 const left=origin.x-area.x,top=origin.y-area.y,right=area.x+area.width-origin.x-origin.width,bottom=area.y+area.height-origin.y-origin.height;
 const near=value=>Math.abs(value)<=角判定距離;
 const horizontal=near(right)&&left>Math.max(0,right)?'right':near(left)&&right>Math.max(0,left)?'left':null;
 const vertical=near(bottom)&&top>Math.max(0,bottom)?'bottom':near(top)&&bottom>Math.max(0,top)?'top':null;
 return horizontal&&vertical?{horizontal,vertical,left,top,right,bottom}:null;
}
function 表示切替位置(origin,size,screen,{画面内=false}={}){
 const target={x:origin.x,y:origin.y,width:size.width,height:size.height};
 const area=screen?.getDisplayMatching?.(origin)?.workArea;
 if(!area||!['x','y','width','height'].every(key=>Number.isFinite(area[key]))||area.width<=0||area.height<=0)return target;
 // 隣り合う両辺が96 DIP以内のときだけ、その角を基準にする。中央・片側の端・最大化は
 // 巻き込まず、少し画面外へ出した窓は切替時に作業領域へ戻す。
 const corner=角を選ぶ(origin,area);
 if(corner){
  const {horizontal,vertical,left,top,right,bottom}=corner;
  target.x=horizontal==='right'?area.x+area.width-Math.max(0,right)-target.width:area.x+Math.max(0,left);
  target.y=vertical==='bottom'?area.y+area.height-Math.max(0,bottom)-target.height:area.y+Math.max(0,top);
 }
 if(corner||画面内){
  // 保存された通常寸法が移動先画面より大きくても、左上の操作領域を隠さない。
  target.x=Math.max(area.x,Math.min(area.x+area.width-target.width,target.x));
  target.y=Math.max(area.y,Math.min(area.y+area.height-target.height,target.y));
 }
 return target;
}
const 同じ矩形=(a,b)=>a&&b&&['x','y','width','height'].every(key=>a[key]===b[key]);
// 自動の高さ確定・中間通常復帰では、最初に選んだ角と余白を保つ。
// 利用者が移動／リサイズした場合、または画面構成が変わった場合だけ選び直す。
function 表示切替基準を作成(screen){
 let reference,input,actual,area;
 return {
  計算(origin,size,options){
   const currentArea=screen?.getDisplayMatching?.(origin)?.workArea;
   if(!reference||!同じ矩形(origin,input)&&!同じ矩形(origin,actual)||!同じ矩形(area,currentArea)){
    reference={...origin};area=currentArea?{...currentArea}:undefined;
   }
   // 角基準でなければ画面内補正後の左肩を継承し、元の画面外座標へ戻さない。
   if(!角を選ぶ(reference,area))reference={...origin};
   input={...origin};
   return 表示切替位置(reference,size,{getDisplayMatching:()=>({workArea:area})},options);
  },
  記録(bounds){actual={...bounds};},
  解除(){reference=input=actual=area=undefined;},
 };
}
module.exports={初期右下位置,表示切替位置,表示切替基準を作成,角判定距離};
