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

import type { Discord設定 } from './接続設定';

export type コマンド = { name: 'chat' | 'live' | 'leave' | 'stop' | 'new' | 'status' | 'help'; text: string };
export const メンション禁止 = { parse: [] as ('users' | 'roles' | 'everyone')[], repliedUser: false };

export function コマンド解析(content: string, _prefix: string, botId: string): コマンド | undefined {
  // 先頭の空白は除去しない。文中や空白の後の ! は通常の文章。
  const bang = /^[!！]/.test(content);
  // Bot メンションは通常チャットの宛先だけ。旧コマンド経路は持たない。
  const trigger = [`<@${botId}>`, `<@!${botId}>`].find(value => content === value || content.startsWith(`${value} `) || content.startsWith(`${value}\n`));
  if (!bang) {
    const text = (trigger ? content.slice(trigger.length) : content).trim();
    return text ? { name: 'chat', text } : undefined;
  }
  const body = content.slice(1).trim();
  if (!body) return { name: 'help', text: '' };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(body)!;
  const name = match[1].toLowerCase();
  if (['chat', 'live', 'leave', 'stop', 'new', 'status', 'help'].includes(name)) return { name: name as コマンド['name'], text: (match[2] || '').trim() };
  return bang ? { name: 'help', text: '' } : { name: 'chat', text: body };
}

export function 利用許可(config: Discord設定, guildId: string | null, channelId: string, userId: string, bot = false): boolean {
  return !bot && guildId === config.guildId && channelId === config.textChannelId && userId === config.userId;
}

export function 会話キー(guildId: string, channelId: string, userId: string): string {
  return `${guildId}:${channelId}:${userId}`;
}

// Discord の2000文字制限をUTF-16単位で満たし、サロゲートペアを分断しない。
export function 本文分割(text: string, limit = 1900): string[] {
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
