// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { createWindowsCpuMonitor, createWindowsCpuProcess, preferredWindowsCpuMetric, parseWindowsCpuRecord,
  windowsCpuSamplerCommand, windowsCpuProcessCommand } = require('../aidiy_cpu/windows-native-cpu.cjs');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const row = (time = 8, utility = 95) => ({ Name: '_Total', PercentProcessorTime: time, PercentProcessorUtility: utility,
  PercentIdleTime: 92, SampleIntervalMs: 1000, TimestampSys100Ns: '133333333333333333', Sequence: 1 });
function clock() {
  let time = 0, id = 0, offset = 1700000000000;
  const timers = new Map(), history = [];
  const options = { now: () => time + offset, monotonicNow: () => time,
    setTimer(fn, ms) { const key = ++id, item = { at: time + ms, fn }; timers.set(key, item); history.push(item); return key; },
    clearTimer(key) { timers.delete(key); } };
  return { timers, history, options, get time() { return time; }, shiftWall(ms) { offset += ms; }, jump(at) { time = at; },
    async advance(at) {
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= at).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = Math.max(time, next[1].at); timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = Math.max(time, at); await flush();
    } };
}
function fixture({ ignoreAbort = false, factoryFailure = false, ...options } = {}) {
  const time = clock(), workers = [], requests = []; let factories = 0;
  const monitor = createWindowsCpuMonitor({ ...time.options, system: { release: () => '10.0.22631' }, makeProcess() {
    factories++; if (factoryFailure && factories === 1) throw Error('spawn failed');
    const worker = { closes: 0, sample({ signal }) { return new Promise((resolve, reject) => {
      const pending = { at: time.time, signal, done: false,
        reply(cpu = row()) { if (pending.done) return; pending.done = true; resolve({ cpu }); },
        reject() { if (pending.done) return; pending.done = true; reject(Error('CPU failed')); } };
      signal.addEventListener('abort', () => { if (!ignoreAbort) pending.reject(); }, { once: true }); requests.push(pending);
    }); }, close() { worker.closes++; } }; workers.push(worker); return worker;
  }, ...options });
  return { ...time, monitor, workers, requests, get factories() { return factories; }, async reply(cpu) { requests.at(-1).reply(cpu); await flush(); } };
}
function processFixture(options = {}) {
  const time = clock(), children = [];
  const worker = createWindowsCpuProcess({ ...time.options, spawn(file, args, opts) {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.writes = []; child.kills = 0; child.stdin.on('data', data => child.writes.push(String(data))); child.kill = () => { child.kills++; return true; };
    children.push({ child, file, args, opts }); return child;
  }, ...options });
  return { ...time, worker, children, get child() { return children.at(-1)?.child; }, reply(cpu = row()) { this.child.stdout.write(JSON.stringify({ cpu }) + '\r\n'); } };
}

test('公開CJSをESMとCommonJSから同じ実装として使える', async () => {
  const imported = await import('../aidiy_cpu/windows-native-cpu.cjs');
  assert.equal(imported.default.createWindowsCpuMonitor, createWindowsCpuMonitor);
  assert.equal(imported.createWindowsCpuMonitor, createWindowsCpuMonitor);
});

test('OS指標はWin10〜23H2だけUtility、24H2以後・未知はTimeを起動時に固定する', async () => {
  for (const release of ['10.0.10240', '10.0.19045', '10.0.22000', '10.0.22621', '10.0.22631.1']) assert.equal(preferredWindowsCpuMetric(release), 'utility');
  for (const release of ['10.0.26100', '10.0.26200', '10.0.9600', '6.3.9600', null, 'unknown']) assert.equal(preferredWindowsCpuMetric(release), 'time');
  let release = '10.0.22631', calls = 0;
  const f = fixture({ system: { release() { calls++; return release; } } });
  f.monitor.read(); await f.reply(); assert.equal(f.monitor.read().cpu, 95); release = '10.0.26100';
  await f.advance(1000); await f.reply(row(30, 80)); assert.equal(f.monitor.read().cpu, 80); assert.equal(calls, 1); f.monitor.close();
});

test('指標overrideを固定し、Utility欠損でTimeやos.cpusへ切り替えない', async () => {
  const f = fixture({ metric: 'time', system: { release() { throw Error('不要'); }, cpus() { throw Error('利用禁止'); } } });
  f.monitor.read(); await f.reply(); assert.equal(f.monitor.read().cpu, 8); assert.equal(f.monitor.read().source, 'windows-processor-time');
  await f.advance(1000); await f.reply(row(null, 100)); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable'); f.monitor.close();
  const utility = fixture(); utility.monitor.read(); await utility.reply(row(100, null)); assert.equal(utility.monitor.read(), null);
  assert.equal(utility.monitor.status(), 'unavailable'); utility.monitor.close();
});

test('0%と100%を有効保持し、Utility100超は表示のみclampしてrawを残す', () => {
  const zero = parseWindowsCpuRecord(row(0, 0), 'utility', 123); assert.equal(zero.cpu, 0);
  const high = parseWindowsCpuRecord(row(8, 145), 'utility', 123);
  assert.equal(high.cpu, 100); assert.equal(high.windowsProcessorUtility, 145); assert.equal(high.windowsProcessorTime, 8);
  assert.equal(high.windowsProcessorIdle, 92); assert.equal(high.measuredAt, 123);
  assert.equal(high.windowsTimestampSys100Ns, '133333333333333333');
  for (const duration of [200, 500, 1000]) {
    const value = parseWindowsCpuRecord({ ...row(100, 100), SampleIntervalMs: duration }, 'time', 0);
    assert.equal(value.cpu, 100); assert.equal(value.sampleIntervalMs, duration);
  }
});

test('VT_BSTR数値のみを変換し、空文字/null/boolean/NaNを偽0%にしない', () => {
  assert.equal(parseWindowsCpuRecord(row('12', '95.5'), 'utility', 0).cpu, 95.5);
  for (const invalid of ['', ' ', null, undefined, false, true, NaN, Infinity, -1, 'bad']) assert.equal(parseWindowsCpuRecord({ ...row(50), PercentProcessorUtility: invalid }, 'utility', 0), null);
  assert.equal(parseWindowsCpuRecord(row(101, 50), 'time', 0), null);
  assert.equal(parseWindowsCpuRecord([{ ...row(), Name: '0,_Total' }], 'utility', 0), null);
  assert.equal(parseWindowsCpuRecord([{ ...row(), Name: '0,_Total' }, row()], 'utility', 0).cpu, 95);
});

test('初回はnull/warming-up、500msのeyes readは追加採取せず最新native値を保持する', async () => {
  const f = fixture({ interval: 500 }); assert.equal(f.factories, 0); assert.equal(f.timers.size, 0); assert.equal(f.monitor.status(), 'idle');
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up');
  await f.advance(500); assert.equal(f.monitor.read(), null); assert.equal(f.requests.length, 1);
  await f.advance(1000); await f.reply(); const value = f.monitor.read(); assert.equal(value.cpu, 95);
  await f.advance(1500); assert.equal(f.monitor.read(), value); assert.equal(f.requests.length, 1);
  await f.advance(2000); assert.equal(f.requests.length, 2); assert.equal(f.monitor.read(), value);
  await f.reply(row(50, 70)); assert.equal(f.monitor.read().cpu, 70); f.monitor.close();
});

test('50〜150msの応答遅延でも完了後1秒を足さず固定予定を維持する', async () => {
  const f = fixture(); f.monitor.read(); await f.advance(1000); await f.reply(); f.monitor.read();
  for (let index = 1; index <= 60; index++) {
    const due = 1000 + index * 1000; await f.advance(due); assert.equal(f.requests.at(-1).at, due);
    await f.advance(due + [50, 150][index % 2]); await f.reply(); assert.equal(f.monitor.read().cpu, 95);
  }
  assert.equal(f.factories, 1); f.monitor.close();
});

test('1時間3600回でも専用process1本・timer2個だけを再利用する', async () => {
  const f = fixture(); f.monitor.read(); await f.advance(1000); await f.reply(); f.monitor.read();
  for (let index = 1; index < 3600; index++) {
    await f.advance(1000 + index * 1000); await f.reply(); f.monitor.read(); assert.equal(f.timers.size, 2);
  }
  assert.equal(f.requests.length, 3600); assert.equal(f.factories, 1); f.monitor.close(); assert.equal(f.timers.size, 0);
});

test('重複read・長い取得はpending1件に抑え、過ぎた周期を連発しない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); f.monitor.read(); await f.advance(1000);
  for (const at of [1500, 2000, 2500, 3600]) { await f.advance(at); f.monitor.read(); assert.equal(f.requests.length, 2); }
  await f.reply(); assert.equal(f.requests.length, 2); await f.advance(3999); assert.equal(f.requests.length, 2);
  await f.advance(4000); assert.equal(f.requests.length, 3); f.monitor.close();
});

test('3秒無readでpendingを中止・最新値と予約を解放し、再開時だけ新processを作る', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); await f.reply(); await f.advance(1000); const old = f.requests.at(-1);
  await f.advance(3000); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.workers[0].closes, 1); assert.ok(old.signal.aborted);
  assert.equal(f.timers.size, 0); await f.advance(60000); assert.equal(f.factories, 1);
  assert.equal(f.monitor.read(), null); assert.equal(f.factories, 2); old.reply(row(100, 100)); await flush(); assert.equal(f.monitor.read(), null);
  await f.reply(row(50, 70)); assert.equal(f.monitor.read().cpu, 70); f.monitor.close();
});

test('停止したevent loopからのreadでもlease期限を確認し、旧timerを無視する', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); const oldTimers = [...f.history]; f.jump(4000);
  assert.equal(f.monitor.read(), null); assert.equal(f.factories, 2); const activeTimers = [...f.timers.keys()];
  for (const timer of oldTimers) timer.fn(); assert.deepEqual([...f.timers.keys()], activeTimers);
  await f.reply(); assert.equal(f.monitor.read().cpu, 95); f.monitor.close();
});

for (const failure of ['factory', 'reject', 'cpu-null', 'selected-missing']) {
  test(`${failure}はCPUをnullにし30秒休止、表示切替でbackoffをリセットしない`, async () => {
    const f = fixture({ factoryFailure: failure === 'factory' }); f.monitor.read();
    if (failure === 'reject') f.requests[0].reject();
    if (failure === 'cpu-null') f.requests[0].reply(null);
    if (failure === 'selected-missing') f.requests[0].reply(row(100, null));
    await flush(); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
    for (const at of [4000, 8000, 12000, 16000, 20000, 24000, 28000]) { await f.advance(at); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable'); assert.equal(f.factories, 1); }
    await f.advance(30000); assert.equal(f.factories, 2); assert.equal(f.monitor.status(), 'warming-up');
    await f.reply(row(0, 0)); assert.equal(f.monitor.read().cpu, 0); f.monitor.close();
  });
}

test('closeは永久停止し、旧応答・timer・statusでも監視を復活させない', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); const pending = f.requests[0], oldTimers = [...f.history];
  f.monitor.close(); f.monitor.close(); pending.reply(); for (const item of oldTimers) item.fn(); await flush();
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.timers.size, 0);
  assert.ok(pending.signal.aborted); assert.equal(f.workers[0].closes, 1); assert.equal(f.factories, 1);
});

test('実時計の変更は周期とleaseを動かさない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); f.monitor.read(); f.shiftWall(-3600000);
  await f.advance(1000); await f.reply(); assert.equal(f.monitor.read().measuredAt, f.options.now());
  f.shiftWall(7200000); await f.advance(2000); assert.equal(f.requests.length, 3); f.monitor.close();
});

test('固定PowerShellはGPU・Get-CimInstance・任意コマンド実行を含まず初回baselineを捨てる', () => {
  assert.match(windowsCpuProcessCommand, /\[Console\]::ReadLine\(\)/);
  assert.match(windowsCpuProcessCommand, /\$request -cne 'cpu'/);
  assert.match(windowsCpuSamplerCommand, /WbemScripting.SWbemRefresher/);
  assert.match(windowsCpuSamplerCommand, /Win32_PerfFormattedData_Counters_ProcessorInformation/);
  assert.match(windowsCpuSamplerCommand, /while \(\$script:cpuClock.ElapsedMilliseconds -lt 1000\)/);
  assert.ok(windowsCpuSamplerCommand.indexOf('$script:cpuClock.Restart()') < windowsCpuSamplerCommand.lastIndexOf('$script:cpuRefresher.Refresh()'));
  assert.doesNotMatch(windowsCpuProcessCommand, /Get-CimInstance|Get-Counter|Invoke-Expression|Add-Type|GPU|ScriptBlock\]::Create/);
  assert.ok(Buffer.from(windowsCpuProcessCommand, 'utf16le').toString('base64').length < 30000);
});

test('CPU専用processは60回でも1起動、固定stdinとJSON pipeだけを使う', async () => {
  const f = processFixture();
  for (let i = 0; i < 60; i++) { const pending = f.worker.sample(); f.reply(); assert.equal((await pending).cpu.PercentProcessorUtility, 95); }
  assert.equal(f.children.length, 1); assert.equal(f.child.writes.length, 60); assert.ok(f.child.writes.every(line => line === 'cpu\n'));
  assert.equal(f.children[0].file, 'powershell.exe'); assert.equal(f.children[0].opts.shell, false); assert.equal(f.children[0].opts.windowsHide, true);
  assert.equal(Buffer.from(f.children[0].args.at(-1), 'base64').toString('utf16le'), windowsCpuProcessCommand);
  assert.equal(f.timers.size, 0); f.worker.close(); assert.equal(f.child.kills, 1);
});

test('UTF8分割・BOM・CRLF応答を読み、進行中の追加要求は拒否する', async () => {
  const f = processFixture(); const pending = f.worker.sample(); await assert.rejects(f.worker.sample(), /実行中/);
  const bytes = Buffer.from('\uFEFF' + JSON.stringify({ cpu: row(), text: '計測' }) + '\r\n');
  for (const byte of bytes) f.child.stdout.write(Buffer.from([byte]));
  assert.equal((await pending).cpu.PercentProcessorUtility, 95); f.worker.close();
});

for (const failure of ['idle-exit', 'late-duplicate', 'same-turn-duplicate']) {
  test(`monitorとprocess統合: ${failure}は次周期を待たず値を消し30秒backoffへ入る`, async () => {
    const time = clock(), transports = [];
    const monitor = createWindowsCpuMonitor({ ...time.options, metric: 'utility', makeProcess({ onFailure }) {
      const transport = processFixture({ ...time.options, onFailure }); transports.push(transport); return transport.worker;
    } });
    monitor.read(); const transport = transports[0]; transport.reply();
    if (failure !== 'same-turn-duplicate') { await flush(); assert.equal(monitor.read().cpu, 95); }
    if (failure === 'idle-exit') transport.child.emit('exit', 1); else transport.child.stdout.write('{}\n');
    await flush(); assert.equal(monitor.read(), null); assert.equal(monitor.status(), 'unavailable');
    assert.equal(transport.child.kills, 1); assert.equal(time.timers.size, 2);
    for (let at = 1000; at < 30000; at += 1000) { await time.advance(at); monitor.read(); assert.equal(transports.length, 1); }
    await time.advance(30000); assert.equal(transports.length, 2); transports[1].reply(row(0, 0)); await flush();
    assert.equal(monitor.read().cpu, 0); transport.child.emit('exit', 1); assert.equal(monitor.read().cpu, 0);
    monitor.close(); assert.equal(time.timers.size, 0); assert.equal(transports[1].child.kills, 1);
  });
}

for (const failure of ['timeout', 'abort', 'exit', 'spawn-error', 'stdin-error', 'invalid-json', 'duplicate', 'stdout-limit', 'stderr-limit']) {
  test(`processの${failure}は要求をreject・子を解放し、同じworkerで勝手に再起動しない`, async () => {
    const f = processFixture({ maxBuffer: 1024 }), controller = new AbortController();
    const pending = f.worker.sample({ signal: controller.signal }), rejected = assert.rejects(pending);
    if (failure === 'timeout') await f.advance(5000);
    if (failure === 'abort') controller.abort();
    if (failure === 'exit') f.child.emit('exit', 1);
    if (failure === 'spawn-error') f.child.emit('error', Error('missing'));
    if (failure === 'stdin-error') f.child.stdin.emit('error', Error('pipe'));
    if (failure === 'invalid-json') f.child.stdout.write('bad\n');
    if (failure === 'duplicate') f.child.stdout.write('{}\n{}\n');
    if (failure === 'stdout-limit') f.child.stdout.write('x'.repeat(1025));
    if (failure === 'stderr-limit') f.child.stderr.write('x'.repeat(1025));
    await rejected; assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
    await assert.rejects(f.worker.sample()); assert.equal(f.children.length, 1); f.worker.close();
  });
}

test('実OS pipeでも同じ子を再利用し、closeで実子プロセスが終了する', async () => {
  let child, starts = 0;
  const worker = createWindowsCpuProcess({ spawn() {
    starts++; child = spawn(process.execPath, ['-e', `require('node:readline').createInterface({input:process.stdin}).on('line',()=>process.stdout.write(${JSON.stringify(JSON.stringify({ cpu: row() }) + '\n')}))`], { stdio: ['pipe', 'pipe', 'pipe'] }); return child;
  } });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await worker.sample()).cpu.PercentProcessorUtility, 95);
    assert.equal(starts, 1); const exited = new Promise(resolve => child.once('exit', resolve)); worker.close(); await exited;
    assert.equal(child.killed, true);
  } finally { worker.close(); }
});

test('Windows実PowerShell: 暖機値を捨て1秒以上の新Refreshを返し、同じCOMを再利用する', { skip: process.platform !== 'win32' }, async () => {
  const { mockCpuRefresher } = await import('./cpu-windows-fixture.mjs'); let starts = 0;
  const worker = createWindowsCpuProcess({ spawn(file, args, options) {
    starts++; args[args.length - 1] = Buffer.from(mockCpuRefresher({ time: 8, utility: 95 }) + windowsCpuProcessCommand, 'utf16le').toString('base64');
    return spawn(file, args, options);
  } });
  try {
    const first = (await worker.sample()).cpu, second = (await worker.sample()).cpu;
    assert.equal(first.PercentProcessorTime, 8); assert.equal(first.PercentProcessorUtility, 95);
    assert.ok(first.SampleIntervalMs >= 1000); assert.ok(second.SampleIntervalMs >= 1000);
    assert.equal(first.Sequence, 1); assert.equal(second.Sequence, 2); assert.equal(starts, 1);
  } finally { worker.close(); }
});
