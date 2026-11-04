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
const { resolve } = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const { core } = require('./fake-core.cjs');
function load(relative) {
  const source = resolve(__dirname, relative), loaded = new Module(source, module);
  loaded.filename = source; loaded.paths = module.paths;
  loaded._compile(buildSync({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22' }).outputFiles[0].text, source);
  return loaded.exports;
}
const { CodeConnection } = load('../src/code-connection.ts');
const { LiveHost } = load('../aidiy_live/src/host.ts');
const backend = 'http://127.0.0.1:18091';
const tokenA = 'fixture.secret.transport-A', tokenB = 'fixture.secret.transport-B';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function noSecrets(value) {
  const text = JSON.stringify(value);
  for (const token of [tokenA, tokenB]) assert.ok(!text.includes(token), 'tokenを画面・packet・URLへ含めない');
}
function cleanSocketUrl(value) {
  const url = new URL(value);
  assert.equal(decodeURI(url.pathname), '/core/ws/AIコア');
  assert.equal(url.search, ''); assert.equal(url.hash, ''); assert.equal(url.username, '');
  noSecrets(value);
}

test('内部認証Code: 全REST/WSで最新Bearerを付与しURL・packet・画面へ漏らさない', async () => {
  const fake = core(), requests = [], sockets = [], packets = [], states = [];
  let current = tokenA, reads = 0;
  const client = new CodeConnection(backend, value => packets.push(value), () => states.push({ connected: client.connected, error: client.error }),
    (url, headers) => { sockets.push({ url, headers }); return new fake.Socket(url); },
    (url, options) => { requests.push({ url: String(url), ...options }); return fake.request(url, options); },
    () => { reads++; return { Authorization: `Bearer ${current}` }; });
  try {
    client.start('/fixture-project', { provider: '', model: '' }); await flush();
    assert.equal(client.connected, true); assert.equal(sockets.length, 2);
    assert.ok(sockets.every(({ headers }) => headers.Authorization === `Bearer ${tokenA}`));
    assert.ok(requests.every(({ headers, redirect }) => headers.Authorization === `Bearer ${tokenA}` && redirect === 'error'));
    current = tokenB;
    await client.catalog();
    assert.equal(requests.at(-1).headers.Authorization, `Bearer ${tokenB}`);
    client.disconnect(); client.start('/fixture-project', { provider: '', model: '' }); await flush();
    assert.equal(client.connected, true);
    assert.ok(sockets.slice(2).every(({ headers }) => headers.Authorization === `Bearer ${tokenB}`));
    assert.equal(reads, sockets.length + requests.length, '要求ごとにproviderを読み直す');
    for (const { url } of sockets) cleanSocketUrl(url);
    noSecrets({ packets, states, sent: fake.sockets.map(socket => socket.sent), bodies: requests.map(request => request.body) });
  } finally { client.dispose(); }
});

test('内部認証Code: 読込失敗はREST/WSの実行前に止める', async () => {
  let requests = 0, sockets = 0;
  const client = new CodeConnection(backend, () => {}, () => {},
    () => { sockets++; throw new Error('must not connect'); },
    async () => { requests++; throw new Error('must not fetch'); },
    () => { throw new Error('内部認証を利用できません。'); });
  try {
    await assert.rejects(client.catalog(), /内部認証/);
    client.start('/fixture-project', { provider: '', model: '' }); await flush();
    assert.equal(client.connected, false); assert.match(client.error, /内部認証/);
    assert.equal(sockets, 0); assert.equal(requests, 0);
  } finally { client.dispose(); }
});

test('内部認証Live: REST/WSで更新Bearerを使い、rendererへは値を返さない', async t => {
  let current = tokenA, reads = 0;
  const requests = [], sockets = [], packets = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url: String(url), ...options });
    return { ok: true, json: async () => ({ status: 'OK', data: {} }) };
  });
  const host = new LiveHost(backend, packet => packets.push(packet), () => assert.fail('マイクは起動しない'), '/fixture-mic.py',
    () => { reads++; return { Authorization: `Bearer ${current}` }; },
    (url, headers) => {
      const socket = { url, headers, readyState: 1, bufferedAmount: 0, sent: [], send(data) { this.sent.push(data); }, close() { this.onclose?.(); } };
      sockets.push(socket); return socket;
    });
  try {
    await host.receive({ type: 'api', id: 1, path: 'core/AIコア/モデル情報/取得', body: { セッションID: '' } });
    await host.receive({ type: 'socket-open', id: 2 }); sockets[0].onopen();
    current = tokenB;
    await host.receive({ type: 'api', id: 3, path: 'core/AIコア/モデル情報/取得', body: { セッションID: '' } });
    await host.receive({ type: 'socket-open', id: 4 }); sockets[1].onopen();
    for (const [i, token] of [tokenA, tokenB].entries()) {
      assert.equal(requests[i].headers.Authorization, `Bearer ${token}`);
      assert.equal(requests[i].redirect, 'error');
      assert.equal(sockets[i].headers.Authorization, `Bearer ${token}`);
      cleanSocketUrl(sockets[i].url);
    }
    await host.receive({ type: 'socket-send', id: 2, data: JSON.stringify({ type: 'connect', ソケット番号: '0' }) });
    assert.equal(reads, 4);
    noSecrets({ packets, bodies: requests.map(request => request.body), sent: sockets.map(socket => socket.sent) });
  } finally { host.dispose(); }
});

test('内部認証Live: 読込失敗時は上流要求せず安全な失敗だけ通知', async t => {
  const packets = []; let requests = 0, sockets = 0;
  t.mock.method(global, 'fetch', async () => { requests++; throw new Error('must not fetch'); });
  const host = new LiveHost(backend, packet => packets.push(packet), () => assert.fail(), '/fixture-mic.py',
    () => { throw new Error('内部認証を利用できません。'); }, () => { sockets++; throw new Error('must not connect'); });
  try {
    await host.receive({ type: 'socket-open', id: 1 });
    await host.receive({ type: 'api', id: 2, path: 'core/AIコア/モデル情報/取得', body: {} });
    assert.equal(requests, 0); assert.equal(sockets, 0);
    assert.deepEqual(packets.slice(0, 2), [{ type: 'socket-error', id: 1 }, { type: 'socket-closed', id: 1 }]);
    assert.match(packets.at(-1).error, /内部認証/); noSecrets(packets);
  } finally { host.dispose(); }
});

test('内部認証Code: Core再起動で旧token拒否・ファイル更新待ちを経て再読込し同じ会話へ復帰', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = core(), attempts = [], packets = [];
  // 有効期限内でもCoreの再起動で旧tokenは失効しうる。起動時snapshotを保持しない。
  const tokenFile = { access_token: tokenA, expires_at: Date.now() + 25 * 3600000 };
  let restarted = false, fileUnavailable = false, reads = 0;
  const client = new CodeConnection(backend, packet => packets.push(packet), () => {}, (url, headers) => {
    attempts.push(headers.Authorization);
    if (restarted && headers.Authorization === `Bearer ${tokenA}`) {
      const rejected = { readyState: 0, bufferedAmount: 0, send() { assert.fail('拒否socketは送信しない'); }, close() { this.readyState = 3; } };
      queueMicrotask(() => { if (rejected.readyState !== 3) rejected.onerror?.({}); });
      return rejected;
    }
    return new fake.Socket(url);
  }, fake.request, () => {
    reads++;
    if (fileUnavailable) throw new Error('内部認証を利用できません。');
    assert.ok(tokenFile.expires_at > Date.now());
    return { Authorization: `Bearer ${tokenFile.access_token}` };
  });
  try {
    client.start('/fixture-project', { provider: '', model: '' }); await flush();
    assert.equal(client.connected, true);
    const session = client.session;
    client.send({ メッセージ識別: 'input_text', メッセージ内容: '一度だけの依頼' }); await flush();
    const promptCount = () => fake.sockets.flatMap(socket => socket.sent).filter(packet => packet.メッセージ識別 === 'input_text').length;
    assert.equal(promptCount(), 1);
    restarted = true; fake.sockets[1].close();
    assert.equal(client.connected, false);
    t.mock.timers.tick(10000); await flush();
    assert.equal(attempts.at(-1), `Bearer ${tokenA}`, '期限前の旧tokenも拒否された');
    assert.equal(client.connected, false);
    const rejectedAttempts = attempts.length, readsBeforeGap = reads;
    fileUnavailable = true;
    t.mock.timers.tick(10000); await flush();
    assert.equal(reads, readsBeforeGap + 1, 'ファイル更新待ちでも各retryでproviderを呼ぶ');
    assert.equal(attempts.length, rejectedAttempts, '読込できない間は無認証接続を行わない');
    assert.equal(client.connected, false);
    fileUnavailable = false; tokenFile.access_token = tokenB;
    t.mock.timers.tick(10000); await flush();
    assert.equal(client.connected, true);
    assert.equal(client.session, session);
    assert.deepEqual(attempts.slice(-2), [`Bearer ${tokenB}`, `Bearer ${tokenB}`]);
    assert.equal(promptCount(), 1, '復帰時に依頼を再送しない');
    assert.equal(packets.filter(packet => packet.メッセージ識別 === 'output_text').length, 1, '履歴の再受信でも回答を重複表示しない');
    client.disconnect();
    const disconnectedReads = reads;
    t.mock.timers.tick(30000); await flush();
    assert.equal(reads, disconnectedReads, '明示切断でretryを止める');
    client.start('/fixture-project', { provider: '', model: '' }, session); await flush();
    fake.sockets.at(-1).close();
    client.dispose();
    const disposedReads = reads;
    t.mock.timers.tick(30000); await flush();
    assert.equal(reads, disposedReads, '破棄で保留retryを止める');
  } finally { client.dispose(); t.mock.timers.reset(); }
});
