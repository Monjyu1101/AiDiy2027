// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemMetrics, parseGpuUtilization, parseWindowsGpuUtilization } from '../aidiy_cpu/metrics.mjs';
import { parseWindowsCpuUtilization } from '../aidiy_cpu/windows-cpu.mjs';
// API/GPUのテストでは採取済みCPUを注入。実採取はcpu-os-monitor.test.mjsで検証する。
function fixture(options = {}) {
  let time = 0, calls = 0, record = null, state = 'warming-up', closed = false;
  const system = { cpus: () => [{ times: { user: 100, idle: 100 } }], totalmem: () => 1000, freemem: () => 250 };
  const cpu = { read: () => record, status: () => state, close: () => { closed = true; } };
  const metrics = createSystemMetrics({ system, platform: 'linux', cpuMetrics: cpu, now: () => time, run: async () => { calls++; return { stdout: '20\n65\n' }; }, ...options });
  return { metrics, system, get calls() { return calls; }, get closed() { return closed; },
    tick(ms = 1000, work = 25, rest = 75) { time += ms; record = { cpu: 100 * work / (work + rest), measuredAt: time, sampleIntervalMs: 500, logicalCpuCount: 2 }; state = 'available'; },
    set(value, duration = 500, status = value === null ? 'unavailable' : 'available') { state = status; record = value === null ? null : { cpu: value, measuredAt: time, sampleIntervalMs: duration, logicalCpuCount: 2 }; },
    elapse(ms) { time += ms; },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const engine = (pid, eng, value, luid = '0x00000000_0x0000abcd', phys = 0, type = '3D') => ({
  Name: `pid_${pid}_luid_${luid}_phys_${phys}_eng_${eng}_engtype_${type}`, UtilizationPercentage: value,
});
const source = (file, args) => file !== 'powershell.exe' ? 'nvidia' : args.at(-1).includes('Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine') ? 'cim' : args.at(-1).includes('Get-Counter') ? 'counter' : 'cpu';
async function sampleGpu(f) { await f.metrics.sample(); await settle(); f.tick(); return f.metrics.sample(); }

test('CPUは最新採取値、RAMはホスト使用率、GPUは非同期で複数デバイスの最大値', async () => {
  const f = fixture(); f.tick();
  const first = await f.metrics.sample();
  assert.deepEqual({ timestamp: first.timestamp, cpu: first.cpu, ram: first.ram, gpu: first.gpu, gpuStatus: first.gpuStatus }, { timestamp: 1000, cpu: 25, ram: 75, gpu: null, gpuStatus: 'unavailable' });
  assert.equal(first.cpuSource, 'os-times'); assert.equal(first.cpuDetails.sampleIntervalMs, 500);
  await settle(); f.tick(1000, 90, 10);
  const second = await f.metrics.sample();
  assert.deepEqual({ timestamp: second.timestamp, cpu: second.cpu, ram: second.ram, gpu: second.gpu, gpuStatus: second.gpuStatus }, { timestamp: 2000, cpu: 90, ram: 75, gpu: 65, gpuStatus: 'available' }); f.metrics.close();
});
test('GPU未対応・不正値を0%にせず、実際の0%は保持する', () => {
  for (const value of ['', 'N/A', '[Not Supported]', '15\nN/A', '101', '-1', 'garbage']) assert.equal(parseGpuUtilization(value), null);
  assert.equal(parseGpuUtilization('0\n'), 0); assert.equal(parseGpuUtilization('20\r\n40'), 40);
});
test('GPU失敗はnullで30秒後に再試行、CPUとRAMは継続', async () => {
  let calls = 0;
  const f = fixture({ run: async () => { calls++; throw Error('not installed'); } }); f.tick();
  const result = await f.metrics.sample(); await settle(); assert.equal(result.gpu, null); assert.equal(result.gpuStatus, 'unavailable');
  f.tick(); assert.equal((await f.metrics.sample()).cpu, 25); assert.equal(calls, 1);
  f.tick(30000); await f.metrics.sample(); assert.equal(calls, 2); f.metrics.close();
});
test('遅いGPU取得はCPU/RAMを待たせず、重複要求と取得中の再起動を抑止', async () => {
  let release, invocation, calls = 0;
  const f = fixture({ run: (...args) => { calls++; invocation = args; return new Promise(resolve => { release = resolve; }); } }); f.tick();
  const first = f.metrics.sample(), second = f.metrics.sample(); assert.equal(first, second);
  assert.equal(invocation[0], 'nvidia-smi'); assert.equal(invocation[2].shell, false); assert.equal(invocation[2].timeout, 1500); assert.equal(invocation[2].maxBuffer, 16384);
  const result = await first; assert.equal(result.cpu, 25); assert.equal(result.ram, 75); assert.equal(result.gpu, null);
  assert.equal(await f.metrics.sample(), result);
  f.tick(5000); assert.equal((await f.metrics.sample()).gpu, null); assert.equal(calls, 1);
  release({ stdout: '0' }); await settle(); f.tick(); assert.equal((await f.metrics.sample()).gpu, 0); f.metrics.close();
});
test('初回準備中・取得不能・不正RAMを測定済み0%と区別する', async () => {
  const f = fixture(); assert.equal((await f.metrics.sample()).cpu, null);
  f.tick(); f.set(null); f.system.freemem = () => NaN;
  const result = await f.metrics.sample(); assert.equal(result.cpu, null); assert.equal(result.ram, null); f.metrics.close();
});
test('終了時は進行中のGPU取得を中止し、再取得を拒否する', async () => {
  let release, signal;
  const f = fixture({ run: (_file, _args, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
  await f.metrics.sample(); f.metrics.close(); assert.equal(signal.aborted, true); release({ stdout: '40' }); await settle();
  await assert.rejects(f.metrics.sample(), /終了/);
});
test('Windows 3Dは同一エンジンのプロセス別を合計し、エンジンとGPU間は最大', () => {
  assert.equal(parseWindowsGpuUtilization(JSON.stringify([engine(1,0,20),engine(2,0,'35'),engine(1,1,40),engine(1,2,99,undefined,0,'Copy')])),55);
  assert.equal(parseWindowsGpuUtilization(JSON.stringify([engine(1,0,20),engine(1,0,70,'0x00000000_0x0000ffff')])),70);
  assert.equal(parseWindowsGpuUtilization(JSON.stringify([engine(1,0,20),engine(1,0,70,undefined,1)])),70);
  assert.equal(parseWindowsGpuUtilization(JSON.stringify([engine(1,0,80),engine(2,0,40)])),100);
  assert.equal(parseWindowsGpuUtilization(JSON.stringify(engine(1,0,0))),0);
  for (const data of ['', '[]', 'null', '{}', 'no counters', JSON.stringify(engine(1,0,null)), JSON.stringify(engine(1,0,-1)), JSON.stringify(engine(1,0,101)), JSON.stringify({...engine(1,0,10),Name:'_Total'}), JSON.stringify(engine(1,0,10,undefined,0,'VideoDecode'))]) assert.equal(parseWindowsGpuUtilization(data),null,data);
});
test('消滅・不正・非3D・無効Statusのカウンターは正常な他の3D値へ影響しない', () => {
  const rows = [null, {}, engine(1,0,null), engine(2,0,101), {...engine(3,0,90),Status:2147485649}, engine(4,0,99,undefined,0,'VideoDecode'), engine(5,0,12.5), {...engine(6,0,7.5),Status:1}, {...engine(7,1,0),Status:0}];
  assert.equal(parseWindowsGpuUtilization('\uFEFF' + JSON.stringify(rows)), 20);
  assert.equal(parseWindowsGpuUtilization(JSON.stringify({...engine(1,0,0),Name:engine(1,0,0).Name.toUpperCase()})),0);
});
test('WindowsはCIMを優先し、成功時はGet-CounterとNVIDIAを起動しない', async () => {
  const calls = []; const f = fixture({platform:'win32', run:async (...args) => { calls.push(args); return {stdout:JSON.stringify(engine(1,0,35))}; }});
  assert.equal((await sampleGpu(f)).gpu,35); assert.ok(calls.every(args => source(...args) === 'cim'));
  assert.equal(calls[0][0],'powershell.exe'); assert.ok(calls[0][1].includes('-NoProfile')); assert.ok(calls[0][1].includes('-NonInteractive'));
  assert.match(calls[0][1].at(-1),/engtype_3D/); assert.equal(calls[0][2].shell,false); assert.equal(calls[0][2].windowsHide,true); assert.equal(calls[0][2].timeout,8000); f.metrics.close();
});
test('Intel: CIM未提供ならGet-Counterへ切替え、失敗CIMの30秒休止中も更新', async () => {
  const calls = []; let value = 42;
  const f = fixture({platform:'win32',run:async (file,args) => { const kind=source(file,args); calls.push(kind); if(kind==='cim')throw Error('invalid class'); assert.equal(kind,'counter'); return {stdout:JSON.stringify(engine(1,0,value))}; }});
  await f.metrics.sample(); await settle(); assert.deepEqual(calls,['cim','counter']);
  f.tick(); assert.equal((await f.metrics.sample()).gpu,42); await settle(); assert.deepEqual(calls,['cim','counter','counter']);
  value=0; f.tick(); await f.metrics.sample(); await settle(); f.tick(); assert.equal((await f.metrics.sample()).gpu,0); f.metrics.close();
});
test('CIMが空配列または不正値のみでもGet-Counterを試す', async () => {
  for (const stdout of ['[]',JSON.stringify(engine(1,0,null))]) {
    const calls=[]; const f=fixture({platform:'win32',run:async (file,args)=>{const kind=source(file,args);calls.push(kind);return {stdout:kind==='cim'?stdout:JSON.stringify(engine(1,0,33))};}});
    assert.equal((await sampleGpu(f)).gpu,33); assert.deepEqual(calls.slice(0,2),['cim','counter']); f.metrics.close();
  }
});
test('両Windows経路失敗はNVIDIAへ切替え、30秒後にCIMを再試行', async () => {
  const calls=[];let fail=true;
  const f=fixture({platform:'win32',run:async(file,args)=>{const kind=source(file,args);calls.push(kind);if(kind!=='nvidia'){if(fail)throw Error('unsupported');return{stdout:JSON.stringify(engine(1,0,0))};}return{stdout:'30'};}});
  await f.metrics.sample(); await settle(); assert.deepEqual(calls,['cim','counter','nvidia']);
  f.tick(); assert.equal((await f.metrics.sample()).gpu,30); await settle(); assert.equal(calls.at(-1),'nvidia');
  fail=false;f.tick(30000);assert.equal((await f.metrics.sample()).gpu,null);await settle();assert.equal(calls.at(-1),'cim');
  f.tick();assert.equal((await f.metrics.sample()).gpu,0);f.metrics.close();
});
test('成功後の全経路失敗は過去値を消し、完了時から30秒待って復旧', async () => {
  let fail=false,calls=0;
  const f=fixture({platform:'win32',run:async()=>{calls++;if(fail)throw Error('unavailable');return{stdout:JSON.stringify(engine(1,0,55))};}});
  await f.metrics.sample();await settle();fail=true;f.tick();assert.equal((await f.metrics.sample()).gpu,55);await settle();
  f.tick();assert.equal((await f.metrics.sample()).gpu,null);const before=calls;
  f.tick(28000);await f.metrics.sample();assert.equal(calls,before);
  fail=false;f.tick();await f.metrics.sample();await settle();assert.ok(calls>before);f.tick();assert.equal((await f.metrics.sample()).gpu,55);f.metrics.close();
});
test('Windows取得を終了すると、遅れて完了してもフォールバックを追加起動しない', async () => {
  for (const stopAt of ['cim','counter']) {
    let release,signal;const calls=[];
    const f=fixture({platform:'win32',run:(file,args,options)=>{const kind=source(file,args);calls.push(kind);if(kind!==stopAt)return Promise.reject(Error('no class'));signal=options.signal;return new Promise(r=>release=r);}});
    await f.metrics.sample();await settle();f.metrics.close();assert.equal(signal.aborted,true);release({stdout:'[]'});await settle();
    assert.deepEqual(calls,stopAt==='cim'?['cim']:['cim','counter']);await assert.rejects(f.metrics.sample(),/終了/);
  }
});
test('GPU要求が完了するまで新規取得を開始せず、失敗の再試行は完了時から数える', async () => {
  let release,calls=0;
  const f=fixture({run:()=>{calls++;return new Promise(r=>release=r);}});
  await f.metrics.sample();f.tick(10000);await f.metrics.sample();assert.equal(calls,1);
  release({stdout:'N/A'});await settle();f.tick(29000);await f.metrics.sample();assert.equal(calls,1);
  f.tick();await f.metrics.sample();assert.equal(calls,2);f.metrics.close();release({stdout:'0'});await settle();
});

const nativeCpu=(time,utility=time)=>({Name:'_Total',PercentProcessorTime:time,PercentProcessorUtility:utility});
test('CPU標準値は独立検証し、欠損・不正・コア別を除外、0とUtility>100を保持',()=>{
 assert.deepEqual(parseWindowsCpuUtilization(nativeCpu(0,150)),{time:0,utility:150});
 assert.deepEqual(parseWindowsCpuUtilization([nativeCpu('55','90')]),{time:55,utility:90});
 assert.deepEqual(parseWindowsCpuUtilization(nativeCpu(null,'51')),{time:null,utility:51});
 for(const row of [null,{},nativeCpu(null),nativeCpu(-1),nativeCpu(101,null),nativeCpu(''),{...nativeCpu(80),Name:'0,0'}])assert.equal(parseWindowsCpuUtilization(row),null);
});

for (const platform of ['win32', 'linux', 'darwin']) test(`${platform}は同じ採取済みos-times値を採用し、GPU応答のTime/Utilityへ切り替えない`, async () => {
 let native = { cpu: nativeCpu(4, 49), gpu: [engine(1, 0, 40)] };
 const f=fixture({platform,run:async()=>({stdout:platform==='win32'?JSON.stringify(native):'40'})});
 for(const row of [nativeCpu(4,49),nativeCpu(4,null),null]){
  native.cpu=row;f.tick(1000,9,91);const sample=await f.metrics.sample();await settle();
  assert.equal(sample.cpu,9);assert.equal(sample.cpuSource,'os-times');
  assert.equal(sample.cpuDetails.windowsProcessorTime,null);assert.equal(sample.cpuDetails.windowsProcessorUtility,null);
 }
 f.metrics.close();assert.equal(f.closed,true);
});
test('GPUの3秒待機中・失敗時もCPU最新値を毎秒表示し、CPU用PowerShellを要求しない',async()=>{
 let finish;const commands=[];
 const f=fixture({platform:'win32',run:(_file,args)=>{commands.push(args.at(-1));return new Promise(r=>finish=r);}});
 await f.metrics.sample();
 for(let i=1;i<=3;i++){f.tick();f.set(10*i);const data=await f.metrics.sample();assert.equal(data.cpu,10*i);assert.equal(data.cpuDetails.sampleIntervalMs,500);assert.equal(commands.length,1);}
 assert.doesNotMatch(commands[0],/Read-AidiyCpu|Win32_PerfFormattedData_Counters_ProcessorInformation/);
 finish({stdout:'[]'});await settle();f.tick();f.set(100);assert.equal((await f.metrics.sample()).cpu,100);
 f.metrics.close();finish?.({stdout:'[]'});await settle();
});
test('500ms新標本はHTTPの1秒キャッシュ中でも取り込み、同じ標本への重複要求は共有',async()=>{
 const f=fixture();await f.metrics.sample();f.tick(500,100,0);
 const a=await f.metrics.sample();assert.equal(a.cpu,100);assert.equal(a.cpuDetails.sampleIntervalMs,500);
 f.elapse(200);assert.equal(await f.metrics.sample(),a);f.metrics.close();
});
for(const duration of [200,500])test(`${duration}msの100%を1秒周期に合わせて縮小せず次標本まで保持`,async()=>{
 const f=fixture();f.set(100,duration);
 for(let i=0;i<3;i++){f.elapse(1000);const data=await f.metrics.sample();assert.equal(data.cpu,100);assert.equal(data.cpuDetails.sampleIntervalMs,duration);}
 f.set(30,duration);f.elapse(1000);assert.equal((await f.metrics.sample()).cpu,30);f.metrics.close();
});
test('CPU準備中は値を作らず、取得失敗は別状態、成功した0%から表示する',async()=>{
 const f=fixture({platform:'win32'});let sample=await f.metrics.sample();
 assert.equal(sample.cpu,null);assert.equal(sample.cpuSource,'warming-up');assert.equal(sample.cpuDetails.cpuStatus,'warming-up');
 f.set(null,500,'unavailable');sample=await f.metrics.sample();assert.equal(sample.cpu,null);assert.equal(sample.cpuSource,'unavailable');
 f.set(0);sample=await f.metrics.sample();assert.equal(sample.cpu,0);assert.equal(sample.cpuSource,'os-times');
 f.set(null,500,'warming-up');sample=await f.metrics.sample();assert.equal(sample.cpu,null);assert.equal(sample.cpuSource,'warming-up');f.metrics.close();
});
