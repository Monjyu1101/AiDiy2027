// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { spawn: spawnProcess } = require('node:child_process');

// 診断で継続PDHとの一致を確認したCOM更新器を使う。os.cpus()へ戻さない。
// 公式例の初回baselineと1秒以上の採取を維持する。
// https://learn.microsoft.com/en-us/windows/win32/wmisdk/refreshing-wmi-data-in-scripts
// https://learn.microsoft.com/en-us/windows/win32/perfctrs/collecting-performance-data
const windowsCpuSamplerCommand = String.raw`
$script:cpuRefresher = $null
$script:cpuRefreshable = $null
$script:cpuClock = $null
$script:cpuSequence = 0
function Read-AidiyCpu {
  if ($null -eq $script:cpuRefresher) {
    $locator = New-Object -ComObject WbemScripting.SWbemLocator
    $service = $locator.ConnectServer('.', 'root\cimv2')
    $script:cpuRefresher = New-Object -ComObject WbemScripting.SWbemRefresher
    $script:cpuRefreshable = $script:cpuRefresher.AddEnum($service, 'Win32_PerfFormattedData_Counters_ProcessorInformation')
    [void]$script:cpuRefresher.Refresh()
    $script:cpuClock = [Diagnostics.Stopwatch]::StartNew()
  }
  while ($script:cpuClock.ElapsedMilliseconds -lt 1000) {
    [Threading.Thread]::Sleep([int][Math]::Max(1, 1000 - $script:cpuClock.ElapsedMilliseconds))
  }
  $sampleIntervalMs = $script:cpuClock.ElapsedMilliseconds
  $script:cpuClock.Restart()
  [void]$script:cpuRefresher.Refresh()
  $row = @($script:cpuRefreshable.ObjectSet | Where-Object { $_.Properties_.Item('Name').Value -eq '_Total' }) | Select-Object -First 1
  if ($null -eq $row) { throw 'CPU total is unavailable' }
  $time = $null; $utility = $null; $idle = $null; $stamp = $null
  try { $time = $row.Properties_.Item('PercentProcessorTime').Value } catch {}
  try { $utility = $row.Properties_.Item('PercentProcessorUtility').Value } catch {}
  try { $idle = $row.Properties_.Item('PercentIdleTime').Value } catch {}
  try { $stamp = [string]$row.Properties_.Item('Timestamp_Sys100NS').Value } catch {}
  $script:cpuSequence++
  return [PSCustomObject]@{ Name = '_Total'; PercentProcessorTime = $time; PercentProcessorUtility = $utility;
    PercentIdleTime = $idle; SampleIntervalMs = $sampleIntervalMs; TimestampSys100Ns = $stamp; Sequence = $script:cpuSequence }
}
`;
const windowsCpuProcessCommand = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
` + windowsCpuSamplerCommand + String.raw`
while ($null -ne ($request = [Console]::ReadLine())) {
  if ($request -cne 'cpu') { exit 1 }
  try { $cpu = Read-AidiyCpu }
  catch { $cpu = $null }
  $json = ConvertTo-Json -InputObject ([PSCustomObject]@{ cpu = $cpu }) -Depth 4 -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}
`;

function preferredWindowsCpuMetric(release) {
  const match = /^10\.0\.(\d+)(?:\.|$)/.exec(String(release));
  return match && Number(match[1]) >= 10240 && Number(match[1]) <= 22631 ? 'utility' : 'time';
}
const numeric = value => typeof value === 'number' ? value
  : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
function parseWindowsCpuRecord(row, metric, measuredAt) {
  if (!['time', 'utility'].includes(metric)) return null;
  if (Array.isArray(row)) row = row.find(item => String(item?.Name).toLowerCase() === '_total');
  if (String(row?.Name).toLowerCase() !== '_total') return null;
  const valid = (value, max = Infinity) => { const number = numeric(value); return Number.isFinite(number) && number >= 0 && number <= max ? number : null; };
  const time = valid(row.PercentProcessorTime, 100), utility = valid(row.PercentProcessorUtility), idle = valid(row.PercentIdleTime, 100);
  const selected = metric === 'utility' ? utility : time;
  if (selected === null) return null;
  const duration = valid(row.SampleIntervalMs), sequence = valid(row.Sequence);
  // formatted百分率だけ数値化し、uint64の生timestampは精度を失わない文字列で保持する。
  return Object.freeze({ cpu: Math.min(100, selected), source: `windows-processor-${metric}`, measuredAt,
    sampleIntervalMs: duration > 0 ? duration : null, windowsProcessorTime: time, windowsProcessorUtility: utility,
    windowsProcessorIdle: idle, windowsPreferredMetric: metric,
    windowsTimestampSys100Ns: typeof row.TimestampSys100Ns === 'string' && /^\d+$/.test(row.TimestampSys100Ns) ? row.TimestampSys100Ns : null,
    sequence: Number.isSafeInteger(sequence) ? sequence : null });
}

// CPU専用PowerShellは1本だけ。標準入力をコマンド評価せず固定要求だけ受け取る。
function createWindowsCpuProcess({ spawn = spawnProcess, setTimer = setTimeout, clearTimer = clearTimeout,
  timeout = 5000, maxBuffer = 512 * 1024, onFailure } = {}) {
  let session, closed = false, failure;
  function settle(current, error, result) {
    const pending = current.pending;
    if (!pending) return;
    current.pending = undefined; clearTimer(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error); else pending.resolve(result);
  }
  function stop(current, error = Error('Windows CPU計測は終了しました。')) {
    if (!current || current.stopped) return;
    current.stopped = true;
    if (session === current) session = undefined;
    failure = error;
    settle(current, error);
    try { current.child.stdin.destroy(); } catch {}
    try { current.child.kill(); } catch {}
    if (!closed) { try { onFailure?.(); } catch {} }
  }
  function start() {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand',
      Buffer.from(windowsCpuProcessCommand, 'utf16le').toString('base64')], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const current = { child, buffer: '', received: 0, pending: undefined, stopped: false };
    session = current;
    child.on('error', error => stop(current, error));
    child.on('exit', () => stop(current));
    child.stdin.on('error', error => stop(current, error));
    child.stderr.on('data', chunk => {
      if (current.stopped) return;
      current.received += Buffer.byteLength(chunk);
      if (current.received > maxBuffer) stop(current, Error('Windows CPU計測の出力上限を超えました。'));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (current.stopped) return;
      current.received += Buffer.byteLength(chunk);
      if (!current.pending || current.received > maxBuffer) { stop(current, Error('Windows CPU計測の予期しない出力です。')); return; }
      current.buffer += chunk;
      const end = current.buffer.indexOf('\n');
      if (end < 0) return;
      if (current.buffer.slice(end + 1).trim()) { stop(current, Error('Windows CPU計測の応答が重複しました。')); return; }
      const line = current.buffer.slice(0, end).replace(/^\uFEFF/, '').trim();
      current.buffer = '';
      let result;
      try { result = JSON.parse(line); } catch { stop(current, Error('Windows CPU計測の応答が不正です。')); return; }
      settle(current, null, result);
    });
    return current;
  }
  return {
    sample({ signal } = {}) {
      if (closed || signal?.aborted || failure) return Promise.reject(failure ?? Error('Windows CPU計測は終了しました。'));
      if (session?.pending) return Promise.reject(Error('Windows CPU計測は実行中です。'));
      let current;
      try { current = session ?? start(); } catch (error) { failure = error; return Promise.reject(error); }
      current.received = 0;
      return new Promise((resolve, reject) => {
        const abort = () => stop(current, Error('Windows CPU計測は中止されました。'));
        const timer = setTimer(() => stop(current, Error('Windows CPU計測が時間切れになりました。')), timeout);
        timer?.unref?.();
        current.pending = { resolve, reject, timer, signal, abort };
        signal?.addEventListener('abort', abort, { once: true });
        try { current.child.stdin.write('cpu\n'); } catch (error) { stop(current, error); }
      });
    },
    close() { if (closed) return; closed = true; stop(session); },
  };
}

function createWindowsCpuMonitor({ system = os, metric, interval = 1000, idleTimeout = 3000, retryInterval = 30000,
  now = Date.now, monotonicNow = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  spawn = spawnProcess, makeProcess = options => createWindowsCpuProcess({ spawn, setTimer, clearTimer, ...options }) } = {}) {
  if (![interval, idleTimeout, retryInterval].every(value => Number.isFinite(value) && value > 0)) throw RangeError('CPU計測の間隔が不正です。');
  if (metric === undefined) {
    let release;
    try { release = system.release(); } catch {}
    metric = preferredWindowsCpuMetric(release);
  }
  if (!['time', 'utility'].includes(metric)) throw RangeError('CPU指標が不正です。');
  // eyesの500ms照会でもnative採取は1秒以上。既定指標は途中で切り替えない。
  const period = Math.max(1000, interval);
  let closed = false, active = false, state = 'idle', generation = 0, leaseUntil = 0, retryAt = 0;
  let worker, pending, cycleTimer, leaseTimer, nextDeadline = null, latest = null;
  function timerAt(deadline, callback) {
    const timer = setTimer(callback, Math.ceil(Math.max(0, deadline - monotonicNow())));
    timer?.unref?.(); return timer;
  }
  function releaseProcess() {
    const previous = worker; worker = undefined;
    try { previous?.close(); } catch {}
  }
  function stop() {
    generation++; active = false; state = 'idle'; latest = null; nextDeadline = null;
    clearTimer(cycleTimer); clearTimer(leaseTimer); cycleTimer = leaseTimer = undefined;
    const previous = pending; pending = undefined;
    previous?.controller.abort(); releaseProcess();
    // 失敗時のretryAtは維持し、表示切替によるプロセス再起動の連発を防ぐ。
  }
  function stillActive() {
    if (closed || !active) return false;
    if (monotonicNow() >= leaseUntil) { stop(); return false; }
    return true;
  }
  function renewLease() {
    clearTimer(leaseTimer); const version = generation;
    leaseTimer = timerAt(leaseUntil, () => {
      if (version !== generation) return;
      leaseTimer = undefined; if (stillActive()) renewLease();
    });
  }
  function schedule(startNow = false) {
    if (!stillActive() || pending || cycleTimer !== undefined) return;
    const deadline = nextDeadline ?? retryAt;
    if (startNow && deadline <= monotonicNow()) { void sample(); return; }
    const version = generation;
    cycleTimer = timerAt(deadline, () => {
      if (version !== generation) return;
      cycleTimer = undefined; if (stillActive()) void sample();
    });
  }
  function processFailed(version) {
    if (version !== generation || !stillActive()) return;
    // 成功応答の直後でも異常終了・余分なstdoutを見たら、その世代の値を公開しない。
    generation++; latest = null; state = 'unavailable'; nextDeadline = null; retryAt = monotonicNow() + retryInterval;
    clearTimer(cycleTimer); clearTimer(leaseTimer); cycleTimer = leaseTimer = undefined;
    const previous = pending; pending = undefined;
    previous?.controller.abort(); releaseProcess(); renewLease(); schedule();
  }
  async function sample() {
    if (!stillActive() || pending) return;
    const request = { generation, controller: new AbortController() }; pending = request;
    if (!latest) state = 'warming-up';
    try {
      worker ??= makeProcess({ onFailure: () => processFailed(request.generation) });
      const result = await worker.sample({ signal: request.controller.signal });
      if (request.generation !== generation || !stillActive()) return;
      const record = parseWindowsCpuRecord(result?.cpu, metric, now());
      if (!record) throw Error('選択したWindows CPU指標の標本がありません。');
      latest = record; state = 'available'; retryAt = 0;
      const completedAt = monotonicNow();
      nextDeadline = nextDeadline === null ? completedAt + period : nextDeadline + period;
      if (nextDeadline < completedAt) nextDeadline += Math.ceil((completedAt - nextDeadline) / period) * period;
    } catch {
      if (request.generation !== generation || !stillActive()) return;
      latest = null; state = 'unavailable'; nextDeadline = null; retryAt = monotonicNow() + retryInterval;
      releaseProcess();
    } finally { if (pending === request) { pending = undefined; schedule(); } }
  }
  return {
    read() {
      if (closed) return null;
      if (active && monotonicNow() >= leaseUntil) stop();
      active = true; leaseUntil = monotonicNow() + idleTimeout;
      if (state === 'idle') state = retryAt > monotonicNow() ? 'unavailable' : 'warming-up';
      renewLease(); schedule(true); return latest;
    },
    status() { return stillActive() ? state : 'idle'; },
    close() { if (closed) return; closed = true; stop(); },
  };
}

module.exports = { createWindowsCpuMonitor, createWindowsCpuProcess, preferredWindowsCpuMetric, parseWindowsCpuRecord,
  windowsCpuSamplerCommand, windowsCpuProcessCommand };
