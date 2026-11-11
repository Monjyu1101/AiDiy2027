// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWindowsGpuUtilization, windowsGpuCimCommand, windowsGpuCounterCommand } from './windows-gpu.mjs';
import { windowsSystemMetricsCommand } from './windows-cpu.mjs';
import { createWindowsMetricsProcess } from './windows-process.mjs';
import { createOsCpuMonitor } from './os-cpu-monitor.mjs';
export { parseWindowsGpuUtilization } from './windows-gpu.mjs';
const execute = promisify(execFile);

const percent = value => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

// 複数GPUでは最も使用率の高いデバイスを表示する。未対応値を0%に変換しない。
export function parseGpuUtilization(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).map(line => line.trim());
  if (!lines.length || lines.some(line => !/^\d+(?:\.\d+)?$/.test(line))) return null;
  const values = lines.map(Number);
  if (values.some(value => value < 0 || value > 100)) return null;
  return Math.max(...values);
}

// ブラウザではなくIDEサーバーが動くホスト全体を計測する。CPU周期はGPUから独立。
export function createSystemMetrics({ system = os, run = execute, now = Date.now, monotonicNow = now === Date.now ? () => performance.now() : now, interval = 1000, gpuRetryInterval = 30000, platform = process.platform, windowsMetrics, cpuMetrics } = {}) {
  const osRelease = typeof system.release === 'function' ? system.release() : null;
  // eyesと同じos.cpus()差分を500msごとに採取。Windows指標との途中切替はしない。
  const cpuMonitor = cpuMetrics ?? createOsCpuMonitor({ system, now, monotonicNow });
  let cpuRecord = null, cpuMonitorStatus = null, cachedAt = -Infinity;
  const windowsProcess = windowsMetrics ?? (platform === 'win32' && run === execute ? createWindowsMetricsProcess() : null);
  let cached, pending, externalPending, closed = false, gpu = null, externalCheckedAt = -Infinity, gpuMeasuredAt = -Infinity;
  let nvidiaUnavailableUntil = -Infinity;
  const windowsGpuUnavailableUntil = new Map();
  const controller = new AbortController();
  // PowerShell起動やPDHの2標本を待つ間も、CPU/RAMのHTTP応答を止めない。
  // GPU照会用を再利用し、CPUの0.5秒計測をGPUの待機・失敗から切り離す。
  async function measureExternalMetrics() {
    let next = null;
    async function windowsSample(gpuCommand) {
      try {
        const options = {
          timeout: gpuCommand ? 8000 : 5000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: controller.signal,
        };
        const { stdout } = windowsProcess ? await windowsProcess.sample(gpuCommand, false, options)
          : await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSystemMetricsCommand(gpuCommand, false)], options);
        const data = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
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
    if (!closed) { gpu = next; gpuMeasuredAt = now(); }
  }
  function refreshExternalMetrics(timestamp) {
    const available = gpu !== null;
    if (externalPending || timestamp - externalCheckedAt < (available ? interval : gpuRetryInterval)) return;
    externalCheckedAt = timestamp;
    externalPending = measureExternalMetrics().catch(() => { if (!closed) { gpu = null; } }).finally(() => { externalCheckedAt = now(); externalPending = undefined; });
  }
  async function measure() {
    const timestamp = now();
    const cpu = cpuRecord?.cpu ?? null;
    const memoryTotal = system.totalmem(), memoryFree = system.freemem();
    const ram = memoryTotal > 0 && memoryFree >= 0 && memoryFree <= memoryTotal
      ? percent(100 * (1 - memoryFree / memoryTotal)) : null;
    // 長い非表示から戻ったときは古いGPU値を現在値として表示しない。
    if (timestamp - gpuMeasuredAt >= gpuRetryInterval) gpu = null;
    refreshExternalMetrics(timestamp);
    const cpuSource = cpuMonitorStatus === 'warming-up' ? 'warming-up' : cpu !== null ? 'os-times' : 'unavailable';
    const cpuDetails = Object.freeze({
      osTimes: cpu, logicalCpuCount: cpuRecord?.logicalCpuCount ?? null,
      sampleIntervalMs: cpuRecord?.sampleIntervalMs ?? null, cpuSampleAgeMs: cpuRecord ? Math.max(0, timestamp - cpuRecord.measuredAt) : null,
      cpuStatus: cpuMonitorStatus, platform, osRelease, nodeVersion: process.versions.node, libuvVersion: process.versions.uv,
      // 旧応答との比較用。現行CPU表示はTime/Utilityを採取・採用しない。
      windowsProcessorTime: null, windowsProcessorUtility: null, windowsPreferredMetric: null,
      windowsSampleIntervalMs: null, windowsSampleAgeMs: null, windowsCpuStatus: null,
    });
    if (closed) throw Error('システム計測は終了しました。');
    cachedAt = monotonicNow();
    cached = Object.freeze({ timestamp, cpu, gpu, ram, gpuStatus: gpu === null ? 'unavailable' : 'available', cpuSource, cpuDetails });
    return cached;
  }
  return {
    sample() {
      if (closed) return Promise.reject(Error('システム計測は終了しました。'));
      const currentCpu = cpuMonitor?.read() ?? null;
      const currentStatus = cpuMonitor.status();
      if (currentCpu !== cpuRecord || currentStatus !== cpuMonitorStatus) {
        cpuMonitorStatus = currentStatus; cpuRecord = currentCpu; cached = undefined;
      }
      if (pending) return pending;
      if (cached && monotonicNow() - cachedAt < interval) return Promise.resolve(cached);
      pending = measure().finally(() => { pending = undefined; });
      return pending;
    },
    close() { closed = true; controller.abort(); cpuMonitor?.close(); windowsProcess?.close(); cached = undefined; },
  };
}
