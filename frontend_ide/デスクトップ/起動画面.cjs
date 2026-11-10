// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
// 起動元が選んだ画面の作業領域だけを受け渡す。窓位置・DPI倍率は指定しない。
function 起動画面を読む(value){
 if(typeof value==='string'){
  if(value.length>256)return null;
  try{value=JSON.parse(value);}catch{return null;}
 }
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4)return null;
 const {x,y,width,height}=value;
 if(![x,y,width,height].every(Number.isInteger)||Math.abs(x)>10000000||Math.abs(y)>10000000||width<1||height<1||width>100000||height>100000)return null;
 return{x,y,width,height};
}
module.exports={起動画面を読む};
