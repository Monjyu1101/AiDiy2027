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
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { 起動ロック } = require('../scripts/single-instance.cjs');

test('同時再実行を拒否し、既存画面の再表示通知を送る', async t => {
  let repeated = 0;
  const owner = await 起動ロック('aidiy_live', () => { repeated++; }, 0);
  t.after(() => owner.close());
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => 起動ロック('aidiy_live', undefined, owner.port)));
  assert.deepEqual(duplicates, Array(8).fill(null));
  assert.equal(repeated, 8);
});

test('終了後は再起動できる', async t => {
  const owner = await 起動ロック('aidiy_discord', undefined, 0);
  const port = owner.port;
  await owner.close();
  const next = await 起動ロック('aidiy_discord', undefined, port);
  t.after(() => next.close());
  assert.ok(next);
});

test('所有プロセスを強制終了しても残留ロックがない', async t => {
  const modulePath = require.resolve('../scripts/single-instance.cjs');
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).起動ロック('aidiy_live', undefined, 0).then(lock => process.send(lock.port));`],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const [port] = await once(child, 'message');
  assert.equal(await 起動ロック('aidiy_live', undefined, port), null);
  const exited = once(child, 'exit'); child.kill(); await exited;
  const next = await 起動ロック('aidiy_live', undefined, port);
  t.after(() => next.close());
  assert.ok(next);
});

test('別アプリの待受は起動済みとして扱わない', async t => {
  const owner = await 起動ロック('aidiy_discord', undefined, 0);
  t.after(() => owner.close());
  await assert.rejects(起動ロック('aidiy_live', undefined, owner.port), /別のプログラム/);
});
