// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { performance } from 'node:perf_hooks';
import { parseWindowsCpuUtilization } from './windows-cpu.mjs';
import { createWindowsMetricsProcess } from './windows-process.mjs';

// GPUの待機やHTTPの到着時刻から独立したCPU採取。表示中だけ専用プロセスを再利用する。
export function createWindowsCpuMonitor({ makeProcess = () => createWindowsMetricsProcess(), now = Date.now,
  monotonicNow = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  interval = 1000, idleTimeout = 3000, retryInterval = 30000 } = {}) {
  if (![interval, idleTimeout].every(value => Number.isFinite(value) && value > 0)
    || !Number.isFinite(retryInterval) || retryInterval < 0) throw RangeError('CPU計測の間隔が不正です。');
  let closed = false, active = false, generation = 0, leaseUntil = 0, retryAt = 0;
  let worker, pending, cycleTimer, leaseTimer, nextDeadline = null, latest = null;

  function timerAt(deadline, callback) {
    const timer = setTimer(callback, Math.ceil(Math.max(0, deadline - monotonicNow())));
    timer?.unref?.();
    return timer;
  }
  function releaseProcess() {
    const previous = worker;
    worker = undefined;
    try { previous?.close(); } catch { /* 終了済みのプロセスでも監視状態を確実に解放する。 */ }
  }
  function stop() {
    generation++;
    active = false; latest = null; nextDeadline = null;
    clearTimer(cycleTimer); clearTimer(leaseTimer);
    cycleTimer = leaseTimer = undefined;
    const previous = pending;
    pending = undefined;
    previous?.controller.abort();
    releaseProcess();
    // retryAtは保持し、失敗中の表示切替でPowerShell起動を連発しない。
  }
  function stillActive() {
    if (!active || closed) return false;
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
  function schedule(startNow = false) {
    if (!stillActive() || pending || cycleTimer !== undefined) return;
    const deadline = nextDeadline ?? retryAt;
    if (startNow && deadline <= monotonicNow()) { void sample(); return; }
    const version = generation;
    cycleTimer = timerAt(deadline, () => {
      if (version !== generation) return;
      cycleTimer = undefined;
      if (stillActive()) void sample();
    });
  }
  async function sample() {
    if (!stillActive() || pending) return;
    const request = { generation, controller: new AbortController() };
    pending = request;
    try {
      worker ??= makeProcess();
      const { stdout } = await worker.sample('', true, {
        timeout: 5000, maxBuffer: 512 * 1024, signal: request.controller.signal, freshCpu: true,
      });
      if (request.generation !== generation || !stillActive()) return;
      const data = JSON.parse(stdout);
      const cpu = parseWindowsCpuUtilization(data?.cpu);
      if (!cpu) throw Error('Windows CPUの有効な標本がありません。');
      const row = Array.isArray(data.cpu) ? data.cpu.find(item => String(item?.Name).toLowerCase() === '_total') : data.cpu;
      const duration = row?.SampleIntervalMs;
      const sampleIntervalMs = typeof duration === 'number' ? duration
        : typeof duration === 'string' && /^\d+(?:\.\d+)?$/.test(duration) ? Number(duration) : NaN;
      // 百分率は既に採取区間の使用率。0.2秒や0.5秒でも時間比で縮小しない。
      latest = { cpu, measuredAt: now(), sampleIntervalMs: Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0 ? sampleIntervalMs : null };
      retryAt = 0;
      const completedAt = monotonicNow();
      // 初回の有効標本から周期を確立し、その後は前の予定時刻に加算する。
      nextDeadline = nextDeadline === null ? completedAt + interval : nextDeadline + interval;
      if (nextDeadline < completedAt) nextDeadline += Math.ceil((completedAt - nextDeadline) / interval) * interval;
    } catch {
      if (request.generation !== generation || !stillActive()) return;
      latest = null; nextDeadline = null; retryAt = monotonicNow() + retryInterval;
      releaseProcess();
    } finally {
      if (pending === request) {
        pending = undefined;
        schedule();
      }
    }
  }
  return {
    read() {
      if (closed) return null;
      if (active && monotonicNow() >= leaseUntil) stop();
      active = true; leaseUntil = monotonicNow() + idleTimeout;
      renewLease();
      schedule(true);
      return latest;
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
    },
  };
}
