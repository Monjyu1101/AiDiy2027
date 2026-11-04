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

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { connect } = require('node:net');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { readFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { runInNewContext } = require('node:vm');
const { spawn } = require('node:child_process');
const { ライブ起動: realStart } = require('../../dist/aidiy_live/server.cjs');
const start = (...args) => { args[7] = () => ({ Authorization: 'Bearer fixture-token-only' }); return realStart(...args); };
const preferences = mkdtempSync(join(tmpdir(), 'aidiy-live-model-'));
after(() => rmSync(preferences, { recursive: true, force: true }));
let fileNumber = 0;
const ライブ起動 = (root, backend, packaged, project, model, file = join(preferences, `${++fileNumber}.json`)) => start(root, backend, packaged, project, model, file);
const { LiveConnection, 入力レート, 音声入力, 音声操作 } = require('../../out/aidiy_live/protocol.cjs');
const { LiveAudio } = require('../../out/aidiy_live/audio.cjs');
const root = join(__dirname, '../..');

test('Live 中継: 自動接続指定を画面設定へ渡し、通常起動は手動接続', async t => {
  for (const automatic of [false, true]) {
    const live = await start(root, undefined, false, process.cwd(), {}, join(preferences, `${++fileNumber}.json`), automatic);
    try {
      const config = await (await fetch(new URL('config', live.url))).json();
      assert.equal(config.自動接続, automatic);
    } finally { await live.close(); }
  }
});

test('Live: 手動選択のモデル・音声を保存し、再起動時に復元、明示指定や不正要求では上書きしない', async t => {
  const file = join(preferences, 'remember.json');
  const selected = { LIVE_AI_NAME: 'openai_live', LIVE_OPENAI_MODEL: 'gpt-realtime-2.1-mini', LIVE_OPENAI_VOICE: 'marin' };
  let live = await ライブ起動(root, undefined, false, process.cwd(), {}, file);
  const save = (body, origin = new URL(live.url).origin) => fetch(new URL('model', live.url), {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await save(selected, 'https://example.com')).status, 403);
    assert.equal((await save(selected)).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), selected);
    for (const body of [{ ...selected, openai_key_id: 'secret' }, { LIVE_AI_NAME: 'unknown' }, { ...selected, LIVE_OPENAI_MODEL: '' }]) {
      assert.equal((await save(body)).status, 400);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), selected);
    }
  } finally { await live.close(); }
  for (const initial of [{}, { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'explicit' }, {}]) {
    live = await ライブ起動(root, undefined, false, preferences, initial, file);
    try {
      const config = await (await fetch(new URL('config', live.url))).json();
      assert.deepEqual(config.保存モデル設定, selected);
      assert.deepEqual(config.モデル設定 || {}, initial);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), selected);
    } finally { await live.close(); }
  }
  writeFileSync(file, '{broken', 'utf8');
  live = await ライブ起動(root, undefined, false, process.cwd(), {}, file);
  try {
    assert.equal((await (await fetch(new URL('config', live.url))).json()).保存モデル設定, undefined);
    assert.equal(readFileSync(file, 'utf8'), '{broken');
  } finally { await live.close(); }
});

test('単独起動: 起動時の Provider / モデルを画面設定へ渡す', async t => {
  for (const [provider, modelKey] of [
    ['freeai_live', 'LIVE_FREEAI_MODEL'], ['gemini_live', 'LIVE_GEMINI_MODEL'], ['openai_live', 'LIVE_OPENAI_MODEL'],
  ]) {
    await t.test(provider, async t => {
      const live = await ライブ起動(root, undefined, false, process.cwd(), { LIVE_AI_NAME: provider, [modelKey]: 'launch-model' });
      t.after(() => live.close());
      const config = await (await fetch(new URL('config', live.url))).json();
      assert.deepEqual(config.モデル設定, { LIVE_AI_NAME: provider, [modelKey]: 'launch-model' });
    });
  }
});

test('ブラウザ版の起動コマンドがURLを返し、終了できる', { timeout: 8000 }, async t => {
  const env = { ...process.env }; delete env.CODESPACES; // Codespaces ではポート転送先の URL が出力されるため。
  const child = spawn(process.execPath, ['aidiy_live/launch.mjs', '--serve'], { cwd: root, env });
  t.after(() => child.kill());
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const output = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; if (text.includes('http://127.0.0.1:')) resolve(text); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`起動終了: ${code}: ${stderr}`)));
  });
  const url = output.match(/AiDiy Live: (http[^\r\n]+)/)[1];
  assert.equal((await fetch(url)).status, 200);
  child.kill(); await new Promise(resolve => child.once('exit', resolve));
});

test('Live の配布ディレクトリだけで専用画面の全リソースを提供できる', async t => {
  const live = await ライブ起動(join(root, 'aidiy_live'), 'http://127.0.0.1:8091', true);
  t.after(() => live.close());
  for (const path of ['', 'development/app.js', 'development/app.css', 'capture.js', 'sending.png', 'AiDiy.png', 'microphone.png', 'speaker.png']) {
    const response = await fetch(new URL(path, live.url));
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  // 画面は Vue 画面だけを返し、Vue 移行前の画面は配信しない。
  const html = await fetch(live.url), policy = html.headers.get('content-security-policy');
  assert.match(policy, /(?:^|; )img-src 'self' data:(?:;|$)/);
  assert.match(policy, /script-src 'self';/); assert.match(policy, /default-src 'none';/);
  assert.doesNotMatch(policy, /(?:https?:|\*)/);
  assert.match(await html.text(), /<script src="development\/app\.js" defer><\/script>/);
  assert.doesNotMatch((await fetch(new URL('development/app.js', live.url))).headers.get('content-security-policy'), /data:/);
  for (const path of ['view.js', 'style.css']) assert.equal((await fetch(new URL(path, live.url))).status, 404, path);
  assert.equal((await (await fetch(new URL('config', live.url))).json()).backend, 'http://127.0.0.1:8091');
});

test('画面の接続監視: Codespaces は初回接続まで終了せず、閉じたら終了待ちへ移る', async t => {
  const env = { CODESPACES: 'true', CODESPACE_NAME: 'aidiy-test', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  t.mock.timers.enable({ apis: ['Date'] });
  const live = await ライブ起動(root, 'http://127.0.0.1:8091');
  for (const key of Object.keys(env)) {
    if (key in saved) process.env[key] = saved[key];
    else delete process.env[key];
  }
  t.after(() => live.close());
  t.mock.timers.tick(120_001);
  assert.equal(live.idleMilliseconds(), 0, '転送登録・認証を待っている間は自動終了しない');
  t.mock.timers.reset();
  const response = await fetch(new URL('presence', live.url));
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(live.idleMilliseconds(), 0);
  await reader.cancel();
  const deadline = Date.now() + 2000;
  while (!live.idleMilliseconds() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(live.idleMilliseconds() > 0);
});

function frame(text, mask = false) {
  const body = Buffer.from(text), extended = body.length >= 126, large = body.length > 65535;
  const head = Buffer.alloc(2 + (large ? 8 : extended ? 2 : 0) + (mask ? 4 : 0));
  head[0] = 0x81; head[1] = (mask ? 128 : 0) | (large ? 127 : extended ? 126 : body.length);
  if (large) head.writeBigUInt64BE(BigInt(body.length), 2);
  else if (extended) head.writeUInt16BE(body.length, 2);
  const offset = large ? 10 : extended ? 4 : 2;
  if (mask) {
    const key = Buffer.from([9, 17, 25, 33]); key.copy(head, offset);
    for (let i = 0; i < body.length; i++) body[i] ^= key[i % 4];
  }
  return Buffer.concat([head, body]);
}
function frames(socket, receive, initial = Buffer.alloc(0)) {
  let pending = initial;
  const drain = data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 2) {
      const masked = !!(pending[1] & 128), size = pending[1] & 127;
      if (size === 126 && pending.length < 4 || size === 127 && pending.length < 10) return;
      const length = size === 127 ? Number(pending.readBigUInt64BE(2)) : size === 126 ? pending.readUInt16BE(2) : size;
      let offset = size === 127 ? 10 : size === 126 ? 4 : 2;
      if (pending.length < offset + (masked ? 4 : 0) + length) return;
      const key = masked ? pending.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      const body = Buffer.from(pending.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < length; i++) body[i] ^= key[i % 4];
      pending = pending.subarray(offset + length);
      receive(body.toString());
    }
  };
  socket.on('data', drain); drain(Buffer.alloc(0));
}
async function rawWebSocket(url, origin) {
  const parsed = new URL(url), socket = connect(Number(parsed.port), parsed.hostname);
  let pending = Buffer.alloc(0);
  const result = await new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`GET ${parsed.pathname} HTTP/1.1\r\nHost: ${parsed.host}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    const onData = data => {
      pending = Buffer.concat([pending, data]); const index = pending.indexOf('\r\n\r\n');
      if (index < 0) return;
      socket.off('data', onData);
      const response = pending.subarray(0, index).toString();
      pending = pending.subarray(index + 4); resolve(response);
    };
    socket.on('data', onData);
  });
  const messages = [], waiters = [];
  frames(socket, text => { if (waiters.length) waiters.shift()(text); else messages.push(text); }, pending);
  return { socket, response: result, send: text => socket.write(frame(text, true)), next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)) };
}

test('localhost中継: API、音声WebSocket、Origin拒否、終了', { timeout: 8000 }, async t => {
  let apiBody, upgradePath;
  const active = new Set();
  const backend = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    apiBody = JSON.parse(body); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'OK', data: { モデル設定: { LIVE_AI_NAME: 'gemini_live' } } }));
  });
  backend.on('connection', socket => { active.add(socket); socket.on('close', () => active.delete(socket)); });
  backend.on('upgrade', (req, socket, head) => {
    upgradePath = decodeURI(req.url);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    frames(socket, text => {
      const packet = JSON.parse(text);
      socket.write(frame(JSON.stringify(packet.type === 'connect' ? { メッセージ識別: 'init', セッションID: 'test-session', ソケット番号: packet.ソケット番号 } : { ...packet, メッセージ識別: 'output_audio' })));
    }, head);
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const live = await ライブ起動(root, `http://127.0.0.1:${backend.address().port}`);
  t.after(async () => { for (const socket of active) socket.destroy(); await new Promise(resolve => backend.close(resolve)); });
  t.after(() => live.close().catch(() => undefined));
  const origin = new URL(live.url).origin;
  assert.equal((await fetch(live.url)).status, 200);
  assert.match(await (await fetch(live.url)).text(), /"kind":"live"/);
  assert.equal((await fetch(origin + '/')).status, 404);
  assert.equal((await fetch(live.url, { headers: { origin: 'https://evil.example' } })).status, 403);
  const apiUrl = new URL('api/core/AIコア/モデル情報/取得', live.url);
  assert.equal((await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify({ セッションID: 'test-session' }) });
  assert.equal((await response.json()).data.モデル設定.LIVE_AI_NAME, 'gemini_live');
  assert.equal(apiBody.セッションID, 'test-session');
  assert.equal((await fetch(new URL('api/core/auth/ログイン', live.url), { method: 'POST' })).status, 404);
  assert.equal((await fetch(new URL('api/%ZZ', live.url), { method: 'POST' })).status, 400);
  const rejected = await rawWebSocket(new URL('socket', live.url), 'https://evil.example');
  assert.match(rejected.response, /403/); rejected.socket.destroy();
  const ws = await rawWebSocket(new URL('socket', live.url), origin);
  t.after(() => ws.socket.destroy()); assert.match(ws.response, /101/);
  ws.send(JSON.stringify({ type: 'connect', ソケット番号: 'audio', セッションID: 'test-session' }));
  assert.equal(JSON.parse(await ws.next()).セッションID, 'test-session');
  assert.equal(upgradePath, '/core/ws/AIコア');
  const pcm = Buffer.alloc(3072, 1).toString('base64');
  ws.send(JSON.stringify(音声入力(pcm)));
  const reply = JSON.parse(await ws.next()); assert.equal(reply.ファイル名, pcm); assert.equal(reply.メッセージ識別, 'output_audio');
  await live.close();
  await new Promise(resolve => { if (ws.socket.destroyed) resolve(); else ws.socket.once('close', resolve); });
});

test('Live 接続失敗: 単独画面と拡張に実際のローカル接続先・拒否理由を返す', { timeout: 8000 }, async t => {
  const { LiveHost } = require('../../out/aidiy_live/host.cjs');
  const backend = createServer();
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${backend.address().port}`;
  await new Promise(resolve => backend.close(resolve));
  const live = await ライブ起動(root, target);
  t.after(() => live.close());
  const response = await fetch(new URL('api/core/AIコア/モデル情報/取得', live.url), {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: new URL(live.url).origin }, body: '{}',
  });
  assert.equal(response.status, 502);
  const packets = [], host = new LiveHost(target, packet => packets.push(packet), () => 'python', '/microphone.py', () => ({ Authorization: 'Bearer fixture-token-only' }));
  t.after(() => host.dispose());
  await host.receive({ type: 'api', id: 1, path: 'core/AIコア/モデル情報/取得', body: {} });
  for (const message of [(await response.json()).message, packets[0].error]) {
    assert.ok(message.includes(target), message);
    assert.match(message, /ECONNREFUSED/);
  }
});

test('音声レートと既存の操作・PCMパケット', () => {
  assert.equal(入力レート('openai_live'), 24000); assert.equal(入力レート('gemini_live'), 16000);
  assert.equal(音声入力('abc').メッセージ内容, 'audio/pcm');
  assert.deepEqual(音声操作(true, false).メッセージ内容, { ボタン: { マイク: true, スピーカー: false } });
});

test('3つのソケットを同一セッションで接続し、途中失敗・切断で閉じる', async () => {
  const originals = global.WebSocket;
  const instances = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0;
    constructor() { instances.push(this); queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      this.sent = JSON.parse(raw);
      if (this.sent.type === 'connect') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ メッセージ識別: 'init', セッションID: 'session-1' }) }));
    }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  }
  global.WebSocket = FakeSocket;
  try {
    let lost = 0;
    const live = new LiveConnection('ws://localhost/socket', () => {}, () => lost++);
    await live.connect(); assert.equal(instances.length, 3);
    assert.deepEqual(instances.map(socket => socket.sent.ソケット番号), ['input', '0', 'audio']);
    assert.equal(instances[1].sent.セッションID, 'session-1'); assert.equal(instances[2].sent.セッションID, 'session-1');
    live.send('audio', 音声入力('xyz')); assert.equal(instances[2].sent.セッションID, 'session-1');
    instances[2].bufferedAmount = 200000; assert.equal(live.send('audio', 音声入力('x')), false);
    live.disconnect(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(lost, 0); assert.ok(instances.every(socket => socket.readyState === 3));
    const failing = new LiveConnection('ws://localhost/socket', () => {}, () => lost++);
    FakeSocket.prototype.send = function () { queueMicrotask(() => this.onerror?.()); };
    await assert.rejects(failing.connect(), /接続できません/);
    assert.equal(instances.at(-1).readyState, 3);
  } finally { global.WebSocket = originals; }
});

test('AudioWorkletは48kHz入力を16/24kHz PCM16に変換する', () => {
  for (const rate of [16000, 24000]) {
    let Constructor;
    const buffers = [];
    runInNewContext(readFileSync(join(root, 'aidiy_live/media/capture.js'), 'utf8'), {
      AudioWorkletProcessor: class { port = { postMessage: buffer => buffers.push(buffer) }; },
      sampleRate: 48000, registerProcessor: (_name, cls) => { Constructor = cls; },
    });
    const worklet = new Constructor({ processorOptions: { rate } });
    for (let i = 0; i < 24; i++) worklet.process([[new Float32Array(128).fill(.5)]]);
    assert.equal(buffers.length, 1);
    const pcm = new Int16Array(buffers[0]); assert.equal(pcm.length, rate * .064);
    assert.ok(pcm.every(value => value === 16383));
  }
});

test('AI再生音量に応じたマイク減衰: 閾値、符号、弱い入力、停止後の復帰', () => {
  let Constructor;
  const buffers = [];
  runInNewContext(readFileSync(join(root, 'aidiy_live/media/capture.js'), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: buffer => buffers.push(buffer) }; },
    sampleRate: 48000, registerProcessor: (_name, cls) => { Constructor = cls; },
  });
  const worklet = new Constructor({ processorOptions: { rate: 48000 } });
  const input = Float32Array.from({ length: 128 }, (_, i) => [.4, -.4, .1, -.1][i % 4]);
  const capture = level => {
    worklet.port.onmessage({ data: { speakerLevel: level } });
    for (let i = 0; i < 24; i++) worklet.process([[input]]);
    return new Int16Array(buffers.pop());
  };
  const original = capture(0);
  assert.deepEqual(capture(.01), original); // 閾値以下では変えない。
  const attenuated = capture(.2); // 各振幅から0.3を減らす。
  assert.ok(Math.abs(attenuated[0] - 3276) <= 1);
  assert.ok(Math.abs(attenuated[1] + 3276) <= 1);
  assert.equal(attenuated[2], 0); assert.equal(attenuated[3], 0);
  assert.ok(capture(.8).every(value => value === 0));
  assert.deepEqual(capture(0), original); // 再生停止・ミュート後は元の入力に戻る。
});

test('マイク許可待ちの間に切断しても、後から取得したトラックを閉じる', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  let allow, stopped = 0;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { allow = resolve; }) } } });
  try {
    const audio = new LiveAudio(() => assert.fail('切断後の送信'), () => {});
    const starting = audio.start(16000); audio.close();
    allow({ getTracks: () => [{ stop: () => stopped++ }] });
    assert.equal(await starting, false); assert.equal(stopped, 1);
  } finally { if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator); else delete global.navigator; }
});

test('音声キューと実測レベル: マイクへの減衰通知、停止・ミュートで解除', async () => {
  const original = global.AudioContext, originalRequest = global.requestAnimationFrame, originalCancel = global.cancelAnimationFrame;
  const nodes = [], frames = new Map(), notifications = [], levels = [];
  let frameId = 0, measured = 0;
  global.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  global.cancelAnimationFrame = id => frames.delete(id);
  class Context {
    state = 'running'; currentTime = 1; destination = {};
    async resume() {}
    async close() { this.state = 'closed'; }
    createAnalyser() { return { frequencyBinCount: 128, connect() {}, getByteFrequencyData(data) { data.fill(measured); } }; }
    createBuffer(_channels, count, rate) { return { duration: count / rate, getChannelData: () => new Float32Array(count) }; }
    createBufferSource() { const node = { connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } }; nodes.push(node); return node; }
  }
  global.AudioContext = Context;
  try {
    const audio = new LiveAudio(() => {}, (kind, value) => { if (kind === 'output') levels.push(value); });
    audio.processor = { disconnect() {}, port: { postMessage: value => notifications.push(value) } };
    const packet = { メッセージ内容: 'audio/pcm', ファイル名: Buffer.alloc(480).toString('base64') };
    audio.play(packet); audio.play(packet); await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.length, 2); assert.ok(nodes[1].time > nodes[0].time);
    assert.equal(levels.at(-1), 0); // 再生予約しただけではマイクを減衰しない。
    measured = 64;
    const [id, tick] = frames.entries().next().value; frames.delete(id); tick();
    assert.equal(levels.at(-1), .5); assert.equal(notifications.at(-1).speakerLevel, .5);
    audio.cancel(); assert.ok(nodes.every(node => node.stopped));
    assert.equal(notifications.at(-1).speakerLevel, 0); assert.equal(frames.size, 0);
    audio.play(packet); await new Promise(resolve => setImmediate(resolve));
    assert.equal(notifications.at(-1).speakerLevel, .5);
    audio.mute(false); assert.equal(notifications.at(-1).speakerLevel, 0);
    audio.play(packet); await new Promise(resolve => setImmediate(resolve)); assert.equal(nodes.length, 3);
    audio.close();
  } finally { global.AudioContext = original; global.requestAnimationFrame = originalRequest; global.cancelAnimationFrame = originalCancel; }
});


test('Live添付: 単独の実loopback中継で128k超のinput_fileとCore echo・生成画像を往復する', { timeout: 8000 }, async t => {
  const active = new Set(), channels = new Map(), received = [];
  const backend = createServer();
  backend.on('connection', socket => { active.add(socket); socket.on('close', () => active.delete(socket)); });
  backend.on('upgrade', (req, socket, head) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    frames(socket, text => {
      const packet = JSON.parse(text);
      if (packet.type === 'connect') {
        channels.set(packet.ソケット番号, socket);
        socket.write(frame(JSON.stringify({ メッセージ識別: 'init', セッションID: 'files-session', ソケット番号: packet.ソケット番号 })));
      } else {
        received.push(packet);
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1kAAAAASUVORK5CYII=';
        for (const kind of ['input_file', 'output_file']) channels.get('0').write(frame(JSON.stringify({ セッションID: packet.セッションID, チャンネル: '0', メッセージ識別: kind, ファイル名: `temp/${kind}/画像.png`, 元ファイル名: packet.ファイル名, サムネイル画像: png })));
      }
    }, head);
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const live = await ライブ起動(root, `http://127.0.0.1:${backend.address().port}`), clients = [];
  t.after(async () => { for (const client of clients) client.socket.destroy(); for (const socket of active) socket.destroy(); await live.close(); await new Promise(resolve => backend.close(resolve)); });
  for (const channel of ['input', '0']) {
    const client = await rawWebSocket(new URL('socket', live.url), new URL(live.url).origin); clients.push(client);
    assert.match(client.response, /101/);
    client.send(JSON.stringify({ type: 'connect', ソケット番号: channel, セッションID: channel === 'input' ? null : 'files-session', CODE_BASE_PATH: '/project' }));
    assert.equal(JSON.parse(await client.next()).セッションID, 'files-session');
  }
  const body = Buffer.alloc(200000, 42), packet = { メッセージ識別: 'input_file', セッションID: 'files-session', チャンネル: '0', 出力先チャンネル: '0', 送信モード: 'Live', プロジェクトパス: '/project', メッセージ内容: body.toString('base64'), ファイル名: '画像.png', サムネイル画像: null };
  clients[0].send(JSON.stringify(packet));
  const echo = JSON.parse(await clients[1].next()), generated = JSON.parse(await clients[1].next());
  assert.deepEqual(received, [packet]); assert.deepEqual(Buffer.from(received[0].メッセージ内容, 'base64'), body);
  assert.equal(echo.メッセージ識別, 'input_file'); assert.equal(generated.メッセージ識別, 'output_file');
  for (const item of [echo, generated]) { assert.equal(item.セッションID, 'files-session'); assert.equal(item.チャンネル, '0'); assert.match(item.サムネイル画像, /^iVBOR/); }
});
