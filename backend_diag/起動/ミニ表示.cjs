// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {setWindowBounds}=require('../../frontend_ide/デスクトップ/全画面横断.cjs');
const {表示切替基準を作成,初期右下位置}=require('./表示切替位置.cjs');

const ミニ幅=400,ミニの余白=8;
// 7アイコンを並べる幅と、案内・状態列を含めた初期寸法。
const ミニ高さ=200;
const ミニ寸法={width:ミニ幅,height:ミニ高さ};
const ミニ高さは有効=height=>Number.isInteger(height)&&height>=80&&height<=360;
// 通常時の寸法を保持し、四隅付近以外の表示切替では現在の左肩を引き継ぐ。
function ミニ表示を作成(window,{screen,位置=表示切替基準を作成(screen)}={}){
 let original,前回ミニ寸法=ミニ寸法;
 return {
  get active(){return !!original;},
  get normalBounds(){return original?.bounds;},
  演出範囲(enabled){
   const origin=window.getBounds();
   return 位置.計算(origin,enabled?前回ミニ寸法:original?.bounds||origin);
  },
  set(enabled,{initial=false,origin}={}){
   if(typeof enabled!=='boolean'||!window||window.isDestroyed())return false;
   if(enabled===!!original)return true;
   origin=origin||window.getBounds();
   if(enabled){
    original={bounds:window.getNormalBounds(),minimum:window.getMinimumSize(),maximized:window.isMaximized(),maximizable:window.isMaximizable()};
    if(original.maximized)window.unmaximize();
    window.setMinimumSize(300,150);
    window.setMaximizable(false);
    // 初期ミニだけ作業領域の右下角から8 DIP内側に置く。
    const area=initial?screen.getPrimaryDisplay().workArea:null;
    const target=位置.計算(origin,initial?ミニ寸法:前回ミニ寸法);
    setWindowBounds(window,area?初期右下位置(area,target,ミニの余白):target);
    if(area)位置.解除();
   }else{
    const saved=original;original=undefined;
    前回ミニ寸法={width:Math.max(300,origin.width),height:Math.max(150,origin.height)};
    window.setMinimumSize(...saved.minimum);
    window.setMaximizable(saved.maximizable);
    // 最前面は共通ピンの所有。ミニ中の変更を通常表示へ戻しても保持する。
    // 自動最大化せず、現在位置で選んだ基準点から通常寸法へ広げる。
    setWindowBounds(window,位置.計算(origin,saved.bounds));
   }
   位置.記録(window.getBounds());
   return true;
  },
 };
}
module.exports={ミニ表示を作成,ミニ高さは有効,ミニ寸法};
