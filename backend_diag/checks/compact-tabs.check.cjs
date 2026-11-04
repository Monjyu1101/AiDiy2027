// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { source } = require('./ui-components.cjs');
const { parse } = createRequire(path.join(__dirname, '../ui/package.json'))('postcss');
const css = parse(source('style.css'));

// 同じセレクターの後段overrideと幅条件を含め、最終宣言を調べる。
function declarations(selector, width = 1200) {
  const values = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue;
      for (const [, bound, pixels] of parent.params.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) {
        if (bound === 'min' ? width < Number(pixels) : width > Number(pixels)) return;
      }
    }
    rule.walkDecls(({ prop, value }) => { values[prop] = value; });
  });
  return values;
}

test('通常タブは文字を縮めず、余白と間隔だけを詰めて押せる最低高さを保つ', () => {
  for (const width of [1200, 801, 800, 600]) {
    const row = declarations('.tabs', width), button = declarations('.tabs button', width);
    assert.equal(row.padding, '0 8px');
    assert.equal(row.gap, '1px');
    assert.equal(button.padding, '3px 9px 2px');
    assert.equal(button['font-size'], '13px');
    assert.equal(button['min-height'], '30px');
    assert.equal(button['white-space'], 'nowrap');
    assert.equal(button['border-bottom'], '3px solid transparent');
    assert.equal(row.background, '#000');
    const zoom = Number(declarations('#app>.tabs').zoom);
    assert.equal(zoom, .85);
    assert.ok(Number.parseFloat(button['min-height']) * zoom >= 24);
  }
});

test('増えたタブも800px以下で折り返し、480px以下では左右余白だけをさらに詰める', () => {
  for (const width of [800, 600, 480, 420, 360]) {
    assert.equal(declarations('.tabs', width)['flex-wrap'], 'wrap');
    assert.equal(declarations('.tabs button', width)['min-height'], '30px');
  }
  for (const width of [480, 420, 360]) {
    assert.equal(declarations('.tabs', width).padding, '0 4px');
    assert.equal(declarations('.tabs', width).gap, '1px');
    assert.equal(declarations('.tabs button', width).padding, '3px 6px 2px');
    assert.equal(declarations('.tabs button', width)['font-size'], '12px');
  }
});

test('一括実行ボタンも小さい余白で揃え、危険状態・disabled・選択分類色を変えない', () => {
  const run = declarations('.tabs #run.run-all');
  assert.equal(run.margin, '1px 0 1px auto');
  assert.equal(run.padding, '3px 12px');
  assert.equal(run.background, '#f59e0b');
  assert.equal(declarations('.tabs #run.run-all.force-stop').background, '#ff4d6d');
  assert.equal(declarations('.tabs #run.run-all:disabled').cursor, 'not-allowed');
  assert.equal(declarations('.tabs #run.run-all:disabled').opacity, '.45');
  assert.equal(declarations('.tabs button[class*="tab-"].active').background, 'var(--tab-bg)');
  assert.deepEqual(declarations('.tabs .tab-tools'), declarations('.tabs .tab-settings'));
  assert.equal(declarations('.tabs .tab-tools')['--tab-bg'], '#fff0df');
});
