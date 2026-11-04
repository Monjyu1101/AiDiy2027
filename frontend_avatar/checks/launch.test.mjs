// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runAvatar, launchDetached } from '../launch.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ occupied = false, duplicate = false } = {}) {
  const calls = [], notices = [], stopped = [];
  const launch = (command, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: calls.length + 1, connected: true, exitCode: null, signalCode: null });
    child.send = message => { if (message.avatarRendererReady) queueMicrotask(() => child.emit('message', { avatarShown: true })); };
    calls.push({ command, args, options, child });
    if (command === 'electron') queueMicrotask(() => {
      child.emit('message', duplicate ? { avatarExisting: true } : { avatarPrimary: true });
      if (duplicate) queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0); });
    });
    return child;
  };
  const options = {
    launch, electron: 'electron', vite: 'vite', build() {}, timeout: 200,
    isOpen: async () => occupied || calls.length > 1,
    ready: info => notices.push(info),
    stop: async child => { if (child) { stopped.push(child.pid); child.exitCode = 0; child.emit('exit', 0); } },
  };
  return { calls, notices, stopped, options };
}

test('Electronの所有権確定後に8092を起動し、画面表示で通知、終了でサーバー回収', async () => {
  const f = fixture(), running = runAvatar(f.options);
  await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.windowsHide, false);
  assert.match(f.notices[0].url, /8092$/);
  f.calls[0].child.emit('exit', 0);
  assert.equal(await running, 0);
  assert.ok(f.stopped.includes(2));
});
test('二重起動では既存画面への通知だけ行い8092を追加起動しない', async () => {
  const f = fixture({ duplicate: true, occupied: true });
  assert.equal(await runAvatar(f.options), 0);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.notices, [{ existingWindow: true }]);
});
test('8092だけの占有は起動成功にせず新規Electronを回収する', async () => {
  const f = fixture({ occupied: true });
  await assert.rejects(runAvatar(f.options), /8092が別のプロセス/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.stopped, [1]);
});
test('サーバーが途中終了したらElectronも回収する', async () => {
  const f = fixture(), running = runAvatar(f.options);
  await flush();
  f.calls[1].child.emit('exit', 1);
  await assert.rejects(running, /画面サーバーが終了/);
  assert.ok(f.stopped.includes(1));
});
test('サーバー起動エラーでもElectronを回収する', async () => {
  const f = fixture(), running = runAvatar(f.options);
  await flush();
  f.calls[1].child.emit('error', Error('spawn EACCES'));
  await assert.rejects(running, /EACCES/);
  assert.ok(f.stopped.includes(1));
});
test('Electron起動エラーを成功として通知しない', async () => {
  const f = fixture();
  f.options.launch = () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', Error('ENOENT'))); return child; };
  await assert.rejects(runAvatar(f.options), /ENOENT/);
  assert.deepEqual(f.notices, []);
});
test('画面表示前の終了を起動失敗として返す', async () => {
  const f = fixture();
  f.options.launch = () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0)); return child; };
  await assert.rejects(runAvatar(f.options), /画面表示前に終了/);
  assert.deepEqual(f.notices, []);
});
test('親ランチャーのタイムアウトでは子プロセスツリーを回収する', async () => {
  const child = Object.assign(new EventEmitter(), { connected: false });
  let stopped;
  await assert.rejects(launchDetached({ launch: () => child, timeout: 10, stop: async target => { stopped = target; } }), /タイムアウト/);
  assert.equal(stopped, child);
});
