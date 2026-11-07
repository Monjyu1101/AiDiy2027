// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 通常の実行・自動航行がランダムに選ぶ待機画面。
export const NAVIGATION_RANDOM_SCENES = Object.freeze(['ride', 'fireworks', 'aquarium', 'kaleidoscope', 'water', 'clock', 'maze', 'request']);
// 右クリックのメニューから選べる待機画面。戦闘機はゲーム性が強いため、ランダム選択には含めない。
export const NAVIGATION_SCENES = Object.freeze([...NAVIGATION_RANDOM_SCENES, 'fighter']);
export const NAVIGATION_SCENE_LABELS = Object.freeze({ride:'航行',fireworks:'花火',aquarium:'アクアリウム',kaleidoscope:'万華鏡',water:'水面',clock:'時計',maze:'迷路',request:'依頼文',fighter:'戦闘機'});
export const pickNavigationScene = (random = Math.random) => NAVIGATION_RANDOM_SCENES[Math.min(NAVIGATION_RANDOM_SCENES.length - 1, Math.max(0, Math.floor(random() * NAVIGATION_RANDOM_SCENES.length)))];
export function createRipples(random = Math.random) {
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
