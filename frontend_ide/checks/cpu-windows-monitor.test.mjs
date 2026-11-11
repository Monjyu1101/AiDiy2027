// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsCpuMonitor } from '../aidiy_cpu/windows-cpu-monitor.mjs';
import { createSystemMetrics } from '../aidiy_cpu/metrics.mjs';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const value = (time = 100, duration = 1000) => ({ cpu: { Name: '_Total', PercentProcessorTime: time, PercentProcessorUtility: time, SampleIntervalMs: duration }, gpu: [] });
function fixture({ ignoreAbort = false, factoryFailure = false, ...options } = {}) {
  let time = 0, id = 0, wallOffset = 1700000000000, factoryCalls = 0;
  const timers = new Map(), workers = [], requests = [];
  const clock = {
    now: () => wallOffset + time,
    monotonicNow: () => time,
    setTimer(fn, ms) { const key = ++id; timers.set(key, { at: time + ms, fn }); return key; },
    clearTimer(key) { timers.delete(key); },
  };
  const monitor = createWindowsCpuMonitor({ ...clock, makeProcess() {
    factoryCalls++;
    if (factoryFailure && factoryCalls === 1) throw Error('spawn failed');
    const worker = { closes: 0, sample(command, cpu, options) {
      return new Promise((resolve, reject) => {
        const request = { at: time, command, cpu, options, settled: false,
          resolve(data = value()) { if (request.settled) return; request.settled = true; resolve({ stdout: JSON.stringify(data) }); },
          raw(stdout) { if (request.settled) return; request.settled = true; resolve({ stdout }); },
          reject() { if (request.settled) return; request.settled = true; reject(Error('CPU failed')); },
        };
        options.signal.addEventListener('abort', () => { if (!ignoreAbort) request.reject(); }, { once: true });
        requests.push(request);
      });
    }, close() { worker.closes++; } };
    workers.push(worker);
    return worker;
  }, ...options });
  return { monitor, workers, requests, timers, clock,
    get time() { return time; }, get factoryCalls() { return factoryCalls; },
    shiftWall(ms) { wallOffset += ms; },
    jumpTo(target) { time = target; },
    async advanceTo(target) {
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = Math.max(time, next[1].at); timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = target; await flush();
    },
    async reply(data = value()) { requests.at(-1).resolve(data); await flush(); },
  };
}

test('初回readだけでCPU専用要求を開始し、同期で最新標本を返す', async () => {
  const f = fixture(); assert.equal(f.timers.size, 0); assert.equal(f.factoryCalls, 0);
  assert.equal(f.monitor.read(), null); assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.command, ''); assert.equal(request.cpu, true);
  assert.equal(request.options.freshCpu, true); assert.equal(request.options.timeout, 5000);
  assert.equal(request.options.maxBuffer, 512 * 1024); assert.ok(request.options.signal instanceof AbortSignal);
  await f.advanceTo(100); await f.reply(value(64));
  assert.deepEqual(f.monitor.read(), { cpu: { time: 64, utility: 64 }, measuredAt: f.clock.now(), sampleIntervalMs: 1000 });
  for (let i = 0; i < 100; i++) f.monitor.read();
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 2);
  f.monitor.close(); assert.equal(f.workers[0].closes, 1); assert.equal(f.timers.size, 0);
});

test('応答が50〜150ms揺れても初回標本を基準に1秒周期を保ち、同じ値を毎回採取する', async () => {
  const f = fixture(); f.monitor.read(); await f.advanceTo(100); await f.reply();
  let previous = f.monitor.read();
  for (let index = 1; index <= 60; index++) {
    const due = 100 + index * 1000;
    await f.advanceTo(due - 1); assert.equal(f.requests.length, index);
    await f.advanceTo(due); assert.equal(f.requests.length, index + 1);
    assert.equal(f.requests.at(-1).at, due);
    await f.advanceTo(due + [50, 150, 100][index % 3]); await f.reply();
    const current = f.monitor.read(); assert.notEqual(current, previous); assert.equal(current.cpu.time, 100);
    assert.ok(current.measuredAt > previous.measuredAt); previous = current;
  }
  assert.equal(f.factoryCalls, 1); f.monitor.close();
});

test('1時間相当3600回でも1秒予定・専用プロセス1本・タイマー2個を維持する', async () => {
  const f = fixture(); f.monitor.read(); await f.advanceTo(100); await f.reply(); f.monitor.read();
  for (let index = 1; index < 3600; index++) {
    const due = 100 + index * 1000;
    await f.advanceTo(due); assert.equal(f.requests.at(-1).at, due);
    await f.advanceTo(due + [50, 150][index % 2]); await f.reply(); f.monitor.read();
    assert.equal(f.requests.length, index + 1); assert.equal(f.timers.size, 2);
  }
  assert.equal(f.factoryCalls, 1); assert.equal(f.requests.length, 3600);
  f.monitor.close(); assert.equal(f.timers.size, 0); assert.equal(f.workers[0].closes, 1);
});

test('重複readと長い取得でも重複要求せず、過ぎた周期は飛ばして次の予定へ戻る', async () => {
  const f = fixture(); f.monitor.read(); await f.advanceTo(100); await f.reply();
  const previous = f.monitor.read(); await f.advanceTo(1100);
  for (const at of [1500, 2100, 3000, 3600]) {
    await f.advanceTo(at); assert.equal(f.monitor.read(), previous); assert.equal(f.requests.length, 2);
  }
  await f.reply(value(70)); assert.equal(f.requests.length, 2);
  await f.advanceTo(4099); assert.equal(f.requests.length, 2);
  await f.advanceTo(4100); assert.equal(f.requests.length, 3);
  f.monitor.close();
});

for (const duration of [200, 500]) {
  test(`${duration}msの100%は時間比で割らず次の標本まで100%のまま保持する`, async () => {
    const f = fixture(); f.monitor.read(); await f.advanceTo(100); await f.reply(value(100, duration));
    const record = f.monitor.read(); assert.equal(record.cpu.time, 100); assert.equal(record.cpu.utility, 100);
    assert.equal(record.sampleIntervalMs, duration);
    await f.advanceTo(1100); assert.equal(f.monitor.read(), record);
    await f.advanceTo(1300); assert.equal(f.monitor.read(), record);
    await f.reply(value(25, duration)); assert.equal(f.monitor.read().cpu.time, 25); f.monitor.close();
  });
}

test('readで3秒leaseを延長し、失効時は進行中の要求・予約・標本を解放して再開時だけ再作成する', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); await f.advanceTo(100); await f.reply();
  await f.advanceTo(2900); const old = f.requests.at(-1); f.monitor.read();
  await f.advanceTo(3000); assert.equal(f.workers[0].closes, 0);
  await f.advanceTo(5899); assert.equal(f.workers[0].closes, 0);
  await f.advanceTo(5900); assert.equal(f.workers[0].closes, 1); assert.ok(old.options.signal.aborted);
  assert.equal(f.timers.size, 0); await f.advanceTo(60000); assert.equal(f.factoryCalls, 1);
  assert.equal(f.monitor.read(), null); assert.equal(f.factoryCalls, 2);
  old.resolve(value(99)); await flush(); assert.equal(f.monitor.read(), null);
  await f.reply(value(20)); assert.equal(f.monitor.read().cpu.time, 20);
  f.monitor.close(); assert.equal(f.timers.size, 0); assert.equal(f.workers[1].closes, 1);
});

test('タイマー実行が止まった間にleaseが切れてもreadで旧世代を解放する', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); const old = f.requests[0];
  f.jumpTo(4000); assert.equal(f.monitor.read(), null); assert.equal(f.factoryCalls, 2);
  assert.ok(old.options.signal.aborted); old.resolve(); await flush(); assert.equal(f.monitor.read(), null);
  await f.reply(value(30)); assert.equal(f.monitor.read().cpu.time, 30); f.monitor.close();
});

for (const failure of ['invalid-json', 'missing-cpu', 'invalid-cpu', 'rejected', 'factory']) {
  test(`${failure}の失敗はCPUをnullにして30秒休止し、期限後だけ再試行する`, async () => {
    const f = fixture({ factoryFailure: failure === 'factory' }); f.monitor.read();
    if (failure === 'invalid-json') f.requests[0].raw('not JSON');
    if (failure === 'missing-cpu') f.requests[0].resolve({ cpu: null, gpu: [{ anything: 100 }] });
    if (failure === 'invalid-cpu') f.requests[0].resolve({ cpu: { Name: '_Total', PercentProcessorTime: -1 } });
    if (failure === 'rejected') f.requests[0].reject();
    await flush(); assert.equal(f.monitor.read(), null);
    for (let at = 1000; at < 30000; at += 1000) {
      await f.advanceTo(at); f.monitor.read(); assert.equal(f.factoryCalls, 1);
    }
    await f.advanceTo(30000); assert.equal(f.factoryCalls, 2);
    await f.reply(value(0)); assert.equal(f.monitor.read().cpu.time, 0); f.monitor.close();
  });
}

test('有効値の後のCPU失敗は直前値を消し、表示切替でも30秒休止をリセットしない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(value(80)); f.monitor.read();
  await f.advanceTo(1000); f.requests.at(-1).reject(); await flush(); assert.equal(f.monitor.read(), null);
  await f.advanceTo(4000); assert.equal(f.timers.size, 0);
  for (const at of [5000, 9000, 13000, 17000, 21000, 25000, 29000]) {
    await f.advanceTo(at); assert.equal(f.monitor.read(), null); assert.equal(f.factoryCalls, 1);
  }
  await f.advanceTo(31000); assert.equal(f.factoryCalls, 2); await f.reply(value(60));
  assert.equal(f.monitor.read().cpu.time, 60); f.monitor.close();
});

test('closeは永久停止し、中止を無視した旧応答でも値やタイマーが復活しない', async () => {
  const f = fixture({ ignoreAbort: true }); f.monitor.read(); const pending = f.requests[0];
  f.monitor.close(); f.monitor.close(); assert.ok(pending.options.signal.aborted);
  pending.resolve(); await flush(); assert.equal(f.monitor.read(), null);
  await f.advanceTo(3600000); assert.equal(f.factoryCalls, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.workers[0].closes, 1);
});

test('実時間時計が前後しても周期とleaseは単調時計を使う', async () => {
  const f = fixture(); f.monitor.read(); await f.advanceTo(100); await f.reply(); f.monitor.read();
  f.shiftWall(-3600000); await f.advanceTo(1100); assert.equal(f.requests.length, 2);
  await f.reply(); assert.equal(f.monitor.read().measuredAt, f.clock.now());
  f.shiftWall(7200000); await f.advanceTo(2100); assert.equal(f.requests.length, 3); f.monitor.close();
});

test('実monitorをmetricsへ接続してもGPUが3秒待機中にCPUは毎秒更新される', async () => {
  const f = fixture(); let finishGpu, gpuRequests = 0;
  const metrics = createSystemMetrics({ platform: 'win32', now: f.clock.now, windowsCpuMetrics: f.monitor,
    system: { cpus: () => [{ times: { user: f.time, idle: f.time } }], totalmem: () => 1000, freemem: () => 250, release: () => '10.0.26100' },
    windowsMetrics: { sample(command, readCpu) { gpuRequests++; assert.equal(readCpu, false); return new Promise(resolve => { finishGpu = resolve; }); }, close() {} },
    run: async () => { throw Error('NVIDIA not required'); },
  });
  assert.equal((await metrics.sample()).cpu, null); assert.equal(gpuRequests, 1);
  for (let index = 0; index < 3; index++) {
    await f.advanceTo(index === 0 ? 100 : 100 + index * 1000);
    await f.reply(value(10 + index));
    const result = await metrics.sample(); assert.equal(result.cpu, 10 + index);
    assert.equal(result.cpuSource, 'windows-processor-time'); assert.equal(result.gpu, null);
    assert.equal(gpuRequests, 1); assert.equal(f.factoryCalls, 1);
  }
  await f.advanceTo(3000);
  finishGpu({ stdout: JSON.stringify({ gpu: [{ Name: 'pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D', UtilizationPercentage: 40 }] }) });
  await flush(); await f.advanceTo(3100); await f.reply(value(100, 500));
  const result = await metrics.sample(); assert.equal(result.cpu, 100); assert.equal(result.gpu, 40);
  assert.equal(result.cpuDetails.windowsSampleIntervalMs, 500); assert.equal(f.requests.length, 4);
  metrics.close(); assert.equal(f.timers.size, 0);
});
