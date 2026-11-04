// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
test('本体内の3つの別窓起動ピンは本文サイズに依存せず14pxに揃う', () => {
  const selectors = [
    '.space-view .explorer-panel header .explorer-detach',
    '.space-view .explorer-routes .route-detach',
    '.space-view .viewer-popup header .viewer-pin',
  ];
  const start = css.lastIndexOf(selectors.join(','));
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  assert.ok(css.lastIndexOf(selectors.join(',')) > css.lastIndexOf('font-size:var(--file-font-size)'));
  assert.equal(rule.trim(), selectors.join(',') + '{font-size:14px;line-height:14px}');
  // クリック領域・余白・操作は変更せず、別窓のホストには space-view を付けない。
  const panel = readFileSync(new URL('../src/components/ファイル閲覧/パネル別窓.js', import.meta.url), 'utf8');
  assert.match(panel, /host.className = 'development-app ' \+ className/);
  assert.doesNotMatch(rule, /window-actions|viewer-pinned|padding|width|height:(?!14px)/);
});

test('Viewerのピン内部spanは本文サイズでなくボタンの14pxを継承する', () => {
  assert.match(css, /\.space-view \.viewer-popup header \.viewer-pin>span\{font-size:inherit;line-height:inherit\}/);
});
