// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
// 48pxクリック領域の対角線より広い中心間隔。向きを保って回転しても画像が重ならない。
const 最小半径=80,中心間隔=70,外周余白=38;
function 円周配置(count){
 if(!Number.isInteger(count)||count<0||count>32)return null;
 const radius=n=>Math.max(最小半径,n>1?Math.ceil(中心間隔/(2*Math.sin(Math.PI/n))):0);
 const 内側数=count>=11?Math.round(count*.4):count,外側数=count-内側数;
 const 内半径=radius(内側数),半径=外側数?Math.max(radius(外側数),内半径+中心間隔):内半径;
 return {半径,内半径,内側数,外側数,幅:2*(半径+外周余白)};
}
module.exports={円周配置,最小半径,中心間隔};
