// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

// Windows標準のGPU Engineカウンター。WDDM 2.x対応のIntel/AMD/NVIDIAで利用する。
// 同じ物理エンジンのプロセス別値を合計し、エンジン間は最大値（Task Managerと同じ考え方）。
// エンジン同士を足すと3DとCopy等で二重計上になるため合算しない。
export function parseWindowsGpuUtilization(stdout) {
  let rows;try{rows=JSON.parse(String(stdout));}catch{return null;}
  if(!Array.isArray(rows))rows=rows&&typeof rows==='object'?[rows]:[];
  if(!rows.length)return null;
  const engines=new Map();
  for(const row of rows){
    const engine=typeof row?.Name==='string'?row.Name.match(/(?:^|_)luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)(?:_|$)/i):null;
    const raw=row?.UtilizationPercentage;
    const value=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw)?Number(raw):NaN;
    if(!engine||!Number.isFinite(value)||value<0||value>100)return null;
    const key=engine.slice(1).join('_').toLowerCase();engines.set(key,(engines.get(key)||0)+value);
  }
  return Math.min(100,Math.max(...engines.values()));
}
const windowsGpuCommand="$ErrorActionPreference='Stop'; @(Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name,UtilizationPercentage) | ConvertTo-Json -Compress";

// ブラウザではなくIDEサーバーが動くホスト全体を計測する。常駐タイマーは持たない。
export function createSystemMetrics({ system = os, run = execute, now = Date.now, interval = 1000, gpuRetryInterval = 30000, platform = process.platform } = {}) {
  let previous = cpuSnapshot(system.cpus());
  let cached, pending, closed = false, gpu = null, gpuCheckedAt = -Infinity, windowsUnavailableUntil = -Infinity;
  const controller = new AbortController();
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
    if (timestamp - gpuCheckedAt >= (gpu === null ? gpuRetryInterval : interval)) {
      gpuCheckedAt = timestamp;
      gpu=null;
      if(platform==='win32'&&timestamp>=windowsUnavailableUntil){
        try{
          const {stdout}=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',windowsGpuCommand],{
            timeout:2000,maxBuffer:512*1024,windowsHide:true,shell:false,signal:controller.signal,
          });
          gpu=parseWindowsGpuUtilization(stdout);
        }catch{/* 未対応ドライバー・権限不足はNVIDIA専用計測へフォールバック。 */}
        if(gpu===null)windowsUnavailableUntil=timestamp+gpuRetryInterval;
      }
      if(gpu===null&&!controller.signal.aborted){
        try {
          const { stdout } = await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
            timeout: 1500, maxBuffer: 16 * 1024, windowsHide: true, shell: false, signal: controller.signal,
          });
          gpu = parseGpuUtilization(stdout);
        } catch { gpu = null; }
      }
    }
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
