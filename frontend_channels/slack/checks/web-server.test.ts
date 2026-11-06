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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { パネルWeb起動, ブラウザ用HTML } from '../src/web-server';
import type { パネルサービス } from '../src/接続パネル/パネル中継';

// panel-service の代わりに、要求と通知の中継だけを確認する模擬サービス。
function fakeService() {
  const calls: unknown[][] = [];
  let send: ((data: Record<string, unknown> & { type: string }) => void) | undefined;
  let stopped = 0;
  const factory = ((callback: typeof send) => {
    send = callback;
    return { panel: {}, 要求: async (action: unknown, value: unknown) => { calls.push([action, value]); return action === 'bad' ? { error: '拒否' } : { result: { action, value } }; }, 終了: async () => { stopped++; } };
  }) as unknown as typeof パネルサービス;
  return { factory, calls, emit: (data: Record<string, unknown> & { type: string }) => send!(data), stopped: () => stopped };
}

test('ブラウザ版の画面は Electron 版と同じ index.html に WebSocket 用の橋渡しだけを加える', () => {
  const html = ブラウザ用HTML(readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8'));
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /connect-src 'none'/);
  assert.ok(html.indexOf('web-bridge.js') < html.indexOf('view.js'));
  assert.doesNotMatch(html, /visualizer\.js/, '音声表示を持たない');
  assert.throws(() => ブラウザ用HTML('<html></html>'));
});

test('ブラウザ版サーバー: 許可した接続元の要求だけを中継し、通知を配信して、画面が閉じたら終了する', { timeout: 10000 }, async () => {
  const service = fakeService();
  const codespaces = process.env.CODESPACES;
  delete process.env.CODESPACES; // Codespaces ではポート転送先の URL になるため。
  const app = await パネルWeb起動({ service: service.factory, idleMs: 50 });
  if (codespaces !== undefined) process.env.CODESPACES = codespaces;
  try {
    const origin = new URL(app.url).origin;
    assert.equal(app.publicUrl, app.url, 'Codespaces 以外ではローカルURLを開く');
    assert.equal((await fetch(app.url)).status, 200);
    const style = await fetch(new URL('style.css', app.url));
    assert.equal(style.status, 200);assert.match(await style.text(), /@import "\.\/titlebar\.css"/);
    const palette = await fetch(new URL('titlebar.css', app.url));
    assert.equal(palette.status, 200);assert.match(palette.headers.get('content-type') ?? '', /text\/css/);
    assert.equal(await palette.text(), readFileSync(new URL('../panel/titlebar.css', import.meta.url), 'utf8'));
    assert.equal((await fetch(new URL('/frontend_ide/src/components/共通表示/タイトルバー配色.css', app.url))).status, 404, '原本フォルダの配信を開放しない');
    for (const file of ['AiDiy.png', 'AiDiy_slack.png']) {
      const image = await fetch(new URL(file, app.url));assert.equal(image.status, 200);assert.equal(image.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), readFileSync(new URL('../panel/'+file, import.meta.url)));
    }
    assert.equal((await fetch(new URL('/frontend_ide/host/media/AiDiy.png', app.url))).status, 404);
    assert.equal((await fetch(app.url, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(new URL('/wrong/', app.url))).status, 404);
    assert.equal((await fetch(new URL('../src/接続/接続設定.ts', app.url))).status, 404);

    const wsUrl = new URL('ws', app.url); wsUrl.protocol = 'ws:';
    const rejected = new WebSocket(wsUrl, { origin: 'https://evil.example' });
    await assert.rejects(once(rejected, 'open'));

    const socket = new WebSocket(wsUrl, { origin });
    await once(socket, 'open');
    const next = () => once(socket, 'message').then(([data]) => JSON.parse(String(data)));
    socket.send(JSON.stringify({ id: 1, action: 'select', value: { a: 1 } }));
    assert.deepEqual(await next(), { id: 1, result: { action: 'select', value: { a: 1 } } });
    socket.send(JSON.stringify({ id: 2, action: 'bad' }));
    assert.deepEqual(await next(), { id: 2, error: '拒否' });
    service.emit({ type: 'activity', activity: { who: 'AiDiy', text: 'こんにちは', role: 'ai' } });
    assert.deepEqual(await next(), { type: 'activity', activity: { who: 'AiDiy', text: 'こんにちは', role: 'ai' } });
    socket.send('not json'); socket.send(JSON.stringify({ action: 'start' }));
    socket.send(JSON.stringify({ id: 3, action: 'initial' }));
    assert.equal((await next()).id, 3, 'id のない要求・不正な JSON は無視する');
    assert.deepEqual(service.calls.map(([action]) => action), ['select', 'bad', 'initial']);

    socket.close();
    await app.closed;
    assert.equal(service.stopped(), 1, '画面が閉じたら猶予の後に Bot も終了する');
  } finally { await app.close(); }
});

test('ブラウザ版サーバー: 一度も画面が開かれなければ猶予の後に終了する', { timeout: 10000 }, async () => {
  const service = fakeService();
  const app = await パネルWeb起動({ service: service.factory, firstIdleMs: 30 });
  await app.closed;
  assert.equal(service.stopped(), 1);
});

test('Codespaces は初回画面接続を120秒以上待っても終了しない', async t => {
  const service = fakeService();
  const env = { CODESPACES: 'true', CODESPACE_NAME: 'aidiy-test', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let app;
  try { app = await パネルWeb起動({ service: service.factory }); }
  finally {
    for (const key of Object.keys(env)) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
  try {
    t.mock.timers.tick(120_001);
    t.mock.timers.reset();
    assert.equal(service.stopped(), 0);
    assert.equal((await fetch(app.url)).status, 200);
  } finally { await app.close(); }
  assert.equal(service.stopped(), 1);
});

// ネットワーク待受なしでローカル画像の配布境界を固定する。
test('welcome画像と配色は自moduleのassetsだけを参照する', () => {
 const component=readFileSync(new URL('../panel/components/接続/接続パネル.vue',import.meta.url),'utf8');assert.ok(component.includes('<EscapingMark icon="AiDiy.png" />'));
 const mark=readFileSync(new URL('../panel/components/接続/逃げるマーク.vue',import.meta.url),'utf8');assert.ok(mark.includes(':src="icon"'));assert.doesNotMatch(mark,/frontend_ide\/host\/media/);assert.doesNotMatch(component,/frontend_ide\/host\/media/);
 const server=readFileSync(new URL('../src/web-server.ts',import.meta.url),'utf8');assert.ok(server.includes("'AiDiy.png': 'image/png'"));assert.ok(server.includes("'AiDiy_slack.png': 'image/png'"));assert.doesNotMatch(server,/iconPath|frontend_ide\/host\/media/);
 for(const file of ['scripts/build-panel.mjs','scripts/verify-panel.mjs'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/frontend_ide\/src/);
});
