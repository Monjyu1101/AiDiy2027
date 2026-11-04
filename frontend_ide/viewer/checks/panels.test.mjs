// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { createPanels } from '../panels.mjs';
import { startServer } from '../server.mjs';
import { createCoreConnection } from '../core-connection.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));

test('パネルは手動で遅延起動し、オフラインでLiveを拒否し、利用終了で破棄する', async () => {
  let state = { active: false }, starts = [], stops = [];
  const panels = createPanels('.', () => state, async (kind, project, snapshot) => {
    starts.push([kind, snapshot.mode]);
    return { url: `http://127.0.0.1:12345/${kind}/`, close: async () => { stops.push(kind); } };
  });
  try {
    await assert.rejects(panels.open('code'));
    state = { active: true, mode: 'offline', startedAt: 1 };
    await assert.rejects(panels.open('live'));
    const [a, b] = await Promise.all([panels.open('code'), panels.open('code')]);
    assert.equal(a, b); assert.deepEqual(starts, [['code', 'offline']]);
    state = { active: false }; panels.sync();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(stops, ['code']);
    state = { active: true, mode: 'online', startedAt: 2 };
    await panels.open('live'); assert.deepEqual(starts.at(-1), ['live', 'online']);
  } finally { await panels.close(); }
  assert.deepEqual(stops, ['code', 'live']);
});

test('終了と競合した起動結果を破棄する', async () => {
  let state = { active: true, mode: 'offline', startedAt: 1 }, release, closed = 0;
  const panels = createPanels('.', () => state, () => new Promise(done => { release = done; }));
  const pending = panels.open('code');
  state = { active: false }; panels.sync();
  release({ url: 'http://127.0.0.1:12345/token/', close: async () => { closed++; } });
  await assert.rejects(pending); await panels.close(); assert.equal(closed, 1);
});

test('IDEの同一公開元から実Codeのオフライン画面・SSEを使い、モード変更を拒否する', async () => {
  let calls = 0;
  const core = createServer((req, res) => { calls++; req.resume(); res.writeHead(503).end(); });
  await listen(core);
  const connection = createCoreConnection(process.cwd(), { target: `http://127.0.0.1:${core.address().port}` });
  const app = await startServer(process.cwd(), 0, { connection });
  let reader;
  try {
    assert.equal((await fetch(app.url + 'api/panels/code', { method: 'POST' })).status, 503);
    connection.offline();
    const result = await fetch(app.url + 'api/panels/code', { method: 'POST' }).then(r => r.json());
    const base = new URL(result.url, app.url).href;
    // Code サーバーは API だけを返す（画面は IDE の Vue 画面）。同一公開元の中継で API を使える。
    const catalog = await fetch(base + 'catalog');
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json()).providers.map(item => item.id), ['aidiy_hermes']);
    const events = await fetch(base + 'events'); reader = events.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /"実行モード":"offline"/);
    for (const type of ['autoConnect', 'executionMode', 'connect']) {
      const response = await fetch(base + 'message', { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(app.url).origin }, body: JSON.stringify({ メッセージ識別: type, enabled: true, mode: 'online' }) });
      assert.equal(response.status, 409);
    }
    assert.equal((await fetch(app.url + 'api/panels/live', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base, { headers: { origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal(calls, 0);
    await reader.cancel(); reader = null;
    connection.disconnect();
    assert.equal((await fetch(base)).status, 403);
  } finally {
    await reader?.cancel(); connection.close(); app.server.closeAllConnections();
    await new Promise(done => app.server.close(done));
    core.closeAllConnections(); await new Promise(done => core.close(done));
  }
});

test('Liveの設定とWebSocketをIDEの公開元で中継し、切断するとソケットを閉じる', async () => {
  const sockets = new Set();
  const core = createServer((req, res) => {
    req.resume(); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/aidiy_code_agents/ping' ? { status: 'ok', name: 'aidiy_code_agents' } : { status: 'OK', data: { available_models: {}, モデル設定: {} } }));
  });
  core.on('upgrade', (req, socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.from([0x81, 2, 79, 75])); // 本物のAIへ送らずテスト用応答を返す。
  });
  await listen(core);
  const connection = createCoreConnection(process.cwd(), { target: `http://127.0.0.1:${core.address().port}` });
  // 試験用Coreの動的ポートへだけ固定トークンを渡す。実Coreの認証・設定は変更しない。
  const { ライブ起動 } = require('../../host/dist/aidiy_live/server.cjs');
  const app = await startServer(process.cwd(), 0, { connection,
    panelsFactory: (root, state) => createPanels(root, state, async (kind, project, snapshot) => {
      assert.equal(kind, 'live');
      return ライブ起動(fileURLToPath(new URL('../../host/', import.meta.url)), snapshot.backend,
        false, project, {}, undefined, false, () => ({ Authorization: 'Bearer fixture-token-only' }));
    }),
  });
  let client;
  try {
    await connection.connect();
    const { url } = await fetch(app.url + 'api/panels/live', { method: 'POST' }).then(r => r.json());
    const base = new URL(url, app.url);
    const page = await fetch(base); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal((await fetch(new URL('config', base)).then(r => r.json())).自動接続, false);
    const text = await new Promise((done, reject) => {
      const req = request(new URL('socket', base), { headers: { origin: base.origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
      req.on('error', reject);
      req.on('upgrade', (res, socket, head) => {
        client = socket; socket.on('error', () => {});
        if (head.length) done(head.subarray(2).toString());
        else socket.once('data', bytes => done(bytes.subarray(2).toString()));
      });
      req.end();
    });
    assert.equal(text, 'OK');
    const closed = new Promise(done => client.once('close', done));
    connection.disconnect(); await closed;
    assert.equal((await fetch(base)).status, 403);
  } finally {
    client?.destroy(); connection.close(); app.server.closeAllConnections(); await new Promise(done => app.server.close(done));
    for (const socket of sockets) socket.destroy(); core.closeAllConnections(); await new Promise(done => core.close(done));
  }
});
