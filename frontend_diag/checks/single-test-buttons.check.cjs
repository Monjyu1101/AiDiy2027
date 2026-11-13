// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { source, render, component } = require('./ui-components.cjs');
const panels = [
  'components/設定モデル/設定モデルパネル.vue',
  'components/AIモデル/AIモデルパネル.vue',
  'components/モデル一覧/モデル一覧パネル.vue',
  'components/外部連携/外部連携パネル.vue',
  'components/導入状況/導入状況パネル.vue',
];

test('個別テスト・確認の5パネルだけに共通ボタンを適用する', () => {
  for (const name of panels) {
    const text = source(name);
    const buttons = text.match(/<button\b[^>]*>/g);
    const single = buttons.filter(button => button.includes('single-test-button'));
    assert.equal(single.length, 1, name);
    assert.match(single[0], /:disabled=/, name);
    assert.match(single[0], /@click=/, name);
    assert.doesNotMatch(single[0], /check-next|write-next/, name);
    component(name); // Vue コンパイルも確認する。
  }
  assert.match(source('main.js'), /import '\.\/components\/共通表示\/単体テストボタン\.css';/);
});

test('水色・小サイズ・ホバー・フォーカス・無効状態を全パネルで共用する', () => {
  const css = source('components/共通表示/単体テストボタン.css');
  const base = css.match(/\.panel button\.single-test-button\s*\{([^}]+)\}/)[1];
  for (const rule of ['min-height: 24px', 'padding: 3px 8px', 'font-size: 11px', 'line-height: 16px', 'background: #7dd3fc', 'color: #082f49', 'white-space: nowrap']) {
    assert.ok(base.includes(rule), rule);
  }
  assert.match(css, /:hover:not\(:disabled\)[^}]+background: #bae6fd/);
  assert.match(css, /:focus-visible[^}]+outline: 2px solid/);
  assert.match(css, /:disabled[^}]+color: #e0f2fe;[^}]+opacity: 1;[^}]+cursor: not-allowed;/);
  const layout = source('components/設定モデル/設定モデル.css');
  assert.match(layout, /\.trial-test\{[^}]*flex-direction:row;[^}]*flex-wrap:nowrap;/);
});

test('設定モデルの結果を保持し、実行後も水色のクラスと横一列配置を保つ', async () => {
  const data = { 項目: [{ id: 'CHAT', 区分: 'CHAT', プロバイダ: 'synthetic', モデル: 'model-a' }] };
  for (const state of ['未実施', 'OK', 'NG', '実行中']) {
    const html = await render(panels[0], { data, results: { CHAT: { 状態: state } }, online: true, selected: 'CHAT', running: state === '実行中' });
    const button = html.match(/<button class="single-test-button"[^>]*>/)?.[0];
    assert.ok(button, state);
    assert.doesNotMatch(button, /check-next/);
    assert.equal(button.includes(' disabled'), state === '実行中');
    assert.match(html, /class="trial-test"><button[^]*?<\/button><span[^>]*class="[^"]*badge/);
    assert.doesNotMatch(html.match(/<button id="model-trial-start"[^>]*>/)[0], /single-test-button/);
  }
  const offline = await render(panels[0], { data, results: {}, online: false });
  assert.match(offline, /<button class="single-test-button"[^>]* disabled/);
});
