// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWindowsGpuUtilization, windowsGpuCimCommand, windowsGpuCounterCommand } from './windows-gpu.mjs';
export { parseWindowsGpuUtilization } from './windows-gpu.mjs';
const execute = promisify(execFile);

function cpuSnapshot(cpus) {
  if (!cpus.length) return null;
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    const times = Object.values(cpu.times);
    if (!times.every(Number.isFinite) || !Number.isFinite(cpu.times.idle)) return null;
    idle += cpu.times.idle;
    total += times.reduce((sum, value) => sum + value, 0);
  }
  return { idle, total, count: cpus.length };
}
const percent = value => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

// 複数GPUでは最も使用率の高いデバイスを表示する。未対応値を0%に変換しない。
export function parseGpuUtilization(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).map(line => line.trim());
  if (!lines.length || lines.some(line => !/^\d+(?:\.\d+)?$/.test(line))) return null;
  const values = lines.map(Number);
  if (values.some(value => value < 0 || value > 100)) return null;
  return Math.max(...values);
}

// ブラウザではなくIDEサーバーが動くホスト全体を計測する。常駐タイマーは持たない。
export function createSystemMetrics({ system = os, run = execute, now = Date.now, interval = 1000, gpuRetryInterval = 30000, platform = process.platform } = {}) {
  let previous = cpuSnapshot(system.cpus());
  let cached, pending, gpuPending, closed = false, gpu = null, gpuCheckedAt = -Infinity, gpuMeasuredAt = -Infinity;
  const windowsUnavailableUntil = new Map();
  const controller = new AbortController();
  // PowerShell起動やPDHの2標本を待つ間も、CPU/RAMのHTTP応答を止めない。
  // 要求がある間だけ1本起動し、非表示中の常駐タイマーは作らない。
  async function measureGpu() {
    let next = null;
    if (platform === 'win32') {
      for (const command of [windowsGpuCimCommand, windowsGpuCounterCommand]) {
        if (controller.signal.aborted) return;
        if (now() < (windowsUnavailableUntil.get(command) ?? -Infinity)) continue;
        try {
          const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
            timeout: 5000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: controller.signal,
          });
          next = parseWindowsGpuUtilization(stdout);
        } catch { /* 未対応の経路だけを休止し、次のWindows標準経路へ進む。 */ }
        if (next !== null) break;
        windowsUnavailableUntil.set(command, now() + gpuRetryInterval);
      }
    }
    if (next === null && !controller.signal.aborted) {
      try {
        const { stdout } = await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
          timeout: 1500, maxBuffer: 16 * 1024, windowsHide: true, shell: false, signal: controller.signal,
        });
        next = parseGpuUtilization(stdout);
      } catch { /* 未対応・失敗は0%ではなくnull。 */ }
    }
    if (!closed) { gpu = next; gpuMeasuredAt = now(); }
  }
  function refreshGpu(timestamp) {
    if (gpuPending || timestamp - gpuCheckedAt < (gpu === null ? gpuRetryInterval : interval)) return;
    gpuCheckedAt = timestamp;
    gpuPending = measureGpu().catch(() => { if (!closed) gpu = null; }).finally(() => { gpuCheckedAt = now(); gpuPending = undefined; });
  }
  async function measure() {
    const timestamp = now();
    const current = cpuSnapshot(system.cpus());
    const total = current && previous ? current.total - previous.total : 0;
    const idle = current && previous ? current.idle - previous.idle : 0;
    const cpu = current && previous && current.count === previous.count && total > 0 && idle >= 0 && idle <= total
      ? percent(100 * (1 - idle / total)) : null;
    previous = current;
    const memoryTotal = system.totalmem(), memoryFree = system.freemem();
    const ram = memoryTotal > 0 && memoryFree >= 0 && memoryFree <= memoryTotal
      ? percent(100 * (1 - memoryFree / memoryTotal)) : null;
    // 長い非表示から戻ったときは古いGPU値を現在値として表示しない。
    if (timestamp - gpuMeasuredAt >= gpuRetryInterval) gpu = null;
    refreshGpu(timestamp);
    if (closed) throw Error('システム計測は終了しました。');
    cached = Object.freeze({ timestamp, cpu, gpu, ram, gpuStatus: gpu === null ? 'unavailable' : 'available' });
    return cached;
  }
  return {
    sample() {
      if (closed) return Promise.reject(Error('システム計測は終了しました。'));
      if (pending) return pending;
      if (cached && now() - cached.timestamp < interval) return Promise.resolve(cached);
      pending = measure().finally(() => { pending = undefined; });
      return pending;
    },
    close() { closed = true; controller.abort(); cached = undefined; },
  };
}
