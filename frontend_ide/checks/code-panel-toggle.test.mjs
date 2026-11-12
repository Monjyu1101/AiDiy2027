// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPanelToggleDrag } from '../src/components/コード/パネル切替ドラッグ.js';
function fixture(apiOverride) {
  const calls = [], listeners = new Map(), timers = new Map(); let serial = 0;
  const api = apiOverride || { beginWindowMove: async () => { calls.push('begin'); return 'token'; }, moveWindow: async token => { calls.push(['move', token]); return true; }, endWindowMove: async token => calls.push(['end', token]) };
  const win = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key), setInterval: fn => { timers.set(++serial, fn); return serial; }, clearInterval: key => timers.delete(key) };
  const drag = createPanelToggleDrag({ api, win, toggle: () => calls.push('toggle') });
  const event = (extra = {}) => ({ button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', pointerId: 1, screenX: 100, screenY: 100, detail: 1, currentTarget: { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} }, preventDefault() {}, stopPropagation() {}, ...extra });
  return { drag, calls, listeners, timers, event };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
test('Codeタイトル: クリック・長い静止押下・キーボードで切替、微小な動きでは移動しない', async () => {
  const f = fixture();
  for (let n = 0; n < 3; n++) { f.drag.down(f.event()); f.drag.move(f.event({ screenX: 102 })); f.drag.up(f.event()); f.drag.click(f.event()); }
  f.drag.click(f.event({ detail: 0 }));
  assert.deepEqual(f.calls, ['toggle', 'toggle', 'toggle', 'toggle']);
  f.drag.dispose(); assert.equal(f.listeners.size, 0);
});
test('Codeタイトル: マウスダウンのまま移動、離したclickでは折り畳まない、次のクリックは有効', async () => {
  const f = fixture(); f.drag.down(f.event()); f.drag.move(f.event({ screenX: 110 })); await flush();
  assert.equal(f.calls[0], 'begin'); assert.ok(f.calls.some(call => call[0] === 'move'));
  f.drag.up(f.event()); f.drag.click(f.event());
  assert.ok(!f.calls.includes('toggle')); assert.equal(f.timers.size, 0); assert.deepEqual(f.calls.at(-1), ['end', 'token']);
  f.drag.down(f.event()); f.drag.up(f.event()); f.drag.click(f.event()); assert.equal(f.calls.at(-1), 'toggle'); f.drag.dispose();
});
test('Codeタイトル: IPC待機中の解放・破棄でも遅延tokenを終了する', async () => {
  for (const action of ['up', 'dispose']) {
    let resolve; const ends = [];
    const f = fixture({ beginWindowMove: () => new Promise(r => { resolve = r; }), moveWindow: async () => true, endWindowMove: async token => ends.push(token) });
    f.drag.down(f.event()); f.drag.move(f.event({ screenX: 120 }));
    if (action === 'up') f.drag.up(f.event()); else f.drag.dispose();
    resolve('late'); await flush(); assert.deepEqual(ends, ['late']); assert.equal(f.timers.size, 0); f.drag.dispose();
  }
});
test('Codeタイトル: Escape・フォーカス喪失・cancel・移動拒否・Webでも誤って折り畳まない', async () => {
  for (const action of ['Escape', 'blur', 'cancel']) {
    const f = fixture(); f.drag.down(f.event()); f.drag.move(f.event({ screenX: 120 })); await flush();
    if (action === 'Escape') f.listeners.get('keydown')({ key: 'Escape' }); else if (action === 'blur') f.listeners.get('blur')(); else f.drag.cancel(f.event());
    f.drag.click(f.event()); assert.ok(!f.calls.includes('toggle')); assert.equal(f.timers.size, 0); f.drag.click(f.event({ detail: 0 })); assert.equal(f.calls.at(-1), 'toggle'); f.drag.dispose();
  }
  for (const api of [{}, { beginWindowMove: async () => null, moveWindow() {}, endWindowMove() {} }]) {
    const f = fixture(api); f.drag.down(f.event()); f.drag.move(f.event({ screenX: 120 })); await flush(); f.drag.up(f.event()); f.drag.click(f.event()); assert.deepEqual(f.calls, []);
    f.drag.down(f.event()); f.drag.up(f.event()); f.drag.click(f.event()); assert.deepEqual(f.calls, ['toggle']); f.drag.dispose();
  }
});

test('Codeタイトル: 閉じている間は本文とシアンバーを隠し、タイトル行だけ残す', () => {
  const source = readFileSync(new URL('../src/components/コード/コードパネル.vue', import.meta.url), 'utf8');
  assert.match(source, /\.code-component\.panel-collapsed > :not\(\.panel-brand\)\{display:none!important\}/);
  assert.doesNotMatch(source, /panel-collapsed[^\n]*:not\(\.connection-bar\)/);
});
test('LiveもCodeと同じ切替部品を使い、縮小完了後だけ本文を隠す', () => {
  for (const name of ['コード', 'ライブ']) {
    const source = readFileSync(new URL(`../src/components/${name}/${name}パネル.vue`, import.meta.url), 'utf8');
    assert.match(source, /<PanelToggle[^>]*@hidden="panelHidden = \$event"/);
    assert.match(source, /'panel-collapsed': panelHidden/);
    assert.doesNotMatch(source, /v-if="!panelCollapsed"/);
  }
});
