/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { 接続元許可, 転送オリジン } = require('../out/forwarded-origin.cjs');

const codespace = { CODESPACES: 'true', CODESPACE_NAME: 'aidiy-test', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };

test('ブラウザ版の起動判断: Codespaces と画面のない Linux だけ自動でブラウザ版にする', async () => {
  const { ブラウザ自動判定 } = await import(pathToFileURL(join(__dirname, '../scripts/launch-project.mjs')).href);
  assert.equal(ブラウザ自動判定({ CODESPACES: 'true' }, 'win32'), true);
  assert.equal(ブラウザ自動判定({}, 'linux'), true);
  assert.equal(ブラウザ自動判定({ DISPLAY: ':0' }, 'linux'), false);
  assert.equal(ブラウザ自動判定({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
  assert.equal(ブラウザ自動判定({}, 'win32'), false);
  assert.equal(ブラウザ自動判定({}, 'darwin'), false);
});

test('接続元の許可: 通常は 127.0.0.1 だけ、Codespaces ではポート転送先も許可する', () => {
  const local = new 接続元許可(8123, {});
  assert.equal(local.初回待機時間, 120_000);
  assert.equal(local.公開URL('/t/'), 'http://127.0.0.1:8123/t/');
  assert.ok(local.host('127.0.0.1:8123') && local.origin('http://127.0.0.1:8123'));
  for (const value of ['localhost:8123', 'aidiy-test-8123.app.github.dev', 'evil.example']) assert.equal(local.host(value), false);
  assert.equal(local.origin('https://aidiy-test-8123.app.github.dev'), false);
  assert.equal(local.origin(undefined), false);

  const forwarded = new 接続元許可(8123, codespace);
  assert.equal(forwarded.初回待機時間, undefined);
  assert.equal(forwarded.公開URL('/t/'), 'https://aidiy-test-8123.app.github.dev/t/');
  for (const origin of ['http://127.0.0.1:8123', 'https://aidiy-test-8123.app.github.dev', 'http://localhost:8123']) assert.ok(forwarded.origin(origin), origin);
  for (const origin of ['https://aidiy-test-9999.app.github.dev', 'https://evil.example', 'http://aidiy-test-8123.app.github.dev']) assert.equal(forwarded.origin(origin), false, origin);
  // 必要な変数が欠けている・不正な文字を含む場合は転送先を許可しない。
  assert.equal(転送オリジン(8123, { ...codespace, CODESPACE_NAME: '' }), undefined);
  assert.equal(転送オリジン(8123, { ...codespace, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'evil.example/x' }), undefined);
});

test('Code ブラウザ版: Codespaces は初回接続まで終了せず、転送元からの操作だけを受け付ける', async t => {
  const saved = { ...process.env };
  Object.assign(process.env, codespace);
  const preferences = mkdtempSync(join(tmpdir(), 'aidiy-browser-mode-'));
  const { 単独起動 } = require('../out/aidiy_code/server.cjs');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = await 単独起動(process.cwd(), undefined, {}, join(preferences, 'model.json'));
  try {
    t.mock.timers.tick(120_001);
    t.mock.timers.reset();
    const port = new URL(app.url).port, path = new URL(app.url).pathname;
    assert.equal(app.publicUrl, `https://aidiy-test-${port}.app.github.dev${path}`);
    const get = headers => fetch(app.url, { headers }).then(response => response.status);
    // fetch は Host を変更できないため、Origin で転送元の許可・拒否を確認する。
    // 画面は frontend_ide の Vue 画面が返すため、許可した転送元でもルートは API の 404 になる。
    assert.equal(await get({ origin: `https://aidiy-test-${port}.app.github.dev` }), 404);
    assert.equal(await get({ origin: 'https://evil.example' }), 403);
  } finally {
    await app.close();
    for (const key of Object.keys(codespace)) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
    rmSync(preferences, { recursive: true, force: true });
  }
});

// 転送 URL を直に開かず、VS Code のブラウザヘルパーへ元の URL を渡す。
test('Codespaces のブラウザヘルパーへ localhost のポート・トークン付きパスを渡す', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidiy-opener-'));
  const log = join(dir, 'opened.json'), browser = join(dir, 'browser');
  writeFileSync(browser, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(browser, 0o755);
  const overrides = { ...codespace, BROWSER: browser }, saved = { ...process.env };
  Object.assign(process.env, overrides);
  const output = [], originalLog = console.log;
  console.log = text => output.push(text);
  try {
    const { ブラウザ版表示 } = await import(pathToFileURL(join(__dirname, '../scripts/launch-project.mjs')).href);
    const publicUrl = 'https://aidiy-test-8123.app.github.dev/token/?view=live#chat';
    assert.equal(await ブラウザ版表示(publicUrl), true);
    const deadline = Date.now() + 2000;
    while (!existsSync(log) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), ['http://127.0.0.1:8123/token/?view=live#chat']);
    assert.ok(output.some(line => line.includes(publicUrl)), '手動で開くための外部 URL は案内する');
  } finally {
    console.log = originalLog;
    for (const key of Object.keys(overrides)) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
