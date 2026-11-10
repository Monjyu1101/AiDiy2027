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

test('単独版は正規化プロジェクト・専用loopbackポート・非公開認証モードを伝達する', async () => {
  const f = fixture();
  const running = runAvatar({ ...f.options, alone: true, project: '.', allocatePort: async () => 43210 });
  await flush();
  const env = f.calls[0].options.env;
  assert.equal(env.AIDIY_AVATAR_ALONE, '1');
  assert.equal(env.AIDIY_AVATAR_PROJECT, process.cwd());
  assert.equal(env.VITE_DEV_SERVER_URL, 'http://127.0.0.1:43210');
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.deepEqual(f.calls[1].args, ['vite', '--mode', 'avatar-alone', '--host', '127.0.0.1', '--port', '43210', '--strictPort']);
  assert.equal(f.notices[0].url, env.VITE_DEV_SERVER_URL);
  f.calls[0].child.emit('exit', 0);
  assert.equal(await running, 0);
  assert.ok(f.stopped.includes(2));
});
test('単独版も占有ポート・重複・表示前失敗を成功にしない', async () => {
  const conflict = fixture({ occupied: true });
  await assert.rejects(runAvatar({ ...conflict.options, alone: true, project: '.', allocatePort: async () => 43210 }), /43210が別のプロセス/);
  assert.deepEqual(conflict.notices, []);
  const duplicate = fixture({ duplicate: true });
  assert.equal(await runAvatar({ ...duplicate.options, alone: true, project: '.', allocatePort: async () => 43211 }), 0);
  assert.equal(duplicate.calls.length, 1);
  assert.deepEqual(duplicate.notices, [{ existingWindow: true }]);
});
test('引数はcwd基準で検証し存在しないフォルダーや不完全な指定を拒否する', async () => {
  const { parseOptions } = await import('../launch.mjs');
  assert.equal(parseOptions(['--internal-auth']).project, process.cwd());
  assert.equal(parseOptions(['--internal-auth', '--project', '.', '--foreground']).foreground, true);
  for (const args of [['--alone'], ['--project', '.'], ['--internal-auth', '--project'], ['--internal-auth', '--project', '/missing-avatar-project'], ['--unknown']]) {
    assert.throws(() => parseOptions(args));
  }
});
test('切り離し後にも単独版と空白を含むプロジェクト引数を維持する', async () => {
  let invocation;
  const child = Object.assign(new EventEmitter(), { connected: true, disconnect() { this.connected = false; }, unref() {} });
  const result = await launchDetached({ alone: true, project: '/tmp/project with spaces', log() {}, launch(command, args, options) {
    invocation = { args, options };
    queueMicrotask(() => child.emit('message', { launchReady: true, url: 'http://127.0.0.1:43210' }));
    return child;
  } });
  assert.deepEqual(invocation.args.slice(1), ['--foreground', '--internal-auth', '--project', '/tmp/project with spaces']);
  assert.equal(invocation.options.env.AIDIY_LAUNCHER_CHILD, '1');
  assert.equal(result.launchReady, true);
  assert.equal(child.connected, false);
});
test('renderer起動だけではreadyを返さず、Electron表示完了を待つ', async () => {
  const f = fixture();
  const originalLaunch = f.options.launch;
  f.options.launch = (...args) => { const child = originalLaunch(...args); child.send = () => {}; return child; };
  const running = runAvatar(f.options);
  await flush();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.notices, []);
  f.calls[0].child.emit('message', { avatarShown: true });
  assert.equal(f.notices.length, 1);
  f.calls[0].child.emit('exit', 0);
  assert.equal(await running, 0);
});
test('ポート確保失敗・プロジェクト不正では子プロセスを作らない', async () => {
  const f = fixture();
  await assert.rejects(runAvatar({ ...f.options, alone: true, project: '.', allocatePort: async () => { throw Error('port allocation failed'); } }), /allocation/);
  await assert.rejects(runAvatar({ ...f.options, alone: true, project: '/missing-avatar-project' }), /フォルダー/);
  assert.deepEqual(f.calls, []);
});


test('初期ピンは明示引数だけをElectronへ渡し親環境から漏らさない', async () => {
  const old = process.env.AIDIY_AVATAR_INITIAL_PINNED;
  process.env.AIDIY_AVATAR_INITIAL_PINNED = '1';
  try {
    const { parseOptions } = await import('../launch.mjs');
    assert.equal(parseOptions([]).initialPinned, false);
    assert.equal(parseOptions(['--initial-pinned']).initialPinned, true);
    for (const initialPinned of [false, true]) {
      const f = fixture(), running = runAvatar({ ...f.options, initialPinned });
      await flush();
      assert.equal(f.calls[0].options.env.AIDIY_AVATAR_INITIAL_PINNED, initialPinned ? '1' : undefined);
      f.calls[0].child.emit('exit', 0);
      assert.equal(await running, 0);
    }
    let args;
    const child = Object.assign(new EventEmitter(), { connected: false, unref() {} });
    await launchDetached({ initialPinned: true, log() {}, launch(_command, values) {
      args = values;
      queueMicrotask(() => child.emit('message', { launchReady: true }));
      return child;
    } });
    assert.ok(args.includes('--initial-pinned'));
  } finally {
    if (old === undefined) delete process.env.AIDIY_AVATAR_INITIAL_PINNED;
    else process.env.AIDIY_AVATAR_INITIAL_PINNED = old;
  }
});


test('既にIDEとのIPCが切れている場合は子プロセスを起動しない', async () => {
  const f = fixture(), owner = Object.assign(new EventEmitter(), { connected: false });
  await assert.rejects(runAvatar({ ...f.options, owner }), /IDEとの接続/);
  assert.equal(f.calls.length, 0);
  assert.equal(owner.listenerCount('disconnect'), 0);
});

test('IDE所有起動では終了までIPCの監視を維持し、通常終了で解除する', async () => {
  const f = fixture(), owner = Object.assign(new EventEmitter(), { connected: true });
  const running = runAvatar({ ...f.options, owner });
  await flush();
  assert.equal(owner.listenerCount('disconnect'), 1);
  assert.equal(f.calls[0].options.detached, process.platform !== 'win32');
  assert.equal(f.calls[1].options.detached, process.platform !== 'win32');
  f.calls[0].child.emit('exit', 0);
  await running;
  assert.equal(owner.listenerCount('disconnect'), 0);
});
test('IDE layout IPC relays only owned ready allowlisted geometry and removes listeners on exit', async () => {
  const f = fixture(), owner = Object.assign(new EventEmitter(), { connected: true });
  const replies = []; owner.send = message => replies.push(message);
  const running = runAvatar({ ...f.options, alone: true, project: process.cwd(), allocatePort: async () => 19876, owner });
  await flush();
  const desktop = f.calls[0].child, requests = [];
  desktop.send = message => requests.push(message);
  owner.emit('message', { avatarLayout: { id: 1, action: 'execute', command: 'bad' } });
  owner.emit('message', { avatarLayout: { id: 2, action: 'restore', snapshot: { windows: [{ role: 'core', bounds: {} }] } } });
  assert.equal(requests.length, 0);
  owner.emit('message', { avatarLayout: { id: 3, action: 'capture', token: 'secret' } });
  assert.deepEqual(requests[0], { avatarLayout: { id: 3, action: 'capture' } });
  desktop.emit('message', { avatarLayoutResult: { id: 3, ok: true, snapshot: { windows: [], token: 'secret' }, session: 'secret' } });
  assert.deepEqual(replies[0], { avatarLayoutResult: { id: 3, ok: true, snapshot: { windows: [] } } });
  desktop.emit('exit', 0); await running;
  assert.equal(owner.listenerCount('message'), 0);
});
