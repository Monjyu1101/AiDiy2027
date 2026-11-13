// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const motions=new WeakMap();
// click の currentTarget はイベント終了後に消えるため、受付コールバック作成時に保持する。
// 光の二周は起動要求の受付を示すだけで、起動成功や完了を表さない。
// 枠内だけの短い受付表示のため、OS のアニメーション効果オフ（prefers-reduced-motion）でも省略しない。
export function 起動モーション(event){
 const button=event?.currentTarget,disabledAtClick=button?.disabled;
 return ()=>{
  try{
   if(!button||disabledAtClick)return;
   const icon=button.querySelector?.('.launch-trace');if(!icon?.animate)return;
   motions.get(icon)?.cancel();
   // 全区間を同じ加速曲線で進める。フェード境界でも周回速度をリセットしない。
   // x=t, y=t² に近い曲線で、最初はゆっくり、最後まで連続的に速くする。
   const animation=icon.animate([
    // 先頭は真下(0deg)から時計回りに進み、720deg で真下へ戻って消える。
    {offset:0,'--launch-spin':'0deg',opacity:0},
    {offset:0.02,'--launch-spin':'14.4deg',opacity:1},
    {offset:0.9,'--launch-spin':'648deg',opacity:1},
    {offset:1,'--launch-spin':'720deg',opacity:0}
   ],{duration:1800,easing:'cubic-bezier(0.333333,0,0.666667,0.333333)',iterations:1});
   motions.set(icon,animation);
   const frame=icon.parentElement;
   frame?.classList.add('launch-active');
   const cleanup=()=>{if(motions.get(icon)===animation){motions.delete(icon);frame?.classList.remove('launch-active');}};
   animation.finished.then(cleanup,cleanup);
  }catch{/* 演出の非対応・失敗で起動要求を止めない。 */}
 };
}
