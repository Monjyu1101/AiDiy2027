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

import { 設定エラー } from './接続設定';

export type ライブ接続段階 = 'ボイス参加確認' | 'Discordボイス接続' | 'AIコア接続' | '音声中継' | 'LiveAI';
export type 接続段階 = '設定読込' | 'Hermes確認' | 'モデル確認' | 'Bot作成' | 'Discord接続' | '準備完了待ち' | ライブ接続段階;

export class ライブ接続エラー extends Error {
  readonly details: string;
  constructor(error: unknown, readonly stage: ライブ接続段階, token: string, elapsedMs = 0) {
    const details = 接続エラー詳細(error, stage, token, elapsedMs);
    super(`音声会話に接続できません（${stage}）。\n${details}`);
    this.name = 'ライブ接続エラー';
    this.details = details;
  }
}

// 要約は既知の原因を固定文へ変換し、詳細は必要な項目だけを伏せ字処理して表示する。
export function 接続失敗案内(error: unknown, stage: 接続段階): string {
  if (error instanceof 設定エラー) return error.message;
  const detail = error as { code?: unknown; status?: unknown; message?: unknown; cause?: unknown } | null;
  const message = typeof detail?.message === 'string' ? detail.message : '';
  if (stage === 'Hermes確認') {
    if (message.startsWith('Python が見つかりません。'))
      return 'Hermes用のPythonが見つかりません。command_hermes の仮想環境（.venv）をセットアップし直してください。';
    if (message.startsWith('aidiy_hermes が見つかりません。'))
      return 'aidiy_hermes が見つかりません。command_hermes のセットアップとランチャーのPATHを確認してください。';
    if (message.startsWith('この .cmd は AiDiy の起動形式ではありません。'))
      return 'Hermesの起動ランチャーが無効です。PythonやCLIの移動・削除がないか確認し、ランチャーを再登録してください。';
    return 'Hermesの起動パスを確認できません。command_hermes のセットアップを確認してください。';
  }
  if (detail?.code === 'TokenInvalid' || detail?.code === 50014 || detail?.status === 401 || message === 'Authentication failed')
    return 'DiscordのBotトークン認証に失敗しました。AiDiy_key.json の discord_bot_token を確認してください。';
  if (detail?.code === 'DisallowedIntents' || message === 'Used disallowed intents')
    return 'Discordで必要なIntentが許可されていません。Developer PortalのBot設定で Message Content Intent を有効にしてください。';
  if (message === 'Used invalid intents') return 'Discordに指定したIntentが無効です。BotのGateway設定を確認してください。';
  const network: Record<string, string> = {
    ENOTFOUND: 'Discordの接続先をDNSで解決できません。', EAI_AGAIN: 'Discordの接続先のDNS応答が得られません。',
    ECONNREFUSED: 'Discordへの通信が拒否されました。', ECONNRESET: 'Discordへの通信が途中で切断されました。',
    ETIMEDOUT: 'Discordへの通信がタイムアウトしました。', UND_ERR_CONNECT_TIMEOUT: 'Discordへの接続がタイムアウトしました。',
  };
  for (const value of [detail, detail?.cause as typeof detail]) {
    if (typeof value?.code === 'string' && Object.hasOwn(network, value.code))
      return `${network[value.code]} ネットワーク・プロキシ・ファイアウォールを確認してください。（${value.code}）`;
  }
  return `${stage}で失敗しました。既知のエラーに分類できませんでした。`;
}

export function 接続エラー詳細(error: unknown, stage: 接続段階, token = '', elapsedMs = 0): string {
  const redact = (value: string) => {
    for (const secret of [token, token ? encodeURIComponent(token) : '',
      ...['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY'].map(key => process.env[key] || '')]) {
      if (secret) value = value.split(secret).join('[REDACTED]');
    }
    return value
      .replace(/\b(?:Bot|Bearer)\s+[^\s"'<>]+/gi, '[REDACTED]')
      .replace(/\b(?:mfa\.[\w-]+|[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,})\b/g, '[REDACTED]')
      .replace(/\bsk-[\w-]+/g, '[REDACTED]')
      .replace(/((?:token|api[_-]?key|authorization|password)["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 1500);
  };
  const lines = [`失敗段階: ${stage}`, `経過: ${(elapsedMs / 1000).toFixed(1)}秒`];
  const seen = new Set<unknown>();
  const visit = (value: unknown, label: string, depth: number) => {
    if (typeof value === 'string' && depth <= 2) { lines.push(`${label}内容: ${redact(value)}`); return; }
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 2) return;
    seen.add(value);
    const data = value as Record<string, unknown>;
    for (const [key, name] of [['name', '種類'], ['code', 'コード'], ['status', 'HTTP状態'], ['message', '内容']]) {
      if (typeof data[key] === 'string' || typeof data[key] === 'number') lines.push(`${label}${name}: ${redact(String(data[key]))}`);
    }
    visit(data.cause, `${label}原因 / `, depth + 1);
    if (Array.isArray(data.errors)) data.errors.slice(0, 3).forEach((item, i) => visit(item, `${label}原因${i + 1} / `, depth + 1));
  };
  visit(error, '', 0);
  return lines.join('\n');
}
