// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {setWindowBounds}=require('../../frontend_ide/デスクトップ/全画面横断.cjs');
const {表示切替基準を作成}=require('./表示切替位置.cjs');

// 7列384pxからアイコン枠＋間隔1列分（約54px）を減らした6列幅。
const ミニ幅=330,初期ミニ高さ=134,最小ミニ高さ=80,最大ミニ高さ=360,ミニの余白=8;
const ミニ高さは有効=height=>Number.isInteger(height)&&height>=最小ミニ高さ&&height<=最大ミニ高さ;
// 通常時の寸法を保持し、四隅付近以外の表示切替では現在の左肩を引き継ぐ。
function ミニ表示を作成(window,{screen,位置=表示切替基準を作成(screen)}={}){
 let original;
 return {
  get active(){return !!original;},
  get normalBounds(){return original?.bounds;},
  演出範囲(enabled){
   const origin=window.getBounds();
   return 位置.計算(origin,enabled?{width:ミニ幅,height:最大ミニ高さ}:original?.bounds||origin);
  },
  set(enabled,{topLeft=false,origin}={}){
   if(typeof enabled!=='boolean'||!window||window.isDestroyed())return false;
   if(enabled===!!original)return true;
   origin=origin||window.getBounds();
   if(enabled){
    original={bounds:window.getNormalBounds(),minimum:window.getMinimumSize(),maximized:window.isMaximized(),maximizable:window.isMaximizable()};
    if(original.maximized)window.unmaximize();
    window.setMinimumSize(ミニ幅,初期ミニ高さ);
    window.setMaximizable(false);
    // 初期ミニは作業領域の左上角から数px内側に置く。
    const area=topLeft?screen.getPrimaryDisplay().workArea:null;
    const target=位置.計算(origin,{width:ミニ幅,height:初期ミニ高さ});
    setWindowBounds(window,{...target,...(area?{x:area.x+ミニの余白,y:area.y+ミニの余白}:{})});
    if(area)位置.解除();
   }else{
    const saved=original;original=undefined;
    window.setMinimumSize(...saved.minimum);
    window.setMaximizable(saved.maximizable);
    // 最前面は共通ピンの所有。ミニ中の変更を通常表示へ戻しても保持する。
    // 自動最大化せず、現在位置で選んだ基準点から通常寸法へ広げる。
    setWindowBounds(window,位置.計算(origin,saved.bounds));
   }
   位置.記録(window.getBounds());
   return true;
  },
  resize(height){
   if(!original||!window||window.isDestroyed()||!ミニ高さは有効(height))return false;
   const bounds=window.getBounds();
   if(bounds.width===ミニ幅&&bounds.height===height)return true;
   // 縮小時は以前の最小高さに阻まれない順序にし、測定後も基準点を保つ。
   window.setMinimumSize(ミニ幅,height);
   setWindowBounds(window,位置.計算(bounds,{width:ミニ幅,height}));
   位置.記録(window.getBounds());
   return true;
  },
 };
}
module.exports={ミニ表示を作成,ミニ高さは有効,ミニ幅};
