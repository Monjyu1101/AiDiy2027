// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
// frontend_web の開発サーバーで実行。業務APIはすべて配車1件の試験応答を使う。
// Chromeとplaywright-coreを使う。外部ランタイムを使うときはそのnode_modulesを
// AIDIY_DOCUMENT_NODE_MODULESに指定し、node frontend_web/checks/配車編集読込.mjs を実行する。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const runtime = process.env.AIDIY_DOCUMENT_NODE_MODULES;
const { chromium } = require(runtime ? join(runtime, 'playwright-core') : 'playwright-core');
const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.env.CHROME_PATH,
  headless: true,
});
const origin = process.env.AIDIY_WEB_TEST_URL || 'http://127.0.0.1:8090';
const user = { 利用者ID: 'guide', 利用者名: '配車試験', 権限ID: '1' };
const row = { 配車伝票ID: 'HS-DEMO', 配車内容: '変更前', 車両ID: 'VAN', 配車区分ID: 'MOVE',
  配車開始日時: '2026-11-28T08:00', 配車終了日時: '2026-11-28T09:00', 有効: true };

try {
  const page = await browser.newPage();
  const warnings = [];
  page.on('console', message => {
    if (/Suspense.*single root|navigation guards is deprecated/.test(message.text())) warnings.push(message.text());
  });
  let allowResponse;
  const waiting = new Promise(resolve => { allowResponse = resolve; });
  await page.route(url => url.origin === origin && /^\/(core|apps)\//.test(url.pathname), async route => {
    const path = decodeURI(new URL(route.request().url()).pathname);
    let data = {};
    if (path.endsWith('/現在利用者')) data = user;
    if (path.endsWith('/トークン更新')) data = { access_token: 'training-only' };
    if (path.endsWith('/M車両/一覧')) data = { items: [{ 車両ID: 'VAN', 車両名: '試験車' }] };
    if (path.endsWith('/M配車区分/一覧')) data = { items: [{ 配車区分ID: 'MOVE', 配車区分名: '搬入' }] };
    if (path.endsWith('/T配車/取得')) {
      await waiting;
      data = row;
    }
    await route.fulfill({ json: { status: 'OK', message: '', data } });
  });
  const query = new URLSearchParams({ モード: '編集', 配車伝票ID: row.配車伝票ID });
  const url = origin + '/Tトラン/T配車/編集?' + query;
  await page.goto(url);
  await page.locator('input[type=password]').waitFor();
  assert.equal(decodeURI(new URL(page.url()).pathname), '/ログイン');
  await page.addInitScript(({ origin, user }) => {
    if (location.origin !== origin) return;
    localStorage.setItem('token', 'training-only');
    localStorage.setItem('user', JSON.stringify(user));
  }, { origin, user });
  const requested = page.waitForRequest(req => decodeURI(new URL(req.url()).pathname) === '/apps/T配車/取得', { timeout: 12000 });
  await page.goto(url);
  await requested;
  const content = page.locator('textarea').first();
  try {
    assert.equal(await content.isVisible() && await content.isEditable(), false, '伝票を読む間は入力できない');
  } finally {
    allowResponse();
  }
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '変更前');
  await content.fill('読み込み後に入力');
  assert.equal(await content.inputValue(), '読み込み後に入力');
  assert.deepEqual(warnings, []);
  console.log('配車の読込完了後に編集できることを確認');
} finally {
  await browser.close();
}
