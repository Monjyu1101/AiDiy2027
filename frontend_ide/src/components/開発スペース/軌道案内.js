// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

/** 軌道面の法線が画面の上下を向くロール角。最短の機体回転で水平を合わせる。 */
export function orbitLevelRoll(normal,view) {
  const [x,y,z]=normal,cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cp=Math.cos(view.pitch),sp=Math.sin(view.pitch);
  const right=x*cy-z*sy,up=y*cp-(x*sy+z*cy)*sp,reference=view.roll||0;
  const delta=Math.atan2(-right,up)-reference;
  return reference+Math.atan2(Math.sin(delta),Math.cos(delta));
}
