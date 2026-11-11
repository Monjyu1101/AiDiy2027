// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';

function cpuSnapshot(system) {
  try {
    const cpus = system.cpus();
    if (!Array.isArray(cpus) || !cpus.length) return null;
    let idle = 0, total = 0;
    for (const cpu of cpus) {
      const times = cpu?.times;
      if (!times || !Number.isFinite(times.idle)) return null;
      const values = Object.values(times);
      if (!values.every(value => Number.isFinite(value) && value >= 0)) return null;
      idle += times.idle;
      total += values.reduce((sum, value) => sum + value, 0);
    }
    return Number.isFinite(idle) && Number.isFinite(total) ? { idle, total, count: cpus.length } : null;
  } catch { return null; }
}

// eyesと同じ全論理CPUの累積時間差分を、表示・HTTP・GPUとは独立に採取する。
export function createOsCpuMonitor({ system = os, now = Date.now, monotonicNow = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, interval = 500, idleTimeout = 3000 } = {}) {
  if (![interval, idleTimeout].every(value => Number.isFinite(value) && value > 0)) throw RangeError('CPU計測の間隔が不正です。');
  // 長い停止区間の平均を現在の使用率と誤認しない。通常周期の5倍まで許容する。
  const maxSampleInterval = Math.max(1000, interval * 5);
  let closed = false, active = false, generation = 0, state = 'idle', leaseUntil = 0;
  let cycleTimer, leaseTimer, nextDeadline, previous = null, latest = null;

  function timerAt(deadline, callback) {
    const timer = setTimer(callback, Math.ceil(Math.max(0, deadline - monotonicNow())));
    timer?.unref?.();
    return timer;
  }
  function stop() {
    generation++;
    active = false; state = 'idle'; previous = latest = null; nextDeadline = undefined;
    clearTimer(cycleTimer); clearTimer(leaseTimer);
    cycleTimer = leaseTimer = undefined;
  }
  function stillActive() {
    if (closed || !active) return false;
    if (monotonicNow() >= leaseUntil) { stop(); return false; }
    return true;
  }
  function renewLease() {
    clearTimer(leaseTimer);
    const version = generation;
    leaseTimer = timerAt(leaseUntil, () => {
      if (version !== generation) return;
      leaseTimer = undefined;
      if (stillActive()) renewLease();
    });
  }
  function capture() {
    const current = cpuSnapshot(system), sampledAt = monotonicNow(), before = previous;
    previous = current ? { ...current, sampledAt } : null;
    latest = null;
    if (!current) { state = 'unavailable'; return; }
    if (!before) { state = 'warming-up'; return; }
    const sampleIntervalMs = sampledAt - before.sampledAt;
    const totalDelta = current.total - before.total, idleDelta = current.idle - before.idle;
    if (current.count !== before.count || sampleIntervalMs <= 0 || sampleIntervalMs > maxSampleInterval
      || totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) {
      state = 'unavailable'; return;
    }
    // 既に区間内の割合なのでコア数や表示周期で再除算しない。移動平均も取らない。
    const cpu = Math.min(100, Math.max(0, 100 * (1 - idleDelta / totalDelta)));
    latest = Object.freeze({ cpu, measuredAt: now(), sampleIntervalMs, logicalCpuCount: current.count });
    state = 'available';
  }
  function schedule() {
    if (!stillActive()) return;
    const version = generation;
    cycleTimer = timerAt(nextDeadline, () => {
      if (version !== generation) return;
      cycleTimer = undefined;
      if (!stillActive()) return;
      if (monotonicNow() < nextDeadline) { schedule(); return; }
      capture();
      nextDeadline += interval;
      const completedAt = monotonicNow();
      // 完了時刻に500msを足さず予定を維持し、取り逃した周期は連続取得しない。
      if (nextDeadline <= completedAt) nextDeadline += (Math.floor((completedAt - nextDeadline) / interval) + 1) * interval;
      schedule();
    });
  }
  return {
    read() {
      if (closed) return null;
      const resume = !stillActive();
      active = true; leaseUntil = monotonicNow() + idleTimeout;
      renewLease();
      if (resume) {
        capture();
        nextDeadline = monotonicNow() + interval;
        schedule();
      }
      // HTTPの追加要求は採取窓を動かさず、直近の新標本をそのまま返す。
      return latest;
    },
    status() { return stillActive() ? state : 'idle'; },
    close() {
      if (closed) return;
      closed = true;
      stop();
    },
  };
}
