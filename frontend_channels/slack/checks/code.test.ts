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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Code接続 } from '../src/コード/コード会話';
import { config } from './helpers';

const launch = { 実行ファイル: process.execPath, 引数: [fileURLToPath(new URL('./fake-cli.cjs', import.meta.url))] };
test('VS Code と共通のCLIでstdinを渡し、スレッドごとに会話を継続・リセットする', async () => {
  const settings = config();
  const code = new Code接続(settings, launch);
  try {
    const text = '日本語 & | " ` $() %PATH%\n';
    const first = JSON.parse(await code.実行('team:channel:1.0', text));
    assert.equal(first.input, text); assert.equal(first.cwd, settings.folder);
    assert.ok(first.args.includes('--oneshot-stdin'));
    const second = JSON.parse(await code.実行('team:channel:1.0', '続き'));
    assert.ok(second.args.includes('--resume')); assert.ok(second.args.includes('slack-test-session'));
    assert.ok(!JSON.parse(await code.実行('team:channel:2.0', '別スレッド')).args.includes('--resume'));
    code.リセット('team:channel:1.0');
    assert.ok(!JSON.parse(await code.実行('team:channel:1.0', '新規')).args.includes('--resume'));
  } finally { await code.終了(); }
});

test('二重実行を拒否し、停止・終了でCLIを回収する', { timeout: 10000 }, async () => {
  const code = new Code接続(config(), launch);
  try {
    const pending = code.実行('one', 'wait');
    await assert.rejects(code.実行('one', '二重'), /実行中/);
    code.停止('one'); assert.match(await pending, /停止/);
    const second = code.実行('two', 'wait');
    await code.終了(); assert.match(await second, /終了/);
    await assert.rejects(code.実行('one', '終了後'), /終了処理/);
  } finally { await code.終了(); }
});
