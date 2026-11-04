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
import { 設定解析, 設定エラー, プロジェクトルート } from '../src/接続/接続設定';
import { defaults } from './helpers';

const parse = (patch: Record<string, unknown>) => 設定解析({ ...defaults, ...patch }, プロジェクトルート);

test('Slack の接続設定を読み、app token は使わない', () => {
  const config = parse({});
  assert.equal(config.botToken, 'xoxb-test-token');
  assert.equal(config.teamId, 'T0TESTTEAM1'); assert.equal(config.userId, 'U0TESTUSER1'); assert.equal(config.channelId, 'C0TESTCHAN1');
  assert.ok(!('appToken' in config));
  assert.equal(config.cli, 'aidiy_hermes');
});

test('仮設定・取り違え・不正IDを拒否し、実値をエラーに含めない', () => {
  for (const value of ['', 'x', '< your slack bot token >', 'xoxb-has space']) {
    assert.throws(() => parse({ slack_bot_token: value }), 設定エラー);
  }
  assert.throws(() => parse({ slack_bot_token: 'xapp-secret-value' }), (error: Error) => error instanceof 設定エラー && !error.message.includes('secret-value'));
  assert.throws(() => parse({ slack_team_id: '1557039216846970991' }), 設定エラー);
  assert.throws(() => parse({ slack_allowed_user_id: 'T0TESTTEAM1' }), 設定エラー);
  assert.throws(() => parse({ slack_text_channel_id: 'D0TESTDM001' }), 設定エラー);
  assert.throws(() => parse({ slack_text_channel_id: 123 }), 設定エラー);
});
