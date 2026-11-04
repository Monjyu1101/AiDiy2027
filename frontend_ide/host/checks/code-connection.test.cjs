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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodeConnection: RealCodeConnection, コード選択 } = require('../out/code-connection.cjs');
class CodeConnection extends RealCodeConnection { constructor(...args) { args[5] = () => ({ Authorization: 'Bearer fixture-token-only' }); super(...args); } }
const { core } = require('./fake-core.cjs');
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function connection(backend) {
  const packets = [], states = [];
  const client = new CodeConnection('http://127.0.0.1:18091', packet => packets.push(packet), () => states.push({connected:client.connected,connecting:client.接続中}), url => new backend.Socket(url), backend.request);
  return { client, packets, states };
}

test('Code 接続: inputのinit・モデル設定後に出力ソケットを開き、両init前は送信しない', async () => {
  const backend = core(), { client, packets, states } = connection(backend);
  try {
    client.start('/project', {provider:'copilot_cli',model:'gpt-6-sol'});
    assert.deepEqual(states, [{connected:false,connecting:false},{connected:false,connecting:true}]);
    assert.equal(client.send({メッセージ識別:'input_text',メッセージ内容:'早すぎる送信'}),false);
    await flush();
    assert.equal(client.connected,true);
    assert.deepEqual(states.at(-1),{connected:true,connecting:false});
    assert.deepEqual(backend.sockets.map(s=>s.channel),['input','1']);
    assert.equal(backend.requests.at(-1).body.モデル設定.CODE_AI1_MODEL,'gpt-6-sol');
    assert.equal(backend.requests.at(-1).body.save,false);
    assert.ok(backend.sockets.every(s=>s.sent[0].CODE_BASE_PATH==='/project'));
    for (const socket of backend.sockets) assert.equal(socket.sent[0].voice,false,'Code専用セッションはJSON booleanのfalseで音声を無効にする');
    assert.ok(client.send({メッセージ識別:'input_text',メッセージ内容:'依頼'})); await flush();
    assert.equal(backend.sockets[0].sent.at(-1).チャンネル,'1');
    assert.ok(packets.some(p=>p.メッセージ識別==='output_text'));
    backend.sockets[0].emit({メッセージ識別:'error',メッセージ内容:'入力処理エラー'});
    assert.equal(packets.at(-1).メッセージ内容,'入力処理エラー');
    const catalog = await client.catalog('aidiy_hermes');
    assert.ok(catalog.some(m=>m.id==='openai_oauth/gpt-6.1-sol'));
    await client.setModel({provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'});
    assert.equal(backend.requests.at(-1).body.モデル設定.CODE_AI1_MODEL,'openai_oauth/gpt-6.1-sol');
  } finally { client.dispose(); }
});

test('Code 接続: 切断から10秒後に再接続し、同じセッションと会話を保持、遅延イベントを無視する', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const backend = core(), {client, packets, states} = connection(backend);
  try {
    client.start('/project',{provider:'copilot_cli',model:'gpt-6-sol'}); await flush();
    const session = client.session, epoch = client.epoch;
    client.send({メッセージ識別:'input_text',メッセージ内容:'依頼'}); await flush();
    const old = backend.sockets[1], count = packets.filter(p=>p.メッセージ識別==='output_text').length;
    const settings = backend.requests.filter(r=>r.path.endsWith('設定')).length;
    old.close(); assert.equal(client.connected,false); assert.equal(backend.sockets[0].readyState,3);
    assert.deepEqual(states.at(-1),{connected:false,connecting:false});
    assert.equal(client.send({メッセージ識別:'input_text',メッセージ内容:'切断中'}),false);
    t.mock.timers.tick(9999); await flush(); assert.equal(backend.sockets.length,2);
    t.mock.timers.tick(1); await flush();
    assert.deepEqual(states.slice(-2),[{connected:false,connecting:true},{connected:true,connecting:false}]);
    assert.equal(client.connected,true); assert.equal(client.session,session);
    assert.ok(client.epoch > epoch, '同sessionの自動再接続でもepochを更新する');
    assert.equal(backend.sockets.length,4);
    for (const socket of backend.sockets.slice(2)) {
      assert.equal(socket.sent[0].voice,false,'再接続でも音声を有効にしない');
      assert.equal(socket.sent[0].セッションID,session);
    }
    assert.equal(packets.filter(p=>p.メッセージ識別==='output_text').length,count,'履歴再送で回答が二重にならない');
    assert.equal(backend.requests.filter(r=>r.path.endsWith('設定')).length,settings,'同じ設定の再接続でAIインスタンスをリセットしない');
    old.onclose({}); old.emit({メッセージ識別:'output_text',メッセージ内容:'古い回答'});
    assert.equal(client.connected,true); assert.ok(!packets.some(p=>p.メッセージ内容==='古い回答'));
    client.disconnect(); t.mock.timers.tick(20000); await flush();
    assert.equal(client.connected,false); assert.equal(backend.sockets.length,4);
  } finally { client.dispose(); t.mock.timers.reset(); }
});

test('Code 接続: 保存済みセッションを再開するときも両ソケットで音声を無効にする', async () => {
  const backend = core(), {client} = connection(backend);
  try {
    client.start('/project',{provider:'',model:''},'saved-session'); await flush();
    assert.equal(client.connected,true);
    assert.equal(client.session,'saved-session');
    assert.deepEqual(backend.sockets.map(socket=>socket.sent[0]),['input','1'].map(channel=>({
      type:'connect', セッションID:'saved-session', ソケット番号:channel, CODE_BASE_PATH:'/project', voice:false,
    })));
    await client.setModel({provider:'copilot_cli',model:'gpt-6-sol'});
    assert.equal(client.connected,true);
    assert.equal(backend.sockets.length,2,'モデル変更で接続を作り直さない');
    assert.deepEqual(backend.requests.at(-1).body,{
      セッションID:'saved-session', モデル設定:{CODE_AI1_NAME:'copilot_cli',CODE_AI1_MODEL:'gpt-6-sol'}, save:false,
    });
  } finally {client.dispose();}
});

test('Code 接続: 初回失敗も10秒間隔で再試行し、破棄・接続変更で途中の処理を終了する', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const backend = core(), {client} = connection(backend); backend.unavailable = true;
  try {
    client.start('/project',{provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'}); await flush();
    assert.equal(client.connected,false);
    t.mock.timers.tick(10000); await flush(); assert.equal(backend.sockets.length,2);
    backend.unavailable = false;
    t.mock.timers.tick(10000); await flush(); assert.equal(client.connected,true);
    client.start('/other',{provider:'copilot_cli',model:'gpt-6-sol'});
    client.dispose(); await flush(); t.mock.timers.tick(10000); await flush();
    assert.equal(client.connected,false); assert.ok(backend.sockets.every(s=>s.readyState===3));
  } finally { client.dispose(); t.mock.timers.reset(); }
});

test('Code 接続: 30秒のinit待ちで失敗し、設定APIのNGも送信可能にしない', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const backend = core(), sockets = [];
  const client = new CodeConnection('http://127.0.0.1:18091',()=>{},()=>{},()=>{
    const socket = { readyState:1, bufferedAmount:0, send(){}, close(){this.readyState=3;} }; sockets.push(socket); return socket;
  },backend.request);
  try {
    client.start('/project',{provider:'copilot_cli',model:'gpt-6-sol'});
    t.mock.timers.tick(30000); await flush();
    assert.equal(client.connected,false); assert.equal(sockets[0].readyState,3);
  } finally { client.dispose(); t.mock.timers.reset(); }
  const failed = new CodeConnection('http://127.0.0.1:18091',()=>{},()=>{},url=>new backend.Socket(url),async()=>({ok:true,json:async()=>({status:'NG',message:'設定失敗'})}));
  try { failed.start('/project',{provider:'copilot_cli',model:'gpt-6-sol'}); await flush(); assert.equal(failed.connected,false); assert.match(failed.error,/設定失敗/); }
  finally { failed.dispose(); }
});

test('Code モデル: Hermes旧設定とCLI別名を移行し、組み合わせIDを保持する', () => {
  assert.deepEqual(コード選択({provider:'openai_oauth',model:'gpt-6.1-sol'}),{provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'});
  assert.deepEqual(コード選択({provider:'copilot-cli',model:'gpt-6-sol'}),{provider:'copilot_cli',model:'gpt-6-sol'});
  assert.deepEqual(コード選択({provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'}),{provider:'aidiy_hermes',model:'openai_oauth/gpt-6.1-sol'});
});

test('Code 接続: 回答・CAN・中断通知後も要求全体の完了まで実行中を伝える', async () => {
  const backend=core(), {client,packets}=connection(backend);
  backend.hold=true;backend.holdCancel=true;
  try {
    client.start('/project',{provider:'codex_cli',model:'auto'});await flush();
    client.send({メッセージ識別:'input_text',メッセージ内容:'検証付きの依頼'});await flush();
    assert.equal(backend.sockets[0].sent.at(-1).実行状態通知,true);
    const output=backend.sockets[1];
    output.emit({メッセージ識別:'output_text',メッセージ内容:'通常回答'});
    assert.equal(packets.at(-1).実行中,true);
    client.send({メッセージ識別:'cancel_run'});await flush();
    assert.equal(packets.at(-1).実行中,true);
    assert.ok(packets.some(p=>p.メッセージ内容==='\x18' && p.実行中===true));
    output.emit({メッセージ識別:'output_end',メッセージ内容:'',実行中:false});
    assert.equal(packets.at(-1).実行中,false);
    client.disconnect();
    client.start('/project',{provider:'codex_cli',model:'auto'});await flush();
    backend.sockets.at(-1).emit({メッセージ識別:'output_text',メッセージ内容:'旧コアの回答'});
    assert.equal(packets.at(-1).実行中,undefined,'新しい接続へ前の実行状態を持ち込まない');
  } finally {client.dispose();}
});

test('Code 接続: 共通のモデル既定値を使う再接続で会話をリセットしない', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const backend=core(), {client}=connection(backend);
  try {
    client.start('/project',{provider:'',model:''}); await flush();
    const session=backend.sessions.get(client.session);
    session.settings.CODE_AI1_MODEL='';session.settings.CODE_AIDIY_HERMES_MODEL='openai_oauth/gpt-6.1-sol';
    backend.sockets[1].close();t.mock.timers.tick(10000);await flush();
    assert.equal(client.connected,true);
    assert.ok(!backend.requests.some(request=>request.path.endsWith('設定')));
  } finally {client.dispose();t.mock.timers.reset();}
});

test('Code 接続: モデル取得の30秒期限と接続切替の中断を区別する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const client = new CodeConnection('http://127.0.0.1:18091', () => {}, () => {}, undefined, request);
  try {
    const timeout = assert.rejects(client.catalog(), error => {
      assert.match(error.message, /応答待ちがタイムアウト/);
      assert.match(error.message, /30秒/);
      assert.doesNotMatch(error.message, /20:|This operation was aborted/);
      return true;
    });
    t.mock.timers.tick(30000); await timeout;
    const cancelled = assert.rejects(client.catalog(), error => {
      assert.match(error.message, /要求を中断/);
      assert.doesNotMatch(error.message, /通信に失敗|タイムアウト|20:/);
      return true;
    });
    client.disconnect(); await cancelled;
  } finally { client.dispose(); t.mock.timers.reset(); }
});

test('Code 添付: ファイルを現在のinput/session/channel1/projectへ固定し、要求実行や自動再送を開始しない', async () => {
  const backend = core({ CODE_BASE_PATH: '/session-project' }), { client, packets } = connection(backend);
  try {
    client.start('/project', { provider: '', model: '' }); await flush();
    assert.equal(client.send({ メッセージ識別: 'input_file', メッセージ内容: 'aGk=', ファイル名: 'test.txt', セッションID: 'wrong', チャンネル: '0', 出力先チャンネル: '0', プロジェクトパス: '/wrong' }), true);
    assert.deepEqual(backend.sockets[0].sent.at(-1), { メッセージ識別: 'input_file', メッセージ内容: 'aGk=', ファイル名: 'test.txt', セッションID: client.session, チャンネル: '1', 出力先チャンネル: '1', プロジェクトパス: '/session-project' });
    assert.equal(packets.some(packet => packet.メッセージ識別 === 'output_stream'), false);
    backend.sockets[0].bufferedAmount = 128001;
    assert.equal(client.send({ メッセージ識別: 'input_file' }), false);
    client.disconnect(); assert.equal(client.send({ メッセージ識別: 'input_file' }), false);
  } finally { client.dispose(); }
});
