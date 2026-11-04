// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const declaration = (body, property) => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim();
test('Console / Code / Live / IDE の接続バーは境界線込み3pxを共有する', () => {
  const css = read('../src/style.css') + '\n' + read('../src/components/共通表示/会話表示.css');
  assert.match(css, /\*\s*\{\s*box-sizing\s*:\s*border-box/);
  const sizes = rules(css).filter(([_, selector, body]) => selector.includes('.connection-bar') && declaration(body, 'height'));
  assert.equal(sizes.length, 1, 'アプリ別の高さ上書きを追加しない');
  assert.equal(sizes[0][1].trim(), '.connection-bar');
  assert.equal(declaration(sizes[0][2], 'height'), '3px');
  assert.equal(declaration(sizes[0][2], 'border-top'), '1px solid #242424');
  assert.equal(declaration(sizes[0][2], 'flex'), 'none');
});
// Diag / Discord の配布 CSS はそれぞれ自身の module 内で同じ寸法を検証する。
test('VS Code版は単独版と同じ共通CSSを配布・参照する', () => {
  assert.match(read('../host/src/vscode-html.ts'), /dist\/development\/app\.css/);
  const build = read('../scripts/build.mjs');
  assert.match(build, /host\/dist\/development/);
  assert.match(build, /host\/aidiy_live\/dist\/development/);
  assert.match(build, /'app\.css'/);
});
