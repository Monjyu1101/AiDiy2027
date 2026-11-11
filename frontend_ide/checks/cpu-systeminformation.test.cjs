// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemInformationCpuMonitor } = require('../aidiy_cpu/systeminformation-cpu.cjs');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const load = (currentLoad = 100) => ({ currentLoad, currentLoadIdle: 100 - currentLoad,
  rawCurrentLoad: 12345, rawCurrentLoadIdle: 9876, rawCurrentLoadUser: 12000, rawCurrentLoadSystem: 345,
  rawCurrentLoadIrq: 0, rawCurrentLoadNice: 0, cpus: [{}, {}, {}, {}] });
function fixture(options = {}) {
  let time = 0, offset = 1700000000000, id = 0;
  const requests = [], timers = new Map(), history = [];
  const clock = { now: () => time + offset, monotonicNow: () => time,
    setTimer(fn, ms) { const key = ++id, value = { at: time + ms, fn }; timers.set(key, value); history.push(value); return key; },
    clearTimer(key) { timers.delete(key); } };
  const monitor = createSystemInformationCpuMonitor({ ...clock, getLoad: () => new Promise((resolve, reject) => {
    requests.push({ at: time, resolve, reject });
  }), ...options });
  return { monitor, requests, timers, history, clock, get time() { return time; },
    jump(at) { time = at; }, shiftWall(ms) { offset += ms; },
    async advance(at) {
      for (;;) {
        const next = [...timers].filter(([, entry]) => entry.at <= at).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = Math.max(time, next[1].at); timers.delete(next[0]); next[1].fn(); await flush();
      }
      time = Math.max(time, at); await flush();
    },
    async reply(value = load()) { requests.at(-1).resolve(value); await flush(); },
  };
}

test('CJS/ESMから共有でき、getLoadを必須注入する', async () => {
  const esm = await import('../aidiy_cpu/systeminformation-cpu.cjs');
  assert.equal(esm.createSystemInformationCpuMonitor, createSystemInformationCpuMonitor);
  assert.throws(() => createSystemInformationCpuMonitor(), /getLoad/);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => fixture({ interval: value }), RangeError);
});

test('初回500msprimeの結果は捨てず採用し、次の取得は最初の呼出から1秒で行う', async () => {
  const f = fixture(); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up');
  await f.advance(500); await f.reply(load(100)); const record = f.monitor.read();
  assert.equal(record.cpu, 100); assert.equal(record.sampleIntervalMs, 500); assert.equal(record.measuredAt, f.clock.now());
  assert.equal(record.source, 'systeminformation-current-load'); assert.equal(record.logicalCpuCount, 4);
  await f.advance(999); assert.equal(f.monitor.read(), record); assert.equal(f.requests.length, 1);
  await f.advance(1000); assert.equal(f.requests.length, 2); await f.reply(load(25));
  assert.equal(f.monitor.read().cpu, 25); assert.equal(f.monitor.read().sampleIntervalMs, 500); f.monitor.close();
});

test('500msのeyes照会や連続readは追加取得を起こさず、百分率をそのまま保持する', async () => {
  const f = fixture(); f.monitor.read(); await f.advance(200); await f.reply(load(100)); const record = f.monitor.read();
  assert.equal(record.cpu, 100); assert.equal(record.sampleIntervalMs, 200);
  for (const at of [250, 500, 750, 999]) {
    await f.advance(at); for (let i = 0; i < 100; i++) assert.equal(f.monitor.read(), record);
  }
  assert.equal(f.requests.length, 1); await f.advance(1000); await f.reply(load(0));
  assert.equal(f.monitor.read().cpu, 0); assert.equal(f.monitor.status(), 'available'); f.monitor.close();
});

test('rawCurrentLoadなどの生値は有限数だけ診断に残し、値や分母を再計算しない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply({ ...load(87.5), rawCurrentLoad: 1000, rawCurrentLoadIdle: 999000,
    rawCurrentLoadUser: '100', rawCurrentLoadSystem: NaN, rawCurrentLoadIrq: Infinity, rawCurrentLoadGuest: false });
  const record = f.monitor.read(); assert.equal(record.cpu, 87.5); assert.equal(record.rawCurrentLoad, 1000); assert.equal(record.rawCurrentLoadIdle, 999000);
  for (const key of ['rawCurrentLoadUser', 'rawCurrentLoadSystem', 'rawCurrentLoadIrq', 'rawCurrentLoadGuest']) assert.equal(record[key], null);
  f.monitor.close();
});

test('50〜150msの応答揺れでも固定1秒予定を維持し、実応答間隔を記録する', async () => {
  const f = fixture(); f.monitor.read(); await f.advance(500); await f.reply(); f.monitor.read(); let lastAt = 500;
  for (let index = 1; index <= 60; index++) {
    const due = index * 1000; await f.advance(due); assert.equal(f.requests.at(-1).at, due);
    const complete = due + [50, 150][index % 2]; await f.advance(complete); await f.reply();
    const current = f.monitor.read(); assert.equal(current.cpu, 100); assert.equal(current.sampleIntervalMs, complete - lastAt); lastAt = complete;
  }
  f.monitor.close();
});

test('1時間相当3600回でタイマーを増やさず、同じ100%でも毎回新結果に更新する', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); let previous = f.monitor.read();
  for (let index = 1; index < 3600; index++) {
    await f.advance(index * 1000); await f.reply(); const current = f.monitor.read(); assert.notEqual(current, previous); previous = current;
    assert.equal(f.timers.size, 2); assert.equal(f.requests.length, index + 1);
  }
  f.monitor.close(); assert.equal(f.timers.size, 0);
});

test('遅い要求中は追加取得せず、遅延で失った周期を連発しない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); const previous = f.monitor.read(); await f.advance(1000);
  for (const at of [1500, 2000, 3000, 3600]) { await f.advance(at); assert.equal(f.monitor.read(), previous); assert.equal(f.requests.length, 2); }
  await f.reply(load(60)); assert.equal(f.monitor.read().sampleIntervalMs, 3600); assert.equal(f.requests.length, 2);
  await f.advance(3999); assert.equal(f.requests.length, 2); await f.advance(4000); assert.equal(f.requests.length, 3); f.monitor.close();
});

for (const invalid of [null, {}, { currentLoad: null }, { currentLoad: '' }, { currentLoad: false },
  { currentLoad: NaN }, { currentLoad: Infinity }, { currentLoad: -1 }, { currentLoad: 101 }]) {
  test(`不正load ${JSON.stringify(invalid)}はnullとして次周期で回復する`, async () => {
    const f = fixture(); f.monitor.read(); await f.reply(invalid);
    assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
    assert.equal(f.monitor.diagnostics().lastError.code, 'invalid-current-load');
    await f.advance(1000); await f.reply(load(0)); assert.equal(f.monitor.read().cpu, 0);
    assert.equal(f.monitor.diagnostics().lastError, null); f.monitor.close();
  });
}

test('例外は固定コードだけを残して古い値を消し、次周期で回復する', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); f.monitor.read(); await f.advance(1000);
  f.requests.at(-1).reject(Error('private environment token')); await flush(); assert.equal(f.monitor.read(), null);
  assert.equal(f.monitor.diagnostics().lastError.code, 'current-load-failed'); assert.doesNotMatch(JSON.stringify(f.monitor.diagnostics()), /private|token/);
  await f.advance(2000); await f.reply(load(75)); assert.equal(f.monitor.read().cpu, 75); assert.equal(f.monitor.read().sampleIntervalMs, 2000); f.monitor.close();
});

test('同期throwでもreadを投げずに失敗扱いとし、1秒後に再試行する', async () => {
  let calls = 0; const f = fixture({ getLoad() { calls++; if (calls === 1) throw Error('failed'); return load(50); } });
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
  await f.advance(1000); assert.equal(f.monitor.read().cpu, 50); assert.equal(calls, 2); f.monitor.close();
});

test('取得が5秒止まったら古い値をnullにし、遅い結果は捨てて次の採取から回復する', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(load(80)); f.monitor.read(); await f.advance(1000);
  for (const at of [2000, 3000, 4000, 5000]) { await f.advance(at); assert.equal(f.monitor.read().cpu, 80); }
  await f.advance(6000); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'unavailable');
  assert.equal(f.monitor.diagnostics().lastError.code, 'current-load-timeout'); assert.equal(f.requests.length, 2);
  await f.advance(6500); await f.reply(load(99)); assert.equal(f.monitor.read(), null); assert.equal(f.requests.length, 2);
  await f.advance(7000); assert.equal(f.requests.length, 2); assert.equal(f.monitor.read(), null);
  await f.advance(8000); await f.reply(load(25)); assert.equal(f.monitor.read().cpu, 25); assert.equal(f.monitor.read().sampleIntervalMs, 1500);
  f.monitor.close(); assert.equal(f.timers.size, 0);
});

test('timeout後6995msの結果を捨て、7000msのSI内部200mscacheを再採用しない', async () => {
  let f, calls = [], completeLate, cacheAt = -Infinity;
  f = fixture({ getLoad() {
    calls.push(f.time);
    if (calls.length === 1) return load(80);
    if (calls.length === 2) return new Promise(resolve => { completeLate = () => { cacheAt = f.time; resolve(load(99)); }; });
    return load(f.time - cacheAt < 200 ? 99 : 25);
  } });
  f.monitor.read(); await flush(); await f.advance(1000);
  for (const at of [2000, 3000, 4000, 5000, 6000]) { await f.advance(at); f.monitor.read(); }
  assert.equal(f.monitor.diagnostics().lastError.code, 'current-load-timeout');
  await f.advance(6995); completeLate(); await flush(); assert.equal(f.monitor.read(), null);
  await f.advance(7000); assert.deepEqual(calls, [0, 1000]); assert.equal(f.monitor.read(), null);
  await f.advance(7999); assert.deepEqual(calls, [0, 1000]); assert.equal(f.monitor.read(), null);
  await f.advance(8000); assert.deepEqual(calls, [0, 1000, 8000]); assert.equal(f.monitor.read().cpu, 25);
  assert.equal(f.monitor.read().sampleIntervalMs, 1005);
  await f.advance(9000); assert.deepEqual(calls, [0, 1000, 8000, 9000]); assert.equal(f.monitor.read().cpu, 25);
  f.monitor.close(); assert.equal(f.timers.size, 0);
});

test('再開初回が不正なら不正理由を残し、次の正常標本から採用する', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); await f.advance(3000); f.monitor.read();
  // 休止前に未完了になった旧要求を先に返す。
  await f.reply(load(90)); await f.reply({ currentLoad: null });
  assert.equal(f.monitor.read(), null); assert.equal(f.monitor.diagnostics().lastError.code, 'invalid-current-load');
  await f.advance(4000); await f.reply(load(35)); assert.equal(f.monitor.read().cpu, 35); f.monitor.close();
});

test('watchdog timerより遅い応答のmicrotaskが先でも期限超過値を採用しない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); await f.advance(1000);
  for (const at of [2000, 3000, 4000, 5000]) { await f.advance(at); f.monitor.read(); }
  f.jump(6500); await f.reply(load(99)); assert.equal(f.monitor.read(), null);
  assert.equal(f.monitor.diagnostics().lastError.code, 'current-load-timeout'); f.monitor.close();
});

test('3秒無照会で停止し、再開初回の休止平均だけ捨て1秒後の新値を使う', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(load(20)); f.monitor.read();
  await f.advance(1000); await f.reply(load(20)); await f.advance(2000); await f.reply(load(20));
  await f.advance(3000); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.timers.size, 0);
  await f.advance(60000); const count = f.requests.length; assert.equal(f.monitor.read(), null); assert.equal(f.requests.length, count + 1);
  await f.reply(load(99)); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'warming-up');
  await f.advance(60999); assert.equal(f.monitor.read(), null); await f.advance(61000); await f.reply(load(35));
  assert.equal(f.monitor.read().cpu, 35); assert.equal(f.monitor.read().sampleIntervalMs, 1000); f.monitor.close();
});

test('旧要求がidle後も未完了なら再開要求を重ねず、旧結果を無視してから再開する', async () => {
  const f = fixture(); f.monitor.read(); const old = f.requests[0]; await f.advance(3000);
  assert.equal(f.monitor.status(), 'idle'); await f.advance(4000); assert.equal(f.monitor.read(), null); assert.equal(f.requests.length, 1);
  old.resolve(load(99)); await flush(); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].at, 4000); assert.equal(f.monitor.read(), null);
  await f.reply(load(80)); assert.equal(f.monitor.read(), null); await f.advance(5000); await f.reply(load(25));
  assert.equal(f.monitor.read().cpu, 25); f.monitor.close();
});

test('event loop停止中のlease期限もreadで確認し、旧timerと旧結果を採用しない', async () => {
  const f = fixture(); f.monitor.read(); await f.reply(); const callbacks = [...f.history]; f.jump(4000);
  assert.equal(f.monitor.read(), null); const activeTimers = [...f.timers.keys()]; for (const item of callbacks) item.fn();
  assert.deepEqual([...f.timers.keys()], activeTimers); await f.reply(load(88)); assert.equal(f.monitor.read(), null);
  await f.advance(5000); await f.reply(load(42)); assert.equal(f.monitor.read().cpu, 42); f.monitor.close();
});

test('close後は進行結果やtimerで復活せず、初回前closeも取得を始めない', async () => {
  const never = fixture(); never.monitor.close(); assert.equal(never.monitor.read(), null); assert.equal(never.requests.length, 0);
  const f = fixture(); f.monitor.read(); const callbacks = [...f.history]; f.monitor.close(); f.monitor.close();
  await f.reply(); for (const item of callbacks) item.fn(); assert.equal(f.monitor.read(), null); assert.equal(f.monitor.status(), 'idle');
  assert.equal(f.timers.size, 0); await f.advance(60000); assert.equal(f.requests.length, 1);
});

test('時計変更は1秒採取周期とleaseに影響せず、status確認だけではleaseを延長しない', async () => {
  const f = fixture(); f.monitor.read(); await f.advance(500); await f.reply(); f.shiftWall(-3600000);
  await f.advance(1000); await f.reply(); assert.equal(f.monitor.status(), 'available');
  f.shiftWall(7200000); await f.advance(2000); await f.reply(); assert.equal(f.monitor.status(), 'available');
  await f.advance(3000); assert.equal(f.monitor.status(), 'idle'); assert.equal(f.timers.size, 0); f.monitor.close();
});

test('実systeminformation currentLoadを注入して最初の結果を加工せず公開する', async () => {
  const si = require('systeminformation'); let delivered, complete;
  const observed = new Promise(resolve => { complete = resolve; });
  const monitor = createSystemInformationCpuMonitor({ getLoad: async () => {
    delivered = await si.currentLoad(); complete(); return delivered;
  } });
  try {
    assert.equal(monitor.read(), null); await observed; await flush(); const current = monitor.read();
    assert.equal(current.cpu, delivered.currentLoad); assert.equal(current.rawCurrentLoad, delivered.rawCurrentLoad);
    assert.equal(current.rawCurrentLoadIdle, delivered.rawCurrentLoadIdle); assert.equal(monitor.status(), 'available');
  } finally { monitor.close(); }
});
