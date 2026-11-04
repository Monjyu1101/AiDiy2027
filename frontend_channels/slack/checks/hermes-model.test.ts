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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hermes会話引数, Hermesモデル候補, Hermesモデル検証, 旧コードモデル変換 } from '../src/コード/Hermesモデル';

// AIコア（AIコード_cli.py）の aidiy_hermes 実行と同じ引数になること。
test('モデル文字列を AIコアと同じ規則で Hermes の起動引数にする', () => {
  const tail = (model: string) => Hermes会話引数(model, 5).slice(4);
  assert.deepEqual(tail('auto'), []);
  assert.deepEqual(tail('same'), ['--provider', 'same', '--model', 'same']);
  assert.deepEqual(tail('codex_cli/same'), ['--provider', 'codex-cli']);
  assert.deepEqual(tail('claude_cli/sonnet'), ['--provider', 'claude-code', '--model', 'sonnet']);
  assert.deepEqual(tail('openai_oauth/gpt-6.1-sol'), ['--provider', 'openai_oauth', '--model', 'gpt-6.1-sol']);
  assert.deepEqual(tail('freeai/gemini-test'), ['--model', 'freeai/gemini-test']);
  assert.deepEqual(Hermes会話引数('same', 5, 'session-1').slice(-4), ['--resume', 'session-1', '--model', 'same']);
  for (const bad of ['', ' ', 'a b', 'x'.repeat(301), 1, undefined]) assert.throws(() => Hermesモデル検証(bad));
});

test('候補は auto / same を先頭に、AIコア停止時は diag の候補ファイルを読む', () => {
  const api = { settings: {}, chat: {}, code: { aidiy_hermes: { auto: 'a', same: 's', 'openai_oauth/gpt-x': 'x' } } } as never;
  assert.deepEqual(Hermesモデル候補(api).map(item => item.id), ['auto', 'same', 'openai_oauth/gpt-x']);
  const root = mkdtempSync(join(tmpdir(), 'aidiy-hermes-models-'));
  try {
    assert.deepEqual(Hermesモデル候補(undefined, root).map(item => item.id), ['auto', 'same']);
    mkdirSync(join(root, '_AIDIY/aidiy_diag'), { recursive: true });
    writeFileSync(join(root, '_AIDIY/aidiy_diag/code_models_info.json'), JSON.stringify({ aidiy_hermes: { models: { 'codex_cli/same': 'c' } } }));
    assert.deepEqual(Hermesモデル候補(undefined, root).map(item => item.id), ['auto', 'same', 'codex_cli/same']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('旧形式（provider / model）を1つのモデル文字列へ移す', () => {
  assert.equal(旧コードモデル変換({ provider: '', model: '' }, 'auto'), 'auto');
  assert.equal(旧コードモデル変換({ provider: 'codex-cli', model: 'gpt-x' }, 'auto'), 'codex_cli/gpt-x');
  assert.equal(旧コードモデル変換({ provider: 'claude-code', model: '' }, 'auto'), 'claude_cli/same');
  assert.equal(旧コードモデル変換({ provider: 'openai_oauth', model: 'gpt-6.1-sol' }, 'auto'), 'openai_oauth/gpt-6.1-sol');
  assert.equal(旧コードモデル変換(undefined, 'same'), 'same');
});
