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
const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { CLI実行, 会話引数, 起動解決, 再開セッション不在 } = require('../out/runner.cjs');
const fake = resolve('checks/fake-cli.cjs');
const root = resolve('.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function cleanup(dir) {
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'aidiy-hermes-'));
  rmSync(dir, { recursive: true, force: true });
}
function run(mode, extra = [], options = {}) {
  return CLI実行({ 起動: { 実行ファイル: process.execPath, 引数: [fake, mode, ...extra] }, 作業フォルダ: root, 本文: '', 引数: [], 制限時間: 10000, ...options });
}
test('日本語長文を stdin で渡し、進捗・回答・会話IDを分離する', async () => {
  const 本文 = '日本語 & | " ` $() %PATH%\n'.repeat(8000);
  const 引数 = 会話引数('custom', 'model with spaces & symbols', 8, 'old-session');
  const lines = [];
  const result = await run('echo', [], { 本文, 引数, 進捗: line => lines.push(line) }).完了;
  const answer = JSON.parse(result.回答);
  assert.equal(answer.input, 本文);
  assert.deepEqual(answer.args, 引数);
  assert.equal(answer.cwd, root); assert.equal(answer.envCwd, root);
  assert.equal(result.セッションID, 'test-session-001');
  assert.equal(result.終了コード, 0);
  assert.deepEqual(lines, ['[step] 日本語の進捗']);
  assert.ok(!引数.includes('--yolo'));
});
test('モデル自動選択では --model を付けず CLI 既定へ任せる', () => {
  for (const model of ['', 'auto', ' AUTO ', 'same', ' SAME ']) {
    const 引数 = 会話引数('copilot-cli', model, 30);
    assert.deepEqual(引数, ['-Q', '--oneshot-stdin', '--max-turns', '30', '--provider', 'copilot-cli']);
  }
});

test('xAI OAuth の provider とモデルを Hermes へ渡す', () => {
  assert.deepEqual(会話引数('xai-oauth', 'grok-4.6', 30), [
    '-Q', '--oneshot-stdin', '--max-turns', '30',
    '--provider', 'xai-oauth', '--model', 'grok-4.6'
  ]);
});
test('非ゼロ終了と stderr を呼び出し元へ返す', async () => {
  const result = await run('fail', [], { 本文: 'abc'.repeat(100000) }).完了;
  assert.equal(result.終了コード, 7);
  assert.match(result.ログ, /authentication failed/);
});
for (const 出力元 of ['stdout', 'stderr']) {
  test(`${出力元} の改行なしチャンクを受信中は開始からの制限時間で停止しない`, { timeout: 5000 }, async () => {
    const result = await run('pulse', [出力元], { 制限時間: 650 }).完了;
    assert.equal(result.終了コード, 0);
    assert.equal(result.停止理由, undefined);
    assert.equal(出力元 === 'stdout' ? result.回答 : result.ログ, 'tickticktick');
  });
}
test('最後の受信後に制限時間が経過すると停止する', { timeout: 6000 }, async () => {
  const start = Date.now();
  const job = run('pulse-hang', ['stdout'], { 制限時間: 650 });
  try {
    const result = await job.完了;
    assert.match(result.停止理由, /最後の受信から制限時間/);
    assert.ok(Date.now() - start >= 1200, '最後のチャンクより前に停止しました');
  } finally { job.停止(); }
});
test('保存済みセッションが消えた場合だけ resume を外して再実行する', async () => {
  const { コード要求実行, STREAM_START, STREAM_END, STREAM_CANCEL } = require('../out/protocol.cjs');
  const id = '20260929_140445_a8bbc2';
  const args = 会話引数('xai-oauth', 'grok-4.6', 30, id);
  const first = await run('missing-session', [], { 本文: '続き', 引数: args }).完了;
  assert.equal(再開セッション不在(first, id), true);
  assert.equal(再開セッション不在(first, 'different-id'), false);
  const packets = [];
  const result = await コード要求実行({ セッションID: 'ui-session', チャンネル: 'code1', メッセージ識別: 'input_text', メッセージ内容: '続き' }, {
    起動: { 実行ファイル: process.execPath, 引数: [fake, 'missing-session'] },
    作業フォルダ: root, 引数: args, 制限時間: 10000
  }, packet => packets.push(packet), id).完了;
  assert.equal(result.終了コード, 0);
  assert.equal(result.セッション復旧, true);
  assert.equal(result.セッションID, 'test-session-001');
  assert.ok(!JSON.parse(result.回答).args.includes('--resume'));
  assert.equal(packets.filter(packet => packet.メッセージ内容 === STREAM_START).length, 1);
  assert.equal(packets.filter(packet => packet.メッセージ内容 === STREAM_END).length, 1);
  assert.equal(packets.filter(packet => packet.メッセージ内容 === STREAM_CANCEL).length, 0);
});
test('実行ファイルが存在しない場合に起動エラーを返す', async () => {
  await assert.rejects(CLI実行({ 起動: { 実行ファイル: join(root, 'does-not-exist.exe'), 引数: [] }, 作業フォルダ: root, 本文: 'hello', 引数: [], 制限時間: 5000 }).完了, /CLI を起動できません/);
});
test('AiDiy .cmd の絶対パスを読み取り、シェルを経由せず起動できる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidiy-hermes-test-'));
  try {
    const cmd = join(dir, 'aidiy_hermes.cmd');
    writeFileSync(cmd, `@echo off\nset "PY=${process.execPath}"\nset "CLI=${fake}"\n`);
    assert.deepEqual(起動解決(cmd), { 実行ファイル: process.execPath, 引数: [fake] });
    writeFileSync(cmd, '@echo off\nset "PY=%EVIL%"\nset "CLI=relative.py"\n');
    assert.throws(() => 起動解決(cmd), /AiDiy の起動形式/);
  } finally { cleanup(dir); }
});
for (const timeout of [false, true]) {
  test(timeout ? 'タイムアウトで子孫プロセスも停止する' : '停止操作で子孫プロセスも停止する', { timeout: 15000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidiy-hermes-process-'));
    const pidFile = join(dir, 'pids.json');
    const job = run('wait', [pidFile], { 制限時間: timeout ? 2000 : 10000 });
    try {
      for (let i = 0; i < 100 && !existsSync(pidFile); i++) await pause(30);
      assert.ok(existsSync(pidFile));
      const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
      if (!timeout) job.停止();
      const result = await job.完了;
      assert.match(result.停止理由, timeout ? /制限時間/ : /停止しました/);
      for (const pid of Object.values(pids)) {
        let alive = true;
        for (let i = 0; i < 40; i++) {
          try { process.kill(pid, 0); await pause(50); } catch { alive = false; break; }
        }
        assert.equal(alive, false, `プロセス ${pid} が残留しています`);
      }
    } finally { job.停止(); cleanup(dir); }
  });
}
test('AIコードと同じ開始・stdout/stderrストリーム・終了・正式回答の順序で返す', async () => {
  const { コード要求実行, STREAM_START, STREAM_END, STREAM_CANCEL, streamControlOf, visibleStreamContent } = require('../out/protocol.cjs');
  assert.deepEqual([...Buffer.from(STREAM_START)], [0x02]);
  assert.deepEqual([...Buffer.from(STREAM_END)], [0x03]);
  assert.deepEqual([...Buffer.from(STREAM_CANCEL)], [0x18]);
  assert.equal(streamControlOf(`${STREAM_START}\n`), 'start');
  assert.equal(streamControlOf(`${STREAM_END}\r\n`), 'end');
  assert.equal(streamControlOf(`${STREAM_CANCEL}\n`), 'cancel');
  assert.equal(visibleStreamContent(`${STREAM_START}\n`), '');
  assert.equal(visibleStreamContent(`開始${STREAM_START}終了${STREAM_END}中断${STREAM_CANCEL}`), '開始終了中断');
  assert.equal(visibleStreamContent('1行\r\n\r\n'), '1行');
  const packets = [];
  const result = await コード要求実行({ セッションID: 'ui-session', チャンネル: 'code1', メッセージ識別: 'input_text', メッセージ内容: 'テスト' }, {
    起動: { 実行ファイル: process.execPath, 引数: [fake, 'echo'] }, 作業フォルダ: root, 引数: [], 制限時間: 10000
  }, packet => packets.push(packet)).完了;
  assert.equal(packets[0].メッセージ内容, STREAM_START);
  assert.ok(packets.some(p => p.出力元 === 'stderr' && p.メッセージ内容.includes('[step]')));
  assert.ok(packets.some(p => p.出力元 === 'stdout'));
  assert.equal(packets.at(-2).メッセージ内容, STREAM_END);
  assert.equal(packets.at(-1).メッセージ識別, 'output_text');
  assert.equal(packets.at(-1).メッセージ内容, result.回答);
  assert.ok(packets.every(p => p.セッションID === 'ui-session' && p.チャンネル === 'code1'));
});
test('非ゼロ終了は CAN 1バイトで1回終端通知する', async () => {
  const { コード要求実行, STREAM_CANCEL } = require('../out/protocol.cjs');
  const packets = [];
  await コード要求実行({ セッションID: 'ui-session', チャンネル: 'code1', メッセージ識別: 'input_text', メッセージ内容: 'テスト' }, {
    起動: { 実行ファイル: process.execPath, 引数: [fake, 'fail'] }, 作業フォルダ: root, 引数: [], 制限時間: 10000
  }, packet => packets.push(packet)).完了;
  assert.equal(packets.filter(packet => packet.メッセージ内容 === STREAM_CANCEL).length, 1);
  assert.equal(packets.filter(packet => packet.メッセージ識別 === 'output_stream').at(-1).メッセージ内容, STREAM_CANCEL);
});
