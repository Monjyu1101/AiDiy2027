// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { buildSync } = require('esbuild');
const source = buildSync({ entryPoints: [fileURLToPath(new URL('../host/aidiy_code/src/server.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, offline = false, connecting = false) {
  const folder = mkdtempSync(join(tmpdir(), 'navi-code-'));
  const filename = join(folder, 'install/out/aidiy_code/server.cjs');
  const loaded = new Module(filename); loaded.filename = filename; loaded.paths = require.resolve.paths('esbuild'); loaded._compile(source, filename);
  const core = require('../host/checks/fake-core.cjs').core(); core.install(t); core.hold = true;core.unavailable = connecting;
  const jobs = [];
  const execute = (...args) => { let complete; const done = new Promise(resolve => { complete = resolve; });
    const job = { args, complete, stopped: false }; jobs.push(job);
    return { 完了: done, 停止() { job.stopped = true; if (!job.holdStop) complete({ 終了コード: 1, 停止理由: '中止' }); } };
  };
  const app = await loaded.exports.単独起動(folder, 'http://127.0.0.1:18091', { offline, keepAlive: true }, join(folder, 'model.json'), execute,
    join(folder, 'history'), () => ({ Authorization: 'Bearer fixture-token-only' }), url => new core.Socket(url));
  const reader = (await fetch(app.url + 'events')).body.getReader(), packets = [];
  const pump = (async () => { let buffer = ''; const decoder = new TextDecoder(); while (true) {
    const { value, done } = await reader.read(); if (done) return;
    buffer += decoder.decode(value, { stream: true }); let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (block.startsWith('data: ')) packets.push(JSON.parse(block.slice(6))); }
  } })();
  const wait = async predicate => { const deadline = Date.now() + 3000; while (Date.now() < deadline) { const found = packets.findLast(predicate); if (found) return found; await pause(5); } throw Error('SSE timeout'); };
  const state = await wait(p => p.type === 'state' && (offline || connecting || p.接続済み));
  t.after(async () => { await reader.cancel(); await pump; await app.close(); rmSync(folder, { recursive: true, force: true }); });
  const post = data => fetch(app.url + 'message', { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const request = (id = 'nav-1', extra = {}) => post({ type: 'input_text', navigationRequestId: id, projectPath: folder, conversationId: state.会話ID,
    sessionId: state.セッションID || '', connectionEpoch: state.接続世代, メッセージ内容: '改善してください', self_check_loop: 2, ...extra });
  return { core, jobs, app, packets, wait, post, request, state, output: () => core.sockets.findLast(s => s.channel === '1') };
}
const terminal = p => p.type === 'navigationRunResult' && p.status !== 'accepted';
test('Code server: 自動接続の一時offline表示中はNavigatorの送信を拒否しHermesへ迂回しない', async t => {
  const f = await fixture(t, false, true);
  const state = await f.wait(p => p.type === 'state' && !p.接続済み && !!p.接続エラー);
  assert.equal(state.自動接続, true);assert.equal(state.実行モード, 'offline');
  const response = await f.request('startup', { sessionId: state.セッションID || '', connectionEpoch: state.接続世代 });
  assert.equal(response.status, 409);assert.match((await response.json()).error, /オンライン接続/);assert.equal(f.jobs.length, 0);assert.equal(f.packets.some(p => p.type === 'navigationRunResult'), false);
});
test('Code server: correlated start + terminal success required, duplicates and stale cancellation isolated', async t => {
  const f = await fixture(t);
  assert.equal(f.state.navigationRunSupported, true);
  assert.equal((await f.request()).status, 200);
  await f.wait(p => p.type === 'navigationRunResult' && p.status === 'accepted');
  const input = f.core.sockets.find(s => s.channel === 'input').sent.find(p => p.メッセージ識別 === 'input_text');
  assert.equal(input.navigationRequestId, 'nav-1'); assert.equal(input.self_check_loop, 2); assert.equal('autoApprove' in input, false);
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'other', navigationStatus: 'succeeded' });
  await pause(15); assert.equal(f.packets.some(terminal), false);
  assert.equal((await f.request('nav-2')).status, 409);
  assert.equal((await f.post({ type: 'cancel_run', navigationRequestId: 'old' })).status, 200);
  assert.equal(f.core.sockets.flatMap(s => s.sent).some(p => p.メッセージ識別 === 'cancel_run'), false);
  f.output().emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x02', 実行中: true, navigationRequestId: 'nav-1' });
  f.output().emit({ メッセージ識別: 'output_text', メッセージ内容: '完了しました' });
  assert.equal(f.packets.some(terminal), false);
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'nav-1', navigationStatus: 'succeeded' });
  assert.equal((await f.wait(terminal)).status, 'succeeded');
  assert.equal((await f.request()).status, 409);
});
for (const status of ['failed', 'cancelled', undefined]) test(`Code server: ${status || 'missing'} terminal is never success`, async t => {
  const f = await fixture(t); await f.request();
  f.output().emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x02', 実行中: true, navigationRequestId: 'nav-1' });
  f.output().emit({ メッセージ識別: 'output_text', メッセージ内容: '途中の回答' });
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'nav-1', navigationStatus: status });
  const ended = await f.wait(terminal);assert.equal(ended.status, 'failed');assert.equal(ended.settled, true);
  assert.equal((await f.request('retry-after-error')).status, 200, '新しいIDの明示再開を受け付ける');
});
test('Code server: abort-before-send and scope mismatch cannot execute', async t => {
  const f = await fixture(t, true);
  await f.post({ type: 'cancel_run', navigationRequestId: 'nav-1' });
  assert.equal((await f.request()).status, 409);
  for (const [key, value] of [['projectPath', '/other'], ['conversationId', 'other'], ['sessionId', 'other'], ['connectionEpoch', -1]])
    assert.equal((await f.request('nav-' + key, { [key]: value })).status, 409);
  assert.equal(f.jobs.length, 0);
});
for (const success of [true, false]) test(`Code server: offline actual process exit ${success ? 'success' : 'failure'} controls result`, async t => {
  const f = await fixture(t, true); await f.request();
  await f.wait(p => p.type === 'navigationRunResult' && p.status === 'accepted');
  const job = f.jobs[0]; job.args[5]({ メッセージ識別: 'output_text', メッセージ内容: '回答' });
  await pause(10); assert.equal(f.packets.some(terminal), false);
  job.complete({ 終了コード: success ? 0 : 1, セッションID: 'created-session' });
  const ended = await f.wait(terminal);assert.equal(ended.status, success ? 'succeeded' : 'failed');assert.equal(ended.settled, true);
  assert.equal(f.jobs.length, 1);
});
test('Code server: matching cancel stops offline run once and prevents another request until actual exit', async t => {
  const f = await fixture(t, true); await f.request();
  await f.post({ type: 'cancel_run', navigationRequestId: 'nav-1' });
  const ended = await f.wait(terminal);assert.equal(ended.status, 'cancelled');assert.equal(ended.settled, true); assert.equal(f.jobs[0].stopped, true);
  assert.equal(f.packets.some(p => terminal(p) && p.status === 'succeeded'), false);
});
test('Code server: unrelated idle event cannot prevent cancellation of owned active run', async t => {
  const f = await fixture(t); await f.request();
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'unrelated' });
  await f.post({ type: 'cancel_run', navigationRequestId: 'nav-1' });
  await pause(15); assert.equal(f.packets.some(terminal), false);
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'nav-1', navigationStatus: 'cancelled' });
  assert.equal((await f.wait(terminal)).status, 'cancelled');
  assert.equal(f.core.sockets.flatMap(s => s.sent).filter(p => p.メッセージ識別 === 'cancel_run').length, 1);
});

test('Code server: 接続切断は実終了の確認と区別して通知する', async t => {
  const f = await fixture(t); await f.request();
  f.output().close();
  const ended = await f.wait(terminal);
  assert.equal(ended.status, 'failed');assert.equal(ended.settled, false);assert.match(ended.message, /接続が切れ/);
});

test('Code server: 停止受付と途中通知だけでは手動送信・モデル変更を解放しない', async t => {
  const f = await fixture(t); f.core.holdCancel = true; await f.request();
  f.output().emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x02', 実行中: true, navigationRequestId: 'nav-1' });
  const ack = await f.post({ type: 'cancel_run', navigationRequestId: 'nav-1' });
  assert.equal(ack.status, 200); assert.equal((await ack.json()).navigationPending, true);
  // fake Core はcancel_run / CAN / 中断本文を先に送り、終了通知だけ保留する。
  await pause(20); assert.equal(f.packets.some(terminal), false);
  const stopping = f.packets.findLast(p => p.type === 'state');
  assert.equal(stopping.実行中, true); assert.equal(stopping.停止中, true);
  assert.equal((await f.post({ type: 'input_text', メッセージ内容: '人間の次の依頼' })).status, 409);
  assert.equal((await f.post({ type: 'model', provider: 'aidiy_hermes', model: 'auto' })).status, 409);
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'other', navigationStatus: 'cancelled' });
  assert.equal((await f.post({ type: 'input_text', メッセージ内容: 'まだ待つ' })).status, 409);
  f.output().emit({ メッセージ識別: 'output_end', 実行中: false, navigationRequestId: 'nav-1', navigationStatus: 'cancelled' });
  assert.equal((await f.wait(terminal)).status, 'cancelled');
  assert.equal(f.packets.findLast(p => p.type === 'state').実行中, false);
  assert.equal((await f.post({ type: 'input_text', メッセージ内容: '完了後の人間の依頼' })).status, 200);
});

test('Code server: offline停止も実プロセス完了まで手動送信を解放しない', async t => {
  const f = await fixture(t, true); await f.request(); f.jobs[0].holdStop = true;
  const ack = await f.post({ type: 'cancel_run', navigationRequestId: 'nav-1' });
  assert.equal((await ack.json()).navigationPending, true);
  f.jobs[0].args[5]({ メッセージ識別: 'output_stream', メッセージ内容: '\x18' });
  await pause(15); assert.equal(f.packets.some(terminal), false);
  assert.equal(f.packets.findLast(p => p.type === 'state').実行中, true);
  assert.equal((await f.post({ type: 'input_text', メッセージ内容: '人間の次の依頼' })).status, 409);
  f.jobs[0].complete({ 終了コード: 1, 停止理由: '中止' });
  assert.equal((await f.wait(terminal)).status, 'cancelled');
  assert.equal((await f.post({ type: 'input_text', メッセージ内容: '終了後に人間が送信' })).status, 200);
});
