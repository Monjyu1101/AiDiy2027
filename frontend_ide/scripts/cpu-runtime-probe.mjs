// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { electronExecutable } from '../viewer/launch-options.mjs';

const execute = promisify(execFile), script = fileURLToPath(import.meta.url);
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = value => Number.isFinite(value) ? value : null;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const runtimeInfo = () => ({ execPath: process.execPath, node: process.versions.node, uv: process.versions.uv,
  electron: process.versions.electron ?? null, platform: process.platform, arch: process.arch });

function checkSamplingOptions(targetStartAt, intervalMs, sampleCount) {
  if (!Number.isFinite(targetStartAt) || !Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 1000
    || !Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 32) throw RangeError('CPU比較の採取条件が不正です。');
}
function snapshot(system, now, monotonicNow) {
  try {
    const cpus = system.cpus();
    if (!Array.isArray(cpus) || !cpus.length) throw Error('unavailable');
    const totals = cpus.reduce((summary, cpu) => {
      const values = Object.values(cpu.times);
      if (!Number.isFinite(cpu.times.idle) || !values.every(Number.isFinite)) throw Error('unavailable');
      return { idle: summary.idle + cpu.times.idle, total: summary.total + values.reduce((sum, value) => sum + value, 0) };
    }, { idle: 0, total: 0 });
    if (!Number.isFinite(totals.idle) || !Number.isFinite(totals.total)) throw Error('unavailable');
    return { timestamp: now(), monotonic: monotonicNow(), ...totals, busy: totals.total - totals.idle, logicalCpuCount: cpus.length };
  } catch { return null; }
}
function publicSnapshot(value) {
  if (!value) return null;
  const { timestamp, idle, total, busy, logicalCpuCount } = value;
  return { timestamp, idle, total, busy, logicalCpuCount };
}

// 既存eyesを読まず、旧os.cpus方式を別ランタイムで比較する読み取り専用probe。
// 現行Windows eyesは継続WMIカウンターなので、このprobeの数値はeyesの実測値ではない。
export async function sampleRuntimeCpu({ targetStartAt = Date.now(), intervalMs = 500, sampleCount = 24,
  system = os, now = Date.now, monotonicNow = () => performance.now(), sleep = defaultSleep, runtime = runtimeInfo() } = {}) {
  checkSamplingOptions(targetStartAt, intervalMs, sampleCount);
  const startedAt = now(), origin = monotonicNow() + targetStartAt - now();
  const waitUntil = async deadline => {
    while (monotonicNow() < deadline) await sleep(Math.ceil(deadline - monotonicNow()));
  };
  await waitUntil(origin);
  let previous = snapshot(system, now, monotonicNow);
  const baseline = publicSnapshot(previous), baselineAt = now(), samples = [], recent = [], all = [];
  let deadline = origin + intervalMs;
  // 起動が遅れた場合も短時間の追い付き採取をせず、共通の次の予定時刻に合わせる。
  if (deadline <= monotonicNow()) deadline += (Math.floor((monotonicNow() - deadline) / intervalMs) + 1) * intervalMs;
  for (let index = 0; index < sampleCount; index++) {
    await waitUntil(deadline);
    const current = snapshot(system, now, monotonicNow);
    const row = { timestamp: current?.timestamp ?? now(), scheduledAt: targetStartAt + deadline - origin,
      sampleIntervalMs: current && previous ? current.monotonic - previous.monotonic : null,
      idle: current?.idle ?? null, total: current?.total ?? null, busy: current?.busy ?? null,
      idleDelta: null, totalDelta: null, busyDelta: null, logicalCpuCount: current?.logicalCpuCount ?? null,
      cpu: null, status: 'cpu-snapshot-unavailable' };
    if (current) {
      if (previous) {
        row.idleDelta = current.idle - previous.idle;
        row.totalDelta = current.total - previous.total;
        row.busyDelta = row.totalDelta - row.idleDelta;
        // 旧eyesのos.cpus差分式。採取秒数・待ち時間やコア数で再除算しない。
        row.cpu = row.totalDelta <= 0 ? 0 : Math.min(100, Math.max(0, (1 - row.idleDelta / row.totalDelta) * 100));
        row.status = current.logicalCpuCount !== previous.logicalCpuCount ? 'cpu-count-changed'
          : row.totalDelta < 0 || row.idleDelta < 0 || row.idleDelta > row.totalDelta ? 'counter-discontinuity'
            : row.totalDelta === 0 ? 'zero-total-delta' : 'available';
      } else { row.cpu = 0; row.status = 'warming-up'; }
      previous = current;
      recent.push(row.cpu); all.push(row.cpu);
      if (recent.length > 12) recent.shift();
    }
    // 旧方式との比較用に、採取できた直近12点の平均も残す。現行eyesの欠損処理とは別。
    row.average12 = average(recent); row.averageSampleCount = recent.length;
    samples.push(row);
    deadline += intervalMs;
    if (deadline <= monotonicNow()) deadline += (Math.floor((monotonicNow() - deadline) / intervalMs) + 1) * intervalMs;
  }
  return { schema: 1, runtime, targetStartAt, startedAt, baselineAt, startupDelayMs: Math.max(0, baselineAt - targetStartAt),
    finishedAt: now(), intervalMs, requestedSamples: sampleCount, baseline, samples,
    averageCpu: average(all), last12AverageCpu: average(recent), last12SampleCount: recent.length };
}

const safeCode = error => typeof error?.code === 'number' ? finite(error.code)
  : typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : null;
const statuses = new Set(['available', 'warming-up', 'zero-total-delta', 'counter-discontinuity', 'cpu-count-changed', 'cpu-snapshot-unavailable']);
function selectProbeReport(data, sampleCount) {
  if (data?.schema !== 1 || !data.runtime || !Array.isArray(data.samples) || data.samples.length !== sampleCount
    || !data.samples.every(row => row && typeof row === 'object' && Number.isFinite(row.timestamp))) throw Error('invalid-probe-json');
  const runtime = Object.fromEntries(['execPath', 'node', 'uv', 'electron', 'platform', 'arch'].map(key => [key,
    typeof data.runtime[key] === 'string' ? data.runtime[key].slice(0, 4096) : null]));
  const numberKeys = ['targetStartAt', 'startedAt', 'baselineAt', 'startupDelayMs', 'finishedAt', 'intervalMs', 'requestedSamples', 'averageCpu', 'last12AverageCpu', 'last12SampleCount'];
  const sampleKeys = ['timestamp', 'scheduledAt', 'sampleIntervalMs', 'idle', 'total', 'busy', 'idleDelta', 'totalDelta', 'busyDelta', 'logicalCpuCount', 'cpu', 'average12', 'averageSampleCount'];
  const baseline = data.baseline && Object.fromEntries(['timestamp', 'idle', 'total', 'busy', 'logicalCpuCount'].map(key => [key, finite(data.baseline[key])]));
  return { schema: 1, runtime, ...Object.fromEntries(numberKeys.map(key => [key, finite(data[key])])), baseline: baseline ?? null,
    samples: data.samples.map(row => ({ ...Object.fromEntries(sampleKeys.map(key => [key, finite(row[key])])),
      status: statuses.has(row.status) ? row.status : 'cpu-snapshot-unavailable' })) };
}

export async function collectRuntimeComparison({ run = execute, now = Date.now,
  resolveElectron = () => electronExecutable(new URL('../../frontend_avatar/package.json', import.meta.url)),
  nodeExecutable = process.execPath, env = process.env, startDelayMs = 1500, intervalMs = 500, sampleCount = 24,
  timeout = 18000, signal } = {}) {
  const targetStartAt = now() + startDelayMs;
  checkSamplingOptions(targetStartAt, intervalMs, sampleCount);
  if (!Number.isFinite(startDelayMs) || startDelayMs < 0 || startDelayMs > 3000 || !Number.isFinite(timeout)
    || timeout < startDelayMs + intervalMs * sampleCount + 500 || timeout > 20000) throw RangeError('CPU比較の実行期限が不正です。');
  const args = [script, '--sample', String(targetStartAt), String(intervalMs), String(sampleCount)];
  const controller = new AbortController(), children = new Set();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  async function probe(kind, executable, electron) {
    let task;
    try {
      const childEnv = { ...env };
      // 親やNode子の環境を変更せず、Electron子だけNodeモードにする。
      delete childEnv.ELECTRON_RUN_AS_NODE;
      if (electron) childEnv.ELECTRON_RUN_AS_NODE = '1';
      task = run(executable, args, { timeout, maxBuffer: 512 * 1024, windowsHide: true, shell: false,
        killSignal: 'SIGKILL', signal: controller.signal, env: childEnv });
      if (task?.child) children.add(task.child);
      const { stdout } = await task;
      if (Buffer.byteLength(String(stdout)) > 512 * 1024) return { kind, error: 'probe-output-limit' };
      try { return { kind, ...selectProbeReport(JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim()), sampleCount) }; }
      catch { return { kind, error: 'invalid-probe-json' }; }
    } catch (error) {
      return { kind, error: controller.signal.aborted ? 'probe-aborted' : 'probe-command-failed', code: safeCode(error), killed: !!error?.killed };
    }
  }
  try {
    // 片方の起動失敗で他方を中止せず、同じtargetStartAtへ並行して起動する。
    const systemNode = probe('system-node-probe', nodeExecutable, false);
    const installedAvatarElectron = (async () => {
      let executable;
      try { executable = await resolveElectron(); if (typeof executable !== 'string' || !executable) throw Error('missing'); }
      catch (error) { return { kind: 'installed-avatar-electron-probe', error: 'avatar-electron-unavailable', code: safeCode(error) }; }
      return probe('installed-avatar-electron-probe', executable, true);
    })();
    const [node, electron] = await Promise.all([systemNode, installedAvatarElectron]);
    return { schema: 1, mode: 'separate-runtime-probes-not-existing-eyes', metric: 'legacy-os-times', targetStartAt, intervalMs, sampleCount,
      systemNode: node, installedAvatarElectron: electron };
  } finally {
    signal?.removeEventListener('abort', abort);
    controller.abort();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* すでに終了済みなら追加操作は不要。 */ }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const work = args.length === 4 && args[0] === '--sample'
    ? sampleRuntimeCpu({ targetStartAt: Number(args[1]), intervalMs: Number(args[2]), sampleCount: Number(args[3]) })
    : args.length === 0 ? collectRuntimeComparison() : Promise.reject(Error('invalid-arguments'));
  work.then(report => { process.stdout.write(JSON.stringify(report) + '\n'); })
    .catch(() => { process.stderr.write('CPU runtime probe failed.\n'); process.exitCode = 1; });
}
