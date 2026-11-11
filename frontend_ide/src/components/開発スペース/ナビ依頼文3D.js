// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ナビ依頼文の純粋ロジック（描画なし）。作業中の依頼文を短い断片に分け、3D空間の遠くから視点（自分）へ迫って
// 左右をかすめて背後へ通り過ぎるコメントとして流すための、大きさ・速さ・色・位置・横流れをランダムに決める。
export const COMMENT_PLACEHOLDER = '調査中…';
export const COMMENT_MAX_LENGTH = 22;
// 暗めで薄い（彩度を抑えた）色。暗い背景の上でぎりぎり読める程度にして、目に刺さらないようにする。薄い白灰を多めにする。
export const COMMENT_COLORS = Object.freeze(['#99a2b0', '#99a2b0', '#a07676', '#a07d91', '#9d8a6e', '#9f9a74', '#789881', '#6f989f', '#7787a6', '#8a7ca2']);
export const COMMENT_ALPHA = .68;   // 文字全体の濃さ（少し薄くする）
// 3D空間の範囲（視点は原点で -z 方向を向く）。単位はワールド座標。
export const FLIGHT = Object.freeze({
  start: {min: 90, max: 160},      // 出現する遠さ（視点の前方 z = -start）
  speed: {min: 12.6, max: 42},     // 視点へ迫る速さ（単位/秒。従来の70%）。遠くから通り過ぎるまで約3〜12秒
  height: {min: .8, max: 2.6},     // 文字の高さ
  x: 24, y: 15,                    // 出現する左右・上下の広がり（±）
  width: 26,                       // 1コメントの最大の幅（長い断片は文字を小さくして収める）
  clear: 4,                        // 視点の真正面（|x|がこれ未満）を避けて左右をかすめさせる
  drift: 2.45,                     // 横流れの速さ（±、単位/秒。従来の70%）。左右どちらへも流れる
  passed: 6,                       // 視点よりこれだけ背後（z がこの値を超える）に出たら消す
});

/** 依頼文を、流す断片へ分ける。先に改行・句点（。！？；）で細かく区切り、長すぎる断片は読点（、，：）でも分け、それでも長ければ文字数で刻む。空なら「調査中…」だけ。 */
export function ナビ依頼文3Dを分割(text, maxLength = COMMENT_MAX_LENGTH) {
  const result = [];
  // 断片の末尾の区切り（、。！？など）は表示しない。
  const push = piece => { const clean = piece.replace(/\s+/g, ' ').trim().replace(/[、。，,．.！？!?；;：:]+$/u, '').trim(); if (clean) result.push(clean); };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    for (const sentence of line.split(/(?<=[。！？!?；;])/)) {
      if (sentence.trim().length <= maxLength) { push(sentence); continue; }
      let current = '';
      for (const part of sentence.split(/(?<=[、，,：:])/)) {
        if ((current + part).length <= maxLength) { current += part; continue; }
        push(current); current = '';
        let rest = part;
        while (rest.length > maxLength) { push(rest.slice(0, maxLength)); rest = rest.slice(maxLength); }
        current = rest;
      }
      push(current);
    }
  }
  return result.length ? result : [COMMENT_PLACEHOLDER];
}

const between = (range, random) => range.min + random() * (range.max - range.min);

/** コメントを1つ決める：{text, color, height, speed, x, y, z, vx}。遠く（z=-start）から、視点の左右をかすめて背後へ通り過ぎる。 */
export function ナビ依頼文3Dの飛行を作成(segments, random = Math.random) {
  let x = (random() * 2 - 1) * FLIGHT.x;
  if (Math.abs(x) < FLIGHT.clear) x = (x < 0 ? -1 : 1) * (FLIGHT.clear + random() * (FLIGHT.x - FLIGHT.clear) * .5);   // 真正面は避ける
  return {
    text: segments[Math.floor(random() * segments.length)],
    color: COMMENT_COLORS[Math.floor(random() * COMMENT_COLORS.length)],
    height: between(FLIGHT.height, random), speed: between(FLIGHT.speed, random),
    x, y: (random() * 2 - 1) * FLIGHT.y, z: -between(FLIGHT.start, random), vx: (random() * 2 - 1) * FLIGHT.drift,
  };
}
