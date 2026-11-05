// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { fork, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { consoleEnvironment } from './console-environment.mjs';

// ネイティブPTYとその補助スレッドを端末ごとのプロセスに閉じ込める。
// ElectronからもNodeモードで起動し、窓を閉じた時はプロセスツリーごと終了する。
export function spawnConsole(shell, args, options) {
  const events = new EventEmitter();
  const child = fork(fileURLToPath(new URL('./console-worker.mjs', import.meta.url)), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execArgv: [], windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let ended = false, ready = false, failure = '', pending = [], stopping;
  const exited = new Promise(resolve => child.once('exit', (exitCode) => {
    ended = true; if (failure) events.emit('failure', failure);
    events.emit('exit', { exitCode: exitCode ?? 1 }); resolve();
  }));
  child.stderr.on('data', data => { failure = (failure + data).slice(-4000); });
  child.on('error', error => { events.emit('failure', error.message); });
  child.on('message', message => {
    if (message.type === 'ready') { ready = true; for (const value of pending) child.send(value); pending = []; }
    if (message.type === 'data') events.emit('data', message.data);
    if (message.type === 'error') events.emit('failure', message.message);
  });
  const send = value => { if (!ended && child.connected) { if (ready) child.send(value); else pending.push(value); } };
  child.send({ type: 'start', shell, args, options: { ...options, env: consoleEnvironment(options.env) } });
  const subscribe = (name, listener) => { events.on(name, listener); return { dispose: () => events.off(name, listener) }; };
  return {
    onData: fn => subscribe('data', fn), onExit: fn => subscribe('exit', fn), onError: fn => subscribe('failure', fn),
    write: data => send({ type: 'input', data }), resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    pause: () => send({ type: 'pause' }), resume: () => send({ type: 'resume' }),
    kill() {
      return stopping ??= (async () => {
        if (ended) return;
        if (process.platform === 'win32') {
          await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, resolve));
        } else send({ type: 'stop' });
        const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
        await exited; clearTimeout(timeout);
      })();
    },
  };
}
