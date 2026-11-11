// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOsCpuMonitor } from '../aidiy_cpu/os-cpu-monitor.mjs';
import { createSystemMetrics } from '../aidiy_cpu/metrics.mjs';

const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture({ count = 4, cost = () => 0, source = at => Array.from({ length: count }, () => cpu(at * .4, at * .6)), ...options } = {}) {
  let time = 0, id = 0, wallOffset = 1700000000000;
  const calls = [], timers = new Map(), history = [];
  const clock = {
    now: () => wallOffset + time, monotonicNow: () => time,
    setTimer(fn, ms) { const timer = ++id; const entry = { at: time + ms, fn }; timers.set(timer, entry); history.push(entry); return timer; },
    clearTimer(timer) { timers.delete(timer); },
  };
  const monitor = createOsCpuMonitor({ ...clock, system: { cpus() {
    calls.push(time); const result = source(time, calls.length); time += cost(calls.length); return result;
  } }, ...options });
  return { monitor, calls, timers, history, clock,
    get time() { return time; }, setSource(next) { source = next; }, shiftWall(ms) { wallOffset += ms; },
    jumpTo(at) { time = at; },
    advanceTo(target) {
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = Math.max(time, next[1].at); timers.delete(next[0]); next[1].fn();
      }
      time = Math.max(time, target);
    },
  };
}

test('初回read前には採取せず、基準採取後の500msから最新値を返す', () => {
  const f = fixture(); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up'); assert.deepEqual(f.calls, [0]);
  f.advanceTo(499); assert.equal(f.monitor.read(), null); assert.equal(f.calls.length, 1);
  f.advanceTo(500); const record = f.monitor.read();
  near(record.cpu, 40); assert.equal(record.rawIdleDeltaMs, 1200); assert.equal(record.rawTotalDeltaMs, 2000); assert.equal(record.rawBusyDeltaMs, 800); assert.equal(record.measuredAt, f.clock.now()); assert.equal(record.sampleIntervalMs, 500);
  assert.equal(record.logicalCpuCount, 4); assert.equal(f.monitor.status(), 'available');
  f.monitor.close(); assert.equal(f.timers.size, 0);
});

test('全論理CPUの差分を合計し、コア数で再び割らない', () => {
  let data = [cpu(100, 100), cpu(200, 200), cpu(300, 300), cpu(400, 400)];
  const f = fixture({ source: () => data }); f.monitor.read();
  data = [cpu(600, 100), cpu(200, 700), cpu(800, 300), cpu(400, 900)]; f.advanceTo(500);
  assert.equal(f.monitor.read().cpu, 50); assert.equal(f.monitor.read().logicalCpuCount, 4); f.monitor.close();
});

test('500msの100%は50%に縮めず、1秒表示の間も移動平均を取らない', () => {
  let data = [cpu(0, 0)]; const f = fixture({ source: () => data }); f.monitor.read();
  data = [cpu(500, 0)]; f.advanceTo(500); const full = f.monitor.read(); assert.equal(full.cpu, 100);
  f.advanceTo(999); assert.equal(f.monitor.read(), full);
  data = [cpu(500, 500)]; f.advanceTo(1000); assert.equal(f.monitor.read().cpu, 0);
  data = [cpu(1000, 500)]; f.advanceTo(1500); assert.equal(f.monitor.read().cpu, 100); f.monitor.close();
});

test('200ms周期でも100%は100%で、次の標本までそのまま保持する', () => {
  const f = fixture({ interval: 200, source: at => [cpu(at, 0)] }); f.monitor.read(); f.advanceTo(200);
  const current = f.monitor.read(); assert.equal(current.cpu, 100); assert.equal(current.sampleIntervalMs, 200);
  f.advanceTo(399); assert.equal(f.monitor.read(), current); f.monitor.close();
});

for (const interval of [100, 200, 500]) test(`${interval}ms区間の70%は70%で、1秒表示に合わせて縮小しない`, () => {
  const f = fixture({ interval, source: at => [cpu(at * .7, at * .3)] }); f.monitor.read(); f.advanceTo(interval);
  const record = f.monitor.read(); near(record.cpu, 70); assert.equal(record.sampleIntervalMs, interval);
  f.advanceTo(interval * 2 - 1); assert.equal(f.monitor.read(), record); f.monitor.close();
});

test('HTTPの連続readとstatus照会は追加採取や500ms予定の変更を生まない', () => {
  const f = fixture(); f.monitor.read();
  for (let at = 1; at <= 1600; at++) { f.advanceTo(at); f.monitor.read(); f.monitor.status(); }
  assert.deepEqual(f.calls, [0, 500, 1000, 1500]); assert.equal(f.timers.size, 2); f.monitor.close();
});

test('採取処理に50〜150msかかっても完了後500ms待たず、予定時刻を維持する', () => {
  const f = fixture({ cost: index => index === 1 ? 0 : [50, 150][index % 2] }); f.monitor.read();
  for (let index = 1; index <= 120; index++) {
    f.advanceTo(index * 500); near(f.monitor.read().cpu, 40); assert.equal(f.calls.at(-1), index * 500);
    assert.equal(f.timers.size, 2);
  }
  f.monitor.close();
});

test('1時間の1秒表示でも500ms採取7200回、タイマー2個を維持する', () => {
  const f = fixture(); f.monitor.read();
  for (let seconds = 1; seconds <= 3600; seconds++) {
    f.advanceTo(seconds * 1000); const current = f.monitor.read();
    assert.equal(current.sampleIntervalMs, 500); near(current.cpu, 40); assert.equal(f.timers.size, 2);
  }
  assert.equal(f.calls.length, 7201); assert.equal(f.calls.at(-1), 3600000); f.monitor.close();
});

test('遅れたタイマーは1回だけ採取し、逃した周期を連発せず元の予定へ戻る', () => {
  const f = fixture(); f.monitor.read(); f.jumpTo(1700); f.advanceTo(1700);
  assert.deepEqual(f.calls, [0, 1700]); assert.equal(f.monitor.read().sampleIntervalMs, 1700);
  f.advanceTo(1999); assert.equal(f.calls.length, 2); f.advanceTo(2000); assert.deepEqual(f.calls, [0, 1700, 2000]);
  assert.equal(f.monitor.read().sampleIntervalMs, 300); near(f.monitor.read().cpu, 40); f.monitor.close();
});

test('既定2.5秒を超えた採取窓は捨てて基準を更新し、次周期で回復する', () => {
  const f = fixture(); f.monitor.read(); f.jumpTo(2600); f.advanceTo(2600);
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
  f.advanceTo(3000); assert.equal(f.monitor.status(), 'available'); near(f.monitor.read().cpu, 40);
  assert.equal(f.monitor.read().sampleIntervalMs, 400); f.monitor.close();
});

test('最後のreadから3秒で停止し、再表示では休止中の累積平均を捨てる', () => {
  const f = fixture(); f.monitor.read(); f.advanceTo(500); near(f.monitor.read().cpu, 40);
  f.advanceTo(3499); assert.equal(f.monitor.status(), 'available');
  f.advanceTo(3500); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.timers.size, 0);
  const previousCalls = f.calls.length; f.advanceTo(60000); assert.equal(f.calls.length, previousCalls);
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up');
  f.advanceTo(60500); assert.equal(f.monitor.read().sampleIntervalMs, 500); near(f.monitor.read().cpu, 40); f.monitor.close();
});

test('タイマーが止まってもreadで期限切れを回収し、古いコールバックを無視する', () => {
  const f = fixture(); f.monitor.read(); const oldCallbacks = [...f.history];
  f.jumpTo(4000); assert.equal(f.monitor.read(), null); assert.deepEqual(f.calls, [0, 4000]);
  const liveTimers = [...f.timers.keys()]; for (const entry of oldCallbacks) entry.fn();
  assert.deepEqual([...f.timers.keys()], liveTimers); assert.deepEqual(f.calls, [0, 4000]);
  f.advanceTo(4500); assert.equal(f.monitor.read().sampleIntervalMs, 500); f.monitor.close();
});

test('statusだけではleaseを延長せず、期限切れの最新値をavailableにしない', () => {
  const f = fixture(); f.monitor.read(); f.advanceTo(500); assert.equal(f.monitor.status(), 'available');
  f.jumpTo(3000); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.timers.size, 0);
  assert.equal(f.calls.length, 2); f.monitor.close();
});

for (const bad of [[], null, [{}], [{ times: { user: NaN, idle: 0 } }], [{ times: { user: 1, idle: Infinity } }], [{ times: { user: -1, idle: 1 } }], [{ times: { user: '1', idle: 0 } }], [{ times: { user: 1 } }]]) {
  test(`不正CPUスナップショット ${JSON.stringify(bad)} は0%にせず基準を取り直す`, () => {
    const f = fixture({ source: () => bad }); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
    f.setSource(at => [cpu(at, 0)]); f.advanceTo(500); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up');
    f.advanceTo(1000); assert.equal(f.monitor.read().cpu, 100); assert.equal(f.monitor.status(), 'available'); f.monitor.close();
  });
}

test('os.cpus例外は古い値を消し、次周期から新しい基準で回復する', () => {
  const f = fixture(); f.monitor.read(); f.advanceTo(500); near(f.monitor.read().cpu, 40);
  f.setSource(() => { throw Error('CPU unavailable'); }); f.advanceTo(1000);
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
  f.setSource(at => [cpu(at, 0)]); f.advanceTo(1500); assert.equal(f.monitor.status(), 'warming-up');
  f.advanceTo(2000); assert.equal(f.monitor.read().cpu, 100); f.monitor.close();
});

for (const [label, initial, invalid, recovered] of [
  ['差分0', [cpu(100, 100)], [cpu(100, 100)], [cpu(200, 100)]],
  ['累積値巻戻り', [cpu(1000, 1000)], [cpu(100, 100)], [cpu(200, 100)]],
  ['idle巻戻り', [cpu(100, 100)], [cpu(300, 50)], [cpu(400, 50)]],
  ['idle差分超過', [cpu(100, 100)], [cpu(50, 200)], [cpu(150, 200)]],
  ['CPU数変化', [cpu(100, 100)], [cpu(200, 100), cpu(200, 100)], [cpu(300, 100), cpu(300, 100)]],
]) {
  test(`${label}は不正区間を捨てて、次の正常な差分だけを採用する`, () => {
    let data = initial; const f = fixture({ source: () => data }); f.monitor.read();
    data = invalid; f.advanceTo(500); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
    data = recovered; f.advanceTo(1000); assert.equal(f.monitor.read().cpu, 100); assert.equal(f.monitor.read().sampleIntervalMs, 500); f.monitor.close();
  });
}

test('実時計が前後しても採取間隔とleaseは単調時計を使う', () => {
  const f = fixture(); f.monitor.read(); f.shiftWall(-3600000); f.advanceTo(500);
  assert.equal(f.monitor.read().sampleIntervalMs, 500); assert.equal(f.monitor.read().measuredAt, f.clock.now());
  f.shiftWall(7200000); f.advanceTo(1000); assert.equal(f.monitor.read().sampleIntervalMs, 500); f.monitor.close();
});

test('closeは初回前も採取中も永久停止し、タイマーと最新値を解放する', () => {
  const neverStarted = fixture(); neverStarted.monitor.close(); assert.equal(neverStarted.monitor.read(), null);
  assert.equal(neverStarted.calls.length, 0); assert.equal(neverStarted.timers.size, 0);
  const f = fixture(); f.monitor.read(); f.advanceTo(500); const oldCallbacks = [...f.history];
  f.monitor.close(); f.monitor.close(); for (const entry of oldCallbacks) entry.fn();
  f.advanceTo(60000); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'idle');
  assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
});

test('採取間隔とleaseの不正設定を拒否する', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => createOsCpuMonitor({ interval: value }), RangeError);
    assert.throws(() => createOsCpuMonitor({ idleTimeout: value }), RangeError);
  }
});

test('metrics統合: GPUの3秒待機中も500ms採取を続け、1秒APIは平均なしの最新値と失敗・復帰を返す', async () => {
  let data = [cpu(0, 0)], finishGpu, gpuRequests = 0, gpuCloses = 0, directCpuReads = 0;
  const f = fixture({ source: () => data });
  const gpuResponse = { stdout: JSON.stringify({ gpu: [
    { Name: 'pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D', UtilizationPercentage: 40 },
  ] }) };
  const metrics = createSystemMetrics({ platform: 'win32', now: f.clock.now, monotonicNow: f.clock.monotonicNow, cpuMetrics: f.monitor,
    system: { cpus() { directCpuReads++; throw Error('HTTPでCPUを再採取しない'); },
      totalmem: () => 1000, freemem: () => 250, release: () => '10.0.26100' },
    windowsMetrics: { sample(command, readCpu) {
      gpuRequests++; assert.equal(readCpu, false); assert.ok(command);
      return gpuRequests === 1 ? new Promise(resolve => { finishGpu = resolve; }) : Promise.resolve(gpuResponse);
    }, close() { gpuCloses++; } },
    run: async () => { throw Error('NVIDIAへの代替取得は不要'); },
  });
  try {
    const first = await metrics.sample(); assert.equal(first.cpu, null); assert.equal(first.cpuSource, 'warming-up');
    assert.equal(first.ram, 75); assert.equal(first.gpu, null); assert.equal(gpuRequests, 1);
    for (const [at, user, idle, expected] of [
      [500, 500, 0, null], [1000, 500, 500, 0],
      [1500, 500, 1000, null], [2000, 1000, 1000, 100],
      [2500, 1500, 1000, null], [3000, 1500, 1500, 0],
    ]) {
      data = [cpu(user, idle)]; f.advanceTo(at);
      // APIは1秒ごとだけ。途中の500ms標本と平均せず、最後の標本をそのまま返す。
      if (expected !== null) {
        const result = await metrics.sample(); assert.equal(result.cpu, expected); assert.equal(result.cpuSource, 'os-times');
        assert.equal(result.cpuDetails.sampleIntervalMs, 500); assert.equal(result.cpuDetails.cpuSampleAgeMs, 0);
        assert.equal(result.gpu, null); assert.equal(gpuRequests, 1);
      }
    }
    assert.deepEqual(f.calls, [0, 500, 1000, 1500, 2000, 2500, 3000]); assert.equal(directCpuReads, 0);
    finishGpu(gpuResponse); for (let i = 0; i < 6; i++) await Promise.resolve();
    f.setSource(() => { throw Error('一時的なCPU取得失敗'); }); f.advanceTo(4000);
    const failed = await metrics.sample(); assert.equal(failed.cpu, null); assert.equal(failed.cpuSource, 'unavailable');
    assert.equal(failed.cpuDetails.cpuStatus, 'unavailable'); assert.equal(failed.gpu, 40); assert.equal(failed.ram, 75);
    f.setSource(() => data); f.advanceTo(4500); assert.equal(f.monitor.status(), 'warming-up');
    data = [cpu(2000, 1500)]; f.advanceTo(5000);
    const recovered = await metrics.sample(); assert.equal(recovered.cpu, 100); assert.equal(recovered.cpuSource, 'os-times');
    assert.equal(recovered.cpuDetails.cpuStatus, 'available'); assert.equal(recovered.cpuDetails.sampleIntervalMs, 500);
    assert.equal(recovered.gpu, 40); assert.equal(directCpuReads, 0);
  } finally { metrics.close(); }
  assert.equal(f.timers.size, 0); assert.equal(f.monitor.status(), 'idle'); assert.equal(gpuCloses, 1);
  const count = f.calls.length; f.advanceTo(60000); assert.equal(f.calls.length, count);
  await assert.rejects(metrics.sample(), /終了/);
});
