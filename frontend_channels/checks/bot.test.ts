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
import { EventEmitter } from 'node:events';
import { ChannelType, Events, type Client, type Message, type VoiceChannel } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { DiscordBot, 回答送信 } from '../src/接続/Bot接続';
import { Code接続 } from '../src/コード/コード会話';
import { ライブ接続エラー } from '../src/接続/接続エラー';
import { config, guildId, textId, voiceId, userId, botId, waitFor } from './helpers';

function fixture(inVoice = true) {
  const sent: any[] = [];
  const textChannel = { id: textId, guildId, isSendable: () => true, isTextBased: () => true, sendTyping: async () => {}, send: async (data: unknown) => { sent.push(data); } };
  const guild = { id: guildId, channels: { cache: new Map() }, members: { me: {} } };
  const channel = { id: voiceId, type: ChannelType.GuildVoice, guild, members: new Map(inVoice ? [[userId, { id: userId, user: { bot: false } }]] : []), permissionsFor: () => ({ has: () => true }) } as unknown as VoiceChannel;
  guild.channels.cache.set(voiceId, channel);
  const client = Object.assign(new EventEmitter(), { user: { id: botId }, guilds: { cache: new Map([[guildId, guild]]) },
    channels: { fetch: async () => textChannel }, destroy: async () => {} }) as unknown as Client;
  const message = (content: string, overrides: Record<string, unknown> = {}) => ({
    content, guildId, channelId: textId, author: { id: userId, bot: false },
    member: { voice: { channel, channelId: voiceId } }, guild: { members: { me: {} } },
    channel: textChannel,
    reply: async (data: unknown) => { sent.push(data); }, ...overrides,
  }) as unknown as Message;
  const voiceChange = (from: string | null, to: string | null, id = userId, server = guildId) => {
    if (server === guildId) {
      if (to === voiceId) channel.members.set(id, { id, user: { bot: false } } as any);
      else channel.members.delete(id);
    }
    client.emit(Events.VoiceStateUpdate, { id, guild: { id: server }, channelId: from } as any, { id, guild: { id: server }, channelId: to } as any);
  };
  return { client, channel, sent, message, voiceChange, textChannel };
}

test('REST待ちの音声接続準備があってもGatewayを切断し、終了後に音声接続を再開しない', async () => {
  const f = fixture(); let release!: (value: any) => void, fetched = false, destroyed = 0, started = 0;
  f.client.channels.fetch = (() => { fetched = true; return new Promise(resolve => { release = resolve; }); }) as any;
  f.client.destroy = async () => { destroyed++; };
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel) => {
    started++; return { channel, 接続: async () => {}, 終了: () => {}, テキスト送信: () => {} };
  });
  f.client.emit(Events.ClientReady, f.client as any);
  await waitFor(() => fetched);
  const stopped = bot.終了(); assert.equal(bot.終了(), stopped);
  await stopped;
  assert.equal(destroyed, 1); assert.equal(started, 0);
  release(f.textChannel); await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 0);
});

test('コード終了が遅れても音声とGatewayを先に切断し、同時終了は同じ完了を待つ', async () => {
  const f = fixture(); let finish!: () => void, voiceStopped = 0, destroyed = 0;
  const code = { 終了: () => new Promise<void>(resolve => { finish = resolve; }) } as Code接続;
  f.client.destroy = async () => { destroyed++; };
  const bot = new DiscordBot(config(), f.client, code, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => {}, 終了: () => { voiceStopped++; closed(); }, テキスト送信: () => {},
  }));
  await bot.メッセージ受信(f.message('!live'));
  const stopped = bot.終了(); let completed = false; void stopped.then(() => { completed = true; });
  assert.equal(bot.終了(), stopped);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(voiceStopped, 1); assert.equal(destroyed, 1); assert.equal(completed, false);
  finish(); await stopped;
});

test('受信からHermes実行・回答まで動作し、非許可要求では実行・返信しない', async () => {
  const f = fixture();
  const code = new Code接続(config(), { 実行ファイル: process.execPath, 引数: [fileURLToPath(new URL('./fake-cli.cjs', import.meta.url))] });
  const bot = new DiscordBot(config(), f.client, code);
  try {
    await bot.メッセージ受信(f.message('こんにちは', { guildId: null }));
    await bot.メッセージ受信(f.message('こんにちは', { author: { id: 'other', bot: false } }));
    await bot.メッセージ受信(f.message('こんにちは', { author: { id: botId, bot: true } }));
    await bot.メッセージ受信(f.message('こんにちは', { channelId: 'other' }));
    assert.equal(f.sent.length, 0);
    await bot.メッセージ受信(f.message('日本語の回答'));
    assert.equal(JSON.parse(f.sent[0].content.split('\n\nコマンド:')[0]).input, '日本語の回答');
    assert.deepEqual(f.sent[0].allowedMentions, { parse: [], repliedUser: false });
    await Promise.all([bot.メッセージ受信(f.message('続きの質問1')), bot.メッセージ受信(f.message('続きの質問2'))]);
    assert.deepEqual(f.sent.slice(1, 3).map(packet => JSON.parse(packet.content).input), ['続きの質問1', '続きの質問2']);
    await 回答送信(f.message(''), '@everyone'.repeat(1000));
    assert.equal(f.sent.at(-1).files[0].name, 'AiDiy回答.txt');
  } finally { await bot.終了(); }
});

test('live開始中の重複要求を抑止し、leaveで中断して古い接続を復活させない', async () => {
  const f = fixture(); let count = 0; let finish!: () => void; let stopped = 0;
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => {
    count++;
    return { channel, 接続: () => new Promise<void>(resolve => { finish = resolve; }), 終了: () => { stopped++; closed(); }, テキスト送信: () => {} };
  });
  try {
    const pending = bot.メッセージ受信(f.message('!live'));
    await waitFor(() => !!finish);
    await bot.メッセージ受信(f.message('!live'));
    assert.equal(count, 1);
    await bot.メッセージ受信(f.message('!leave', { member: { voice: { channelId: 'other' } } }));
    assert.equal(stopped, 0);
    await bot.メッセージ受信(f.message('!leave'));
    assert.equal(stopped, 1);
    finish(); await pending;
    assert.ok(!f.sent.some(packet => packet.content === '音声会話に接続しました。そのまま話しかけてください。'));
  } finally { await bot.終了(); }
});

test('許可利用者の入室で自動接続し、ミュート変更で重複せず、準備中の退出でも即時終了する', async () => {
  const f = fixture(false); let started = 0; let stopped = 0; let finish!: () => void;
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => ({
    channel, 接続: () => { started++; return new Promise<void>(resolve => { finish = resolve; }); },
    終了: () => { stopped++; closed(); }, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    f.voiceChange(null, voiceId, 'other');
    f.voiceChange(null, voiceId, userId, 'other-guild');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 0);
    f.voiceChange(null, voiceId);
    await waitFor(() => started === 1);
    f.voiceChange(voiceId, voiceId);
    assert.equal(started, 1);
    f.voiceChange(voiceId, null);
    assert.equal(stopped, 1);
    finish();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(!f.sent.some(item => item.content.includes('接続しました')));
  } finally { finish?.(); await bot.終了(); }
});

test('指定ユーザーでも別のボイスチャンネルでは接続しない', async () => {
  const f = fixture(false); let started = 0;
  const other = { ...f.channel, id: '666666666666666666', members: new Map([[userId, { id: userId, user: { bot: false } }]]) } as unknown as VoiceChannel;
  f.channel.guild.channels.cache.set(other.id, other);
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { started++; }, 終了: closed, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 0);
    await bot.メッセージ受信(f.message('!live', { member: { voice: { channel: other, channelId: other.id } } }));
    assert.equal(started, 0);
    assert.match(f.sent.at(-1).content, /discord_voice_channel_id/);
  } finally { await bot.終了(); }
});

test('Bot起動前から参加中でも自動接続し、Gateway復旧で重複接続しない', async () => {
  const f = fixture(); let started = 0; let stopped = 0;
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { started++; }, 終了: () => { stopped++; closed(); }, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    await waitFor(() => f.sent.length > 0);
    assert.equal(started, 1);
    f.client.emit(Events.ShardResume, 0, 0);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 1);
    f.voiceChange(voiceId, null);
    assert.equal(stopped, 1);
  } finally { await bot.終了(); }
});

test('返信先の取得中に退出した場合は音声接続を作らない', async () => {
  const f = fixture(); let fetchStarted = false; let finish!: (channel: any) => void; let started = 0;
  f.client.channels.fetch = (() => { fetchStarted = true; return new Promise(resolve => { finish = resolve; }); }) as any;
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { started++; }, 終了: closed, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    await waitFor(() => fetchStarted);
    f.voiceChange(voiceId, null);
    finish(f.textChannel);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 0);
  } finally { finish?.(f.textChannel); await bot.終了(); }
});

test('自動Live開始の失敗通知に段階・Providerの拒否理由を残し、秘密値を出さない', async () => {
  const f = fixture();
  const failure = new ライブ接続エラー({ code: 'credit_balance_exhausted', message: 'APIクレジットがありません test-token' }, 'AIコア接続', 'test-token');
  const bot = new DiscordBot(config(), f.client, undefined, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { throw failure; }, 終了: closed, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    await waitFor(() => f.sent.length > 0);
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].content, /AIコア接続/);
    assert.match(f.sent[0].content, /credit_balance_exhausted/);
    assert.match(f.sent[0].content, /APIクレジットがありません/);
    assert.doesNotMatch(f.sent[0].content, /test-token/);
    assert.ok(!f.sent.some(packet => packet.content.includes('音声会話に接続しました')));
    await bot.メッセージ受信(f.message('!live'));
    assert.match(f.sent.at(-1).content, /credit_balance_exhausted/, '手動開始も同じ拒否理由を返す');
  } finally { await bot.終了(); }
});

test('Live が OFF なら入室しても音声接続せず live コマンドも拒否し、Code は動作する', async () => {
  const f = fixture(true); let started = 0;
  const code = new Code接続(config(), { 実行ファイル: process.execPath, 引数: [fileURLToPath(new URL('./fake-cli.cjs', import.meta.url))] });
  const bot = new DiscordBot({ ...config(), liveEnabled: false }, f.client, code, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { started++; }, 終了: closed, テキスト送信: () => {},
  }));
  try {
    f.client.emit(Events.ClientReady, f.client as any);
    f.voiceChange(null, voiceId);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(started, 0);
    await bot.メッセージ受信(f.message('!live'));
    assert.match(f.sent.at(-1).content, /Live は OFF/);
    await bot.メッセージ受信(f.message('こんにちは'));
    assert.equal(JSON.parse(f.sent.at(-1).content).input, 'こんにちは');
  } finally { await bot.終了(); }
});

test('Code が OFF なら通常投稿を Hermes に渡さず、Live は接続する', async () => {
  const f = fixture(true); let started = 0, ran = 0;
  const code = new Code接続(config(), { 実行ファイル: process.execPath, 引数: [fileURLToPath(new URL('./fake-cli.cjs', import.meta.url))] });
  const original = code.実行.bind(code); code.実行 = (...args) => { ran++; return original(...args); };
  const bot = new DiscordBot({ ...config(), codeEnabled: false }, f.client, code, (_config, channel, _notify, closed) => ({
    channel, 接続: async () => { started++; }, 終了: closed, テキスト送信: () => {},
  }));
  try {
    await bot.メッセージ受信(f.message('こんにちは'));
    assert.match(f.sent.at(-1).content, /Code は OFF/);
    assert.equal(ran, 0);
    f.client.emit(Events.ClientReady, f.client as any);
    await waitFor(() => started === 1);
  } finally { await bot.終了(); }
});

function commandCode() {
  const calls = { run: [] as string[], stop: [] as string[], reset: [] as string[] };
  const code = { 実行中: () => false, 実行: async (_key: string, text: string) => { calls.run.push(text); return text; },
    停止: (key: string) => { calls.stop.push(key); }, リセット: (key: string) => { calls.reset.push(key); }, 終了: () => {} } as unknown as Code接続;
  return { calls, code };
}

test('未知コマンドはAIに渡さずhelp、短縮stop/newは同じ会話を操作する', async () => {
  const f = fixture(false), c = commandCode(); const bot = new DiscordBot(config(), f.client, c.code);
  await bot.メッセージ受信(f.message('！unknown'));
  assert.equal((f.sent[0].content.match(/コマンド:/g) || []).length, 1);
  await bot.メッセージ受信(f.message('！stop'));
  await bot.メッセージ受信(f.message('!new'));
  assert.deepEqual(c.calls.stop, c.calls.reset); assert.equal(c.calls.stop.length, 1);
  assert.deepEqual(c.calls.run, []);
  await bot.メッセージ受信(f.message(' !new'));
  assert.deepEqual(c.calls.run, ['!new']);
  await bot.終了();
});

test('初回案内は同時返信でも一度、Gateway再接続で戻らず新Botで戻る', async () => {
  const f = fixture(false), c = commandCode(); const bot = new DiscordBot(config(), f.client, c.code);
  let release!: () => void; const packets: any[] = [];
  const reply = async (data: unknown) => { packets.push(data); if (packets.length === 1) await new Promise<void>(resolve => { release = resolve; }); };
  const first = bot.メッセージ受信(f.message('!status', { reply }));
  await waitFor(() => !!release);
  const second = bot.メッセージ受信(f.message('！status', { reply }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(packets.length, 1);
  release(); await Promise.all([first, second]);
  assert.equal(packets.filter(packet => packet.content.includes('コマンド:')).length, 1);
  f.client.emit(Events.ShardResume, 0, 0);
  await bot.メッセージ受信(f.message('!status', { reply }));
  assert.doesNotMatch(packets.at(-1).content, /コマンド:/);
  await bot.終了();
  const next = fixture(false); const restarted = new DiscordBot(config(), next.client, commandCode().code);
  await restarted.メッセージ受信(next.message('!help'));
  assert.equal((next.sent[0].content.match(/コマンド:/g) || []).length, 1);
  await restarted.終了();
});

test('失敗した初回送信は案内を消費せず次の成功返信に付ける', async () => {
  const f = fixture(false); const bot = new DiscordBot(config(), f.client, commandCode().code);
  await assert.rejects(bot.メッセージ受信(f.message('!status', { reply: async () => { throw new Error('送信失敗'); } })));
  await bot.メッセージ受信(f.message('!status'));
  assert.match(f.sent[0].content, /コマンド:/);
  await bot.メッセージ受信(f.message('!status')); assert.doesNotMatch(f.sent[1].content, /コマンド:/);
  await bot.終了();
});

test('複数チャンクと添付の初回回答にも末尾に一度だけ案内を付ける', async () => {
  for (const size of [4000, 7000]) {
    const f = fixture(false); const bot = new DiscordBot(config(), f.client, commandCode().code);
    await bot.メッセージ受信(f.message('あ'.repeat(size)));
    assert.equal(f.sent.filter(packet => packet.content.includes('コマンド:')).length, 1);
    assert.match(f.sent.at(-1).content, /コマンド:/);
    if (size === 4000) assert.equal(f.sent.slice(0, -1).map(packet => packet.content).join(''), 'あ'.repeat(size));
    else assert.equal(f.sent[0].files[0].name, 'AiDiy回答.txt');
    await bot.メッセージ受信(f.message('次')); assert.equal(f.sent.at(-1).content, '次');
    await bot.終了();
  }
});

test('長文の本文だけ送れて案内送信が失敗した場合も次の返信に案内を残す', async () => {
  const f = fixture(false); const bot = new DiscordBot(config(), f.client, commandCode().code);
  const delivered: string[] = [];
  f.textChannel.send = async (data: any) => {
    if (data.content.includes('コマンド:')) throw new Error('案内送信失敗');
    delivered.push(data.content);
  };
  await assert.rejects(bot.メッセージ受信(f.message('あ'.repeat(4000), { reply: async () => { throw new Error('返信失敗'); } })));
  assert.equal(delivered.join(''), 'あ'.repeat(4000));
  await bot.メッセージ受信(f.message('!status'));
  assert.match(f.sent[0].content, /コマンド:/);
  await bot.終了();
});
