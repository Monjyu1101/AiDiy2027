// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const { performance } = require('node:perf_hooks');

// 依存解決は呼出側で行う。Avatar単独起動でもIDE側node_modulesを必要としない。
function createSystemInformationCpuMonitor({ getLoad, now = Date.now, monotonicNow = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, interval = 1000, idleTimeout = 3000, requestTimeout = 5000 } = {}) {
  if (typeof getLoad !== 'function') throw TypeError('getLoad関数が必要です。');
  if (![interval, idleTimeout, requestTimeout].every(value => Number.isFinite(value) && value > 0)) throw RangeError('CPU計測の間隔が不正です。');
  let closed = false, active = false, everStarted = false, generation = 0, state = 'idle', leaseUntil = 0;
  let cycleTimer, leaseTimer, pending, needsStart = false, discardNext = false, nextDeadline = null;
  let latest = null, lastResponseAt = null, lastError = null;

  function timerAt(deadline, callback) {
    const timer = setTimer(callback, Math.ceil(Math.max(0, deadline - monotonicNow())));
    timer?.unref?.(); return timer;
  }
  function stop() {
    generation++; active = false; state = 'idle'; latest = null; lastResponseAt = null;
    needsStart = false; nextDeadline = null;
    clearTimer(cycleTimer); clearTimer(leaseTimer); cycleTimer = leaseTimer = undefined;
    if (pending) { clearTimer(pending.timer); pending.timer = undefined; }
    // SIには中止APIがない。旧要求は結果を無視し、完了まで新要求を重ねない。
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
  function schedule() {
    if (!stillActive() || pending || cycleTimer !== undefined) return;
    if (needsStart) { void measure(); return; }
    const version = generation;
    cycleTimer = timerAt(nextDeadline, () => {
      if (version !== generation) return;
      cycleTimer = undefined;
      if (!stillActive()) return;
      if (monotonicNow() < nextDeadline) { schedule(); return; }
      void measure();
    });
  }
  async function measure() {
    if (!stillActive() || pending) return;
    const request = { generation, startedAt: monotonicNow() };
    pending = request;
    request.timer = timerAt(request.startedAt + requestTimeout, () => {
      request.timer = undefined;
      if (request.generation !== generation || !stillActive()) return;
      // 未完了要求は中止できないが、取得が止まった古い値を表示し続けない。
      request.timedOut = true; latest = null; state = 'unavailable';
      lastError = Object.freeze({ code: 'current-load-timeout', timestamp: now() });
    });
    nextDeadline = needsStart ? request.startedAt + interval : nextDeadline + interval;
    needsStart = false;
    try {
      const load = await getLoad();
      if (request.generation !== generation || !stillActive()) return;
      const completedAt = monotonicNow();
      // SI内部の正確な採取窓ではなく応答間の観測時間。初回は呼出しからの時間。
      const sampleIntervalMs = Math.max(0, completedAt - (lastResponseAt ?? request.startedAt));
      lastResponseAt = completedAt;
      const discard = discardNext; discardNext = false;
      if (request.timedOut || completedAt - request.startedAt >= requestTimeout) {
        // 遅れた結果はSI内部にキャッシュされるため、完了直後の再取得で再採用しない。
        // 通常の固定予定は変えず、完了から少なくとも1秒空く次の予定へ送る。
        const retryAfter = completedAt + Math.max(interval, 1000);
        if (nextDeadline < retryAfter) nextDeadline += Math.ceil((retryAfter - nextDeadline) / interval) * interval;
        latest = null; state = 'unavailable';
        lastError = Object.freeze({ code: 'current-load-timeout', timestamp: now() }); return;
      }
      if (!load || !Number.isFinite(load.currentLoad) || load.currentLoad < 0 || load.currentLoad > 100) {
        latest = null; state = 'unavailable'; lastError = Object.freeze({ code: 'invalid-current-load', timestamp: now() }); return;
      }
      if (discard) {
        // SIはモジュール内に累積差分の基準を保持するため、休止全体の最初の値を捨てる。
        latest = null; state = 'warming-up'; lastError = null; return;
      }
      const rawKeys = ['rawCurrentLoad', 'rawCurrentLoadUser', 'rawCurrentLoadSystem', 'rawCurrentLoadNice',
        'rawCurrentLoadIdle', 'rawCurrentLoadIrq', 'rawCurrentLoadSteal', 'rawCurrentLoadGuest'];
      const raw = Object.fromEntries(rawKeys.map(key => [key, Number.isFinite(load[key]) ? load[key] : null]));
      // currentLoadはライブラリの百分率をそのまま採用し、周期比・コア数で割り直さない。
      latest = Object.freeze({ cpu: load.currentLoad, source: 'systeminformation-current-load', measuredAt: now(),
        sampleIntervalMs, logicalCpuCount: Array.isArray(load.cpus) && load.cpus.length ? load.cpus.length : null,
        currentLoadIdle: Number.isFinite(load.currentLoadIdle) ? load.currentLoadIdle : null, ...raw });
      state = 'available'; lastError = null;
    } catch {
      if (request.generation !== generation || !stillActive()) return;
      latest = null; state = 'unavailable'; lastError = Object.freeze({ code: 'current-load-failed', timestamp: now() });
    } finally {
      clearTimer(request.timer);
      if (pending === request) {
        pending = undefined;
        if (stillActive()) {
          // 完了後にさらに1秒待たず予定を維持する。遅延中に過ぎた周期は連発しない。
          if (!needsStart && nextDeadline <= monotonicNow()) nextDeadline += (Math.floor((monotonicNow() - nextDeadline) / interval) + 1) * interval;
          schedule();
        }
      }
    }
  }
  return {
    read() {
      if (closed) return null;
      const resume = !stillActive();
      active = true; leaseUntil = monotonicNow() + idleTimeout;
      if (resume) {
        state = 'warming-up'; lastError = null; needsStart = true; discardNext = everStarted; everStarted = true;
      }
      renewLease(); schedule(); return latest;
    },
    status() { return stillActive() ? state : 'idle'; },
    diagnostics() { return Object.freeze({ status: stillActive() ? state : 'idle', inFlight: !!pending, lastError }); },
    close() { if (closed) return; closed = true; stop(); },
  };
}

module.exports = { createSystemInformationCpuMonitor };
