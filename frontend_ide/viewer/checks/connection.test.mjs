// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createCoreConnection, coreTarget } from '../core-connection.mjs';
import { toolsTarget } from '../../ファイル機能/ai-search.mjs';
import { startServer } from '../server.mjs';

const project = fileURLToPath(new URL('../web/', import.meta.url));
const valid = { status: 'ok', name: 'aidiy_code_agents' };

test('IDEはConsoleと同じtools接続先を確認し、子パネルにはcore接続先を保持する', async t => {
  const expected = new URL('ping', await toolsTarget(project)).href;
  let calls = 0;
  const connection = createCoreConnection(project, { fetcher: async (url, options) => {
    calls++;
    assert.equal(url.href, expected);
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.body, undefined);
    return { ok: true, json: async () => valid };
  } });
  t.after(() => connection.close());
  assert.equal((await connection.connect()).connected, true);
  assert.equal(calls, 1);
  assert.equal(connection.state().backend, coreTarget(fileURLToPath(new URL('../', import.meta.url)), project));
});

test('toolsの応答待ちをタイムアウトで終了し、初回失敗では利用を開始しない', async t => {
  const connection = createCoreConnection(project, { target: 'http://127.0.0.1:8095', timeout: 20,
    fetcher: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  });
  t.after(() => connection.close());
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const state = await connection.connect();
  assert.equal(state.active, false);
  assert.equal(state.connected, false);
  assert.equal(state.wanted, false);
  assert.match(state.message, /tools.*タイムアウト/);
});

test('10秒間隔の稼働確認中は接続済みを維持し、失敗後の再接続だけ接続中にする', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, release;
  const connection = createCoreConnection(project, {
    target: 'http://127.0.0.1:8095',
    fetcher: () => { calls++; return new Promise(done => { release = done; }); },
  });
  t.after(() => connection.close());
  const first = connection.connect();
  assert.equal(connection.state().connecting, true);
  release({ ok: true, json: async () => valid });
  await first;
  const startedAt = connection.state().startedAt;
  t.mock.timers.tick(9999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
  assert.equal(connection.state().connected, true);
  assert.equal(connection.state().connecting, false);
  assert.equal(connection.state().startedAt, startedAt);
  const checked = connection.check();
  t.mock.timers.tick(10000);
  assert.equal(calls, 2); // 確認中は次の確認を重ねない。
  release({ ok: false, status: 503 });
  await checked;
  assert.equal(connection.state().connected, false);
  assert.equal(connection.state().connecting, false);
  assert.equal(connection.state().active, true);
  t.mock.timers.tick(10000);
  assert.equal(calls, 3);
  assert.equal(connection.state().connecting, true);
  const recovered = connection.check();
  release({ ok: true, json: async () => valid });
  await recovered;
  assert.equal(connection.state().connected, true);
  assert.equal(connection.state().connecting, false);
  assert.equal(connection.state().startedAt, startedAt);
});

test('手動開始後はtools停止でも作業を維持し、復帰時に同じセッションで再接続する', async () => {
  let healthy = true, calls = 0;
  const backend = createServer((req, res) => {
    calls++;
    assert.equal(decodeURI(req.url), '/aidiy_code_agents/ping');
    assert.equal(req.method, 'GET');
    req.resume(); res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(healthy ? valid : { status: 'NG' }));
  });
  await new Promise(done => backend.listen(0, '127.0.0.1', done));
  const connection = createCoreConnection(project, { target: `http://127.0.0.1:${backend.address().port}` });
  const app = await startServer(project, 0, { connection });
  const get = path => fetch(app.url + path);
  const post = path => fetch(app.url + 'api/connection/' + path, { method: 'POST' });
  try {
    assert.equal(calls, 0); // 起動だけでは接続を作らない
    assert.equal((await get('api/connection').then(r => r.json())).connected, false);
    for (const path of ['api/galaxy', 'api/file?path=layout.js', 'api/raw?path=a.png', 'api/document?path=a.pdf']) assert.equal((await get(path)).status, 503);
    assert.equal((await get('office.js')).status, 200);
    assert.equal((await get('licenses.html')).status, 200);
    assert.equal((await post('connect').then(r => r.json())).connected, true);
    assert.equal((await get('api/galaxy')).status, 200);
    assert.equal((await get('api/file?path=layout.js')).status, 200);
    const startedAt = connection.state().startedAt;
    healthy = false;
    await connection.check();
    assert.equal(connection.state().connected, false);
    assert.equal((await get('api/file?path=layout.js')).status, 200);
    assert.equal(connection.state().mode, 'online');
    assert.equal(connection.state().wanted, true);
    assert.equal(connection.state().active, true);
    assert.equal(connection.state().startedAt, startedAt);
    healthy = true;
    const failedCalls = calls;
    await connection.check();
    assert.ok(calls > failedCalls);
    assert.equal(connection.state().active, true);
    assert.equal(connection.state().connected, true);
    assert.equal(connection.state().startedAt, startedAt);
    assert.equal((await post('connect').then(r => r.json())).connected, true);
    assert.equal((await post('disconnect').then(r => r.json())).connected, false);
    const previous = calls;
    await connection.check();
    assert.equal(calls, previous); // 明示切断後は自動接続しない
    assert.equal((await get('api/galaxy')).status, 503);
    healthy = false;
    const offline = await post('offline').then(r => r.json());
    assert.equal(offline.mode, 'offline');
    assert.equal(offline.active, true);
    assert.equal(offline.connected, false);
    await connection.check();
    assert.equal(calls, previous); // オフラインではtoolsを呼ばない
    assert.equal((await get('api/galaxy')).status, 200);
    assert.equal((await get('api/file?path=layout.js')).status, 200);
    assert.equal((await get('api/connection/offline')).status, 405);
    await post('disconnect');
    assert.equal((await get('api/galaxy')).status, 503);
  } finally {
    app.server.closeAllConnections(); backend.closeAllConnections();
    await Promise.all([new Promise(done => app.server.close(done)), new Promise(done => backend.close(done))]);
  }
});

test('接続処理中に切断した場合、遅れて届いた成功で再接続しない', async () => {
  let release;
  const connection = createCoreConnection(project, { target: 'http://127.0.0.1:8095', fetcher: () => new Promise(done => { release = done; }) });
  const pending = connection.connect();
  connection.disconnect();
  release({ ok: true, json: async () => valid });
  await pending;
  assert.equal(connection.state().connected, false);
  assert.equal(connection.state().wanted, false);
  connection.close();
});

test('AiDiy の応答形式でないサーバーをオンラインと表示しない', async () => {
  const connection = createCoreConnection(project, { target: 'http://127.0.0.1:8095', fetcher: async () => ({ ok: true, json: async () => ({ status: 'OK' }) }) });
  try { const state=await connection.connect();assert.equal(state.connected, false);assert.equal(state.active,false);assert.equal(state.wanted,false);assert.equal(state.startedAt,null); }
  finally { connection.close(); }
});

test('接続確認中のオフライン切り替えを遅い応答で上書きしない', async () => {
  let release;
  const connection = createCoreConnection(project, { target: 'http://127.0.0.1:8095', fetcher: () => new Promise(done => { release = done; }) });
  try {
    const pending = connection.connect();
    connection.offline();
    release({ ok: true, json: async () => valid });
    await pending;
    assert.equal(connection.state().mode, 'offline');
    assert.equal(connection.state().active, true);
    assert.equal(connection.state().connected, false);
    assert.equal(connection.state().connecting, false);
  } finally { connection.close(); }
});

test('起動の起点は接続成立時刻で、稼働確認では変わらず次回利用で更新する', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const connection = createCoreConnection(project, { target: 'http://127.0.0.1:8095', fetcher: async () => ({ ok: true, json: async () => valid }) });
  try {
    assert.equal(connection.state().startedAt, null);
    now = 2000;
    assert.equal((await connection.connect()).startedAt, 2000);
    now = 3000;
    assert.equal((await connection.check()).startedAt, 2000);
    assert.equal(connection.disconnect().startedAt, null);
    now = 4000;
    assert.equal(connection.offline().startedAt, 4000);
    now = 5000;
    assert.equal((await connection.check()).startedAt, 4000);
    assert.equal((await connection.connect()).startedAt, 5000);
  } finally { connection.close(); }
});
