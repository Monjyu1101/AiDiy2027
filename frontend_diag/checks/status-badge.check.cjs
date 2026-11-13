// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, source } = require('./ui-components.cjs');
test('compiled badges distinguish every state with text only, no icons', async () => {
  for (const [state, tone] of Object.entries({ 未確認: 'neutral', 未実施: 'warning', 未取得: 'neutral', 未検出: 'warning', 注意: 'warning', OK: 'success', NG: 'danger', ERR: 'danger', 取得済: 'success', 取得中: 'pending', 失敗: 'danger', 確認中: 'pending', キャッシュ利用: 'cache', PASS: 'cache' })) {
    const html = await render('components/共通表示/状態バッジ.vue', { state });
    assert.ok(html.includes(`data-state="${state}"`));
    assert.ok(html.includes(`data-tone="${tone}"`));
    assert.ok(html.includes(`aria-label="${state}"`));
    assert.ok(html.includes(`class="badge-label">${state}</span>`));
    assert.doesNotMatch(html, /<svg|<path|badge-icon/);
    assert.equal(html.includes('badge-spinner'), state === '確認中' || state === '取得中');
  }
});

test('untrusted labels are escaped', async () => {
  const escaped = await render('components/共通表示/状態バッジ.vue', { label: '<script>alert(1)</script>' });
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});

test('key list keeps public acquisition and individual test outcomes separate', async () => {
  const html = await render('components/モデル一覧/モデル一覧パネル.vue', {
    data: { 設定状態: '読込済み', 項目: [{ id: 'openai', 名前: 'OpenAI', キー名: 'OPENAI_API_KEY', 設定済み: true, テスト可能: true }] },
    results: { openai: { 状態: 'NG' } }, loading: false, testing: '', connected: true,
    publicModels: { 状態: '取得済', 件数: 12 }, publicBusy: false,
  });
  assert.match(html, /<span class="public-status"[^>]*>公開モデル一覧取得: <span class="badge public-indicator" data-state="OK" data-tone="success"/);
  assert.equal((html.match(/public-indicator/g) || []).length, 1);
  const cached = await render('components/モデル一覧/モデル一覧パネル.vue', { data: { 設定状態: '読込済み', 項目: [] }, results: {}, connected: true, publicModels: { 状態: '取得済', 取得元: 'キャッシュ' } });
  assert.match(cached, /class="badge public-indicator" data-state="キャッシュ利用" data-tone="cache"[^]*?<\/span><button class="public-retry refresh-button"[^>]*>[^]*?<span>再取得<\/span><\/button><\/span>/);
  assert.match(html, /data-state="NG" data-tone="danger"/);
  assert.match(html, />テスト<\/button>/);
  assert.match(html, /<button id="latest-models"[^>]*>一括取得<\/button>/);
  assert.doesNotMatch(html, /設定状況を更新/);
  assert.doesNotMatch(html, /public-retry/);
  assert.match(html, /class="config-state">設定済/);
  assert.match(html, /<details class="test-notes"><summary>テストについて/);
  assert.match(html, /各サービスへモデル一覧を問い合わせます/);
  assert.doesNotMatch(html, /<input|<select|設定ファイル:|12 件/);
});

test('vivid badge palette keeps readable contrast and unconfirmed black', () => {
  const css = source('style.css');
  const luminance = hex => hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const palettes = [...css.matchAll(/--badge-fg:#([0-9a-f]{6});--badge-bg:#([0-9a-f]{6})/g)];
  assert.equal(palettes.length, 6);
  for (const [, fg, bg] of palettes) { const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x); assert.ok((light + .05) / (dark + .05) >= 4.5, `${fg} on ${bg}`); }
  assert.match(css, /\.badge\{--badge-fg:#ffffff;--badge-bg:#111318;[^}]*border:0/);
  for(const [, , bg] of palettes.slice(1))assert.ok((luminance(bg)+.05)/(luminance('121d28')+.05)>=3,`badge on dark panel: ${bg}`);
  assert.doesNotMatch(css, /badge-icon|badge-neutral-dot/);
  assert.doesNotMatch(css, /\.badge::before|\.status::before/);
  // 先頭の著作表示（GitHub URL）だけを除き、外部URLの混入を検査する。
  assert.doesNotMatch(source('components/共通表示/状態バッジ.vue').replace(/^<!-- COPYRIGHT \(C\)[\s\S]*?-->\r?\n/,''), /v-html|innerHTML|https?:/);
});


test('simplified key settings still display public and configuration failures', async () => {
  const html = await render('components/モデル一覧/モデル一覧パネル.vue', {
    data: { 設定状態: '読込不可', 説明: '設定の読込に失敗', 項目: [] }, results: {},
    publicModels: { 状態: '失敗', 説明: '公開一覧への接続に失敗' }, connected: true,
  });
  assert.match(html, /設定ファイル: 読込不可/);
  assert.match(html, /設定の読込に失敗/);
  assert.match(html, /公開一覧への接続に失敗/);
  assert.doesNotMatch(html, /public-retry/);
});
