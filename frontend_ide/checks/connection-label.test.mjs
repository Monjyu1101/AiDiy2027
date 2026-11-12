// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { parse, compileTemplate } = require('@vue/compiler-sfc');
const { transformSync } = require('esbuild');
const { createSSRApp } = require('vue');
const { renderToString } = require('@vue/server-renderer');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('共通状態バーは未接続・接続中・接続済・再接続で正しいラベルを描画する', async () => {
  const { descriptor } = parse(read('../src/components/共通表示/状態バー.vue'));
  const compiled = compileTemplate({ source: descriptor.template.content, filename: '状態バー.vue', id: 'connection-label' });
  assert.deepEqual(compiled.errors, []);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(compiled.code, { format: 'cjs' }).code, { module, exports: module.exports, require });
  for (const [props, label] of [
    [{ connected: false }, '未接続'],
    [{ connected: false, busy: true }, '接続中'],
    [{ connected: true }, '接続済'],
    [{ connected: false }, '未接続'],
    [{ connected: true }, '接続済'],
    [{ connected: true, status: 'Task / Team :8093 接続済' }, 'Task / Team :8093 接続済'],
  ]) {
    const app = createSSRApp({ data: () => ({ title: '', status: '', mode: 'online', connected: false, busy: false, active: false, desktop: false, pulseStyle: {}, windowApi: {}, windowContext: {}, allowAll: false, allDisplays: false, allBusy: false, hideClose: false, pinTitle: '', ...props }), render: module.exports.render });
    app.component('WindowActions', { render: () => null });
    const html = await renderToString(app);
    assert.ok(html.includes(`${label}<!--`), html);
    assert.doesNotMatch(html, /接続済み/);
  }
});

test('独自接続表示も接続済に統一し、内部識別子は維持する', () => {
  for (const path of [
    '../src/components/タスクチーム/タスクチームパネル.vue',
    '../../backend_diag/ui/src/App.vue',
    '../../frontend_channels/discord/panel/components/接続/パネル状態.js',
    '../../frontend_channels/slack/panel/components/接続/パネル状態.js',
  ]) {
    const source = read(path);
    assert.match(source, /'接続済'/);
    assert.doesNotMatch(source, /'接続済み'/);
  }
  assert.match(read('../../backend_diag/ui/src/components/導入状況/導入状況パネル.vue'), /'接続済み'/);
});
