// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemMetrics, parseGpuUtilization, parseWindowsGpuUtilization } from '../aidiy_cpu/metrics.mjs';
import { parseWindowsCpuUtilization, preferredWindowsCpuMetric } from '../aidiy_cpu/windows-cpu.mjs';
function fixture(options = {}) {
  let time = 0, busy = 100, idle = 100, calls = 0;
  const system = { cpus: () => [{ times: { user: busy, idle } }, { times: { user: busy, idle } }], totalmem: () => 1000, freemem: () => 250 };
  const metrics = createSystemMetrics({ system, platform: 'linux', windowsCpuMetrics: null, now: () => time, run: async () => { calls++; return { stdout: '20\n65\n' }; }, ...options });
  return { metrics, system, get calls() { return calls; }, tick(ms = 1000, work = 25, rest = 75) { time += ms; busy += work; idle += rest; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const engine = (pid, eng, value, luid = '0x00000000_0x0000abcd', phys = 0, type = '3D') => ({
  Name: `pid_${pid}_luid_${luid}_phys_${phys}_eng_${eng}_engtype_${type}`, UtilizationPercentage: value,
});
const source = (file, args) => file !== 'powershell.exe' ? 'nvidia' : args.at(-1).includes('Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine') ? 'cim' : args.at(-1).includes('Get-Counter') ? 'counter' : 'cpu';
async function sampleGpu(f) { await f.metrics.sample(); await settle(); f.tick(); return f.metrics.sample(); }

test('CPUは区間差分、RAMはホスト使用率、GPUは非同期で複数デバイスの最大値', async () => {
  const f = fixture(); f.tick();
  const first = await f.metrics.sample();
  assert.deepEqual({ timestamp: first.timestamp, cpu: first.cpu, ram: first.ram, gpu: first.gpu, gpuStatus: first.gpuStatus }, { timestamp: 1000, cpu: 25, ram: 75, gpu: null, gpuStatus: 'unavailable' });
  assert.equal(first.cpuSource, 'os-times'); assert.equal(first.cpuDetails.sampleIntervalMs, 1000);
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
test('初回の差分なし・CPU数変更・不正RAMは測定不能を返す', async () => {
  const f = fixture(); assert.equal((await f.metrics.sample()).cpu, null);
  f.tick(); f.system.cpus = () => [{ times: { user: 200, idle: 200 } }]; f.system.freemem = () => NaN;
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

test('CPUは論理コア数で二重に割らず、全コア100%・4コア中1コア100%を正しく表示', async () => {
  let times=Array.from({length:4},()=>({user:100,idle:100,sys:0,nice:0,irq:0}));
  const system={cpus:()=>times.map(t=>({times:{...t}})),totalmem:()=>1000,freemem:()=>250};
  const f=fixture({system,run:async()=>({stdout:'0'})});
  times=times.map(t=>({...t,user:t.user+100}));f.tick();assert.equal((await f.metrics.sample()).cpu,100);
  times=times.map((t,index)=>({...t,user:t.user+(index===0?100:0),idle:t.idle+(index===0?0:100)}));
  f.tick();assert.equal((await f.metrics.sample()).cpu,25);
  times=times.map(t=>({...t,user:t.user+20,sys:t.sys+20,idle:t.idle+60}));
  f.tick();assert.equal((await f.metrics.sample()).cpu,40);f.metrics.close();
});


const nativeCpu=(time,utility=time)=>({Name:'_Total',PercentProcessorTime:time,PercentProcessorUtility:utility});
function nativeFixture({release='10.0.26100',time=64,utility=92,run=async()=>({stdout:JSON.stringify([engine(1,0,40)])})}={}){
 let at=0,busy=100,idle=100,record=null,closed=false;
 const system={release:()=>release,cpus:()=>[{times:{user:busy,idle}}],totalmem:()=>1000,freemem:()=>250};
 const cpu={read:()=>record,close:()=>closed=true};
 const metrics=createSystemMetrics({system,platform:'win32',now:()=>at,run,windowsCpuMetrics:cpu});
 const f={metrics,cpu,get closed(){return closed;},tick(ms=1000,work=3,rest=97){at+=ms;busy+=work;idle+=rest;},set(time,utility,duration=1000){record=time===null&&utility===null?null:{cpu:{time,utility},measuredAt:at,sampleIntervalMs:duration};}};
 f.set(time,utility);return f;
}
test('Windows CPUは独立monitorの値を使い、Node値と両カウンターを診断情報に保持',async()=>{
 const f=nativeFixture();f.tick();const data=await f.metrics.sample();
 assert.equal(data.cpu,64);assert.equal(data.cpuSource,'windows-processor-time');assert.ok(Math.abs(data.cpuDetails.osTimes-3)<1e-8);
 assert.equal(data.cpuDetails.windowsProcessorTime,64);assert.equal(data.cpuDetails.windowsProcessorUtility,92);assert.equal(data.cpuDetails.windowsSampleIntervalMs,1000);
 f.metrics.close();assert.equal(f.closed,true);
});
test('CPU標準値は独立検証し、欠損・不正・コア別を除外、0とUtility>100を保持',()=>{
 assert.deepEqual(parseWindowsCpuUtilization(nativeCpu(0,150)),{time:0,utility:150});
 assert.deepEqual(parseWindowsCpuUtilization([nativeCpu('55','90')]),{time:55,utility:90});
 assert.deepEqual(parseWindowsCpuUtilization(nativeCpu(null,'51')),{time:null,utility:51});
 for(const row of [null,{},nativeCpu(null),nativeCpu(-1),nativeCpu(101,null),nativeCpu(''),{...nativeCpu(80),Name:'0,0'}])assert.equal(parseWindowsCpuUtilization(row),null);
});
test('Windows CPUの失敗でNode差分へ戻り、GPUを失わない',async()=>{
 const f=nativeFixture();await f.metrics.sample();await settle();f.tick();f.set(null,null);
 const data=await f.metrics.sample();assert.ok(Math.abs(data.cpu-3)<1e-8);assert.equal(data.cpuSource,'os-times');assert.equal(data.gpu,40);f.metrics.close();
});
test('GPUの3秒待機中・失敗時もCPU新標本を毎秒表示し、CPU取得を混ぜない',async()=>{
 let finish;const commands=[];
 const f=nativeFixture({run:(_file,args)=>{commands.push(args.at(-1));return new Promise(r=>finish=r);}});
 await f.metrics.sample();
 for(let i=1;i<=3;i++){f.tick();f.set(10*i,15*i);const data=await f.metrics.sample();assert.equal(data.cpu,10*i);assert.equal(data.cpuDetails.windowsSampleAgeMs,0);assert.equal(commands.length,1);}
 assert.doesNotMatch(commands[0],/Read-AidiyCpu|Win32_PerfFormattedData_Counters_ProcessorInformation/);
 finish({stdout:'[]'});await settle();f.tick();f.set(100,100);assert.equal((await f.metrics.sample()).cpu,100);
 f.metrics.close();finish?.({stdout:'[]'});await settle();
});
test('CPU新標本はHTTPの1秒キャッシュ中でも取り込み、同じ標本への重複要求は共有',async()=>{
 const f=nativeFixture();await f.metrics.sample();f.tick(200,20,0);f.set(100,100,200);
 const a=await f.metrics.sample();assert.equal(a.cpu,100);assert.equal(a.cpuDetails.windowsSampleIntervalMs,200);
 f.tick(500,0,50);assert.equal(await f.metrics.sample(),a);f.metrics.close();
});
for(const duration of [200,500])test(`${duration}msの100%を1秒周期に合わせて縮小せず次標本まで保持`,async()=>{
 const f=nativeFixture({time:100,utility:100});f.set(100,100,duration);
 for(let i=0;i<3;i++){f.tick();const data=await f.metrics.sample();assert.equal(data.cpu,100);assert.equal(data.cpuDetails.windowsSampleIntervalMs,duration);}
 f.set(30,30,duration);f.tick();assert.equal((await f.metrics.sample()).cpu,30);f.metrics.close();
});
test('CPU長期休止のNode平均を現在値として出さず、次の区間で復帰',async()=>{
 const f=fixture();f.tick();assert.equal((await f.metrics.sample()).cpu,25);
 f.tick(60000,1,5999);const resumed=await f.metrics.sample();assert.equal(resumed.cpu,null);assert.equal(resumed.cpuDetails.sampleIntervalMs,60000);
 f.tick(1000,80,20);assert.equal((await f.metrics.sample()).cpu,80);f.metrics.close();
});
test('CPU monitorが停止・古い値になれば現在値から除外し、新規標本で復帰',async()=>{
 const f=nativeFixture({time:80});await f.metrics.sample();f.tick(10000);assert.equal((await f.metrics.sample()).cpu,null);
 f.set(65,65);f.tick();assert.equal((await f.metrics.sample()).cpu,65);f.set(null,null);f.tick();assert.equal((await f.metrics.sample()).cpuSource,'os-times');f.metrics.close();
});
test('23H2以前はUtility、新OSと不明OSはTimeを既定とし、大小比較で選ばない',()=>{
 for(const release of ['10.0.10240','10.0.19045','10.0.22000','10.0.22631','10.0.22631.7652'])assert.equal(preferredWindowsCpuMetric(release),'utility');
 for(const release of [null,'unknown','6.1.7601','10.0.25398','10.0.26100','10.0.26200'])assert.equal(preferredWindowsCpuMetric(release),'time');
});
for(const [release,time,utility,expected,metric] of [
 ['10.0.22631',3,51,51,'utility'],['10.0.22631',80,20,20,'utility'],['10.0.22631',3,0,0,'utility'],
 ['10.0.22631',3,150,100,'utility'],['10.0.22631',null,51,51,'utility'],['10.0.22631',3,null,3,'time'],
 ['10.0.26100',3,51,3,'time'],['10.0.26100',80,20,80,'time'],
])test(`CPU指標の選択 ${release}, Time=${time}, Utility=${utility}`,async()=>{
 const f=nativeFixture({release,time,utility});f.tick();const data=await f.metrics.sample();
 assert.equal(data.cpu,expected);assert.equal(data.cpuSource,`windows-processor-${metric}`);assert.equal(data.cpuDetails.windowsProcessorUtility,utility);assert.equal(data.cpuDetails.windowsProcessorTime,time);f.metrics.close();
});
test('新しいWindowsでTimeが無効ならUtilityへ勝手に切り替えずNode差分へ戻る',async()=>{
 const f=nativeFixture({time:null,utility:51});f.tick(1000,9,91);const data=await f.metrics.sample();assert.ok(Math.abs(data.cpu-9)<1e-8);assert.equal(data.cpuSource,'os-times');assert.equal(data.cpuDetails.windowsProcessorUtility,51);f.metrics.close();
});


test('HTTP到着の小さな揺れでNode代替の1秒採取を2秒へ引き延ばさない',async()=>{
 let now=0;const system={cpus:()=>[{times:{user:now,idle:100}}],totalmem:()=>1000,freemem:()=>250};
 const metrics=createSystemMetrics({system,platform:'linux',now:()=>now,run:async()=>({stdout:''})});
 const times=[0,1005,2000,3003,4000,5002,6000],responses=[];
 for(const timestamp of times){now=timestamp;responses.push(await metrics.sample());}
 assert.deepEqual(responses.map(r=>r.timestamp),times);
 assert.deepEqual(responses.map(r=>r.cpuDetails.sampleIntervalMs),[0,1005,995,1003,997,1002,998]);
 for(const r of responses.slice(1))assert.equal(r.cpu,100);metrics.close();
});
test('native標本が途中で更新されてもNodeの採取予定・差分窓はずれない',async()=>{
 const f=nativeFixture();await f.metrics.sample();f.tick(800,80,0);f.set(100,100,500);let data=await f.metrics.sample();
 assert.equal(data.cpu,100);assert.equal(data.cpuDetails.sampleIntervalMs,0);
 f.tick(200,20,0);data=await f.metrics.sample();assert.equal(data.cpuDetails.sampleIntervalMs,1000);assert.equal(data.cpuDetails.osTimes,100);f.metrics.close();
});


test('壁時計が戻ってもNodeの1秒採取予定と実測間隔を維持する',async()=>{
 let wall=100000,clock=0;const system={cpus:()=>[{times:{user:clock,idle:100}}],totalmem:()=>1000,freemem:()=>250};
 const metrics=createSystemMetrics({system,platform:'linux',now:()=>wall,monotonicNow:()=>clock,run:async()=>({stdout:''})});
 await metrics.sample();clock=1000;wall=100;const data=await metrics.sample();assert.equal(data.timestamp,100);assert.equal(data.cpuDetails.sampleIntervalMs,1000);assert.equal(data.cpu,100);metrics.close();
});
