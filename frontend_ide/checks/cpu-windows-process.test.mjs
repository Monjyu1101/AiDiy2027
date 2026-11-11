// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createWindowsMetricsProcess, windowsMetricsProcessCommand } from '../aidiy_cpu/windows-process.mjs';
import { windowsGpuCimCommand, windowsGpuCounterCommand } from '../aidiy_cpu/windows-gpu.mjs';
import { mockCpuRefresher } from './cpu-windows-fixture.mjs';
import { createSystemMetrics } from '../aidiy_cpu/metrics.mjs';

const value = { cpu: { Name: '_Total', PercentProcessorTime: 64, PercentProcessorUtility: 92 }, gpu: [{ Name: 'pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D', UtilizationPercentage: 40 }] };
const reply = JSON.stringify(value) + '\r\n';
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  let now = 0, id = 0;
  const children = [], timers = new Map();
  const clock = {
    setTimer(fn, ms) { const timer = ++id; timers.set(timer, { fn, at: now + ms }); return timer; },
    clearTimer(timer) { timers.delete(timer); },
  };
  const worker = createWindowsMetricsProcess({ ...clock, spawn(file, args, opts) {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.writes = []; child.kills = 0; child.stdin.on('data', data => child.writes.push(String(data)));
    child.kill = () => { child.kills++; return true; };
    children.push({ child, file, args, opts }); return child;
  }, ...options });
  return { worker, children, timers, get now() { return now; }, get child() { return children.at(-1)?.child; },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = until;
    },
  };
}

test('固定スクリプトは入力をコマンド化せず、ブロッキング読取で要求された計測だけ行う', () => {
  assert.match(windowsMetricsProcessCommand, /\[Console\]::ReadLine\(\)/);
  assert.match(windowsMetricsProcessCommand, /switch -Exact \(\$request\)/);
  assert.match(windowsMetricsProcessCommand, /default \{ exit 1 \}/);
  assert.doesNotMatch(windowsMetricsProcessCommand, /Invoke-Expression|ScriptBlock\]::Create|Start-Sleep/);
  assert.equal((windowsMetricsProcessCommand.match(/function Read-AidiyCpu/g) ?? []).length,1);
  assert.ok(Buffer.from(windowsMetricsProcessCommand, 'utf16le').toString('base64').length < 30000);
});

test('1秒ごと60回の計測でもPowerShell起動は1回、CPU/GPUの値と更新間隔は維持', async () => {
  const f = fixture();
  for (let index = 0; index < 60; index++) {
    const pending = f.worker.sample(windowsGpuCimCommand);
    f.child.stdout.write(reply);
    assert.deepEqual(JSON.parse((await pending).stdout), value);
    f.advance(1000);
  }
  assert.equal(f.children.length, 1); assert.equal(f.child.writes.length, 60);
  assert.ok(f.child.writes.every(line => line === 'cim\n'));
  const { file, args, opts } = f.children[0];
  assert.equal(file, 'powershell.exe'); assert.ok(args.includes('-NoProfile')); assert.ok(args.includes('-NonInteractive'));
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), windowsMetricsProcessCommand);
  assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true); assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
  f.worker.close(); assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
});

test('無通信10秒で解放し再表示時だけ再起動、旧プロセス終了で新要求を壊さない', async () => {
  const f = fixture(); const first = f.worker.sample(); f.child.stdout.write(reply); await first;
  const old = f.child;
  f.advance(9999); assert.equal(old.kills, 0); f.advance(1); assert.equal(old.kills, 1); assert.equal(f.timers.size, 0);
  f.advance(60000); assert.equal(f.children.length, 1);
  const pending = f.worker.sample(windowsGpuCounterCommand, false); assert.equal(f.children.length, 2);
  old.emit('exit', 0); old.stdout.write(reply); assert.equal(f.child.kills, 0);
  assert.deepEqual(f.child.writes, ['counter-gpu\n']); f.child.stdout.write(reply); await pending; f.worker.close();
});

test('1時間相当の3600回でも子プロセスとタイマーが増えず、休止・再開を繰り返せる', async () => {
  const f = fixture();
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let index = 0; index < 1200; index++) {
      const pending = f.worker.sample(windowsGpuCimCommand); f.child.stdout.write(reply); await pending;
      assert.equal(f.timers.size, 1); f.advance(1000);
    }
    f.advance(10000); assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
    assert.equal(f.children.length, cycle + 1);
  }
  assert.equal(f.children.reduce((sum, item) => sum + item.child.writes.length, 0), 3600);
  f.worker.close(); assert.equal(f.timers.size, 0);
});

test('分割されたUTF-8/CRLFの応答を1回だけ解決し、取得中の追加起動を拒否', async () => {
  const f = fixture(); const pending = f.worker.sample(windowsGpuCimCommand, false);
  await assert.rejects(f.worker.sample(), /実行中/); assert.equal(f.children.length, 1);
  const unicode = JSON.stringify({ text: '計測', ...value }) + '\r\n'; const bytes = Buffer.from(unicode);
  for (const byte of bytes) f.child.stdout.write(Buffer.from([byte]));
  assert.equal(JSON.parse((await pending).stdout).text, '計測'); f.worker.close();
});

for (const failure of ['timeout', 'abort', 'exit', 'spawn-error', 'stdin-error', 'invalid-json', 'duplicate', 'stdout-limit', 'stderr-limit']) {
  test(`失敗 ${failure} はプロセスを解放し、次の要求で復帰できる`, async () => {
    const f = fixture(), controller = new AbortController();
    const pending = f.worker.sample('', true, { timeout: 5000, maxBuffer: 512, signal: controller.signal });
    const rejection = assert.rejects(pending);
    if (failure === 'timeout') f.advance(5000);
    if (failure === 'abort') controller.abort();
    if (failure === 'exit') f.child.emit('exit', 1);
    if (failure === 'spawn-error') f.child.emit('error', Error('missing'));
    if (failure === 'stdin-error') f.child.stdin.emit('error', Error('closed'));
    if (failure === 'invalid-json') f.child.stdout.write('not json\n');
    if (failure === 'duplicate') f.child.stdout.write(reply + reply);
    if (failure === 'stdout-limit') f.child.stdout.write('x'.repeat(513));
    if (failure === 'stderr-limit') f.child.stderr.write('x'.repeat(513));
    await rejection; assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
    const again = f.worker.sample(); f.child.stdout.write(reply); await again;
    assert.equal(f.children.length, 2); f.worker.close();
  });
}

test('終了時は取得中の要求と解放タイマーを取消し、新規要求を拒否する', async () => {
  const f = fixture(); const pending = f.worker.sample(); const rejection = assert.rejects(pending, /終了/);
  f.worker.close(); await rejection; assert.equal(f.timers.size, 0); assert.equal(f.child.kills, 1);
  f.worker.close(); await assert.rejects(f.worker.sample(), /終了/); assert.equal(f.children.length, 1);
});

test('不正識別子・開始前中止ではプロセスを起動しない', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.worker.sample('Write-Output unsafe'), /未対応/);
  await assert.rejects(f.worker.sample('', true, { signal: controller.signal }), /終了/);
  assert.equal(f.children.length, 0); f.worker.close();
});

test('metrics本体から60回取得しても起動1回、既存API値・非同期応答・終了を維持', async () => {
  const f = fixture(); let busy = 100, idle = 100;
  const metrics = createSystemMetrics({ platform: 'win32', windowsMetrics: f.worker, now: () => f.now,
    system: { cpus: () => [{ times: { user: busy, idle } }], totalmem: () => 1000, freemem: () => 250 },
    run: async () => { throw Error('NVIDIA must not be needed'); },
  });
  for (let index = 0; index < 60; index++) {
    const data = await metrics.sample();
    if (index) { assert.equal(data.cpu, 64); assert.equal(data.gpu, 40); assert.equal(data.cpuSource, 'windows-processor-time'); assert.equal(data.cpuDetails.windowsProcessorUtility, 92); }
    else assert.equal(data.cpu, null);
    f.child.stdout.write(reply); await settle();
    f.advance(1000); busy += 3; idle += 97;
  }
  assert.equal(f.children.length, 1); assert.equal(f.child.writes.length, 60);
  metrics.close(); assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
});

test('OSの実pipeでも連続応答を取得でき、close後は実プロセスが終了する', async () => {
  let child, starts = 0;
  const worker = createWindowsMetricsProcess({ spawn() {
    starts++; child = spawn(process.execPath, ['-e', `require('node:readline').createInterface({input:process.stdin}).on('line',()=>process.stdout.write(${JSON.stringify(reply)}))`], { stdio: ['pipe', 'pipe', 'pipe'] }); return child;
  } });
  try {
    for (let i = 0; i < 10; i++) assert.deepEqual(JSON.parse((await worker.sample()).stdout), value);
    assert.equal(starts, 1);
    const exited = new Promise(resolve => child.once('exit', resolve)); worker.close(); await exited;
    assert.equal(child.killed, true);
  } finally { worker.close(); }
});

test('Windows実行: 同一PowerShellでCPU/GPUの固定照会を切替え、最後まで再利用する', { skip: process.platform !== 'win32' }, async () => {
  let starts = 0;
  const worker = createWindowsMetricsProcess({ spawn(file, args, opts) {
    starts++;
    const mock = mockCpuRefresher() + `$script:gpuCalls = 0
    function Get-CimInstance { param($Namespace,$ClassName,$Filter,$Property,$OperationTimeoutSec)
      if ($ClassName -eq 'Win32_PerfFormattedData_Counters_ProcessorInformation') { throw 'CPU must not use CIM' }
      else {
        $script:gpuCalls++; if ($script:gpuCalls -eq 1) { throw 'First GPU query fails' }
        [PSCustomObject]@{Name='${value.gpu[0].Name}';UtilizationPercentage=40}
      }
    }
    function Get-ItemProperty { param($LiteralPath,$Name)
      if ($LiteralPath.EndsWith('\\009')) { return @{Counter=@('100','GPU Engine','200','Utilization Percentage')} }
      return @{Counter=@('200','使用率','100','GPU エンジン')}
    }
    function Get-Counter { param($Counter,$SampleInterval,$MaxSamples,$ErrorAction)
      if ($Counter -ne '\\GPU エンジン(*engtype_3D)\\使用率' -or $SampleInterval -ne 1 -or $MaxSamples -ne 2) { throw 'Invalid counter request' }
      [PSCustomObject]@{CounterSamples=@([PSCustomObject]@{InstanceName='${value.gpu[0].Name}';CookedValue=80;Status=0})}
      [PSCustomObject]@{CounterSamples=@([PSCustomObject]@{InstanceName='${value.gpu[0].Name}';CookedValue=42;Status=1})}
    }\n`;
    args[args.length - 1] = Buffer.from(mock + windowsMetricsProcessCommand, 'utf16le').toString('base64');
    return spawn(file, args, opts);
  } });
  try {
    for (const [gpu, readCpu, expected] of [[windowsGpuCimCommand, true, null], ['', true, null], [windowsGpuCounterCommand, true, 42], [windowsGpuCounterCommand, false, 42], [windowsGpuCimCommand, false, 40], [windowsGpuCimCommand, true, 40]]) {
      const data = JSON.parse((await worker.sample(gpu, readCpu)).stdout);
      assert.equal(data.cpu?.PercentProcessorTime ?? null, readCpu ? 64 : null);
      assert.equal(data.gpu[0]?.UtilizationPercentage ?? null, expected);
    }
    assert.equal(starts, 1);
  } finally { worker.close(); }
});
