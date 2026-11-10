// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemMetrics, parseGpuUtilization } from '../aidiy_cpu/metrics.mjs';
function fixture(options = {}) {
  let time = 0, busy = 100, idle = 100, calls = 0;
  const system = { cpus: () => [{ times: { user: busy, idle } }, { times: { user: busy, idle } }], totalmem: () => 1000, freemem: () => 250 };
  const metrics = createSystemMetrics({ system, now: () => time, run: async () => { calls++; return { stdout: '20\n65\n' }; }, ...options });
  return { metrics, system, get calls() { return calls; }, tick(ms = 1000, work = 25, rest = 75) { time += ms; busy += work; idle += rest; } };
}
test('CPUは区間差分、RAMはホスト使用率、GPUは複数デバイスの最大値', async () => {
  const f = fixture(); f.tick();
  assert.deepEqual(await f.metrics.sample(), { timestamp: 1000, cpu: 25, ram: 75, gpu: 65, gpuStatus: 'available' });
  f.tick(1000, 90, 10); assert.equal((await f.metrics.sample()).cpu, 90); f.metrics.close();
});
test('GPU未対応・不正値を0%にせず、実際の0%は保持する', () => {
  for (const value of ['', 'N/A', '[Not Supported]', '15\nN/A', '101', '-1', 'garbage']) assert.equal(parseGpuUtilization(value), null);
  assert.equal(parseGpuUtilization('0\n'), 0);
  assert.equal(parseGpuUtilization('20\r\n40'), 40);
});
test('GPU失敗はnullで30秒後に再試行、CPUとRAMは継続', async () => {
  let calls = 0;
  const f = fixture({ run: async () => { calls++; throw Error('not installed'); } }); f.tick();
  const result = await f.metrics.sample(); assert.equal(result.gpu, null); assert.equal(result.gpuStatus, 'unavailable');
  f.tick(); assert.equal((await f.metrics.sample()).cpu, 25); assert.equal(calls, 1);
  f.tick(30000); await f.metrics.sample(); assert.equal(calls, 2); f.metrics.close();
});
test('重複要求を集約、短期間はキャッシュし、外部コマンドは制限付き', async () => {
  let release, invocation;
  const f = fixture({ run: (...args) => { invocation = args; return new Promise(resolve => { release = resolve; }); } }); f.tick();
  const first = f.metrics.sample(), second = f.metrics.sample(); assert.equal(first, second);
  assert.equal(invocation[0], 'nvidia-smi'); assert.equal(invocation[2].shell, false); assert.equal(invocation[2].timeout, 1500); assert.equal(invocation[2].maxBuffer, 16384);
  release({ stdout: '0' }); const result = await first; assert.equal(await f.metrics.sample(), result); f.metrics.close();
});
test('初回の差分なし・CPU数変更・不正RAMは測定不能を返す', async () => {
  const f = fixture(); assert.equal((await f.metrics.sample()).cpu, null);
  f.tick(); f.system.cpus = () => [{ times: { user: 200, idle: 200 } }]; f.system.freemem = () => NaN;
  const result = await f.metrics.sample(); assert.equal(result.cpu, null); assert.equal(result.ram, null); f.metrics.close();
});
test('終了時は進行中の取得を中止し、結果と再取得を拒否する', async () => {
  let release, signal;
  const f = fixture({ run: (_file, _args, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
  const pending = f.metrics.sample(); f.metrics.close(); assert.equal(signal.aborted, true); release({ stdout: '40' });
  await assert.rejects(pending, /終了/); await assert.rejects(f.metrics.sample(), /終了/);
});
