// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTermFontFit } from '../src/components/ターミナル/横幅フォント.js';
function fixture(width = 800) {
  const terminal = { options: { fontSize: 14 } };
  const state = { width, factor: .6, fitCount: 0, unavailable: false };
  const fit = {
    proposeDimensions: () => state.unavailable ? undefined : ({ cols: Math.floor((state.width - 15) / (terminal.options.fontSize * state.factor)), rows: 10 }),
    fit() { state.fitCount++; terminal.cols = this.proposeDimensions().cols; },
  };
  return { terminal, state, update: createTermFontFit(terminal, fit) };
}
test('80列境界・最小6px・幅回復・繰返しで基準を縮めない', () => {
  const f = fixture(687); f.update(); assert.equal(f.terminal.options.fontSize, 14); assert.equal(f.terminal.cols, 80);
  f.state.width = 686; f.update(); assert.equal(f.terminal.options.fontSize, 13); assert.ok(f.terminal.cols >= 80);
  f.state.width = 400; f.update(); assert.equal(f.terminal.options.fontSize, 8); assert.ok(f.terminal.cols >= 80);
  for(let i=0;i<5;i++) f.update(); assert.equal(f.terminal.options.fontSize, 8);
  f.state.width = 180; f.update(); assert.equal(f.terminal.options.fontSize, 6); assert.ok(f.terminal.cols < 80);
  f.state.width = 800; f.update(); assert.equal(f.terminal.options.fontSize, 14);
  assert.equal(f.state.fitCount, 10);
});
test('手動指定は上限、タブ間独立、再測定でDPI変化にも追従', () => {
  const a = fixture(400), b = fixture(800); a.update(); b.update();
  assert.equal(b.terminal.options.fontSize, 14);
  a.terminal.options.fontSize = 18; a.update(); a.state.width = 1200; a.update(); assert.equal(a.terminal.options.fontSize, 18);
  b.state.factor = 1; b.update(); assert.equal(b.terminal.options.fontSize, 9); assert.ok(b.terminal.cols >= 80);
});
test('測定不能時は現在のサイズ・列数を変更しない', () => {
  const f = fixture(400); f.update(); const previous = f.terminal.options.fontSize;
  f.state.unavailable = true; f.update(); assert.equal(f.terminal.options.fontSize, previous); assert.equal(f.state.fitCount, 1);
});
