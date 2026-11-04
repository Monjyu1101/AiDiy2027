// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startTerminal } from '../aidiy_console/terminal.mjs';
import { createCliSession } from '../aidiy_console/cli-session.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await delay(10); } throw Error('timeout'); }
async function connect(url) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + 'socket', { origin: new URL(url).origin }), messages = [];
  ws.on('message', raw => { const value = JSON.parse(raw); messages.push(value); if (value.type === 'data') ws.send(JSON.stringify({ type: 'ack', length: value.data.length })); });
  await once(ws, 'open');
  return { ws, messages, send: value => ws.send(JSON.stringify(value)), start: () => ws.send(JSON.stringify({ type: 'start', cols: 80, rows: 24 })) };
}
async function fixture(run) {
  const project = await mkdtemp(join(tmpdir(), 'aidiy-cli 日本語 &-'));
  await writeFile(join(project, process.platform === 'win32' ? 'copilot.exe' : 'copilot'), 'TEST FIXTURE, NEVER EXECUTE');
  await chmod(join(project, process.platform === 'win32' ? 'copilot.exe' : 'copilot'), 0o755);
  try { await run(project); } finally { await rm(project, { recursive: true, force: true }); }
}
const subscription = () => ({ dispose() {} });
test('CLI端末: 指定project・固定argv、重複start・再接続・終了後に再実行せず状態保持', async () => fixture(async project => {
  const starts = [], writes = []; let onData, onExit, killed = 0;
  const app = await startTerminal(project, { cli: 'copilot', cliAutoApprove: true, env: { PATH: project }, checkTools: async () => false,
    spawnTerminal: (file, args, options) => { starts.push({ file, args, options }); return {
      onData: fn => { onData = fn; return subscription(); }, onExit: fn => { onExit = fn; return subscription(); },
      write: data => writes.push(data), resize() {}, kill: () => killed++,
    }; } });
  let current;
  try {
    const config = await fetch(app.url + 'config').then(response => response.json());
    assert.equal(config.cli.name, 'GitHub Copilot CLI'); assert.equal(config.cli.mode, 'YOLO');
    current = await connect(app.url); current.start(); current.start();
    await until(() => current.messages.some(message => message.type === 'ready'));
    assert.equal(starts.length, 1); assert.equal(starts[0].options.cwd, project); assert.deepEqual(starts[0].args, ['--yolo']);
    assert.ok(!starts[0].args.includes('--model')); assert.equal(current.messages.find(message => message.type === 'ready').completion, false);
    current.send({ type: 'input', data: 'hello\r' }); await until(() => writes.length); assert.deepEqual(writes, ['hello\r']);
    onData('保持した出力'); await until(() => current.messages.some(message => message.data === '保持した出力'));
    let closed = once(current.ws, 'close'); current.ws.close(); await closed; assert.equal(killed, 0);
    onData('切断中の出力');
    current = await connect(app.url); current.start(); await until(() => current.messages.some(message => message.type === 'ready'));
    assert.equal(starts.length, 1); assert.ok(current.messages.some(message => message.data === '保持した出力切断中の出力'));
    onExit({ exitCode: 7 }); await until(() => current.messages.some(message => message.type === 'exit'));
    current.start(); await delay(30); assert.equal(starts.length, 1);
    closed = once(current.ws, 'close'); current.ws.close(); await closed;
    current = await connect(app.url); current.start(); await until(() => current.messages.some(message => message.type === 'exit'));
    assert.equal(starts.length, 1); assert.equal(current.messages.find(message => message.type === 'exit').exitCode, 7);
  } finally { current?.ws.terminate(); await app.close(); }
  assert.equal(killed, 1);
}));

test('CLI端末: 同期起動エラーを表示し、再接続でも再試行しない', async () => fixture(async project => {
  let count = 0;
  const app = await startTerminal(project, { cli: 'copilot', env: { PATH: project }, checkTools: async () => false,
    spawnTerminal: () => { count++; throw Error('fixture startup error'); } });
  let current;
  try {
    for (let i = 0; i < 2; i++) {
      current = await connect(app.url); current.start(); await until(() => current.messages.some(message => message.type === 'error'));
      assert.equal(current.messages.find(message => message.type === 'error').message, 'fixture startup error');
      const closed = once(current.ws, 'close'); current.ws.close(); await closed;
    }
    assert.equal(count, 1);
  } finally { current?.ws.terminate(); await app.close(); }
}));

test('CLIセッション: 非同期エラーと出力上限を保持し、closeを1回だけ実行', async () => {
  let data, error, killed = 0;
  const session = createCliSession({ executable: '/fixture/copilot', args: ['--yolo'], env: {} }, '/fixture/project', () => ({
    onData: fn => { data = fn; return subscription(); }, onExit: subscription, onError: fn => { error = fn; return subscription(); }, kill: () => killed++,
  }), { outputLimit: 8 });
  session.start(80, 24); data('1234567890'); assert.equal(session.snapshot().output, '34567890');
  error('fixture native error'); assert.equal(session.snapshot().state, 'error');
  assert.equal(session.snapshot().error, 'fixture native error'); session.start(80, 24);
  await Promise.all([session.close(), session.close()]); assert.equal(killed, 1);
});

test('CLI再接続猶予: 有効な開始だけが期限を解除し、未開始・不正接続では延長しない', async () => fixture(async project => {
  let count = 0, killed = 0, started = 0, abandoned = 0;
  const clients = [], grace = 80;
  const app = await startTerminal(project, { cli: 'copilot', env: { PATH: project }, cliReconnectGrace: grace, checkTools: async () => false,
    onCliStarted: () => started++, onCliAbandoned: () => abandoned++,
    spawnTerminal: () => { count++; return { onData: subscription, onExit: subscription, resize() {}, kill: () => killed++ }; } });
  const open = async () => { const client = await connect(app.url); clients.push(client); return client; };
  const disconnect = async client => { const closed = once(client.ws, 'close'); client.ws.close(); await closed; };
  try {
    let current = await open(); current.start(); await until(() => current.messages.some(message => message.type === 'ready'));
    await disconnect(current);
    current = await open(); current.start(); await until(() => current.messages.some(message => message.type === 'ready'));
    await delay(grace * 2); assert.equal(killed, 0, '有効な再接続で猶予タイマーを解除'); assert.equal(started, 1);
    await disconnect(current);
    await open(); // 接続しただけでは猶予を解除しない。
    const invalid = await open(), closed = once(invalid.ws, 'close'); invalid.send({ type: 'start', cols: 0, rows: 24 }); await closed;
    await until(() => killed === 1 && abandoned === 1);
    current = await open(); current.start(); await until(() => current.messages.some(message => message.type === 'exit'));
    assert.equal(count, 1); assert.equal(current.messages.find(message => message.type === 'ready').state, 'exited');
    assert.ok(current.messages.some(message => message.type === 'data' && message.data.includes('猶予時間')));
    assert.equal(current.messages.find(message => message.type === 'exit').exitCode, 130);
  } finally { for (const client of clients) client.ws.terminate(); await app.close(); }
  assert.equal(killed, 1);
}));

test('CLI再接続猶予: 期限切れ通知から所有サーバーを閉じても待ち合わせが循環しない', async () => fixture(async project => {
  let closed = false;
  const app = await startTerminal(project, { cli: 'copilot', env: { PATH: project }, cliReconnectGrace: 20, checkTools: async () => false,
    onCliAbandoned: async () => { await app.close(); closed = true; },
    spawnTerminal: () => ({ onData: subscription, onExit: subscription, resize() {}, kill() {} }) });
  try {
    const client = await connect(app.url); client.start(); await until(() => client.messages.some(message => message.type === 'ready'));
    client.ws.close(); await until(() => closed);
  } finally { await app.close(); }
}));

test('CLI起動所有者: 最初の端末開始なしで期限終了、開始・破棄後は終了タイマーなし', async () => {
  const { createCliOwnerLifetime } = await import('../aidiy_console/cli-session.mjs');
  let stopped = 0;
  const missing = createCliOwnerLifetime(() => stopped++, { activationGrace: 20 });
  missing.arm(); missing.arm(); await delay(50); assert.equal(stopped, 1); missing.arm(); await delay(30); assert.equal(stopped, 1);
  for (const beforeArm of [true, false]) {
    const active = createCliOwnerLifetime(() => stopped++, { activationGrace: 20 });
    if (beforeArm) active.started(); active.arm(); if (!beforeArm) active.started(); await delay(40); active.dispose(); assert.equal(stopped, 1);
  }
  const disposed = createCliOwnerLifetime(() => stopped++, { activationGrace: 20 }); disposed.arm(); disposed.dispose(); await delay(40); assert.equal(stopped, 1);
});
