// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 1つのConsole窓が1つのCLIプロセスを所有する。通信の再接続・重複startは再実行にしない。
// 再接続猶予中は直近の出力を保持し、猶予切れまたは所有サーバー終了時にプロセスを片付ける。
export function createCliSession(launch, project, spawnTerminal, { outputLimit = 256 * 1024 } = {}) {
  let terminal, state = 'idle', output = '', exitCode, error, closing;
  const listeners = new Set(), subscriptions = [];
  const emit = value => { for (const listener of listeners) listener(value); };
  const fail = message => { error = String(message); state = 'error'; emit({ type: 'error', message: error }); };
  function shutdown(reason) {
    if (closing) return closing;
    if (reason && (state === 'running' || state === 'error')) {
      if (state !== 'error') state = 'exited';
      exitCode ??= 130;
      const data = `\r\n[${reason}]\r\n`;
      output = (output + data).slice(-outputLimit); emit({ type: 'data', data });
      emit({ type: 'exit', exitCode });
    } else if (!reason) state = 'closed';
    for (const subscription of subscriptions) subscription?.dispose(); listeners.clear();
    return closing = Promise.resolve().then(() => terminal?.kill());
  }
  return {
    start(cols, rows) {
      if (state !== 'idle') return;
      state = 'running';
      try {
        terminal = spawnTerminal(launch.executable, launch.args, { name: 'xterm-256color', cols, rows, cwd: project, env: { ...launch.env, TERM: 'xterm-256color' } });
        subscriptions.push(terminal.onData(data => { output = (output + data).slice(-outputLimit); emit({ type: 'data', data }); }));
        subscriptions.push(terminal.onExit(result => { exitCode = result.exitCode; if (state !== 'error') state = 'exited'; emit({ type: 'exit', exitCode }); }));
        if (terminal.onError) subscriptions.push(terminal.onError(fail));
      } catch (caught) { fail(caught.message); }
    },
    snapshot: () => ({ state, output, exitCode, error }),
    subscribe(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    write(data) { if (state === 'running') terminal?.write(data); },
    resize(cols, rows) { if (state === 'running') terminal?.resize(cols, rows); },
    terminate(reason) { return shutdown(reason); },
    close() { return shutdown(); },
  };
}


// 画面が一度も端末を開始しなかった場合も、CLI専用ランチャーを放置しない。
export function createCliOwnerLifetime(stop, { activationGrace = 30000 } = {}) {
  let timer, activated = false, disposed = false;
  return {
    arm() {
      if (activated || disposed || timer) return;
      timer = setTimeout(() => { timer = undefined; if (!activated && !disposed) { disposed = true; void stop(); } }, activationGrace);
      timer.unref();
    },
    started() { activated = true; clearTimeout(timer); timer = undefined; },
    dispose() { disposed = true; clearTimeout(timer); timer = undefined; },
  };
}
