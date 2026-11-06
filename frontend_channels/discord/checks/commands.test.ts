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
import { コマンド解析, 利用許可, 会話キー, 本文分割, メンション禁止 } from '../src/接続/コマンド処理';
import { config, guildId, textId, userId, botId } from './helpers';

test('通常の文章とBotメンションはチャットにし、旧形式はhelpにする', () => {
  assert.deepEqual(コマンド解析('!aidiy 日本語で説明\nしてください', '!aidiy', botId), { name: 'help', text: '' });
  assert.deepEqual(コマンド解析(`<@!${botId}> live こんにちは`, '!aidiy', botId), { name: 'chat', text: 'live こんにちは' });
  assert.deepEqual(コマンド解析('!aidiy-extra live', '!aidiy', botId), { name: 'help', text: '' });
  assert.deepEqual(コマンド解析('雑談です', '!aidiy', botId), { name: 'chat', text: '雑談です' });
  assert.deepEqual(コマンド解析('stop', '!aidiy', botId), { name: 'chat', text: 'stop' });
  assert.equal(コマンド解析(' \n ', '!aidiy', botId), undefined);
  assert.equal(コマンド解析('!aidiy', '!aidiy', botId)?.name, 'help');
});

test('DM・他サーバー・非許可チャンネル/ユーザー・Bot を拒否する', () => {
  const value = config();
  assert.equal(利用許可(value, guildId, textId, userId), true);
  for (const [guild, channel, user, bot] of [[null, textId, userId, false], ['other', textId, userId, false], [guildId, 'other', userId, false], [guildId, textId, 'other', false], [guildId, textId, userId, true]] as const) {
    assert.equal(利用許可(value, guild, channel, user, bot), false);
  }
  assert.notEqual(会話キー(guildId, textId, userId), 会話キー(guildId, 'other', userId));
  assert.notEqual(会話キー(guildId, textId, userId), 会話キー(guildId, textId, 'other'));
  assert.deepEqual(メンション禁止, { parse: [], repliedUser: false });
});

test('日本語と絵文字の長文をDiscordの制限内で欠落なく分割する', () => {
  const text = 'a'.repeat(1899) + '😀日本語\n'.repeat(2000);
  const parts = 本文分割(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.length <= 1900 && !/[\uD800-\uDBFF]$/.test(part)));
});

test('半角・全角の先頭短縮コマンドだけを操作にする', () => {
  for (const prefix of ['!', '！']) {
    for (const name of ['help', 'status', 'stop', 'new', 'chat', 'live', 'leave']) assert.deepEqual(コマンド解析(`${prefix}${name} 本文`, '!aidiy', botId), { name, text: '本文' });
    for (const body of ['', 'typo', 'newer', '!new']) assert.deepEqual(コマンド解析(prefix + body, '!aidiy', botId), { name: 'help', text: '' });
  }
  for (const text of [' !new', '\t！stop', '\n!help', '説明 !new', '通常！help']) assert.deepEqual(コマンド解析(text, '!aidiy', botId), { name: 'chat', text: text.trim() });
  assert.deepEqual(コマンド解析('！ \tNEW\n', '!aidiy', botId), { name: 'new', text: '' });
  assert.deepEqual(コマンド解析(`<@${botId}> 説明`, '!aidiy', botId), { name: 'chat', text: '説明' });
});

test('旧形式は未知コマンド扱いで、メンションは操作を実行しない', () => {
  for (const prefix of ['!aidiy ', '！aidiy ']) for (const name of ['new', 'stop', 'status', 'chat', 'help', 'live', 'leave']) {
    assert.deepEqual(コマンド解析(prefix + name, '!aidiy', botId), { name: 'help', text: '' });
  }
  for (const name of ['new', 'stop', 'status', 'chat', 'help', 'live', 'leave']) {
    assert.deepEqual(コマンド解析(`<@${botId}> ${name}`, '!aidiy', botId), { name: 'chat', text: name });
  }
});
