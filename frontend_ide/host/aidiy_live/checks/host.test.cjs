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
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { LiveHost: RealLiveHost, backendUrl } = require('../../out/aidiy_live/host.cjs');

class LiveHost extends RealLiveHost { constructor(...args) { args[4] = () => ({ Authorization: 'Bearer fixture-token-only' }); args[5] = url => new global.WebSocket(url); super(...args); } }

test('Live ホスト: HTTP/WS中継はUTF-8で20MiBまで、1byte超過は中継しない', async () => {
  const limit = 20 * 1024 * 1024, originalSocket = global.WebSocket, originalFetch = global.fetch;
  const sockets = [], packets = [], requests = [];
  class Socket {
    readyState = 1; bufferedAmount = 0; sent = [];
    constructor() { sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.onclose?.(); }
  }
  global.WebSocket = Socket;
  global.fetch = async (_url, options) => { requests.push(options.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const host = new LiveHost('http://localhost:8091', packet => packets.push(packet), () => assert.fail('マイクは起動しない'), '/unused.py');
  try {
    await host.receive({ type: 'socket-open', id: 1 });
    for (const extra of [0, 1]) {
      const size = limit + extra - Buffer.byteLength(JSON.stringify({ padding: '' }));
      const body = { padding: '日'.repeat(Math.floor(size / 3)) + 'x'.repeat(size % 3) }, data = JSON.stringify(body);
      assert.equal(Buffer.byteLength(data), limit + extra);
      sockets[0].onmessage({ data });
      assert.equal(packets.filter(packet => packet.type === 'socket-data').length, 1);
      if (!extra) assert.equal(packets.at(-1).data, data);
      await host.receive({ type: 'socket-send', id: 1, data });
      assert.equal(sockets[0].sent.length, 1);
      if (extra) assert.equal(packets.at(-1).type, 'socket-send-error');
      else assert.equal(sockets[0].sent[0], data);
      await host.receive({ type: 'api', id: 2, path: 'core/AIコア/モデル情報/取得', body });
      assert.equal(requests.length, 1);
      if (extra) assert.match(packets.at(-1).error, /大きすぎ/);
      else assert.equal(requests[0], data);
    }
  } finally { host.dispose(); global.WebSocket = originalSocket; global.fetch = originalFetch; }
});

test('Live ホスト: 接続先・API 制限、3ソケット、破棄で全接続を閉じる', async () => {
  assert.throws(() => backendUrl('file:///private'));
  assert.throws(() => backendUrl('http://user:password@localhost:8091'));
  assert.throws(() => backendUrl('http://localhost:8091/core'));
  const originalSocket = global.WebSocket, originalFetch = global.fetch;
  const sockets = [], packets = [], requests = [];
  class Socket {
    readyState = 1; bufferedAmount = 0;
    constructor(url) { this.url = url; sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    send(data) { this.sent = data; }
    close() { this.closed = true; this.onclose?.(); }
  }
  global.WebSocket = Socket;
  global.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ status: 'OK', data: { ok: true } }) }; };
  const host = new LiveHost('http://localhost:8091', packet => packets.push(packet), () => 'python', '/microphone.py');
  try {
    await host.receive({ type: 'api', id: 1, path: 'core/auth/ログイン', body: {} });
    assert.equal(requests.length, 0); assert.ok(packets.at(-1).error);
    await host.receive({ type: 'api', id: 2, path: 'core/AIコア/モデル情報/取得', body: { セッションID: 'session' } });
    assert.equal(requests.length, 1); assert.equal(JSON.parse(requests[0].options.body).セッションID, 'session');
    assert.equal(packets.at(-1).value.status, 'OK');
    for (const id of [3, 4, 5, 6]) await host.receive({ type: 'socket-open', id });
    assert.equal(sockets.length, 3); assert.ok(packets.some(packet => packet.type === 'socket-closed' && packet.id === 6));
    assert.equal(decodeURI(sockets[0].url.pathname), '/core/ws/AIコア');
    assert.equal(sockets[0].url.protocol, 'ws:');
    await host.receive({ type: 'socket-send', id: 3, data: 'audio-packet' });
    assert.equal(sockets[0].sent, 'audio-packet');
    sockets[0].onmessage({ data: '{"メッセージ識別":"output_audio"}' });
    assert.equal(packets.at(-1).type, 'socket-data');
    host.dispose(); assert.ok(sockets.every(socket => socket.closed));
    await host.receive({ type: 'socket-open', id: 7 }); assert.equal(sockets.length, 3);
  } finally { host.dispose(); global.WebSocket = originalSocket; global.fetch = originalFetch; }
});

test('Live ホスト: Windows PCM は前処理せず共通 Worklet へ渡し、停止でマイクを閉じる', { skip: process.platform !== 'win32' }, async () => {
  const childProcess = require('node:child_process'), original = childProcess.spawn;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
  child.stdin.once('finish', () => queueMicrotask(() => child.kill()));
  childProcess.spawn = (python, args, options) => { assert.equal(python, 'python-test'); assert.equal(args.at(-1), '/microphone.py'); assert.equal(options.shell, false); return child; };
  const packets = [], host = new LiveHost('http://localhost:8091', packet => packets.push(packet), () => 'python-test', '/microphone.py');
  try {
    await host.receive({ type: 'mic-start', id: 1 });
    const pcm = Buffer.alloc(6144, 19); child.stdout.write(pcm.subarray(0, 100)); child.stdout.write(pcm.subarray(100));
    assert.equal(packets[0].type, 'reply'); assert.equal(packets[0].value.rate, 48000);
    assert.equal(packets[1].type, 'mic-data'); assert.deepEqual(Buffer.from(packets[1].data, 'base64'), pcm);
    await host.receive({ type: 'mic-stop', id: 1 });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(child.exitCode, 0);
    const count = packets.length; child.stdout.write(pcm); assert.equal(packets.length, count);
  } finally { host.dispose(); child.kill(); childProcess.spawn = original; }
});

test('Live ホスト: APIの35秒期限と停止による中断を区別する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = global.fetch, packets = [];
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const host = new LiveHost('http://127.0.0.1:8091', packet => packets.push(packet), () => 'python', '/microphone.py');
  try {
    const timeout = host.receive({ type: 'api', id: 1, path: 'core/AIコア/モデル情報/取得', body: {} });
    t.mock.timers.tick(35000); await timeout;
    assert.match(packets.find(packet => packet.id === 1).error, /応答待ちがタイムアウト.*[\s\S]*35秒/);
    const cancelled = host.receive({ type: 'api', id: 2, path: 'core/AIコア/モデル情報/取得', body: {} });
    host.stop(); await cancelled;
    const message = packets.find(packet => packet.id === 2).error;
    assert.match(message, /要求を中断/);
    assert.doesNotMatch(message, /通信に失敗|タイムアウト|20:/);
  } finally { host.dispose(); global.fetch = originalFetch; t.mock.timers.reset(); }
});

test('Live ホスト添付: 有効ファイルを現session/project/inputへ送り、業務上限・拒否理由を維持する', async () => {
  const original = global.WebSocket, sockets = [], replies = [];
  class Socket {
    readyState = 1; bufferedAmount = 0; sent = [];
    constructor() { sockets.push(this); }
    send(data) { if (this.fail) throw Error('closed'); this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
    emit(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
  }
  global.WebSocket = Socket;
  const host = new LiveHost('http://localhost:8091', packet => replies.push(packet), () => 'python', '/microphone.py');
  const send = (packet, id = 1) => host.receive({ type: 'socket-send', id, data: JSON.stringify(packet) });
  const upload = { メッセージ識別: 'input_file', メッセージ内容: Buffer.alloc(200000, 1).toString('base64'), ファイル名: '画像.png', セッションID: 'session', チャンネル: '0', 出力先チャンネル: '0', プロジェクトパス: '/project' };
  try {
    for (const id of [1, 2]) await host.receive({ type: 'socket-open', id });
    await send({ type: 'connect', ソケット番号: 'input', CODE_BASE_PATH: '/project' });
    sockets[0].emit({ メッセージ識別: 'init', セッションID: 'session' });
    await send(upload); assert.equal(sockets[0].sent.length, 2); assert.deepEqual(JSON.parse(sockets[0].sent.at(-1)), upload);
    for (const patch of [{ セッションID: 'stale' }, { プロジェクトパス: '/other' }, { チャンネル: '1' }, { 出力先チャンネル: '1' }, { ファイル名: '../bad' }, { メッセージ内容: 'not base64' }, { メッセージ内容: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }]) {
      const before = sockets[0].sent.length; await send({ ...upload, ...patch });
      assert.equal(sockets[0].sent.length, before); assert.equal(replies.at(-1).type, 'socket-send-error'); assert.ok(replies.at(-1).error);
    }
    await send(upload, 2); assert.equal(sockets[1].sent.length, 0); assert.equal(replies.at(-1).id, 2);
    await host.receive({ type: 'socket-send', id: 1, data: 'x'.repeat(20 * 1024 * 1024 + 1) }); assert.match(replies.at(-1).error, /上限/);
    await send({ メッセージ識別: 'input_text', メッセージ内容: 'x'.repeat(128000) }); assert.equal(JSON.parse(sockets[0].sent.at(-1)).メッセージ内容.length, 128000, '従来の小さな転送上限を超えて送信できる');
    for (const [key, value] of [['bufferedAmount', 128000], ['readyState', 3], ['fail', true]]) {
      sockets[0][key] = value; const before = sockets[0].sent.length; await send(upload);
      assert.equal(sockets[0].sent.length, before); assert.match(replies.at(-1).error, /送信できません/);
      sockets[0][key] = key === 'readyState' ? 1 : key === 'fail' ? false : 0;
    }
    await send({ メッセージ識別: 'input_text', メッセージ内容: '後続の本文' }); assert.match(sockets[0].sent.at(-1), /後続の本文/);
    await send({ ...upload, メッセージ内容: Buffer.alloc(4 * 1024 * 1024).toString('base64') });
    assert.equal(JSON.parse(sockets[0].sent.at(-1)).メッセージ内容.length, Math.ceil(4 * 1024 * 1024 / 3) * 4, '4 MiB境界は許可');
    await host.receive({ type: 'socket-close', id: 1 }); const count = sockets[0].sent.length; await send(upload);
    assert.equal(sockets[0].sent.length, count); assert.equal(replies.at(-1).type, 'socket-send-error');
  } finally { host.dispose(); global.WebSocket = original; }
});
