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

export interface Discord設定 {
  token: string; guildId: string; userId: string; textChannelId: string; voiceChannelId: string;
  prefix: string; coreUrl: string; coreRoot?: string; folder: string; cli: string; python: string;
  /** aidiy_hermes のモデル（auto / same / openai_oauth/gpt-… など）。 */
  hermesModel: string; piModel?: string; maxTurns: number; timeoutMs: number; liveModels: Record<string, string>;
  /** 接続制御。省略時は両方 ON。パネルの設定（Live は切替可、Code は ON 固定）で上書きする。 */
  liveEnabled?: boolean; codeEnabled?: boolean;
}
export class 設定エラー extends Error {}

export function 設定解析(data: Record<string, unknown>, root = プロジェクトルート): Discord設定 {
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
  const token = text('discord_bot_token');
  if (token.length <= 1 || token.startsWith('<') || /\s/.test(token)) {
    throw new 設定エラー('_config/AiDiy_key.json の discord_bot_token に Bot トークンを設定してください（空欄・1文字・< で始まる仮設定は使用できません）。');
  }
  const id = (key: string) => {
    const value = text(key);
    if (!/^\d{17,20}$/.test(value)) throw new 設定エラー(`${key} に1つの Discord ID を文字列で設定してください。`);
    return value;
  };
  const guildId = id('discord_guild_id');
  const userId = id('discord_allowed_user_id');
  const textChannelId = id('discord_text_channel_id');
  const voiceChannelId = id('discord_voice_channel_id');
  const port = integer('PORT_CORE', 8091, 1, 65535);
  const url = new URL(`ws://127.0.0.1:${port}`);
  url.pathname = '/core/ws/AIコア';
  const folder = resolve(root, 'backend_server', text('CODE_BASE_PATH') || '../');
  try { if (!statSync(folder).isDirectory()) throw new Error(); }
  catch { throw new 設定エラー('CODE_BASE_PATH の作業フォルダが存在しません。'); }
  const liveModels: Record<string, string> = {};
  for (const key of ['LIVE_AI_NAME', 'LIVE_GEMINI_MODEL', 'LIVE_GEMINI_VOICE', 'LIVE_FREEAI_MODEL', 'LIVE_FREEAI_VOICE', 'LIVE_OPENAI_MODEL', 'LIVE_OPENAI_VOICE']) {
    const value = text(key);
    if (value) liveModels[key] = value;
  }
  // 引数への変換（OAuth の provider 明示など）は コード/Hermesモデル.ts の Hermes会話引数 で行う。
  const hermesModel = text('CODE_AIDIY_HERMES_MODEL') || 'auto';
  return {
    token, guildId, userId, textChannelId, voiceChannelId, prefix: '!aidiy', coreUrl: url.href, coreRoot: root, folder, liveModels,
    cli: 'aidiy_hermes', python: '',
    hermesModel, piModel: text('CODE_AIDIY_PI_MODEL') || 'auto',
    maxTurns: integer('CODE_MAX_TURNS', 999, 1, Number.MAX_SAFE_INTEGER), timeoutMs: 900_000,
  };
}

export function 設定読込(path = 設定ファイル): Discord設定 {
  let data: unknown;
  try { data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new 設定エラー('_config/AiDiy_key.json を UTF-8 の JSON オブジェクトとして読み込めません。'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new 設定エラー('AiDiy_key.json のルートは JSON オブジェクトにしてください。');
  return 設定解析(data as Record<string, unknown>, resolve(dirname(path), '..'));
}
