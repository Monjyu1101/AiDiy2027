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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { プロジェクトルート } from '../接続/接続設定';
import { 会話引数 } from '../共通連携/IDE連携';
import type { モデル初期情報 } from '../モデル情報/モデル情報';

// コードは aidiy_hermes 固定。モデルは aidiy_code / AIコアと同じ1つの文字列
// （auto / same / codex_cli/same / openai_oauth/gpt-… など）で扱う。Slack 版と同じ実装。
export type モデル候補 = { id: string; label: string };
/** 保存する code_name。現在の実行環境は aidiy_hermes だけ。将来は別のスタンドアロンハーネスも同じ欄で選べるようにする。 */
export const 既定コード名 = 'aidiy_hermes';
export const 対応コード名 = [既定コード名];
export function コード名検証(value: unknown): string {
  if (value === undefined) return 既定コード名; // code_name のない旧保存は aidiy_hermes とみなす。
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value.trim())) throw new Error('コード実行環境の指定が不正です。');
  return value.trim();
}
const 固定候補: モデル候補[] = [{ id: 'auto', label: 'auto（自動判定）' }, { id: 'same', label: 'same（変更なし）' }];
// AIコア（AIコード_cli.py の cli_providers）と同じ、外部 CLI の Hermes provider 名。
const 外部CLI: Record<string, string> = {
  copilot_cli: 'copilot-cli', claude_cli: 'claude-code', codex_cli: 'codex-cli',
  antigravity_cli: 'antigravity-cli', opencode_cli: 'opencode', grok_cli: 'grok-cli',
};

export function Hermesモデル検証(value: unknown): string {
  const model = typeof value === 'string' ? value.trim() : '';
  if (!model || model.length > 300 || /[\u0000-\u001f\u007f\s]/.test(model)) throw new Error('モデル指定が不正です。');
  return model;
}

/** モデル文字列を Hermes の起動引数にする。変換規則は AIコアの aidiy_hermes 実行と同じ。 */
export function Hermes会話引数(model: string, maxTurns: number, resume?: string): string[] {
  const value = model.trim();
  // 保存済みの provider / モデルを、非対話起動でも復元する。
  if (value.toLowerCase() === 'same') return [...会話引数('same', '', maxTurns, resume), '--model', 'same'];
  const [head, ...rest] = value.split('/'), tail = rest.join('/');
  if (rest.length && 外部CLI[head] && tail) return 会話引数(外部CLI[head], tail, maxTurns, resume);
  // OAuth 指定時は provider も明示し、認証切れを別 provider への退避で隠さない。
  const oauth = /^(openai_oauth|xai-oauth)\/(.+)$/.exec(value);
  if (oauth) return 会話引数(oauth[1], oauth[2], maxTurns, resume);
  return 会話引数('', value, maxTurns, resume);
}

/** 候補は AIコアのモデル情報APIを優先し、停止中は diag の code_models_info.json を読む。 */
export function Hermesモデル候補(api?: モデル初期情報, root = プロジェクトルート): モデル候補[] {
  let ids: string[] = [];
  const fromApi = api?.code?.aidiy_hermes;
  if (fromApi) ids = Object.keys(fromApi);
  else {
    try {
      const data = JSON.parse(readFileSync(resolve(root, '_AIDIY/aidiy_diag/code_models_info.json'), 'utf8'));
      const models = data?.aidiy_hermes?.models;
      if (models && typeof models === 'object' && !Array.isArray(models)) ids = Object.keys(models);
    } catch { /* 候補なしでも auto / same は選べる。 */ }
  }
  const rest = ids.filter(id => typeof id === 'string' && !['auto', 'same'].includes(id.toLowerCase()) && id.length <= 300);
  return [...固定候補, ...rest.map(id => ({ id, label: id }))];
}

/** 旧保存（{ provider, model }）を1つのモデル文字列へ移す。provider が空なら共通設定の値を使う。 */
export function 旧コードモデル変換(value: unknown, 既定: string): string {
  const data = value as { provider?: unknown; model?: unknown } | null;
  const provider = typeof data?.provider === 'string' ? data.provider.trim() : '';
  const model = typeof data?.model === 'string' ? data.model.trim() : '';
  if (!provider) return 既定;
  if (provider === 'same') return 'same';
  const cli = Object.entries(外部CLI).find(([, name]) => name === provider)?.[0];
  if (cli) return `${cli}/${model || 'same'}`;
  return model ? `${provider}/${model}` : 既定;
}
