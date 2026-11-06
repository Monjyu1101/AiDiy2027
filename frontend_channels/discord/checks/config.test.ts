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
import { resolve } from 'node:path';
import { 設定解析, プロジェクトルート } from '../src/接続/接続設定';
import { defaults } from './helpers';

test('PORT_CORE、共通モデル、作業フォルダを読み込み、元設定は変更しない', () => {
  const data = { ...defaults, PORT_CORE: '18091', CODE_BASE_PATH: '../frontend_ide/host', LIVE_AI_NAME: 'openai_live',
    CODE_AIDIY_HERMES_MODEL: 'openai_oauth/gpt-6.1-sol', CODE_MAX_TURNS: 999 };
  const before = JSON.stringify(data);
  const result = 設定解析(data);
  assert.equal(new URL(result.coreUrl).port, '18091');
  assert.equal(decodeURI(new URL(result.coreUrl).pathname), '/core/ws/AIコア');
  assert.equal(result.folder, resolve(プロジェクトルート, 'frontend_ide/host'));
  assert.equal(result.liveModels.LIVE_AI_NAME, 'openai_live');
  assert.equal(JSON.stringify(data), before);
  assert.equal(result.hermesModel, 'openai_oauth/gpt-6.1-sol');
  assert.equal(result.maxTurns, 999);
});

test('未設定・不正ID・空の許可範囲・不正な共通設定を拒否し秘密値をエラーに出さない', () => {
  for (const change of [
    { discord_bot_token: '' }, { discord_guild_id: '' }, { discord_allowed_user_id: '' },
    { discord_allowed_user_id: 222222222222222222 }, { discord_text_channel_id: [] },
    { discord_voice_channel_id: '' }, { discord_allowed_user_id: ['222222222222222222'] },
    { PORT_CORE: 'secret-value' }, { PORT_CORE: 65536 }, { PORT_CORE: true },
    { CODE_MAX_TURNS: 0 }, { CODE_MAX_TURNS: true },
    { CODE_BASE_PATH: './does-not-exist-secret-value' }, { CODE_AIDIY_HERMES_MODEL: 123 },
    { LIVE_AI_NAME: 123 },
  ]) {
    assert.throws(() => 設定解析({ ...defaults, ...change }), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes('secret-value')); return true;
    });
  }
  const parsed = 設定解析(defaults);
  assert.equal(parsed.userId, defaults.discord_allowed_user_id);
  assert.equal(parsed.textChannelId, defaults.discord_text_channel_id);
  assert.equal(parsed.voiceChannelId, defaults.discord_voice_channel_id);
});

test('空欄・1文字・< で始まるトークンの仮設定を拒否する', () => {
  for (const token of ['', '   ', '<', '>', '(', ')', '[', ']', '{', '}', 'a', '<secret-placeholder>', '  <secret-placeholder  ']) {
    assert.throws(() => 設定解析({ ...defaults, discord_bot_token: token }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /discord_bot_token/);
      assert.doesNotMatch(error.message, /secret-placeholder/);
      return true;
    });
  }
});

test('全Liveベンダーで共通設定を使い、廃止したDiscord設定では上書きしない', () => {
  for (const [name, prefix] of [['freeai_live', 'FREEAI'], ['gemini_live', 'GEMINI'], ['openai_live', 'OPENAI']]) {
    const data = { ...defaults, LIVE_AI_NAME: name, [`LIVE_${prefix}_MODEL`]: 'common-model', [`LIVE_${prefix}_VOICE`]: 'common-voice',
      DISCORD_LIVE_AI_NAME: 'old-provider', DISCORD_LIVE_MODEL: 'old-model', DISCORD_LIVE_VOICE: 'old-voice',
      DISCORD_CORE_URL: 'http://old-host:9999', DISCORD_CODE_BASE_PATH: './old-folder',
      DISCORD_CODE_CLI: 'old-cli', DISCORD_CODE_PYTHON: 'old-python', DISCORD_COMMAND_PREFIX: '!old',
      DISCORD_CODE_PROVIDER: 'old-provider', DISCORD_CODE_MODEL: 'old-model', DISCORD_CODE_MAX_TURNS: 1,
      DISCORD_CODE_TIMEOUT_SECONDS: 1 };
    const before = JSON.stringify(data);
    const result = 設定解析(data);
    assert.equal(result.liveModels.LIVE_AI_NAME, name);
    assert.equal(result.liveModels[`LIVE_${prefix}_MODEL`], 'common-model');
    assert.equal(result.liveModels[`LIVE_${prefix}_VOICE`], 'common-voice');
    const baseline = 設定解析(defaults);
    for (const key of ['coreUrl', 'folder', 'cli', 'python', 'prefix', 'hermesModel', 'maxTurns', 'timeoutMs'] as const) {
      assert.equal(result[key], baseline[key]);
    }
    assert.equal(JSON.stringify(data), before);
  }
  assert.equal(設定解析({ ...defaults, CODE_AIDIY_HERMES_MODEL: 'freeai/gemini-test' }).hermesModel, 'freeai/gemini-test');
  assert.equal(設定解析({ ...defaults, CODE_AIDIY_HERMES_MODEL: '' }).hermesModel, 'auto', '未設定は auto');
});

test('共通Slack5欄はDiscord解析結果に混入せず入力も変更しない', () => {
  const data = {...defaults, slack_bot_token:'slack-bot-fixture', slack_app_token:'slack-app-fixture',
    slack_team_id:'T123', slack_allowed_user_id:'U123', slack_text_channel_id:'C123'};
  const before = JSON.stringify(data);
  assert.deepEqual(設定解析(data), 設定解析(defaults));
  assert.equal(JSON.stringify(data), before);
});

test('Slack欄だけではDiscord認証・許可範囲を代替しない', () => {
  assert.throws(() => 設定解析({slack_bot_token:'slack-bot-fixture', slack_app_token:'slack-app-fixture',
    slack_team_id:'T123', slack_allowed_user_id:'U123', slack_text_channel_id:'C123'}), /discord_bot_token/);
});

test('未設定契約: null・undefined・空白だけのtokenを拒否する', () => {
  for (const token of [null, undefined, '', ' ', '\t\n']) {
    assert.throws(() => 設定解析({...defaults, discord_bot_token:token}), /discord_bot_token/);
  }
});

test('未設定契約: tokenの非文字列・内部空白は秘密を出さず拒否する', () => {
  for (const token of [123, false, [], {}, 'fixture secret', 'fixture\tsecret', 'fixture\nsecret']) {
    assert.throws(() => 設定解析({...defaults, discord_bot_token:token}), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /fixture|secret/);
      return true;
    });
  }
});

test('未設定契約: trim後の1文字・仮設定先頭を拒否する', () => {
  for (const token of [' x ', ' < fixture-token > ', '<fixture-token']) {
    assert.throws(() => 設定解析({...defaults, discord_bot_token:token}), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /fixture-token/);
      return true;
    });
  }
});

test('有効tokenの外側空白だけは除去しSlackの空欄は影響させない', () => {
  const result = 設定解析({...defaults, discord_bot_token:'  fixture-token  ', slack_bot_token:'', slack_app_token:null});
  assert.equal(result.token, 'fixture-token');
});
