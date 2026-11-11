// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemMetrics, parseGpuUtilization, parseWindowsGpuUtilization } from '../aidiy_cpu/metrics.mjs';
function fixture(options = {}) {
  let time = 0, busy = 100, idle = 100, calls = 0;
  const system = { cpus: () => [{ times: { user: busy, idle } }, { times: { user: busy, idle } }], totalmem: () => 1000, freemem: () => 250 };
  const metrics = createSystemMetrics({ system, platform: 'linux', now: () => time, run: async () => { calls++; return { stdout: '20\n65\n' }; }, ...options });
  return { metrics, system, get calls() { return calls; }, tick(ms = 1000, work = 25, rest = 75) { time += ms; busy += work; idle += rest; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const engine = (pid, eng, value, luid = '0x00000000_0x0000abcd', phys = 0, type = '3D') => ({
  Name: `pid_${pid}_luid_${luid}_phys_${phys}_eng_${eng}_engtype_${type}`, UtilizationPercentage: value,
});
const source = (file, args) => file !== 'powershell.exe' ? 'nvidia' : args.at(-1).includes('Get-CimInstance') ? 'cim' : 'counter';
async function sampleGpu(f) { await f.metrics.sample(); await settle(); f.tick(); return f.metrics.sample(); }

test('CPUは区間差分、RAMはホスト使用率、GPUは非同期で複数デバイスの最大値', async () => {
  const f = fixture(); f.tick();
  assert.deepEqual(await f.metrics.sample(), { timestamp: 1000, cpu: 25, ram: 75, gpu: null, gpuStatus: 'unavailable' });
  await settle(); f.tick(1000, 90, 10);
  assert.deepEqual(await f.metrics.sample(), { timestamp: 2000, cpu: 90, ram: 75, gpu: 65, gpuStatus: 'available' }); f.metrics.close();
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
  assert.match(calls[0][1].at(-1),/engtype_3D/); assert.equal(calls[0][2].shell,false); assert.equal(calls[0][2].windowsHide,true); assert.equal(calls[0][2].timeout,5000); f.metrics.close();
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
