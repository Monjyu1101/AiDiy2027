// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startConsole } from '../aidiy_console/console.mjs';
import { startDevelopment } from '../server.mjs';
import { cliCompletions } from '../src/components/コンソール/コマンド補完.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await delay(50); } throw Error('端末の応答がタイムアウトしました。'); }
async function connect(url, origin) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + 'socket', { origin });
  const messages = []; let output = '';
  ws.on('message', raw => { const value = JSON.parse(raw); messages.push(value); if (value.type === 'data') { output += value.data; ws.send(JSON.stringify({ type: 'ack', length: value.data.length })); } });
  await once(ws, 'open');
  return { ws, messages, text: () => output, send: value => ws.send(JSON.stringify(value)) };
}
test('端末: 不正Origin・パス・サイズ拒否、入出力、フロー制御、切断時の終了', async () => {
  let spawned = 0, killed = 0, writes = [], sizes = [], onData, pauses = 0, resumes = 0, toolsOnline = false, toolsChecks = 0;
  const app = await startConsole(tmpdir(), { checkTools: async () => { toolsChecks++; return toolsOnline; }, toolsPollInterval: 30, spawnConsole: () => {
    spawned++;
    return { onData: fn => { onData = fn; return { dispose() {} }; }, onExit: () => ({ dispose() {} }),
      write: value => writes.push(value), resize: (...value) => sizes.push(value), kill: () => killed++, pause: () => pauses++, resume: () => resumes++ };
  } });
  try {
    assert.equal((await fetch(app.url + 'config', { headers: { origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await fetch(new URL('/config', app.url))).status, 404);
    const denied = new WebSocket(app.url.replace(/^http/, 'ws') + 'socket', { origin: 'https://foreign.invalid' });
    await once(denied, 'error'); assert.equal(spawned, 0);
    const { ws, send, messages } = await connect(app.url, new URL(app.url).origin);
    send({ type: 'start', cols: 80, rows: 24 }); await until(() => messages.some(m => m.type === 'ready'));
    assert.equal(messages.find(m => m.type === 'ready').toolsOnline, false);
    toolsOnline = true; await until(() => messages.some(m => m.type === 'tools' && m.online));
    const previous = messages.length; toolsOnline = false;
    await until(() => messages.slice(previous).some(m => m.type === 'tools' && !m.online));
    assert.equal(killed, 0, 'toolsの停止でシェルを終了しない');
    send({ type: 'tools-check', enabled: false });
    await until(() => messages.some(m => m.type === 'tools' && m.enabled === false));
    const stoppedChecks = toolsChecks; await delay(120);
    assert.equal(toolsChecks, stoppedChecks, 'OFF中はtoolsへ確認しない');
    toolsOnline = true; const beforeEnable = messages.length;
    send({ type: 'tools-check', enabled: true });
    await until(() => messages.slice(beforeEnable).some(m => m.type === 'tools' && m.enabled && m.online));
    assert.equal(spawned, 1); assert.equal(killed, 0, 'トグル操作でシェルを再起動しない');
    send({ type: 'input', data: '\u0003日本語\r' }); send({ type: 'resize', cols: 100, rows: 30 });
    await until(() => sizes.length); assert.deepEqual(writes, ['\u0003日本語\r']); assert.deepEqual(sizes, [[100, 30]]);
    onData('x'.repeat(150000)); await until(() => resumes > 0); assert.equal(pauses, 1);
    const closed = once(ws, 'close'); send({ type: 'resize', cols: -1, rows: 1 }); await closed;
    await until(() => killed === 1);
    assert.equal(killed, 1);
    const bad = await connect(app.url, new URL(app.url).origin);
    const done = once(bad.ws, 'close'); bad.send({ type: 'start', cols: 100000, rows: 1 }); await done;
    assert.equal(spawned, 1);
  } finally { await app.close(); }
});

test('tools確認OFF後の遅れた成功応答でオンラインに戻らない', async () => {
  let resolveCheck;
  const app = await startConsole(tmpdir(), { spawnConsole: () => {}, toolsPollInterval: 30, checkTools: () => new Promise(resolve => { resolveCheck = resolve; }) });
  let ws;
  try {
    const client = await connect(app.url, new URL(app.url).origin); ws = client.ws;
    client.send({ type: 'tools-check', enabled: false });
    await until(() => client.messages.some(m => m.type === 'tools' && m.enabled === false));
    resolveCheck(true); await delay(120);
    assert.ok(!client.messages.some(m => m.type === 'tools' && m.online));
  } finally { ws?.terminate(); await app.close(); }
});
test('小さい端末: 1〜5行の起動・縮小・復元をPTYへそのまま渡し、0行・小数は拒否する',async()=>{
 const starts=[],sizes=[];let killed=0;
 const app=await startConsole(tmpdir(),{checkTools:async()=>false,spawnConsole:(_shell,_args,options)=>{
  starts.push([options.cols,options.rows]);return{onData:()=>({dispose(){}}),onExit:()=>({dispose(){}}),resize:(...size)=>sizes.push(size),kill:()=>killed++};
 }});
 try{
  for(const rows of [1,3,4,5]){
   const client=await connect(app.url,new URL(app.url).origin);
   client.send({type:'start',cols:40,rows});await until(()=>client.messages.some(message=>message.type==='ready'));
   assert.deepEqual(starts.at(-1),[40,rows]);
   const before=sizes.length;
   for(const height of [1,3,5,30,4])client.send({type:'resize',cols:40,rows:height});
   await until(()=>sizes.length===before+5);assert.deepEqual(sizes.slice(before),[[40,1],[40,3],[40,5],[40,30],[40,4]]);
   const closed=once(client.ws,'close');client.send({type:'resize',cols:40,rows:rows===1?0:1.5});await closed;
  }
  await until(()=>killed===4);
  for(const rows of [0,-1,1.5]){
   const client=await connect(app.url,new URL(app.url).origin),closed=once(client.ws,'close');
   client.send({type:'start',cols:40,rows});await closed;
  }
  assert.equal(starts.length,4);
 }finally{await app.close();}
});
test('IDEのConsole: 実PTYで日本語・作業フォルダ・リサイズ・Ctrl+C・セッション終了', { timeout: 30000 }, async () => {
  const project = await mkdtemp(join(tmpdir(), 'aidiy-console-'));
  const app = await startDevelopment(project); let ws;
  try {
    assert.equal((await fetch(app.url + 'api/panels/console', { method: 'POST' })).status, 503);
    await fetch(app.url + 'api/connection/offline', { method: 'POST' });
    const { url } = await fetch(app.url + 'api/panels/console', { method: 'POST' }).then(r => r.json());
    const client = await connect(new URL(url, app.url).href, new URL(app.url).origin); ws = client.ws;
    client.send({ type: 'start', cols: 100, rows: 30 }); await until(() => client.messages.some(m => m.type === 'ready'));
    const windows = process.platform === 'win32';
    client.send({ type: 'input', data: windows ? "Write-Output ('TERM_'+'日本語_OK'); (Get-Location).Path\r" : "printf 'TERM_%s_OK\\n' '日本語'; pwd\r" });
    await until(() => client.text().includes('TERM_日本語_OK') && client.text().includes(project));
    client.send({ type: 'resize', cols: 110, rows: 32 });
    client.send({ type: 'input', data: windows ? "Write-Output ('SIZE_'+$Host.UI.RawUI.WindowSize.Width)\r" : "printf 'SIZE_'; stty size\r" });
    await until(() => client.text().includes(windows ? 'SIZE_110' : '32 110'));
    for(const rows of [3,1,4,30]){
      client.send({type:'resize',cols:60,rows});
      client.send({type:'input',data:windows?`Write-Output ('COMPACT_'+$Host.UI.RawUI.WindowSize.Height+'x'+$Host.UI.RawUI.WindowSize.Width)\r`:"printf 'COMPACT_'; stty size\r"});
      await until(()=>client.text().includes(windows?`COMPACT_${rows}x60`:`COMPACT_${rows} 60`));
    }
    client.send({ type: 'input', data: windows ? 'Start-Sleep -Seconds 30\r' : 'sleep 30\r' }); await delay(500);
    client.send({ type: 'input', data: '\u0003' }); await delay(300);
    client.send({ type: 'input', data: windows ? "Write-Output ('INTERRUPT_'+'OK')\r" : "printf 'INTERRUPT_%s\\n' OK\r" });
    await until(() => client.text().includes('INTERRUPT_OK'));
    client.send({ type: 'input', data: `node -e "console.log('CHILD_'+process.pid);setInterval(()=>{},1000)"\r` });
    await until(() => /CHILD_\d+/.test(client.text()));
    const childPid = Number(/CHILD_(\d+)/.exec(client.text())[1]);
    const closed = once(ws, 'close'); await fetch(app.url + 'api/connection/disconnect', { method: 'POST' }); await closed;
    assert.equal((await fetch(new URL(url + 'config', app.url))).status, 403);
    await until(() => { try { process.kill(childPid, 0); return false; } catch { return true; } });
  } finally { ws?.terminate(); await app.close(); await rm(project, { recursive: true, force: true }); }
});

test('PowerShell: 各CLIのTab補完と通常のTab補完を共存させる', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const app = await startConsole(tmpdir(), { checkTools: async () => true, toolsPollInterval: 30 }); let ws;
  try {
    const client = await connect(app.url, new URL(app.url).origin); ws = client.ws;
    client.send({ type: 'start', cols: 160, rows: 30 });
    await until(() => client.messages.some(m => m.type === 'ready'));
    // 実際のCLIは起動せず、同名の関数で確定した引数を確認する。
    client.send({ type: 'input', data: "function AiDiyCompletionProbe { Write-Output ('FALLBACK_'+'OK') }; Write-Output ('INIT_'+'OK')\r" });
    await until(() => client.text().includes('INIT_OK'));
    for (const [name, { options }] of Object.entries(cliCompletions)) {
      client.send({ type: 'input', data: `function ${name} { Write-Output ('ARGS_${name}_'+($args -join ' ')) }; Write-Output ('READY_'+'${name}')\r` });
      await until(() => client.text().includes('READY_' + name));
      const before = client.text().length;
      client.send({ type: 'input', data: name + '\t' });
      await until(() => client.text().slice(before).includes(options));
      assert.ok(!client.text().includes(`ARGS_${name}_${options}`), `${name}: Tabだけでは実行しない`);
      client.send({ type: 'input', data: '\r' });
      await until(() => client.text().includes(`ARGS_${name}_${options}`));
    }
    client.send({ type: 'input', data: 'AiDiyCompletionPro\t\r' });
    await until(() => client.text().includes('FALLBACK_OK'));
    client.send({ type: 'input', data: 'exit\r' });
    await until(() => client.messages.some(m => m.type === 'exit'));
    const previous = client.messages.length;
    await until(() => client.messages.slice(previous).some(m => m.type === 'tools' && m.online));
  } finally { ws?.terminate(); await app.close(); }
});
