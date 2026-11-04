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
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { プロジェクトルート } from '../src/接続/接続設定';
import { defaults } from './helpers';

test('起動（自動接続・--no-connect）は無効なトークンを Electron 起動前に検出し、終了コード1で止まる', { timeout: 120_000 }, () => {
  // 実際のキーには触れず、起動コードと設定検証を一時作業コピーで実行する。
  const root = mkdtempSync(join(tmpdir(), 'aidiy-slack-preflight-'));
  const source = join(プロジェクトルート, 'frontend_channels/slack'), slack = join(root, 'frontend_channels/slack');
  try {
    mkdirSync(join(slack, 'panel'), { recursive: true });
    mkdirSync(join(root, '_config'));
    cpSync(join(source, 'src'), join(slack, 'src'), { recursive: true });
    cpSync(join(source, 'panel/launch.mjs'), join(slack, 'panel/launch.mjs'));
    writeFileSync(join(slack, 'package.json'), '{"type":"module"}');
    for (const name of ['tsx', 'undici', 'ws']) {
      const target = join(slack, 'node_modules', name);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(join(source, 'node_modules', name), target, 'junction');
    }
    mkdirSync(join(root, 'frontend_ide'));
    symlinkSync(join(プロジェクトルート, 'frontend_ide/host'), join(root, 'frontend_ide/host'), 'junction');
    for (const args of [[], ['--connect'], ['--no-connect']]) {
      for (const token of ['', '<', '<secret-placeholder>', 'xapp-secret-placeholder']) {
        writeFileSync(join(root, '_config/AiDiy_key.json'), JSON.stringify({ ...defaults, slack_bot_token: token }));
        const result = spawnSync(process.execPath, [join(slack, 'panel/launch.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8', timeout: 60_000, windowsHide: true });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /slack_bot_token/);
        assert.doesNotMatch(result.stderr, /secret-placeholder|Electron|パネルの表示/);
        assert.equal(existsSync(join(root, 'temp')), false, '設定検証に失敗したら一時ログ・完了通知も作らない');
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
