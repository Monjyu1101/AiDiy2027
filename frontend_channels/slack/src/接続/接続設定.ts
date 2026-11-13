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

import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const プロジェクトルート = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const 設定ファイル = resolve(プロジェクトルート, '_config/AiDiy_key.json');

export interface Slack設定 {
  botToken: string; teamId: string; userId: string; channelId: string;
  coreUrl: string; coreRoot?: string; folder: string; cli: string; python: string;
  /** aidiy_hermes のモデル（auto / same / openai_oauth/gpt-… など）。 */
  hermesModel: string; piModel?: string; maxTurns: number; timeoutMs: number;
}
export class 設定エラー extends Error {}

export function 設定解析(data: Record<string, unknown>, root = プロジェクトルート): Slack設定 {
  const text = (key: string, fallback = '') => {
    const value = data[key] ?? fallback;
    if (typeof value !== 'string') throw new 設定エラー(`${key} は文字列で指定してください。`);
    return value.trim();
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = data[key] ?? fallback;
    const value = typeof raw === 'number' || typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < min || value > max) throw new 設定エラー(`${key} は ${min}～${max} の整数で指定してください。`);
    return value;
  };
  // 実値はエラー文へ埋め込まない。app token との取り違えは接頭辞で早期に止める。
  // 受信は Web API の定期取得で行うため、Socket Mode 用の slack_app_token は読まない。
  const token = (key: string, prefix: string, label: string) => {
    const value = text(key);
    if (value.length <= 1 || value.startsWith('<') || /\s/.test(value)) {
      throw new 設定エラー(`_config/AiDiy_key.json の ${key} に ${label} を設定してください（空欄・1文字・< で始まる仮設定は使用できません）。`);
    }
    if (!value.startsWith(prefix)) throw new 設定エラー(`${key} には ${prefix} で始まる ${label} を設定してください。`);
    return value;
  };
  // Slack の ID は英大文字と数字。Discord の数値 ID 規則は使わない。
  const id = (key: string, pattern: RegExp, label: string) => {
    const value = text(key);
    if (!pattern.test(value)) throw new 設定エラー(`${key} に1つの Slack ${label} ID を文字列で設定してください。`);
    return value;
  };
  const botToken = token('slack_bot_token', 'xoxb-', 'Bot User OAuth Token');
  const teamId = id('slack_team_id', /^T[A-Z0-9]{8,}$/, 'ワークスペース');
  const userId = id('slack_allowed_user_id', /^[UW][A-Z0-9]{8,}$/, 'ユーザー');
  const channelId = id('slack_text_channel_id', /^C[A-Z0-9]{8,}$/, 'パブリックチャンネル');
  // パネルのコードモデル候補は AIコアのモデル情報APIを優先する（停止中はファイル候補へ戻る）。
  const coreUrl = `http://127.0.0.1:${integer('PORT_CORE', 8091, 1, 65535)}/`;
  const folder = resolve(root, 'backend_server', text('CODE_BASE_PATH') || '../');
  try { if (!statSync(folder).isDirectory()) throw new Error(); }
  catch { throw new 設定エラー('CODE_BASE_PATH の作業フォルダが存在しません。'); }
  // 引数への変換（OAuth の provider 明示など）は コード/Hermesモデル.ts の Hermes会話引数 で行う。
  const hermesModel = text('CODE_AIDIY_HERMES_MODEL') || 'auto';
  return {
    botToken, teamId, userId, channelId, coreUrl, coreRoot: root, folder,
    cli: 'aidiy_hermes', python: '',
    hermesModel, piModel: text('CODE_AIDIY_PI_MODEL') || 'auto',
    maxTurns: integer('CODE_MAX_TURNS', 999, 1, Number.MAX_SAFE_INTEGER), timeoutMs: 900_000,
  };
}

export function 設定読込(path = 設定ファイル): Slack設定 {
  let data: unknown;
  try { data = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')); }
  catch { throw new 設定エラー('_config/AiDiy_key.json を UTF-8 の JSON オブジェクトとして読み込めません。'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new 設定エラー('AiDiy_key.json のルートは JSON オブジェクトにしてください。');
  return 設定解析(data as Record<string, unknown>, resolve(dirname(path), '..'));
}
