// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn as spawnProcess } from 'node:child_process';
import { windowsGpuCimCommand, windowsGpuCounterCommand } from './windows-gpu.mjs';
import { windowsSystemMetricsCommand } from './windows-cpu.mjs';

// 照会のたびにPowerShell/.NET/CIMを起動し直さない。標準入力は固定の識別子だけ。
// 値の取得には既存の固定コマンドを再利用し、計測の意味と失敗境界を変えない。
export const windowsMetricsProcessCommand = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$cimQuery = {
` + windowsGpuCimCommand + String.raw`
}
$counterQuery = {
` + windowsGpuCounterCommand + String.raw`
}
$withCpu = {
` + windowsSystemMetricsCommand('& $gpuQuery') + String.raw`
}
$withoutCpu = {
` + windowsSystemMetricsCommand('& $gpuQuery', false) + String.raw`
}
while ($null -ne ($request = [Console]::ReadLine())) {
  $gpuQuery = { '[]' }
  $sample = $withCpu
  switch -Exact ($request) {
    'cim' { $gpuQuery = $cimQuery }
    'counter' { $gpuQuery = $counterQuery }
    'cpu' {}
    'cim-gpu' { $gpuQuery = $cimQuery; $sample = $withoutCpu }
    'counter-gpu' { $gpuQuery = $counterQuery; $sample = $withoutCpu }
    default { exit 1 }
  }
  try { $json = (& $sample) -join [Environment]::NewLine }
  catch { $json = '{"cpu":null,"gpu":[]}' }
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}
`;

const requestName = (gpuCommand, readCpu) => {
  if (!gpuCommand && readCpu) return 'cpu';
  if (gpuCommand === windowsGpuCimCommand) return readCpu ? 'cim' : 'cim-gpu';
  if (gpuCommand === windowsGpuCounterCommand) return readCpu ? 'counter' : 'counter-gpu';
  throw Error('未対応のWindows計測要求です。');
};

// 要求がない間はブロッキング読取で待機。10秒無通信ならプロセスごと解放する。
// 時計は計測周期に使わず、応答期限と1回限りの解放予約だけを持つ。
export function createWindowsMetricsProcess({ spawn = spawnProcess, idleTimeout = 10000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let current, closed = false;
  function settle(session, error, stdout) {
    const pending = session.pending;
    if (!pending) return;
    session.pending = undefined;
    clearTimer(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error); else pending.resolve({ stdout });
  }
  function stop(session, error = Error('Windows計測プロセスは終了しました。')) {
    if (!session) return;
    if (current === session) current = undefined;
    clearTimer(session.idleTimer);
    settle(session, error);
    session.child.stdin.destroy();
    session.child.kill();
  }
  function start() {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(windowsMetricsProcessCommand, 'utf16le').toString('base64')], {
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = { child, buffer: '', received: 0, pending: undefined, idleTimer: undefined };
    current = session;
    child.on('error', error => { if (current === session) stop(session, error); });
    child.on('exit', () => { if (current === session) stop(session); });
    child.stdin.on('error', error => { if (current === session) stop(session, error); });
    // エラー出力も必ず排出し、子プロセスのpipe詰まりを避ける。内容は保存しない。
    child.stderr.on('data', chunk => {
      if (current !== session) return;
      session.received += chunk.length;
      if (session.received > (session.pending?.maxBuffer ?? 512 * 1024)) stop(session, Error('Windows計測の出力上限を超えました。'));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (current !== session) return;
      session.received += Buffer.byteLength(chunk);
      if (!session.pending || session.received > session.pending.maxBuffer) { stop(session, Error('Windows計測の予期しない出力です。')); return; }
      session.buffer += chunk;
      const end = session.buffer.indexOf('\n');
      if (end < 0) return;
      const stdout = session.buffer.slice(0, end).replace(/^\uFEFF/, '').trim();
      if (session.buffer.slice(end + 1).trim()) { stop(session, Error('Windows計測の応答が重複しました。')); return; }
      session.buffer = '';
      try { JSON.parse(stdout); } catch { stop(session, Error('Windows計測の応答が不正です。')); return; }
      settle(session, null, stdout);
      session.idleTimer = setTimer(() => stop(session), idleTimeout);
      session.idleTimer?.unref?.();
    });
    return session;
  }
  return {
    sample(gpuCommand = '', readCpu = true, { timeout = 8000, maxBuffer = 512 * 1024, signal } = {}) {
      if (closed || signal?.aborted) return Promise.reject(Error('Windows計測は終了しました。'));
      let key;
      try { key = requestName(gpuCommand, readCpu); } catch (error) { return Promise.reject(error); }
      if (current?.pending) return Promise.reject(Error('Windows計測は実行中です。'));
      let session;
      try { session = current ?? start(); } catch (error) { return Promise.reject(error); }
      clearTimer(session.idleTimer);
      session.received = 0;
      return new Promise((resolve, reject) => {
        const abort = () => stop(session, Error('Windows計測は中止されました。'));
        const timer = setTimer(() => stop(session, Error('Windows計測が時間切れになりました。')), timeout);
        session.pending = { resolve, reject, timer, signal, abort, maxBuffer };
        signal?.addEventListener('abort', abort, { once: true });
        try { session.child.stdin.write(key + '\n'); } catch (error) { stop(session, error); }
      });
    },
    close() { closed = true; stop(current); },
  };
}
