/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const Module = require('node:module');
const { 単独起動: startServer } = require('../out/aidiy_code/server.cjs');
const { オフライン実行, オフラインモデル保存先, オフラインモデル候補, Hermes既定モデル } = require('../out/offline.cjs');
const { 会話本文上限, 会話ファイル上限 } = require('../out/conversation-store.cjs');
const preferences = mkdtempSync(join(tmpdir(), 'aidiy-code-model-'));
after(() => rmSync(preferences, { recursive: true, force: true }));
let fileNumber = 0;
// 会話履歴はテストごとの一時フォルダへ（作業フォルダの _AIDIY には書かない）
let historyNumber = 0;
const fixtureServers = new Map();
const start = (project, launch, initial, file, run, history = join(preferences, `history-${++historyNumber}`)) => (fixtureServers.get(project) || startServer)(project, launch, initial, file, run, history, () => ({ Authorization: 'Bearer fixture-token-only' }), url => new global.WebSocket(url));
const 単独起動 = (project, launch, initial, file = join(preferences, `${++fileNumber}.json`)) => start(project, launch, initial, file);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function offlineFixture() {
  const project = mkdtempSync(join(preferences, 'offline-project-'));
  const directory = join(project, '_AIDIY/aidiy_diag'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'code_models_info.json'), JSON.stringify({ aidiy_hermes: { models: {
    'openai_oauth/gpt-6.1-sol': 'OpenAI', 'copilot_cli/auto': 'Copilot', 'codex_cli/auto': 'Codex',
  } } }));
  // 配布先も一時ディレクトリに置き、ローカル診断の候補を優先して読まない。
  const filename = join(project, 'installation/out/aidiy_code/server.cjs');
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths;
  loaded._compile(readFileSync(resolve('out/aidiy_code/server.cjs'), 'utf8'), filename);
  fixtureServers.set(project, loaded.exports.単独起動);
  return project;
}

test('Code: 未生成時はsameだけ、生成済みなら診断のHermes候補を読む', () => {
  const root = join(preferences, 'configured');
  mkdirSync(join(root, '_config'), {recursive:true});
  const file = join(root, '_config/AiDiy_key.json');
  writeFileSync(file, '\uFEFF' + JSON.stringify({CODE_AIDIY_HERMES_MODEL:'openai_oauth/configured-model'}));
  assert.equal(Hermes既定モデル(join(root, 'frontend_ide/host')), 'openai_oauth/configured-model');
  const expected = ['same'];
  assert.deepEqual(オフラインモデル候補(root).map(p=>p.id), expected);
  const directory = join(root, '_AIDIY/aidiy_diag'); mkdirSync(directory, {recursive:true});
  writeFileSync(join(directory, 'code_models_info.json'), JSON.stringify({aidiy_hermes:{models:{'claude_cli/same':'Claude same','openai_oauth/new-model':'New model'}}}));
  assert.deepEqual(オフラインモデル候補(join(root, 'frontend_ide/host')), [
    {id:'same',label:'same (変更なし)'},{id:'claude_cli/same',label:'Claude same'},{id:'openai_oauth/new-model',label:'New model'},
  ]);
  writeFileSync(file, '{}');
  assert.equal(Hermes既定モデル(root), 'auto');
});
async function connect(app) {
  const reader = (await fetch(app.url+'events')).body.getReader();
  const packets = [];
  const pump = (async () => {
    let buffer = ''; const decoder = new TextDecoder();
    while (true) {
      const {value, done} = await reader.read(); if (done) return;
      buffer += decoder.decode(value,{stream:true});
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0,end); buffer = buffer.slice(end+2);
        if (block.startsWith('data: ')) packets.push(JSON.parse(block.slice(6)));
      }
    }
  })();
  return {packets, close:async()=>{await reader.cancel(); await pump;}, wait:async (predicate, timeout = 7000)=>{
    const deadline = Date.now()+timeout;
    while (Date.now()<deadline) { const found = packets.find(predicate); if (found) return found; await pause(20); }
    throw new Error('SSE timeout');
  }};
}
function post(app, data, origin = new URL(app.url).origin) {
  return fetch(app.url+'message',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
}

test('Code IDE埋め込み: オフラインのHermes実行を維持し接続モード変更を拒否する', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const run = (...args) => オフライン実行(...args, {実行ファイル:process.execPath,引数:[resolve('checks/fake-cli.cjs'),'echo']});
  const app = await start(process.cwd(), 'http://127.0.0.1:18091', {offline:true, lockedMode:true}, join(preferences,'dev-locked.json'), run);
  const stream = await connect(app);
  try {
    await stream.wait(p => p.type === 'state' && p.実行モード === 'offline');
    for (const type of ['autoConnect','executionMode','connect','disconnect']) {
      assert.equal((await post(app,{メッセージ識別:type,enabled:true,mode:'online'})).status,409);
    }
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'埋め込み確認'})).status,200);
    await stream.wait(p => p.type === 'state' && !p.実行中 && p.メッセージ.some(m => m.種別 === 'assistant' && JSON.parse(m.本文).input === '埋め込み確認'));
    assert.equal(backend.sockets.length,0); assert.equal(backend.requests.length,0);
  } finally { await stream.close(); await app.close(); }
});
test('Code: 自動接続OFFは再試行・新規・履歴復帰からの接続を止め、ONで再開し再起動はON', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences, 'auto-connect.json');
  let app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {}, file), stream = await connect(app);
  try {
    const ready = await stream.wait(p=>p.type==='state' && p.接続済み);
    assert.equal(ready.自動接続,true);
    assert.equal((await post(app,{type:'autoConnect',enabled:'false'})).status,400);
    backend.hold=true;
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'接続切替前'});
    assert.equal((await post(app,{type:'autoConnect',enabled:false})).status,409);
    await post(app,{メッセージ識別:'cancel_run'});backend.hold=false;
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.length>0);
    // 通信切断で予約された10秒後の再試行もOFFでキャンセルする。
    backend.sockets.at(-1).close();
    assert.equal((await post(app,{type:'autoConnect',enabled:false})).status,200);
    const off = await stream.wait(p=>p.type==='state' && p.自動接続===false);
    assert.equal(off.接続済み,false);assert.equal(off.接続中,false);assert.equal(off.接続エラー,'');
    const socketCount = backend.sockets.length, requestCount = backend.requests.length;
    await post(app,{type:'new'});
    await post(app,{type:'selectHistory',id:ready.会話ID});
    await pause(10100);
    assert.equal(backend.sockets.length,socketCount);assert.equal(backend.requests.length,requestCount);
    assert.ok(backend.sockets.every(socket=>socket.readyState===3));
    assert.equal((await post(app,{type:'autoConnect',enabled:true})).status,200);
    await stream.wait(p=>p.type==='state' && p.自動接続 && p.接続済み && backend.sockets.length>socketCount);
    assert.equal(backend.sockets.at(-1).session,ready.セッションID);
    await post(app,{type:'autoConnect',enabled:false});
  } finally { await stream.close(); await app.close(); }
  app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {}, file);stream = await connect(app);
  try {
    const restarted = await stream.wait(p=>p.type==='state' && p.接続済み);
    assert.equal(restarted.自動接続,true);
  } finally { await stream.close(); await app.close(); }
});
test('Code: 最後に選んだ検証回数を保存し、再起動後も状態通知で返す（未保存は0回）', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences, 'self-check-loop_model.json');
  let app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {}, file), stream = await connect(app);
  try {
    const ready = await stream.wait(p=>p.type==='state' && p.接続済み);
    assert.equal(ready.検証回数,0);
    assert.equal((await post(app,{type:'setSelfCheckLoop',count:4})).status,400);
    assert.equal((await post(app,{type:'setSelfCheckLoop',count:'2'})).status,400);
    assert.equal((await post(app,{type:'setSelfCheckLoop',count:2})).status,200);
    assert.deepEqual(JSON.parse(readFileSync(join(preferences,'self-check-loop_options.json'),'utf8')),{検証回数:2});
  } finally { await stream.close(); await app.close(); }
  app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {}, file); stream = await connect(app);
  try {
    const restarted = await stream.wait(p=>p.type==='state');
    assert.equal(restarted.検証回数,2);
  } finally { await stream.close(); await app.close(); }
});
test('Code: --offline 起動から自動接続ONで新規オンライン会話へ切り替える', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {offline:true}), stream = await connect(app);
  try {
    const offline = await stream.wait(p=>p.type==='state');
    assert.equal(offline.自動接続,false);assert.equal(backend.sockets.length,0);
    assert.equal((await post(app,{type:'autoConnect',enabled:true})).status,200);
    const online = await stream.wait(p=>p.type==='state' && p.接続済み);
    assert.equal(online.自動接続,true);assert.equal(online.実行モード,'online');
    assert.notEqual(online.会話ID,offline.会話ID);
    assert.equal(backend.sockets[0].sent[0].セッションID,null);
    assert.equal(backend.sockets[1].sent[0].セッションID,online.セッションID);
  } finally { await stream.close(); await app.close(); }
});

test('Code: 手動選択がなければAPIの初期モデルを使う', async t => {
  const backend = require('./fake-core.cjs').core({CODE_AI1_NAME:'copilot_cli',CODE_AI1_MODEL:'gpt-6-sol'}); backend.install(t);
  const app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', {}), stream = await connect(app);
  try {
    const state = await stream.wait(p=>p.type==='state' && p.接続済み);
    assert.equal(state.provider,'copilot_cli');assert.equal(state.model,'gpt-6-sol');
    assert.equal(backend.requests.filter(request=>request.path.endsWith('設定')).length,0);
  } finally {await stream.close();await app.close();}
});

test('Code: AIコアのモデル候補・選択値・送信と停止を中継する', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences, 'remember.json');
  // 中継の検証は配置先の共通設定に依存させず、初期選択を明示する。
  const app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091', { provider: 'aidiy_hermes', model: 'openai_oauth/gpt-6.1-sol' }, file);
  const stream = await connect(app);
  try {
    const ready = await stream.wait(p => p.type === 'state' && p.接続済み);
    assert.equal(ready.provider, 'aidiy_hermes'); assert.equal(ready.model, 'openai_oauth/gpt-6.1-sol');
    assert.deepEqual(backend.sockets.map(socket => socket.channel), ['input', '1']);
    assert.ok(backend.sockets.every(socket => socket.sent[0].CODE_BASE_PATH === process.cwd()));
    const providers = await (await fetch(app.url + 'catalog')).json();
    assert.ok(providers.providers.some(item => item.id === 'copilot_cli'));
    const hermes = await (await fetch(app.url + 'catalog?provider=aidiy_hermes')).json();
    assert.ok(hermes.models.some(item => item.id === 'openai_oauth/gpt-6.1-sol'));
    assert.equal((await fetch(new URL('/events', app.url))).status, 404);
    assert.equal((await post(app, {type:'new'}, 'https://example.com')).status, 403);
    await post(app, { type:'model', provider:'copilot_cli', model:'gpt-6-sol' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { provider:'copilot_cli', model:'gpt-6-sol' });
    assert.equal((await post(app, {メッセージ識別:'input_text', メッセージ内容:'日本語で確認'})).status, 200);
    const completed = await stream.wait(p => p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.種別==='assistant'));
    const reply = JSON.parse(completed.メッセージ.at(-1).本文);
    assert.equal(reply.input, '日本語で確認');
    assert.equal(reply.settings.CODE_AI1_NAME, 'copilot_cli'); assert.equal(reply.settings.CODE_AI1_MODEL, 'gpt-6-sol');
    assert.ok(completed.進捗.every(line=>!/[\u0002\u0003\u0018]/.test(line)));
    await post(app, {type:'new'});
    await stream.wait(p=>p.type==='state' && p.会話ID!==ready.会話ID && p.接続済み);
    await post(app, {type:'selectHistory', id:ready.会話ID});
    const reopened = await stream.wait(p=>p.type==='state' && p.会話ID===ready.会話ID && p.接続済み && p.メッセージ.length===2);
    assert.equal(reopened.セッションID, ready.セッションID);
    await post(app, {type:'disconnect'});
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:' '})).status,400);
    await post(app, {type:'connect'});
    await pause(30);
    backend.hold = true;
    await post(app, {メッセージ識別:'input_text',メッセージ内容:'待機'});
    await stream.wait(p=>p.type==='state' && p.実行中 && p.メッセージ.at(-1)?.本文==='待機');
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'same'})).status,409);
    await post(app,{メッセージ識別:'cancel_run'});
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.本文==='処理中断！'));
  } finally { await stream.close(); await app.close(); }
});

test('Code: 単独起動の検証ループ指定をAIコアへ渡し、未指定は1回にする', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const app = await 単独起動(process.cwd(),'http://127.0.0.1:18091',{}), stream = await connect(app);
  try {
    await stream.wait(p=>p.type==='state' && p.接続済み);
    for (const count of [undefined,0,1,2,3]) {
      const text = `検証回数: ${count}`;
      const response = await post(app,{メッセージ識別:'input_text',メッセージ内容:text,self_check_loop:count});
      assert.equal(response.status,200);
      await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.種別==='assistant' && JSON.parse(m.本文).input===text));
      const request = backend.sockets.flatMap(socket=>socket.sent).findLast(packet=>packet.メッセージ識別==='input_text');
      assert.equal(request.self_check_loop,count ?? 1);
    }
  } finally { await stream.close(); await app.close(); }
});

test('Code: 最終選択を復元し、旧Hermes Providerを組み合わせモデルへ移行する', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences,'migration.json');
  writeFileSync(file, JSON.stringify({provider:'openai_oauth',model:'gpt-6.1-sol'}));
  for (const [initial, provider, model] of [
    [{}, 'aidiy_hermes', 'openai_oauth/gpt-6.1-sol'],
    [{provider:'copilot-cli',model:'gpt-6-sol'}, 'copilot_cli', 'gpt-6-sol'],
  ]) {
    const app = await 単独起動(process.cwd(),'http://127.0.0.1:18091',initial,file), stream = await connect(app);
    try {
      const state = await stream.wait(p=>p.type==='state' && p.接続済み);
      assert.equal(state.provider,provider); assert.equal(state.model,model);
      assert.equal(JSON.parse(readFileSync(file,'utf8')).provider,'openai_oauth');
    } finally { await stream.close(); await app.close(); }
  }
});

test('Code: 古い履歴からのモード切替で最終手動モデルを上書きしない', async t => {
  const project = offlineFixture();
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  for (const mode of ['online', 'offline']) {
    const file = join(preferences, `history-last-${mode}.json`);
    const online = {provider:'codex_cli',model:'auto'};
    const offline = {provider:'aidiy_hermes',model:'same'};
    const latest = mode === 'online' ? {provider:'copilot_cli',model:'gpt-6-sol'}
      : {provider:'aidiy_hermes',model:'copilot_cli/auto'};
    writeFileSync(file, JSON.stringify(online));
    writeFileSync(オフラインモデル保存先(file), JSON.stringify(offline));
    const run = () => ({完了:Promise.resolve({終了コード:0}),停止(){}});
    const app = await start(project,'http://127.0.0.1:18091',{offline:mode==='offline'},file,run);
    const stream = await connect(app);
    const waitState = async (data, predicate) => {
      const offset = stream.packets.length;
      assert.equal((await post(app,data)).status,200);
      return stream.wait(p=>stream.packets.indexOf(p)>=offset && p.type==='state' && predicate(p));
    };
    try {
      const original = await stream.wait(p=>p.type==='state' && p.実行モード===mode && (mode==='offline' || p.接続済み));
      await waitState({メッセージ識別:'input_text',メッセージ内容:'古いモデルの会話'},p=>!p.実行中 && p.メッセージ.length>0);
      await waitState({type:'new'},p=>p.会話ID!==original.会話ID && (mode==='offline' || p.接続済み));
      assert.equal((await post(app,{type:'model',...latest})).status,200);
      await waitState({メッセージ識別:'input_text',メッセージ内容:'新しいモデルの会話'},p=>!p.実行中 && p.メッセージ.length>0);
      const opened = await waitState({type:'selectHistory',id:original.会話ID},p=>p.会話ID===original.会話ID && (mode==='offline' || p.接続済み));
      assert.deepEqual({provider:opened.provider,model:opened.model},latest,'履歴を開いても今のモデルを保つ（履歴のモデルへ切り替えない）');
      await waitState({type:'selectHistory',id:original.会話ID},p=>p.会話ID===original.会話ID && (mode==='offline' || p.接続済み));
      const fresh = await waitState({type:'new'},p=>p.会話ID!==original.会話ID && (mode==='offline' || p.接続済み));
      assert.deepEqual({provider:fresh.provider,model:fresh.model},latest);
      await waitState({type:'selectHistory',id:original.会話ID},p=>p.会話ID===original.会話ID && (mode==='offline' || p.接続済み));
      await waitState({type:'executionMode',mode:mode==='online'?'offline':'online'},p=>p.実行モード!==mode && (mode==='online' || p.接続済み));
      const restored = await waitState({type:'executionMode',mode},p=>p.実行モード===mode && (mode==='offline' || p.接続済み));
      assert.deepEqual({provider:restored.provider,model:restored.model},latest);
      if (mode === 'offline') {
        await waitState({type:'selectHistory',id:original.会話ID},p=>p.会話ID===original.会話ID);
        await waitState({type:'autoConnect',enabled:true},p=>p.接続済み);
        const switched = await waitState({type:'executionMode',mode:'offline'},p=>p.実行モード==='offline');
        assert.deepEqual({provider:switched.provider,model:switched.model},latest);
      }
      assert.deepEqual(JSON.parse(readFileSync(mode==='online'?file:オフラインモデル保存先(file),'utf8')),latest);
    } finally { await stream.close(); await app.close(); }
  }
});

test('Code offline: コアなしでHermesを直接実行し、モデル保存・継続・新規をオンラインから分離する', async t => {
  const project = offlineFixture();
  const backend = require('./fake-core.cjs').core(); backend.install(t); backend.unavailable = true;
  const file = join(preferences,'offline-models.json');
  const online = {provider:'copilot_cli',model:'gpt-6-sol'};
  writeFileSync(file,JSON.stringify(online));
  const calls = [];
  const run = (...args) => {
    calls.push({model:args[2],session:args[4]});
    return オフライン実行(...args,{実行ファイル:process.execPath,引数:[resolve('checks/fake-cli.cjs'),'echo']});
  };
  const history = join(preferences, 'history-reopen');
  const app = await start(project,'http://127.0.0.1:18091',{offline:true},file,run,history), stream = await connect(app);
  let initial;
  try {
    initial = await stream.wait(p=>p.type==='state' && p.実行モード==='offline');
    assert.equal(initial.provider,'aidiy_hermes'); assert.equal(initial.model,Hermes既定モデル(project).replace(/^auto$/, 'same'));
    assert.equal(backend.sockets.length,0); assert.equal(backend.requests.length,0);
    assert.deepEqual((await (await fetch(app.url+'catalog')).json()).providers.map(p=>p.id),['aidiy_hermes']);
    const catalog = await (await fetch(app.url+'catalog?provider=aidiy_hermes')).json();
    const expected=オフラインモデル候補(project).map(item=>item.id);
    assert.deepEqual(catalog.models.map(p=>p.id),expected);
    assert.equal((await post(app,{type:'model',provider:'copilot_cli',model:'auto'})).status,400);
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'openai_oauth/unlisted'})).status,400);
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'})).status,200);
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),online);
    assert.deepEqual(JSON.parse(readFileSync(オフラインモデル保存先(file),'utf8')),{provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'});
    for (const text of ['初回','継続']) {
      assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:text,self_check_loop:3})).status,200);
      const done = await stream.wait(p=>p.type==='state' && !p.実行中 && p.セッションID==='test-session-001' && p.メッセージ.some(m=>m.種別==='assistant' && JSON.parse(m.本文).input===text));
      const answer = JSON.parse(done.メッセージ.at(-1).本文);
      assert.ok(answer.args.includes('openai_oauth/gpt-6.1-sol')); assert.equal(answer.cwd,project);
      assert.ok(!answer.args.includes('--yolo'));
    }
    assert.equal(calls.length,2); assert.equal(calls[0].session,undefined); assert.equal(calls[1].session,'test-session-001');
    await post(app,{type:'new'});
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'新規'});
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.種別==='assistant' && JSON.parse(m.本文).input==='新規'));
    assert.equal(calls[2].session,undefined);
    assert.equal(backend.sockets.length,0); assert.equal(backend.requests.length,0);
    backend.unavailable=false;
    await post(app,{type:'executionMode',mode:'online'});
    const connected = await stream.wait(p=>p.type==='state' && p.実行モード==='online' && p.接続済み);
    assert.equal(connected.provider,online.provider); assert.equal(connected.model,online.model);
    assert.notEqual(connected.セッションID,'test-session-001');
    await post(app,{type:'executionMode',mode:'offline'});
    await stream.wait(p=>p.type==='state' && p.実行モード==='offline' && p.会話ID!==initial.会話ID && p.model==='openai_oauth/gpt-6.1-sol');
    assert.ok(backend.sockets.every(s=>s.readyState===3));
    await post(app,{type:'selectHistory',id:initial.会話ID});
    const restored = await stream.wait(p=>p.type==='state' && p.会話ID===initial.会話ID && p.セッションID==='test-session-001' && !p.実行中);
    assert.equal(restored.実行モード,'offline');
  } finally { await stream.close(); await app.close(); }
  const reopened = await start(project,'http://127.0.0.1:18091',{offline:true},file,run,history), second = await connect(reopened);
  try {
    const restored = await second.wait(p=>p.type==='state' && p.実行モード==='offline');
    assert.equal(restored.model,'openai_oauth/gpt-6.1-sol');
    // 会話履歴はプロジェクトの保存先から読み直し、再起動後も選んで続けられる
    assert.ok(restored.履歴.some(item=>item.id===initial.会話ID),'再起動後も会話履歴が残る');
    await post(reopened,{type:'selectHistory',id:initial.会話ID});
    await second.wait(p=>p.type==='state' && p.会話ID===initial.会話ID && p.セッションID==='test-session-001');
    await post(reopened,{type:'deleteHistory',id:initial.会話ID});
    await second.wait(p=>p.type==='state' && !p.履歴.some(item=>item.id===initial.会話ID));
    assert.equal(readdirSync(history).includes(initial.会話ID+'.json'),false,'削除した会話のファイルを消す');
  } finally { await second.close(); await reopened.close(); }
});

test('Code 会話履歴: 本文上限の日本語回答を保存し、再起動後も全文を選び直せる', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences, 'long-japanese.json');
  const history = join(preferences, 'history-long-japanese');
  const request = '長文';
  const answer = 'あ'.repeat(会話本文上限 - request.length);
  const run = (_root, _folder, _model, _text, _session, receive) => {
    queueMicrotask(() => receive({ メッセージ識別: 'output_text', メッセージ内容: answer }));
    return { 完了: Promise.resolve({ 終了コード: 0, セッションID: 'long-japanese-session' }), 停止() {} };
  };
  const app = await start(process.cwd(), 'http://127.0.0.1:18091', { offline: true }, file, run, history);
  const stream = await connect(app);
  let id;
  const messages = [{ 種別: 'user', 本文: request }, { 種別: 'assistant', 本文: answer }];
  try {
    assert.equal((await post(app, { メッセージ識別: 'input_text', メッセージ内容: request })).status, 200);
    const done = await stream.wait(p => p.type === 'state' && !p.実行中 && p.セッションID === 'long-japanese-session');
    id = done.会話ID;
    assert.deepEqual(done.メッセージ, messages);
  } finally { await stream.close(); await app.close(); }
  const bytes = statSync(join(history, `${id}.json`)).size;
  assert.ok(bytes > 4 * 1024 * 1024 && bytes <= 会話ファイル上限);

  const reopened = await start(process.cwd(), 'http://127.0.0.1:18091', { offline: true }, file, run, history);
  const second = await connect(reopened);
  try {
    await second.wait(p => p.type === 'state' && p.履歴.some(item => item.id === id));
    assert.equal((await post(reopened, { type: 'selectHistory', id })).status, 200);
    const restored = await second.wait(p => p.type === 'state' && p.会話ID === id);
    assert.deepEqual(restored.メッセージ, messages);
    assert.equal(restored.セッションID, 'long-japanese-session');
    assert.equal(backend.sockets.length, 0); assert.equal(backend.requests.length, 0);
  } finally { await second.close(); await reopened.close(); }
});

test('Code offline: CLI組み合わせモデルはHermesのCLI Providerへ渡す', async () => {
  for (const provider of ['codex','copilot','claude','antigravity','grok','opencode']) {
    const job = オフライン実行(process.cwd(), process.cwd(), `${provider}_cli/same`, '引数確認', undefined, ()=>{},
      {実行ファイル:process.execPath,引数:[resolve('checks/fake-cli.cjs'),'echo']});
    const result = await job.完了;
    assert.equal(result.終了コード,0);
    const {args} = JSON.parse(result.回答);
    assert.equal(args[args.indexOf('--provider')+1], provider === 'claude' ? 'claude-code' : provider === 'opencode' ? 'opencode' : `${provider}-cli`);
    assert.ok(!args.includes('--model'));
  }
});

test('Code offline: 候補外の保存値は候補へ追加せず、設定の既定値へ戻す', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const file = join(preferences,'unlisted.json');
  writeFileSync(オフラインモデル保存先(file),JSON.stringify({provider:'aidiy_hermes',model:'openai_oauth/unlisted'}));
  const app = await start(process.cwd(),'http://127.0.0.1:18091',{offline:true},file), stream = await connect(app);
  try {
    const state = await stream.wait(p=>p.type==='state');
    const catalog = await (await fetch(app.url+'catalog?provider=aidiy_hermes')).json();
    assert.ok(catalog.models.some(p=>p.id===state.model));
    assert.ok(!catalog.models.some(p=>p.id==='openai_oauth/unlisted'));
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'openai_oauth/unlisted'})).status,400);
    assert.equal((await post(app,{type:'model',provider:'codex_cli',model:'auto'})).status,400);
  } finally { await stream.close(); await app.close(); }
});

test('Code offline: 実行中の切替を拒否し、停止と画面終了でジョブを終了する', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  let stopped=0;
  const run = () => {
    let finish;
    return {完了:new Promise(resolve=>{finish=resolve;}),停止:()=>{stopped++;finish({回答:'',ログ:'',終了コード:0,停止理由:'停止しました'});}};
  };
  const app = await start(process.cwd(),'http://127.0.0.1:18091',{offline:true},join(preferences,'stop.json'),run), stream = await connect(app);
  try {
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'待機'});
    assert.equal((await post(app,{type:'executionMode',mode:'online'})).status,409);
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'same'})).status,409);
    await post(app,{メッセージ識別:'cancel_run'});
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.本文==='停止しました'));
    assert.equal(stopped,1);
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'終了待機'});
  } finally { await stream.close(); await app.close(); }
  assert.equal(stopped,2); assert.equal(backend.sockets.length,0);
});

test('Code: 未接続はHermesへ送信し、実行中も自動再接続、完了後はAIコアへ戻す', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t); backend.unavailable = true;
  const file = join(preferences,'automatic-offline.json');
  const online = {provider:'copilot_cli',model:'gpt-6-sol'};
  writeFileSync(file,JSON.stringify(online));
  const jobs = [];
  const run = (_root, _folder, model, text, session, receive) => {
    let finish;
    const done = new Promise(resolve=>{finish=resolve;});
    const job = {model,text,session,stopped:false, finish:()=>{
      receive({メッセージ識別:'output_text',メッセージ内容:`Hermes: ${text}`});
      finish({セッションID:'hermes-session',終了コード:0});
    }};
    jobs.push(job);
    return {完了:done,停止:()=>{job.stopped=true;finish({終了コード:0,停止理由:'停止しました'});}};
  };
  const app = await start(process.cwd(),'http://127.0.0.1:18091',{},file,run), stream = await connect(app);
  try {
    const initial = await stream.wait(p=>p.type==='state' && Boolean(p.接続エラー));
    assert.equal(initial.実行モード,'offline'); assert.equal(initial.provider,'aidiy_hermes');
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:' '})).status,400);
    assert.deepEqual((await (await fetch(app.url+'catalog')).json()).providers.map(p=>p.id),['aidiy_hermes']);
    assert.equal((await post(app,{type:'model',provider:'aidiy_hermes',model:'same'})).status,200);
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),online);
    assert.equal(JSON.parse(readFileSync(オフラインモデル保存先(file),'utf8')).model,'same');
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'未接続の依頼',self_check_loop:3})).status,200);
    assert.equal(jobs.length,1); assert.equal(jobs[0].model,'same'); assert.equal(jobs[0].session,undefined);
    backend.unavailable = false;
    // 手動接続なしで10秒後の再試行を通す。Hermes実行は接続成功後も保持する。
    await stream.wait(p=>p.type==='state' && p.接続済み && p.実行中 && p.実行モード==='offline',12000);
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'二重送信'})).status,409);
    jobs[0].finish();
    const ready = await stream.wait(p=>p.type==='state' && p.接続済み && !p.実行中 && p.実行モード==='online');
    assert.equal(ready.provider,online.provider); assert.equal(ready.model,online.model);
    assert.notEqual(ready.セッションID,'hermes-session');
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'オンラインの依頼',self_check_loop:2})).status,200);
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.本文.includes('"input":"オンラインの依頼"')));
    const coreInput = backend.sockets.flatMap(s=>s.sent).filter(p=>p.メッセージ識別==='input_text');
    assert.equal(coreInput.length,1); assert.equal(coreInput[0].self_check_loop,2);
    backend.unavailable = true;
    for (const socket of backend.sockets) socket.close();
    await stream.wait(p=>p.type==='state' && !p.接続済み && p.メッセージ.some(m=>m.本文==='オンラインの依頼'));
    assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'Hermesの継続'})).status,200);
    assert.equal(jobs[1].session,'hermes-session');
    assert.equal((await post(app,{メッセージ識別:'cancel_run'})).status,200);
    assert.equal(jobs[1].stopped,true);
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.本文==='停止しました'));
    await post(app,{type:'new'});
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'新規の依頼'});
    assert.equal(jobs[2].session,undefined);
  } finally { await stream.close(); await app.close(); }
  assert.equal(jobs[2].stopped,true);
});

test('Code offline: CLI起動失敗を表示し、再入力可能にする', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  const app = await start(process.cwd(),'http://127.0.0.1:18091',{offline:true},join(preferences,'failure.json'),()=>{throw new Error('Hermes未配置');});
  const stream = await connect(app);
  try {
    await post(app,{メッセージ識別:'input_text',メッセージ内容:'依頼'});
    await stream.wait(p=>p.type==='state' && !p.実行中 && p.メッセージ.some(m=>m.種別==='error' && m.本文.includes('Hermes未配置')));
  } finally { await stream.close(); await app.close(); }
});

test('Code: 停止完了までOFF/ON・旧接続操作・新規・モデル変更を拒否する', async t => {
  const project = offlineFixture();
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  backend.hold=true; backend.holdCancel=true;
  for (const mode of ['online','offline']) {
    const file = join(preferences,`stop-switch-${mode}.json`);
    const online={provider:'codex_cli',model:'auto'}, offline={provider:'aidiy_hermes',model:'copilot_cli/auto'};
    writeFileSync(file,JSON.stringify(online));
    writeFileSync(オフラインモデル保存先(file),JSON.stringify(offline));
    let stops=0, finish;
    const run=(_root,_folder,_model,_text,_session,receive)=>({
      完了:new Promise(resolve=>{finish=()=>resolve({終了コード:0,停止理由:'停止しました'});}),
      停止(){stops++;receive({メッセージ識別:'output_stream',メッセージ内容:'\x18'});receive({メッセージ識別:'output_text',メッセージ内容:'途中の中断通知'});}
    });
    const app=await start(project,'http://127.0.0.1:18091',{offline:mode==='offline'},file,run), stream=await connect(app);
    try {
      const initial=await stream.wait(p=>p.type==='state' && p.実行モード===mode && (mode==='offline'||p.接続済み));
      assert.equal((await post(app,{メッセージ識別:'input_text',メッセージ内容:'停止と切替の確認'})).status,200);
      await stream.wait(p=>p.type==='state' && p.実行中);
      const output=backend.sockets.findLast(s=>s.channel==='1' && s.readyState===1);
      if (mode==='online') {
        output.emit({メッセージ識別:'output_text',メッセージ内容:'回答後も検証中'});
        await stream.wait(p=>p.type==='state' && p.実行中 && p.メッセージ.some(m=>m.本文==='回答後も検証中'));
      }
      const cancelCount=()=>backend.sockets.flatMap(s=>s.sent).filter(p=>p.メッセージ識別==='cancel_run').length;
      const before=cancelCount();
      await post(app,{メッセージ識別:'cancel_run'});
      await stream.wait(p=>p.type==='state' && p.実行中 && p.停止中);
      await post(app,{メッセージ識別:'cancel_run'});
      assert.equal(mode==='offline'?stops:cancelCount()-before,1);
      for (const data of [{type:'autoConnect',enabled:false},{type:'autoConnect',enabled:true},
        {type:'disconnect'},{type:'connect'},{type:'new'},{type:'model',provider:'aidiy_hermes',model:'same'}]) {
        assert.equal((await post(app,data)).status,409,JSON.stringify(data));
      }
      if (mode==='offline') finish();
      else output.emit({メッセージ識別:'output_end',メッセージ内容:'',実行中:false});
      await stream.wait(p=>p.type==='state' && !p.実行中 && !p.停止中 && p.メッセージ.length>0);
      if (mode==='online') await post(app,{type:'autoConnect',enabled:false});
      const offset=stream.packets.length;
      await post(app,{type:'model',provider:'aidiy_hermes',model:'codex_cli/auto'});
      await stream.wait(p=>stream.packets.indexOf(p)>=offset && p.type==='state' && p.model==='codex_cli/auto');
      const onOffset=stream.packets.length;
      await post(app,{type:'autoConnect',enabled:true});
      const restored=await stream.wait(p=>stream.packets.indexOf(p)>=onOffset && p.type==='state' && p.接続済み && p.実行モード==='online');
      assert.deepEqual({provider:restored.provider,model:restored.model},online);
      if (mode==='online') {assert.equal(restored.会話ID,initial.会話ID);assert.equal(restored.セッションID,initial.セッションID);}
      else assert.notEqual(restored.会話ID,initial.会話ID);
      const sockets=backend.sockets.length;
      await post(app,{type:'autoConnect',enabled:true});
      assert.equal(backend.sockets.length,sockets,'同じON通知で接続を作り直さない');
      assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),online);
      assert.equal(JSON.parse(readFileSync(オフラインモデル保存先(file),'utf8')).model,'codex_cli/auto');
    } finally { if(finish) finish(); await stream.close(); await app.close(); }
  }
});


test('Code offline: 保存済みsameを復元し、モデル・provider指定なしで呼ぶ', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t); backend.unavailable = true;
  const file = join(preferences, 'saved-same.json');
  writeFileSync(オフラインモデル保存先(file), JSON.stringify({provider:'aidiy_hermes', model:'same'}));
  const app = await start(process.cwd(), 'http://127.0.0.1:18091', {offline:true}, file), stream = await connect(app);
  try {
    const state = await stream.wait(p=>p.type==='state');
    assert.equal(state.model, 'same');
    const catalog = await (await fetch(app.url+'catalog?provider=aidiy_hermes')).json();
    assert.ok(catalog.models.some(m=>m.id==='same'));
    assert.ok(!catalog.models.some(m=>m.id==='auto'));
    const job = オフライン実行(process.cwd(), process.cwd(), state.model, '引数確認', undefined, ()=>{},
      {実行ファイル:process.execPath, 引数:[resolve('checks/fake-cli.cjs'),'echo']});
    const result = await job.完了;
    assert.equal(result.終了コード, 0);
    const {args} = JSON.parse(result.回答);
    assert.ok(!args.includes('--model'));
    assert.ok(!args.includes('--provider'));
  } finally { await stream.close(); await app.close(); }
});

test('Code 添付API: scope/Origin/サイズを検証し、Core echoだけを保存・復元し失敗を表示する', async t => {
  const backend = require('./fake-core.cjs').core({ CODE_BASE_PATH: process.cwd() }); backend.install(t);
  const app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091'); const stream = await connect(app);
  try {
    const ready = await stream.wait(packet => packet.type === 'state' && packet.接続済み);
    const upload = { type: 'sendFile', name: '日本語.txt', base64: 'aGk=', conversationId: ready.会話ID, sessionId: ready.セッションID, projectPath: ready.接続プロジェクトパス, connectionEpoch: ready.接続世代 };
    assert.equal((await post(app, upload, 'https://untrusted.invalid')).status, 403);
    for (const field of ['conversationId', 'sessionId', 'projectPath', 'connectionEpoch']) assert.equal((await post(app, { ...upload, [field]: 'stale' })).status, 409);
    assert.equal((await post(app, { ...upload, name: '../bad.txt' })).status, 400);
    assert.equal((await post(app, { ...upload, base64: 'invalid' })).status, 400);
    assert.equal((await post(app, { ...upload, base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') })).status, 400);
    assert.equal((await post(app, { type: 'input_text', メッセージ内容: 'a'.repeat(200001) })).status, 400, '本文の20万文字という業務上限は緩めない');
    assert.equal((await post(app, { type: 'input_text', メッセージ内容: 'a'.repeat(1_000_001) })).status, 400, '旧HTTP上限より大きくても本文の業務検証で拒否する');
    assert.equal((await post(app, { type: 'input_text', メッセージ内容: 'a'.repeat(20 * 1024 * 1024 + 1) })).status, 413, '20MiBを超える要求は転送前に拒否する');
    assert.equal(backend.sockets.flatMap(socket => socket.sent).filter(packet => packet.メッセージ識別 === 'input_file').length, 0);
    assert.equal((await post(app, upload)).status, 200);
    const input = backend.sockets.find(socket => socket.channel === 'input');
    const output = backend.sockets.find(socket => socket.channel === '1');
    assert.equal(input.sent.at(-1).ファイル名, upload.name); assert.equal(input.sent.at(-1).メッセージ内容, upload.base64);
    assert.equal(stream.packets.findLast(packet => packet.type === 'state').メッセージ.length, 0, '送信受理だけでは受信済み表示を作らない');
    const thumb = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
    const echo = { メッセージ識別: 'input_file', メッセージ内容: 'ファイル受信: 日本語.txt', ファイル名: 'temp/input/unique-日本語.txt', 元ファイル名: '日本語.txt', サムネイル画像: thumb };
    output.emit(echo); output.emit(echo);
    output.emit({ ...echo, メッセージ識別: 'output_file', ファイル名: 'temp/output/answer.png', 元ファイル名: 'answer.png' });
    const shown = await stream.wait(packet => packet.type === 'state' && packet.メッセージ.length === 2);
    assert.equal(shown.メッセージ[0].添付.thumbnail, 'data:image/png;base64,' + thumb);
    assert.equal(shown.メッセージ[0].添付.kind, 'input_file'); assert.equal(shown.メッセージ[1].添付.kind, 'output_file');
    assert.equal(shown.実行中, false);
    assert.equal((await post(app, { type: 'new' })).status, 200);
    await stream.wait(packet => packet.type === 'state' && packet.会話ID !== ready.会話ID && packet.接続済み);
    assert.equal((await post(app, upload)).status, 409, '古い画面から新しい会話へ添付しない');
    assert.equal((await post(app, { type: 'selectHistory', id: ready.会話ID })).status, 200);
    const restored = await stream.wait(packet => packet.type === 'state' && packet.会話ID === ready.会話ID && packet.メッセージ.length === 2);
    assert.equal(restored.メッセージ[1].添付.thumbnail, 'data:image/png;base64,' + thumb);
    const active = backend.sockets.findLast(socket => socket.channel === '1');
    active.emit({ メッセージ識別: 'error', エラーコード: 'FILE_UPLOAD_FAILED', メッセージ内容: 'ファイル保存に失敗しました' });
    await stream.wait(packet => packet.type === 'state' && packet.メッセージ.some(message => message.種別 === 'error' && message.本文.includes('ファイル保存')));
    assert.equal((await post(app, { type: 'autoConnect', enabled: false })).status, 200);
    assert.equal((await post(app, upload)).status, 409);
  } finally { await stream.close(); await app.close(); }
});

test('Code 添付API: body受信中に同sessionへ再接続した旧HTTP要求を拒否する', async t => {
  const backend = require('./fake-core.cjs').core({ CODE_BASE_PATH: process.cwd() }); backend.install(t);
  const app = await 単独起動(process.cwd(), 'http://127.0.0.1:18091'); const stream = await connect(app);
  const { request } = require('node:http');
  const pending = new Set();
  try {
    let ready = await stream.wait(packet => packet.type === 'state' && packet.接続済み);
    for (const updateEmbeddedEpoch of [false, true]) {
      let continueRequest, resolveResponse, rejectResponse;
      const continued = new Promise(resolve => { continueRequest = resolve; });
      const result = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
      const slow = request(app.url + 'message', { method: 'POST', headers: {
        Origin: new URL(app.url).origin, 'Content-Type': 'application/json', Expect: '100-continue', 'Transfer-Encoding': 'chunked',
      } }, response => {
        response.resume(); response.on('end', () => resolveResponse(response.statusCode));
      });
      pending.add(slow); slow.on('error', rejectResponse); slow.once('continue', continueRequest); slow.flushHeaders();
      // 100 Continueはサーバーがheadersを受け付けた証拠。bodyの完了だけを意図的に遅らせる。
      await continued;
      slow.write('{"type":"sendFile","name":"slow.txt","base64":"aGk=",');
      const before = ready, offset = stream.packets.length;
      assert.equal((await post(app, { type: 'disconnect' })).status, 200);
      assert.equal((await post(app, { type: 'connect' })).status, 200);
      ready = await stream.wait(packet => stream.packets.indexOf(packet) >= offset && packet.type === 'state' && packet.接続済み);
      assert.equal(ready.セッションID, before.セッションID); assert.equal(ready.接続プロジェクトパス, before.接続プロジェクトパス);
      assert.notEqual(ready.接続世代, before.接続世代);
      const scope = { conversationId: before.会話ID, sessionId: before.セッションID, projectPath: before.接続プロジェクトパス,
        connectionEpoch: updateEmbeddedEpoch ? ready.接続世代 : before.接続世代 };
      slow.end(JSON.stringify(scope).slice(1));
      assert.equal(await result, 409, updateEmbeddedEpoch ? 'body内epochを新しくしてもHTTP受付時epochが古ければ拒否する' : '同じsessionでも旧epochを拒否する');
      pending.delete(slow);
    }
    assert.equal(backend.sockets.flatMap(socket => socket.sent).filter(packet => packet.メッセージ識別 === 'input_file').length, 0);
    const scope = { conversationId: ready.会話ID, sessionId: ready.セッションID, projectPath: ready.接続プロジェクトパス, connectionEpoch: ready.接続世代 };
    assert.equal((await post(app, { type: 'sendFile', name: 'fresh.txt', base64: 'aGk=', ...scope })).status, 200);
    assert.equal((await post(app, { type: 'sendFile', name: 'missing.txt', base64: 'aGk=', ...scope, connectionEpoch: undefined })).status, 409);
    assert.equal(backend.sockets.flatMap(socket => socket.sent).filter(packet => packet.メッセージ識別 === 'input_file').length, 1);
  } finally { for (const request of pending) request.destroy(); await stream.close(); await app.close(); }
});

test('Code既定保存先: プロジェクトごとのモデルと検証回数を読み、home設定を使わない', async t => {
  const backend = require('./fake-core.cjs').core(); backend.install(t);
  for (const [index, model] of ['project-a-model', 'project-b-model'].entries()) {
    const project = offlineFixture(), folder = join(project,'_AIDIY','aidiy_code');mkdirSync(folder,{recursive:true});
    writeFileSync(join(folder,'aidiy_code_model.json'),JSON.stringify({provider:'codex_cli',model}));
    writeFileSync(join(folder,'aidiy_code_options.json'),JSON.stringify({検証回数:index+1}));
    const app = await start(project,'http://127.0.0.1:18091',{},undefined), stream = await connect(app);
    try { const state = await stream.wait(packet=>packet.type==='state'&&packet.接続済み);assert.equal(state.model,model);assert.equal(state.検証回数,index+1); }
    finally { await stream.close();await app.close(); }
  }
});
