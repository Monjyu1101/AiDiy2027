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

import type { Slack設定 } from './接続設定';

export type コマンド = { name: 'chat' | 'stop' | 'new' | 'status' | 'help'; text: string };
export type Slackメッセージ = {
  type?: unknown; subtype?: unknown; user?: unknown; bot_id?: unknown; app_id?: unknown;
  text?: unknown; ts?: unknown; thread_ts?: unknown; team?: unknown;
};

export function コマンド解析(content: string, _prefix: string, botUserId: string): コマンド | undefined {
  const bang = /^[!！]/.test(content);
  // Bot メンションは通常チャットの宛先だけ。旧コマンド経路は持たない。
  const trigger = [`<@${botUserId}>`].find(value => content === value || content.startsWith(`${value} `) || content.startsWith(`${value}\n`));
  if (!bang) {
    const text = (trigger ? content.slice(trigger.length) : content).trim();
    return text ? { name: 'chat', text } : undefined;
  }
  const body = content.slice(1).trim();
  if (!body) return { name: 'help', text: '' };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(body)!;
  const name = match[1].toLowerCase();
  if (['chat', 'stop', 'new', 'status', 'help'].includes(name)) return { name: name as コマンド['name'], text: (match[2] || '').trim() };
  return bang ? { name: 'help', text: '' } : { name: 'chat', text: body };
}

// subtype 付き（参加通知・編集・削除・スレッドのチャンネル同時投稿など）と Bot 投稿は入力にしない。
export function 利用許可(config: Slack設定, message: Slackメッセージ): message is Slackメッセージ & { user: string; text: string; ts: string } {
  if (message.type !== 'message' || message.subtype !== undefined || message.bot_id !== undefined || message.app_id !== undefined) return false;
  if (typeof message.ts !== 'string' || typeof message.text !== 'string' || message.user !== config.userId) return false;
  // team は省略されることがある。値がある場合だけ固定ワークスペースと照合する。
  return message.team === undefined || message.team === config.teamId;
}

export function 会話キー(teamId: string, channelId: string, threadTs: string): string {
  return `${teamId}:${channelId}:${threadTs}`;
}

/** Slack の ts（秒.マイクロ秒）を桁落ちなく比較する。 */
export function ts比較(a: string, b: string): number {
  const value = (ts: string) => {
    const [sec, micro = ''] = ts.split('.');
    return BigInt(sec) * 1_000_000n + BigInt(`${micro}000000`.slice(0, 6));
  };
  const x = value(a), y = value(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// Slack の記号エスケープを戻し、Hermes へは利用者が書いた文字列として渡す。
export function 本文復元(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// 送信時は <!channel> 等の一斉通知やリンク解釈を起こさないよう、制御文字だけをエスケープする。
export function 本文エスケープ(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 1投稿を読みやすい長さに抑え、サロゲートペアを分断しない。
export function 本文分割(text: string, limit = 3500): string[] {
  if (limit < 2) throw new Error('分割上限は2文字以上にしてください。');
  const parts: string[] = [];
  let current = '';
  for (const char of text) {
    if (current.length + char.length > limit) { parts.push(current); current = ''; }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}
