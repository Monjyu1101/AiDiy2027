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
import { 接続失敗案内, 接続エラー詳細 } from '../src/接続/接続エラー';

test('Hermes、Discord認証、Intent、通信の失敗を分けて案内する', () => {
  assert.match(接続失敗案内(new Error('Python が見つかりません。'), 'Hermes確認'), /Hermes用のPython/);
  assert.match(接続失敗案内({ code: 'TokenInvalid' }, 'Discord接続'), /トークン認証/);
  assert.match(接続失敗案内(new Error('Authentication failed'), 'Discord接続'), /トークン認証/);
  assert.match(接続失敗案内(new Error('Used disallowed intents'), 'Discord接続'), /Message Content Intent/);
  assert.match(接続失敗案内(new Error('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), 'Discord接続'), /タイムアウト/);
  assert.match(接続失敗案内(new Error('unknown'), 'Bot作成'), /Bot作成で失敗/);
});

test('段階、経過時間、コード、HTTP状態、入れ子の原因を表示し、認証情報と要求オブジェクトは出さない', () => {
  const token = 'test-token';
  const error = Object.assign(new Error(`request failed: ${token}; "api_key": "private-key"; password=private-password; https://user:pass@example.test`), {
    code: 'EFAIL', status: 401,
    request: { body: 'private-body' }, stack: 'private-stack',
    cause: new AggregateError([
      Object.assign(new Error('Authorization: Bearer private-bearer'), { code: 'ETIMEDOUT' }),
      new Error('Authorization: Bot private-bot'),
    ], 'connect failed'),
  });
  const details = 接続エラー詳細(error, 'Discord接続', token, 10200);
  for (const value of ['失敗段階: Discord接続', '経過: 10.2秒', '種類: Error', 'コード: EFAIL', 'HTTP状態: 401', 'connect failed', 'ETIMEDOUT', '[REDACTED]'])
    assert.ok(details.includes(value), value);
  assert.doesNotMatch(details, /test-token|private-|user:pass/);
});

test('循環参照・長文・文字列の例外でも詳細を安全に生成する', () => {
  const error = new Error('x'.repeat(3000));
  error.cause = error;
  assert.ok(接続エラー詳細(error, 'Discord接続').length < 1700);
  assert.match(接続エラー詳細('string exception', 'Discord接続'), /string exception/);
});

test('環境プロキシURLは認証なしの場合もログ・パネル詳細に表示しない', () => {
  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://private-proxy.example:8000';
  try {
    const details = 接続エラー詳細(new Error(`connect ${process.env.HTTPS_PROXY}`), 'Discord接続');
    assert.match(details, /\[REDACTED\]/); assert.doesNotMatch(details, /private-proxy/);
  } finally {
    if (previous === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = previous;
  }
});
