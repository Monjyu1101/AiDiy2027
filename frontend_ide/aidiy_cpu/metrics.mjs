// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWindowsGpuUtilization, windowsGpuCimCommand, windowsGpuCounterCommand } from './windows-gpu.mjs';
import { parseWindowsCpuUtilization, preferredWindowsCpuMetric, windowsSystemMetricsCommand } from './windows-cpu.mjs';
import { createWindowsMetricsProcess } from './windows-process.mjs';
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
export function createSystemMetrics({ system = os, run = execute, now = Date.now, interval = 1000, gpuRetryInterval = 30000, platform = process.platform, windowsMetrics } = {}) {
  const osRelease = typeof system.release === 'function' ? system.release() : null;
  const windowsPreferredMetric = preferredWindowsCpuMetric(osRelease);
  const windowsProcess = windowsMetrics ?? (platform === 'win32' && run === execute ? createWindowsMetricsProcess() : null);
  let previous = cpuSnapshot(system.cpus()), previousAt = now();
  let cached, pending, externalPending, closed = false, gpu = null, externalCheckedAt = -Infinity, gpuMeasuredAt = -Infinity;
  let windowsCpu = null, windowsCpuMeasuredAt = -Infinity, nvidiaUnavailableUntil = -Infinity, cpuUnavailableUntil = -Infinity;
  const windowsGpuUnavailableUntil = new Map();
  const controller = new AbortController();
  // PowerShell起動やPDHの2標本を待つ間も、CPU/RAMのHTTP応答を止めない。
  // 要求がある間だけ1本を再利用し、非表示中は追加照会せずプロセスも解放する。
  async function measureExternalMetrics() {
    let next = null, nextCpu = null, nextCpuAt = -Infinity, windowsRan = false, cpuAttempted = false;
    async function windowsSample(gpuCommand) {
      windowsRan = true;
      const readCpu = now() >= cpuUnavailableUntil;
      cpuAttempted ||= readCpu;
      try {
        const options = {
          timeout: gpuCommand ? 8000 : 5000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: controller.signal,
        };
        const { stdout } = windowsProcess ? await windowsProcess.sample(gpuCommand, readCpu, options)
          : await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSystemMetricsCommand(gpuCommand, readCpu)], options);
        const data = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
        const cpu = parseWindowsCpuUtilization(data?.cpu);
        if (cpu) { nextCpu = cpu; nextCpuAt = now(); }
        // 従来のGPU配列も読めるようにし、CPU欠損でGPUを失わない。
        return parseWindowsGpuUtilization(JSON.stringify(Array.isArray(data) || data?.Name ? data : data?.gpu));
      } catch { return null; }
    }
    if (platform === 'win32') {
      for (const command of [windowsGpuCimCommand, windowsGpuCounterCommand]) {
        if (controller.signal.aborted) return;
        if (now() < (windowsGpuUnavailableUntil.get(command) ?? -Infinity)) continue;
        next = await windowsSample(command);
        if (next !== null) break;
        windowsGpuUnavailableUntil.set(command, now() + gpuRetryInterval);
      }
      // GPU経路の30秒休止をCPUへ適用しない。失敗したGPUは再起動しない。
      if (!windowsRan && !controller.signal.aborted && now() >= cpuUnavailableUntil) await windowsSample();
      if (cpuAttempted && !nextCpu) cpuUnavailableUntil = now() + gpuRetryInterval;
    }
    if (next === null && !controller.signal.aborted && now() >= nvidiaUnavailableUntil) {
      try {
        const { stdout } = await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
          timeout: 1500, maxBuffer: 16 * 1024, windowsHide: true, shell: false, signal: controller.signal,
        });
        next = parseGpuUtilization(stdout);
      } catch { /* 未対応・失敗は0%ではなくnull。 */ }
      if (next === null) nvidiaUnavailableUntil = now() + gpuRetryInterval;
    }
    if (!closed) { gpu = next; gpuMeasuredAt = now(); windowsCpu = nextCpu; windowsCpuMeasuredAt = nextCpuAt; }
  }
  function refreshExternalMetrics(timestamp) {
    const available = gpu !== null || windowsCpu !== null;
    if (externalPending || timestamp - externalCheckedAt < (available ? interval : gpuRetryInterval)) return;
    externalCheckedAt = timestamp;
    externalPending = measureExternalMetrics().catch(() => { if (!closed) { gpu = null; windowsCpu = null; } }).finally(() => { externalCheckedAt = now(); externalPending = undefined; });
  }
  async function measure() {
    const timestamp = now();
    const current = cpuSnapshot(system.cpus());
    const total = current && previous ? current.total - previous.total : 0;
    const idle = current && previous ? current.idle - previous.idle : 0;
    const sampleIntervalMs = timestamp - previousAt;
    // 非表示などの長い休止全体の平均を、復帰直後の現在使用率として出さない。
    const osCpu = sampleIntervalMs > 0 && sampleIntervalMs <= Math.max(5000, interval * 5)
      && current && previous && current.count === previous.count && total > 0 && idle >= 0 && idle <= total
      ? percent(100 * (1 - idle / total)) : null;
    previous = current; previousAt = timestamp;
    const memoryTotal = system.totalmem(), memoryFree = system.freemem();
    const ram = memoryTotal > 0 && memoryFree >= 0 && memoryFree <= memoryTotal
      ? percent(100 * (1 - memoryFree / memoryTotal)) : null;
    // 長い非表示から戻ったときは古いGPU値を現在値として表示しない。
    if (timestamp - gpuMeasuredAt >= gpuRetryInterval) gpu = null;
    if (windowsCpu && timestamp - windowsCpuMeasuredAt >= 10000) {
      windowsCpu = null; externalCheckedAt = -Infinity;
    }
    refreshExternalMetrics(timestamp);
    const nativeMetric = windowsCpu?.[windowsPreferredMetric] !== null && windowsCpu?.[windowsPreferredMetric] !== undefined
      ? windowsPreferredMetric : windowsCpu?.time !== null && windowsCpu?.time !== undefined ? 'time' : null;
    const nativeCpu = windowsCpu?.[nativeMetric];
    const cpu = nativeCpu !== null && nativeCpu !== undefined ? percent(nativeCpu) : osCpu;
    const cpuSource = nativeMetric ? `windows-processor-${nativeMetric}` : osCpu !== null ? 'os-times' : 'unavailable';
    const cpuDetails = Object.freeze({
      osTimes: osCpu, windowsProcessorTime: windowsCpu?.time ?? null, windowsProcessorUtility: windowsCpu?.utility ?? null,
      logicalCpuCount: current?.count ?? null, sampleIntervalMs, windowsSampleAgeMs: windowsCpu ? timestamp - windowsCpuMeasuredAt : null,
      windowsPreferredMetric: platform === 'win32' ? windowsPreferredMetric : null, platform, osRelease, nodeVersion: process.versions.node, libuvVersion: process.versions.uv,
    });
    if (closed) throw Error('システム計測は終了しました。');
    cached = Object.freeze({ timestamp, cpu, gpu, ram, gpuStatus: gpu === null ? 'unavailable' : 'available', cpuSource, cpuDetails });
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
    close() { closed = true; controller.abort(); windowsProcess?.close(); cached = undefined; },
  };
}
