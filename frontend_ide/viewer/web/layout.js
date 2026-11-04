// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

export const WORLD_RADIUS = 1750;
export const HOME_VIEW = Object.freeze({ yaw: 0.6, pitch: 0.35 });

/** FNV-1a に最終混合を加え、似た名前も分散させる（暗号用途ではない）。 */
function fraction(text) {
  let h = 2166136261;
  for (const char of text.normalize('NFC')) { h ^= char.codePointAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 名前から3つの値を作り、球の体積に沿って分散する固定3D座標へ変換する。 */
export function spacePosition(name, { scale = 1500, identity = name } = {}) {
  const key = `${name.normalize('NFC')}\0${identity.normalize('NFC')}`;
  const angle = fraction(`azimuth:${key}`) * Math.PI * 2;
  const height = fraction(`height:${key}`) * 2 - 1;
  // 半径の立方根で中心への密集を防ぐ。中心の小領域は帰還ゲートのため空ける。
  const radius = scale * Math.cbrt(0.008 + 0.992 * fraction(`radius:${key}`));
  const side = Math.sqrt(1 - height * height);
  return {
    x: Math.cos(angle) * side * radius,
    y: height * radius,
    z: Math.sin(angle) * side * radius,
  };
}

/** 縦横とも360度回転できる。極で止めず、ドラッグの連続性を保つ。
 *  上下左右とも宇宙をつかんで動かす向き（ドラッグした方向へ手前の星が動く）。 */
export function orbitView(view, dx, dy) {
  view.yaw += dx * 0.005;
  view.pitch -= dy * 0.005;
}

/** 現在の画面の右・上ベクトルに沿う移動。上下反転した視点でも同じ操作感。 */
export function panOffset(yaw, pitch, dx, dy, scale) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return {
    x: (-dx * cy - dy * sy * sp) * scale,
    y: dy * cp * scale,
    z: (dx * sy - dy * cy * sp) * scale,
  };
}

/** フォルダ移動の2段階ワープ。拡縮・フェード・ぼかしを組み合わせる。 */
export function warpMotion(direction, { inwardScale = 2.6 } = {}) {
  const inward = direction !== 'out';
  return {
    exit: {
      duration: 850,
      frames: [
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        { opacity: 0, transform: `scale(${inward ? inwardScale : 0.38})`, filter: `blur(7px)` },
      ],
    },
    entry: {
      duration: 1050,
      frames: [
        { opacity: 0, transform: `scale(${inward ? 0.86 : 1.14})`, filter: `blur(18px)` },
        { opacity: 0.55, transform: `scale(${inward ? 0.98 : 1.02})`, filter: `blur(6px)`, offset: 0.55 },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
      ],
    },
  };
}
