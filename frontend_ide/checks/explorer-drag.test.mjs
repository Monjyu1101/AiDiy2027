// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExplorerDrag } from '../src/components/ファイル閲覧/エクスプローラードラッグ.js';
function setup() {
  const win = new EventTarget(), classes = new Set(); let capture, activities = 0;
  const element = { ownerDocument: { defaultView: win }, scrollTop: 100, scrollHeight: 1000, clientHeight: 300,
    clientWidth: 200, clientLeft: 1, clientTop: 1, getBoundingClientRect: () => ({ left: 10, top: 10 }),
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    setPointerCapture: id => { capture = id; }, hasPointerCapture: id => capture === id, releasePointerCapture: () => { capture = undefined; } };
  const drag = createExplorerDrag({ activity: () => activities++ });
  const event = (extra = {}) => ({ button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 100,
    target: { closest: () => null }, currentTarget: element, detail: 1, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
  const fire = (type, extra = {}) => { const e = new Event(type, { cancelable: true }); for (const [key, value] of Object.entries(event(extra))) if (!['target','currentTarget','preventDefault','stopPropagation'].includes(key)) Object.defineProperty(e, key, { value }); win.dispatchEvent(e); return e; };
  return { drag, element, win, event, fire, classes, capture: () => capture, activities: () => activities };
}
test('上下ドラッグで一覧を動かし、範囲外へ行かず、解放クリックを選択にしない', () => {
  const h = setup(); h.drag.down(h.event());
  assert.equal(h.fire('pointermove', { clientY: 60 }).defaultPrevented, true); assert.equal(h.element.scrollTop, 140); assert.equal(h.capture(), 1);
  h.fire('pointermove', { clientY: 150 }); assert.equal(h.element.scrollTop, 50);
  h.fire('pointermove', { clientY: 1000 }); assert.equal(h.element.scrollTop, 0);
  h.fire('pointermove', { clientY: -1000 }); assert.equal(h.element.scrollTop, 700);
  h.fire('pointerup'); assert.equal(h.capture(), undefined); assert.equal(h.classes.size, 0);
  for (const type of ['click', 'dblclick']) { const e = h.event({ type }); h.drag.click(e); assert.equal(e.prevented, true); assert.equal(e.stopped, true); }
  const keyboard = h.event({ detail: 0 }); h.drag.click(keyboard); assert.equal(keyboard.prevented, undefined);
  h.drag.down(h.event()); h.fire('pointerup'); const click = h.event(); h.drag.click(click); assert.equal(click.prevented, undefined);
});
test('小さな揺れ・短押し・横ドラッグでは選択とダブルクリックを保つ', () => {
  for (const position of [{ clientY: 103 }, { clientX: 90 }]) {
    const h = setup(); h.drag.down(h.event()); h.fire('pointermove', position); h.fire('pointerup');
    assert.equal(h.element.scrollTop, 100); const click = h.event(); h.drag.click(click); assert.equal(click.prevented, undefined);
  }
});
test('入力、展開ボタン、右クリック、タッチ、スクロールバー、短い一覧を横取りしない', () => {
  for (const extra of [{ target: { closest: () => ({}) } }, { button: 2 }, { pointerType: 'touch' }, { isPrimary: false }, { clientX: 211 }, { clientX: 10 }, { clientY: 311 }]) {
    const h = setup(); h.drag.down(h.event(extra)); assert.equal(h.fire('pointermove', { clientY: 40 }).defaultPrevented, false); assert.equal(h.element.scrollTop, 100);
  }
  const h = setup(); h.element.scrollHeight = 300; h.drag.down(h.event()); h.fire('pointermove', { clientY: 40 }); assert.equal(h.element.scrollTop, 100);
});
test('別窓のownerDocumentを使用し、長押し窓移動のpointercancelや終了で待機を片付ける', () => {
  for (const [type, extra] of [['pointercancel', {}], ['blur', {}], ['pagehide', {}], ['keydown', { key: 'Escape' }], ['pointermove', { buttons: 0 }]]) {
    const h = setup(); h.drag.down(h.event()); h.fire(type, extra); h.fire('pointermove', { clientY: 40 }); assert.equal(h.element.scrollTop, 100);
  }
  const h = setup(); h.drag.down(h.event()); h.fire('pointermove', { pointerId: 2, clientY: 40 }); assert.equal(h.element.scrollTop, 100);
  h.fire('pointermove', { clientY: 40 }); assert.equal(h.element.scrollTop, 160); h.drag.dispose(); h.fire('pointermove', { clientY: 20 }); assert.equal(h.element.scrollTop, 160); assert.equal(h.capture(), undefined);
});
test('通常のnative dragだけを止め、Vue一覧に接続し、別窓の長押し対象指定を維持する', () => {
  const h = setup(); const before = h.event(); h.drag.dragstart(before); assert.equal(before.prevented, undefined);
  h.drag.down(h.event()); const pending = h.event(); h.drag.dragstart(pending); assert.equal(pending.prevented, true); h.drag.dispose();
  const source = readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue', import.meta.url), 'utf8');
  // 同じ一覧要素への接続を検証し、無関係な属性追加・順序には依存しない。
  const treeTag = source.match(/<ul\b[^>]*\bref="treeElement"[^>]*>/)?.[0];
  assert.ok(treeTag, 'treeElement の一覧が存在する');
  for (const attribute of ['@pointerdown="treeDrag.down"', '@click.capture="treeDrag.click"', '@dblclick.capture="treeDrag.click"', '@dragstart="treeDrag.dragstart"']) assert.ok(treeTag.includes(attribute), attribute);
  assert.match(source, /:data-aidiy-window-move-list="detached&&nativePanels\?'':undefined"/);
  assert.match(source, /onBeforeUnmount\(\(\)=>\{treeDrag.dispose\(\)/);
});
