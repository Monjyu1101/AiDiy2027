// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export function ナビ水面波紋3D状態を作成(random = Math.random) {
  const points = [];
  return {
    points,
    add(position) {
      const positioned=Number.isFinite(position?.x)&&Number.isFinite(position?.y);
      const point = {x: positioned?Math.max(0,Math.min(1,position.x)):.08+random()*.84, y: positioned?Math.max(0,Math.min(1,position.y)):.08+random()*.84, age: 0};
      if (points.length >= 32) points.shift();
      points.push(point); return point;
    },
    step(dt) {
      for (const point of points) point.age += dt;
      for (let i = points.length - 1; i >= 0; i--) if (points[i].age > 7) points.splice(i, 1);
    },
  };
}
