// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 稼働中表示の明滅（ミニ・通常画面で共用）。周期は約4.5秒。
// 開始位置を0〜周期の乱数でずらすだけでは位相差が固定され、同じ模様が4.5秒ごとに繰り返すため、
// 周期も4.5秒を中心に項目ごとにわずかにずらし（4.32〜4.68秒）、さらに表示のたびに ±0.025秒の揺らぎを加えて、位相差が少しずつ変わり続けるようにする。
// 基準周期の間隔は0.06秒以上あり、揺らぎを加えても同じ周期の項目は生じない。
const 基準周期=[4.50,4.62,4.38,4.68,4.56,4.32];
const 割当=new Map();
export function 明滅値(index,系統='mini'){
 const key=系統+':'+index;
 if(!割当.has(key)){const 周期=基準周期[index%基準周期.length]+(Math.random()-.5)*.05;割当.set(key,{'--mini-blink':周期.toFixed(3)+'s','--mini-blink-delay':(-Math.random()*周期).toFixed(3)+'s'});}
 return 割当.get(key);
}
