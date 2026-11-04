// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { spacePosition, WORLD_RADIUS, HOME_VIEW, orbitView, panOffset } from '../web/layout.js';

test('名前のハッシュを毎回同じ3D座標へ変換し、全方向へ分散する', () => {
  assert.deepEqual(spacePosition('か\u3099.md'), spacePosition('が.md'));
  assert.deepEqual(spacePosition('日本語😀.md'), spacePosition('日本語😀.md'));
  // 旧方式で同じ合計になる名前・文字の順序違いも区別する。
  assert.notDeepEqual(spacePosition('README.md'), spacePosition('CLAUDE.md'));
  assert.notDeepEqual(spacePosition('ab.js'), spacePosition('ba.js'));
  assert.notDeepEqual(spacePosition('a.js', { identity: 'one/a.js' }), spacePosition('a.js', { identity: 'two/a.js' }));
  const octants = new Array(8).fill(0), mean = [0, 0, 0], unique = new Set();
  for (let i = 0; i < 1024; i++) {
    const p = spacePosition(`file-${i}.js`);
    const radius = Math.hypot(p.x, p.y, p.z);
    assert(Number.isFinite(radius));
    assert(radius >= 300 && radius <= 1500);
    assert(radius + 160 < WORLD_RADIUS);
    octants[(p.x > 0 ? 1 : 0) + (p.y > 0 ? 2 : 0) + (p.z > 0 ? 4 : 0)]++;
    [p.x, p.y, p.z].forEach((v, axis) => { mean[axis] += v / 1024; });
    unique.add(JSON.stringify(p));
    const small = spacePosition(`file-${i}.js`, { scale: 150 });
    for (const axis of ['x', 'y', 'z']) assert(Math.abs(small[axis] * 10 - p[axis]) < 1e-9);
  }
  assert.equal(unique.size, 1024);
  assert(octants.every(n => n > 70 && n < 190), String(octants));
  assert(mean.every(n => Math.abs(n) < 100), String(mean));
});

test('上下左右の回転は極で止まらず、一周で同じ向きへ戻る', () => {
  const view = { ...HOME_VIEW };
  orbitView(view, 0, 600); assert(view.pitch < -Math.PI / 2);
  orbitView(view, 0, -600);
  orbitView(view, Math.PI * 2 / 0.005, Math.PI * 2 / 0.005);
  for (const key of ['yaw', 'pitch']) {
    assert(Math.abs(Math.sin(view[key]) - Math.sin(HOME_VIEW[key])) < 1e-12);
    assert(Math.abs(Math.cos(view[key]) - Math.cos(HOME_VIEW[key])) < 1e-12);
  }
});

test('ドラッグした方向へ手前の星が動く（宇宙をつかむ向き）', () => {
  // 描画と同じ投影: x1 = x·cos(yaw) − z·sin(yaw)、y2 = y·cos(pitch) − z1·sin(pitch)。画面の y は下向き正（= 中心 − y2）
  const screen = (view, point) => {
    const x1 = point.x * Math.cos(view.yaw) - point.z * Math.sin(view.yaw);
    const z1 = point.x * Math.sin(view.yaw) + point.z * Math.cos(view.yaw);
    return { x: x1, y: -(point.y * Math.cos(view.pitch) - z1 * Math.sin(view.pitch)) };
  };
  // 原点よりカメラ側にある点（回転後の奥行き z1 が −100）
  const nearOf = view => ({ x: -100 * Math.sin(view.yaw), y: 0, z: -100 * Math.cos(view.yaw) });
  let view = { ...HOME_VIEW }, near = nearOf(view), before = screen(view, near);
  orbitView(view, 0, 20);
  assert(screen(view, near).y > before.y, '下へドラッグ → 下へ');
  view = { ...HOME_VIEW }; near = nearOf(view); before = screen(view, near);
  orbitView(view, 20, 0);
  assert(screen(view, near).x > before.x, '右へドラッグ → 右へ');
});

test('平行移動はどの視点でも画面に沿い、奥行きを変えない', () => {
  for (const yaw of [0, 0.6, Math.PI, 5]) for (const pitch of [0, 0.35, Math.PI / 2, Math.PI, 5]) {
    const delta = panOffset(yaw, pitch, 12, -8, 3);
    const x = delta.x * Math.cos(yaw) - delta.z * Math.sin(yaw);
    const z = delta.x * Math.sin(yaw) + delta.z * Math.cos(yaw);
    const y = delta.y * Math.cos(pitch) - z * Math.sin(pitch);
    const depth = delta.y * Math.sin(pitch) + z * Math.cos(pitch);
    assert(Math.abs(x + 36) < 1e-10);
    assert(Math.abs(y + 24) < 1e-10);
    assert(Math.abs(depth) < 1e-10);
  }
});
