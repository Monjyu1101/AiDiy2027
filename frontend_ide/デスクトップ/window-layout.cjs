// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ElectronのworkArea（タスクバーを除いた論理座標）に収める。
const size=require('../host/scripts/window-size.cjs');
// Consoleは操作バーと端末の数行を残せればよい。初期配置・会話画面の最小寸法とは分ける。
function windowMinimumSize(kind,bounds){
 if(kind==='cpu')return{minWidth:Math.min(240,bounds.width),minHeight:Math.min(150,bounds.height)};
 return{minWidth:Math.min(['ide','task','team'].includes(kind)?400:size.最小幅,bounds.width),minHeight:Math.min(kind==='ide'?550:kind==='console'?180:size.会話最小高さ,bounds.height)};
}
function windowBounds(kind,area,owner,slot=0,cli=false){
 const margin=kind==='ide'?Math.min(32,Math.max(12,Math.round(Math.min(area.width,area.height)*.025))):8;
 const available={x:area.x+margin,y:area.y+margin,width:Math.max(1,area.width-margin*2),height:Math.max(1,area.height-margin*2)};
 if(kind==='ide')return available;
 if(kind==='cpu'){
  const width=Math.min(360,available.width),height=Math.min(160,available.height);
  // Diagミニの固定高さ190 DIPと窓間の33 DIPを空け、右端を揃える。
  const x=available.x+available.width-width;
  const y=Math.max(available.y,available.y+available.height-height-190-33);
  return{x,y,width,height};
 }
 if(kind==='navi'){
  const width=Math.min(size.幅,available.width),height=Math.min(size.ナビ高さ,available.height);
  return{x:available.x,y:Math.round(area.y+(area.height-height)/2),width,height};
 }
 if(kind==='task'||kind==='team'){
  const width=Math.min(1200,available.width),height=Math.min(820,available.height);
  return{x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height};
 }
 if(kind==='browser'){
  const width=Math.min(1100,Math.round(available.width*.8)),height=Math.min(820,Math.round(available.height*.85)),offset=(slot%6)*24;
  return{x:Math.round(Math.min(available.x+(available.width-width)/2+offset,available.x+available.width-width)),y:Math.round(Math.min(available.y+(available.height-height)/2+offset,available.y+available.height-height)),width,height};
 }
 if(kind==='console'){
  if(cli){
   const width=Math.min(800,available.width),height=Math.min(600,available.height);
   // CLI専用窓は通常Consoleの左下・段違い配置と分け、下端中央から表示する。
   return{x:Math.round(area.x+(area.width-width)/2),y:available.y+available.height-height,width,height};
  }
  const width=Math.min(Math.round(area.width*2/3),available.width),height=Math.min(Math.round(area.height/(area.width>area.height?3:4)),available.height);
  const originX=available.x,originY=available.y+available.height-height;
  const steps=Math.max(1,Math.floor(Math.min(available.x+available.width-width-originX,originY-available.y)/28)+1),offset=(slot%steps)*28;
  return{x:Math.round(originX+offset),y:Math.round(originY-offset),width,height};
 }
 const base=owner||available;
 // ピン留めのビューア: IDEの右寄り、高さは作業領域の8割程度。2枚目以降は28pxずつ左下へずらす。
 if(kind==='viewer'){
  const width=Math.min(680,available.width),height=Math.min(Math.max(560,Math.round(available.height*.8)),available.height),offset=(slot%6)*28;
  const x=base.x+base.width-width-24-offset,y=base.y+(owner?36:0)+offset;
  return{x:Math.round(Math.max(available.x,Math.min(x,available.x+available.width-width))),y:Math.round(Math.max(available.y,Math.min(y,available.y+available.height-height))),width,height};
 }
 // Code / LiveはIDEの位置によらず同じディスプレイの左上 / 右上へ置く。
 const width=Math.min(size.幅,available.width);
 const height=Math.min(size.会話高さ,available.height);
 // 先頭窓以外は24〜120pxを循環させ、7枚目以降も先頭位置へ戻さない。
 const offset=owner&&kind==='code'&&slot>0?((slot-1)%5+1)*24:0;
 const x=kind==='code'?available.x+offset:available.x+available.width-width;
 const y=available.y+offset;
 return{x:Math.round(Math.max(available.x,Math.min(x,available.x+available.width-width))),y:Math.round(Math.max(available.y,Math.min(y,available.y+available.height-height))),width,height};
}
// ALLの選択画面でもConsoleを左下、Naviを左中央へ。Codeは右上、Liveは左上へ置く。
function allWindowBounds(kind,area,slot=0){
 const bounds=windowBounds(kind,area,area,slot);
 if(kind==='code'||kind==='live')bounds.x=area.x+area.width-(bounds.x-area.x)-bounds.width;
 return bounds;
}
module.exports={windowBounds,windowMinimumSize,allWindowBounds};
