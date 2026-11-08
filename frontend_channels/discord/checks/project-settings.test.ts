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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { パネル設定保存先, パネルプロジェクト, パネル設定保存, パネル設定読込 } from '../src/接続パネル/パネル設定';
import { プロジェクトルート } from '../src/接続/接続設定';

test('空プロジェクトはAiDiyルート、相対プロジェクトはAiDiyルート基準の保存先になる', () => {
  assert.equal(パネルプロジェクト(''), プロジェクトルート);
  assert.equal(パネル設定保存先(''), join(プロジェクトルート, '_AIDIY', 'aidiy_discord', 'aidiy_discord.json'));
  assert.equal(パネル設定保存先('work/demo'), join(プロジェクトルート, 'work/demo', '_AIDIY', 'aidiy_discord', 'aidiy_discord.json'));
});

test('プロジェクト間の設定を分離し、未保存・破損時も旧設定へ退避しない', () => {
  const root = mkdtempSync(join(tmpdir(), 'aidiy-discord-storage-'));
  try {
    const a = パネル設定保存先(join(root, 'A'));
    const b = パネル設定保存先(join(root, 'B'));
    パネル設定保存({ live: false, live_models: {}, code_name: 'aidiy_hermes', code_model: 'same' }, a);
    assert.equal(パネル設定読込('auto', b), undefined);
    パネル設定保存({ live: false, live_models: {}, code_name: 'aidiy_hermes', code_model: 'auto' }, b);
    assert.equal(パネル設定読込('auto', a)?.code_model, 'same');
    assert.equal(パネル設定読込('same', b)?.code_model, 'auto');
    const legacy = join(root, 'A', '_AIDIY', 'aidiy_discord', 'aidiy_discord_code_model.json');
    writeFileSync(legacy, '{"provider":"codex-cli","model":"old"}');
    writeFileSync(a, '{broken');
    assert.equal(パネル設定読込('auto', a), undefined);
    assert.equal(readFileSync(a, 'utf8'), '{broken');
    assert.equal(existsSync(legacy), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
