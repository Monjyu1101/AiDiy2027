// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../src/components/開発スペース/ナビ時計2D.vue', import.meta.url), 'utf8');
function mountClock() {
  const calls = [], images = [], gradients = [];
  const gradient = {addColorStop(offset, color) { gradients.push({offset, color}); }};
  function context() {
    return new Proxy({
      drawImage(surface, x, y, width, height) { images.push({x, y, width, height}); },
      font: '', textAlign: '', textBaseline: '',
      measureText(text) { return {width: parseFloat(this.font.split(' ')[1]) * .6 * text.length}; },
      fillText(text, x, y) { calls.push({text, x, y, font: this.font, align: this.textAlign, baseline: this.textBaseline}); },
      createRadialGradient: () => gradient, createConicGradient: () => gradient,
    }, {get: (target, key) => key in target ? target[key] : () => {}});
  }
  let next, mounted, unmount, index = 0, unbound = false;
  const owner = {devicePixelRatio: 1, requestAnimationFrame(fn) { next = fn; return 1; }, cancelAnimationFrame() { next = null; }};
  const doc = {hidden: false, defaultView: owner, createElement: () => ({getContext: context})};
  const rect = {width: 800, height: 600};
  const stage = {ownerDocument: doc, getBoundingClientRect: () => rect};
  const canvas = {getContext: context};
  let now = new Date(2026, 10, 12, 23, 59, 59).getTime();
  runInNewContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, ''), {
    defineOptions() {}, defineEmits: () => () => {},
    ref: () => ({value: index++ === 0 ? stage : canvas}),
    onMounted(fn) { mounted = fn; }, onBeforeUnmount(fn) { unmount = fn; },
    bindNavigationKeys: () => () => { unbound = true; }, document: doc,
    Date: class extends Date { constructor() { super(now); } },
  });
  mounted();
  return {calls, images, gradients, rect, doc, draw() { calls.length = 0; images.length = 0; gradients.length = 0; next(16); }, tick() { now += 1000; }, unmount,
    get stopped() { return next === null && unbound; }};
}

test('日付は高さ33%の中央で拡大し、時刻は75%へ配置してリサイズに追従する', () => {
  const clock = mountClock();
  for (const [width, height] of [[800, 600], [400, 320], [320, 800], [1200, 200], [160, 120]]) {
    Object.assign(clock.rect, {width, height}); clock.draw();
    const date = clock.calls.find(call => call.text === '2026-11-12');
    const image = clock.images.at(-1);
    assert.equal(image.x + image.width / 2, width / 2); assert.equal(image.y + image.height / 2, height * .33);
    assert.equal(date.x, image.width / 2); assert.equal(date.y, image.height / 2);
    assert.deepEqual(clock.gradients.slice(2, 10), clock.gradients.slice(10, 18), '日付と時刻は同じ7色のパレットを使用する');
    assert.equal(clock.images[1].y + clock.images[1].height / 2, height * .75, '時刻の数字も75%の高さへ配置する');
    assert.equal(clock.images.length, 4, '時刻と日付それぞれに発光と本体を描く');
    assert.equal(date.align, 'center'); assert.equal(date.baseline, 'middle');
    const size = parseFloat(date.font.split(' ')[1]);
    assert.ok(size > Math.max(12, Math.min(width, height) * .055) || size === 12);
    assert.ok(size * .6 * 10 <= width * .92);
    const colons = clock.calls.filter(call => call.text === ':');
    assert.equal(colons.length, 2); assert.ok(colons.every(call => call.y === height * .75));
    assert.ok(colons.every(call => call.align === 'left'), '前フレームの日付中央揃えを時刻に持ち越さない');
    assert.equal(clock.calls.filter(call => /^\d$/.test(call.text)).map(call => call.text).join(''), '235959');
  }
  clock.unmount(); assert.ok(clock.stopped);
});

test('日付をまたぐ現在時刻、非表示からの復帰、破棄を維持する', () => {
  const clock = mountClock(); clock.draw(); clock.tick(); clock.draw();
  assert.ok(clock.calls.some(call => call.text === '2026-11-13'));
  assert.equal(clock.calls.filter(call => /^\d$/.test(call.text)).map(call => call.text).join(''), '000000');
  clock.doc.hidden = true; clock.draw(); assert.equal(clock.calls.length, 0);
  clock.doc.hidden = false; clock.draw(); assert.ok(clock.calls.length > 0);
  clock.unmount(); assert.ok(clock.stopped);
});
