// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { sampleRuntimeCpu, collectRuntimeComparison } from '../scripts/cpu-runtime-probe.mjs';

const execute = promisify(execFile), script = fileURLToPath(new URL('../scripts/cpu-runtime-probe.mjs', import.meta.url));
const runtime = { execPath: '/test/node', node: '26.0.0', uv: '1.51.0', electron: null, platform: 'win32', arch: 'x64' };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture({ initial = 0, extraSleep = () => 0, cost = () => 0,
  usage = () => 100, failure = () => false } = {}) {
  let time = initial, calls = 0, sleeps = 0, user = 0, idle = 0;
  const callTimes = [];
  return { callTimes,
    options: { runtime, now: () => time, monotonicNow: () => time,
      sleep: async ms => { time += ms + extraSleep(++sleeps); },
      system: { cpus() {
        callTimes.push(time); calls++;
        if (failure(calls)) throw Error('private CPU failure');
        if (calls > 1) { const next = usage(calls - 1); user += next; idle += 100 - next; }
        time += cost(calls);
        return Array.from({ length: 4 }, () => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } }));
      } },
    },
  };
}
async function goodReport(options = {}) {
  const f = fixture(); return sampleRuntimeCpu({ ...f.options, targetStartAt: 1500, ...options });
}

test('同じeyes式で500ms×24標本を採り、全コアraw差分と実際の窓を記録する', async () => {
  const f = fixture(); const report = await sampleRuntimeCpu({ ...f.options, targetStartAt: 1000 });
  assert.equal(report.samples.length, 24); assert.equal(report.finishedAt, 13000); assert.equal(report.runtime.node, runtime.node);
  assert.equal(report.baseline.timestamp, 1000); assert.equal(report.startupDelayMs, 0);
  assert.deepEqual(f.callTimes, Array.from({ length: 25 }, (_, i) => 1000 + i * 500));
  for (const row of report.samples) {
    assert.equal(row.cpu, 100); assert.equal(row.totalDelta, 400); assert.equal(row.busyDelta, 400); assert.equal(row.idleDelta, 0);
    assert.equal(row.logicalCpuCount, 4); assert.equal(row.sampleIntervalMs, 500); assert.equal(row.timestamp, row.scheduledAt);
  }
  assert.equal(report.last12AverageCpu, 100); assert.equal(report.last12SampleCount, 12);
});

test('eyesと同じ12点単純平均をraw最新値と別に残し、13点目で最古値を落とす', async () => {
  const f = fixture({ usage: index => index === 1 ? 100 : 0 });
  const report = await sampleRuntimeCpu({ ...f.options, targetStartAt: 0 });
  assert.equal(report.samples[0].cpu, 100); assert.equal(report.samples[0].average12, 100);
  assert.equal(report.samples[1].cpu, 0); assert.equal(report.samples[1].average12, 50);
  near(report.samples[11].average12, 100 / 12); assert.equal(report.samples[12].average12, 0);
  assert.equal(report.last12AverageCpu, 0); near(report.averageCpu, 100 / 24);
});

test('50〜150msの採取コストは次の予定へ加算せず、実窓と開始時刻を区別する', async () => {
  const f = fixture({ cost: call => call === 1 ? 0 : [50, 150][call % 2] });
  const report = await sampleRuntimeCpu({ ...f.options, targetStartAt: 1000, sampleCount: 6 });
  assert.deepEqual(f.callTimes, [1000, 1500, 2000, 2500, 3000, 3500, 4000]);
  assert.equal(report.samples[0].sampleIntervalMs, 550); assert.equal(report.samples[1].sampleIntervalMs, 600);
  assert.ok(report.samples.every(row => row.cpu === 100));
});

test('起動遅れとタイマー遅延を記録し、短時間の追い付き採取を行わない', async () => {
  const late = fixture({ initial: 5000 });
  const lateReport = await sampleRuntimeCpu({ ...late.options, targetStartAt: 1000, sampleCount: 2 });
  assert.equal(lateReport.startupDelayMs, 4000); assert.deepEqual(late.callTimes, [5000, 5500, 6000]);
  const delayed = fixture({ extraSleep: count => count === 2 ? 1250 : 0 });
  const report = await sampleRuntimeCpu({ ...delayed.options, targetStartAt: 1000, sampleCount: 3 });
  assert.deepEqual(delayed.callTimes, [1000, 2750, 3000, 3500]);
  assert.equal(report.samples[0].scheduledAt, 1500); assert.equal(report.samples[0].sampleIntervalMs, 1750);
  assert.equal(report.samples[1].sampleIntervalMs, 250); assert.equal(report.samples[1].cpu, 100);
});

test('一時的な採取失敗は秘密の例外文を保存せず、eyes同様に平均へ追加しない', async () => {
  const f = fixture({ failure: call => call === 3 });
  const report = await sampleRuntimeCpu({ ...f.options, targetStartAt: 0, sampleCount: 4 });
  assert.equal(report.samples[1].cpu, null); assert.equal(report.samples[1].status, 'cpu-snapshot-unavailable');
  assert.equal(report.samples[1].averageSampleCount, 1); assert.equal(report.samples[1].average12, 100);
  assert.equal(report.samples[2].sampleIntervalMs, 1000); assert.equal(report.samples[2].cpu, 100);
  assert.doesNotMatch(JSON.stringify(report), /private/);
});

test('差分0・巻戻りもeyesの式を保ったまま、診断上の状態を分ける', async () => {
  const rows = [{ user: 100, idle: 100 }, { user: 100, idle: 100 }, { user: 0, idle: 0 }, { user: 100, idle: 0 }];
  let time = 0;
  const report = await sampleRuntimeCpu({ targetStartAt: 0, sampleCount: 3, runtime, now: () => time, monotonicNow: () => time,
    sleep: async ms => { time += ms; }, system: { cpus: () => [{ times: rows.shift() }] } });
  assert.deepEqual(report.samples.map(row => row.cpu), [0, 0, 100]);
  assert.deepEqual(report.samples.map(row => row.status), ['zero-total-delta', 'counter-discontinuity', 'available']);
  assert.equal(report.samples[1].totalDelta, -200);
});

test('2ランタイムを同じ固定script・開始時刻で並行起動し、Electron子だけNodeモードにする', async () => {
  const source = await goodReport(), calls = [], releases = [], parentEnv = { SAFE: 'yes', ELECTRON_RUN_AS_NODE: 'inherited', SECRET: 'not recorded' };
  const promise = collectRuntimeComparison({ now: () => 10000, nodeExecutable: '/system/node', resolveElectron: () => '/avatar/electron', env: parentEnv,
    run(file, args, options) { calls.push({ file, args, options }); return new Promise(resolve => releases.push(resolve)); },
  });
  await flush(); assert.equal(calls.length, 2); assert.equal(releases.length, 2);
  assert.deepEqual(calls.map(call => call.file), ['/system/node', '/avatar/electron']);
  assert.deepEqual(calls[0].args, calls[1].args); assert.deepEqual(calls[0].args.slice(1), ['--sample', '11500', '500', '24']);
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(calls[1].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(parentEnv.ELECTRON_RUN_AS_NODE, 'inherited'); assert.equal(calls[0].options.timeout, 18000);
  assert.equal(calls[0].options.maxBuffer, 512 * 1024); assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.killSignal, 'SIGKILL');
  for (const finish of releases) finish({ stdout: JSON.stringify({ ...source, secret: 'not recorded' }) });
  const result = await promise;
  assert.equal(result.mode, 'separate-runtime-probes-not-existing-eyes');
  assert.equal(result.systemNode.kind, 'system-node-probe'); assert.equal(result.installedAvatarElectron.kind, 'installed-avatar-electron-probe');
  assert.equal(result.systemNode.samples.length, 24); assert.doesNotMatch(JSON.stringify(result), /not recorded|commandline|SECRET/);
  assert.equal(calls[0].options.signal.aborted, true);
});

test('Avatar Electronが未導入でもNodeの結果を残し、導入コマンドを実行しない', async () => {
  const source = await goodReport(); let calls = 0;
  const result = await collectRuntimeComparison({ resolveElectron() { throw Object.assign(Error('private installation path'), { code: 'MODULE_NOT_FOUND' }); },
    run: async () => { calls++; return { stdout: JSON.stringify(source) }; } });
  assert.equal(calls, 1); assert.equal(result.systemNode.samples.length, 24);
  assert.deepEqual(result.installedAvatarElectron, { kind: 'installed-avatar-electron-probe', error: 'avatar-electron-unavailable', code: 'MODULE_NOT_FOUND' });
  assert.doesNotMatch(JSON.stringify(result), /private installation/);
});

test('片方のコマンド失敗・時間切れでも他方の有効結果を保持する', async () => {
  const source = await goodReport();
  const result = await collectRuntimeComparison({ nodeExecutable: '/system/node', resolveElectron: () => '/avatar/electron',
    run: async file => { if (file === '/system/node') throw Object.assign(Error('secret command and environment'), { code: 'ETIMEDOUT', killed: true, stderr: 'secret stderr' });
      return { stdout: JSON.stringify(source) }; } });
  assert.deepEqual(result.systemNode, { kind: 'system-node-probe', error: 'probe-command-failed', code: 'ETIMEDOUT', killed: true });
  assert.equal(result.installedAvatarElectron.samples.length, 24); assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('不正JSON・過大stdoutを結果へ転載しない', async () => {
  const result = await collectRuntimeComparison({ nodeExecutable: '/system/node', resolveElectron: () => '/avatar/electron',
    run: async file => ({ stdout: file === '/system/node' ? 'secret invalid JSON' : 'x'.repeat(512 * 1024 + 1) }) });
  assert.equal(result.systemNode.error, 'invalid-probe-json'); assert.equal(result.installedAvatarElectron.error, 'probe-output-limit');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('子応答の未知フィールドや生のenv/commandlineを除外する', async () => {
  const source = await goodReport(); source.runtime.env = { secret: 'private' }; source.samples[0].commandline = 'private'; source.baseline.env = 'private';
  const result = await collectRuntimeComparison({ resolveElectron: () => '/avatar/electron', run: async () => ({ stdout: JSON.stringify(source) }) });
  assert.equal(result.systemNode.runtime.node, runtime.node); assert.doesNotMatch(JSON.stringify(result), /private|commandline|env/);
});

test('中止シグナルを両子へ渡し、終了時に残っているchildを片付ける', async () => {
  const signal = new AbortController(), children = [];
  const work = collectRuntimeComparison({ signal: signal.signal, resolveElectron: () => '/avatar/electron',
    run(file, args, options) {
      const child = { exitCode: null, signalCode: null, kills: 0, kill(name) { assert.equal(name, 'SIGKILL'); child.kills++; } };
      children.push(child);
      const task = new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject({ code: 'ABORT_ERR' }), { once: true }));
      task.child = child; return task;
    } });
  await flush(); assert.equal(children.length, 2); signal.abort(); const result = await work;
  assert.equal(result.systemNode.error, 'probe-aborted'); assert.equal(result.installedAvatarElectron.error, 'probe-aborted');
  assert.ok(children.every(child => child.kills === 1));
});

test('20秒超の期限や過剰採取を起動前に拒否する', async () => {
  let calls = 0; const run = async () => { calls++; throw Error('unexpected'); };
  for (const options of [{ timeout: 20001 }, { timeout: 1000 }, { sampleCount: 100 }, { intervalMs: 0 }, { startDelayMs: -1 }]) {
    await assert.rejects(collectRuntimeComparison({ ...options, run }));
  }
  assert.equal(calls, 0);
});

test('Avatarの既存Electron解決だけを使い、外部通信・設定変更・自動導入を含まない', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /electronExecutable\(new URL\('\.\.\/\.\.\/frontend_avatar\/package\.json', import\.meta\.url\)\)/);
  assert.doesNotMatch(source, /fetch\(|https?:\/\/[^\s'";]*\.(?:download|zip)|npm install|npx|downloadArtifact|writeFile\(|Set-ItemProperty|process\.env\.[A-Z_]+\s*=/);
});

test('実Node子でも短い診断がJSONのみを出し、終了コード0で終了する', async () => {
  const { stdout, stderr } = await execute(process.execPath, [script, '--sample', String(Date.now() + 100), '10', '3'],
    { timeout: 3000, maxBuffer: 512 * 1024, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  const result = JSON.parse(stdout); assert.equal(stderr, ''); assert.equal(result.schema, 1);
  assert.equal(result.samples.length, 3); assert.equal(result.runtime.node, process.versions.node);
  assert.equal(result.runtime.electron, null); assert.equal(result.runtime.execPath, process.execPath);
  assert.ok(result.samples.every(row => Number.isFinite(row.timestamp) && Number.isFinite(row.cpu)));
});
