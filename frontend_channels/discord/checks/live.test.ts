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

import { authFixture } from './internal-auth-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import OpusScript from 'opusscript';
import { VoiceConnectionStatus, type VoiceConnection, type AudioPlayer } from '@discordjs/voice';
import type { VoiceChannel } from 'discord.js';
import { Live接続 } from '../src/ライブ/ライブ会話';
import { config, userId, guildId, voiceId, waitFor } from './helpers';

async function fixture(rejectChannel = '', provider = 'openai_live', selectedProvider = provider,
  options: { holdReady?: boolean; ready?: (voice: VoiceConnection, signal: AbortSignal) => Promise<VoiceConnection> } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const auth = authFixture(address.port);
  const settings = config(); settings.coreRoot = auth.root; settings.coreUrl = `ws://127.0.0.1:${address.port}/core/ws/AIコア`;
  settings.liveModels = { LIVE_AI_NAME: selectedProvider };
  const received: Record<string, any>[] = [];
  const sockets = new Map<string, WebSocket>();
  server.on('connection', socket => {
    let channel = '';
    socket.on('message', data => {
      const packet = JSON.parse(data.toString()); received.push({ ...packet, socket: channel });
      if (packet.type === 'connect') {
        channel = packet.ソケット番号; sockets.set(channel, socket);
        socket.send(JSON.stringify(channel === rejectChannel
          ? { メッセージ識別: 'error', メッセージ内容: 'テストで拒否' }
          : { メッセージ識別: 'init', セッションID: 'live-test-session', モデル設定: { ...settings.liveModels, LIVE_AI_NAME: provider } }));
        if (channel === 'audio' && channel !== rejectChannel && packet.Live準備確認 && !options.holdReady)
          socket.send(JSON.stringify({ メッセージ識別: 'live_ready', セッションID: 'live-test-session' }));
      }
    });
  });
  const speaking = Object.assign(new EventEmitter(), { users: new Map<string, number>() });
  const streams = new Map<string, PassThrough>();
  const voice = Object.assign(new EventEmitter(), {
    state: { status: VoiceConnectionStatus.Ready },
    receiver: { speaking, subscribe(user: string) { const stream = new PassThrough({ objectMode: true }); streams.set(user, stream); return stream; } },
    player: undefined as AudioPlayer | undefined,
    subscribe(player: AudioPlayer) { this.player = player; },
    destroy() { this.state.status = VoiceConnectionStatus.Destroyed; voice.emit(VoiceConnectionStatus.Destroyed); },
  });
  const members = new Map([[userId, { user: { bot: false }, id: userId }], ['unauthorized', { user: { bot: false }, id: 'unauthorized' }]]);
  const channel = { id: voiceId, guild: { id: guildId }, members } as unknown as VoiceChannel;
  const notices: string[] = []; let closed = 0;
  const connection = new Live接続(settings, channel, async text => { notices.push(text); }, () => { closed++; }, {
    join: () => voice as unknown as VoiceConnection,
    ready: options.ready ?? (async () => voice as unknown as VoiceConnection),
  });
  return { connection, received, sockets, speaking, streams, voice, notices, members, closed: () => closed,
    async cleanup() {
      connection.終了(); auth.cleanup(); for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    } };
}

test('Live実装がinput→0→audioのinitを待ち、許可話者のOpusと無音をAIコアへ送る', { timeout: 10000 }, async () => {
  const f = await fixture();
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
    await f.connection.接続();
    await waitFor(() => f.received.some(packet => packet.メッセージ識別 === 'input_audio'));
    const connects = f.received.filter(packet => packet.type === 'connect');
    assert.deepEqual(connects.map(packet => packet.ソケット番号), ['input', '0', 'audio']);
    assert.equal(connects[0].セッションID, null);
    assert.equal(connects[1].セッションID, 'live-test-session');
    assert.equal(connects[2].モデル設定.LIVE_AI_NAME, 'openai_live');
    const silence = f.received.find(packet => packet.メッセージ識別 === 'input_audio')!;
    assert.equal(Buffer.from(silence.ファイル名, 'base64').length, 960);
    assert.equal(silence.socket, 'audio');
    f.speaking.emit('start', 'unauthorized'); assert.equal(f.streams.size, 0);
    f.speaking.emit('start', userId); assert.equal(f.streams.size, 1);
    const pcm = Buffer.alloc(3840);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 12000), i * 2);
    f.streams.get(userId)!.write(encoder.encode(pcm, 960));
    await waitFor(() => f.received.some(packet => packet.メッセージ識別 === 'input_audio' && Buffer.from(packet.ファイル名, 'base64').some(value => value !== 0)));
    f.connection.テキスト送信('こんにちは');
    await waitFor(() => f.received.some(packet => packet.メッセージ内容 === 'こんにちは'));
    const text = f.received.find(packet => packet.メッセージ内容 === 'こんにちは')!;
    assert.equal(text.送信モード, 'Live'); assert.equal(text.socket, 'input');
    f.connection.終了(); f.connection.終了();
    assert.equal(f.closed(), 1); assert.equal(f.voice.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(f.streams.get(userId)?.destroyed, true);
    await assert.rejects(f.connection.接続(), /開始済み/);
  } finally { encoder.delete(); await f.cleanup(); }
});

test('initだけで接続済みにせず、LiveAIの待受準備完了後にマイクを開始する', { timeout: 10000 }, async () => {
  const f = await fixture('', 'openai_live', 'openai_live', { holdReady: true });
  let connected = false;
  const pending = f.connection.接続().then(() => { connected = true; });
  try {
    await waitFor(() => f.sockets.has('audio'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connected, false);
    assert.equal(f.received.some(packet => packet.メッセージ識別 === 'input_audio'), false);
    assert.equal(f.received.some(packet => packet.メッセージ識別 === 'operations'), false);
    assert.equal(f.received.find(packet => packet.ソケット番号 === 'audio')!.Live準備確認, true);
    f.sockets.get('audio')!.send(JSON.stringify({ メッセージ識別: 'live_ready', セッションID: 'wrong-session' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connected, false);
    f.sockets.get('audio')!.send(JSON.stringify({ メッセージ識別: 'live_ready', セッションID: 'live-test-session' }));
    await pending;
    await waitFor(() => f.received.some(packet => packet.メッセージ識別 === 'input_audio'));
    assert.equal(connected, true);
  } finally { await f.cleanup(); await pending.catch(() => {}); }
});

test('LiveAIの開始拒否理由を保ち、秘密値を伏せ、接続済みとは扱わない', { timeout: 10000 }, async () => {
  const f = await fixture('', 'openai_live', 'openai_live', { holdReady: true });
  const pending = f.connection.接続();
  const rejected = assert.rejects(pending, (error: Error) => {
    assert.match(error.message, /AIコア接続/);
    assert.match(error.message, /credit_balance_exhausted/);
    assert.match(error.message, /APIクレジットがありません/);
    assert.doesNotMatch(error.message, /test-token|sk-private/);
    return true;
  });
  try {
    await waitFor(() => f.sockets.has('audio'));
    f.sockets.get('0')!.send(JSON.stringify({ メッセージ識別: 'error', エラーコード: 'credit_balance_exhausted',
      メッセージ内容: 'APIクレジットがありません test-token sk-private' }));
    await rejected;
    assert.equal(f.closed(), 1);
    assert.equal(f.received.some(packet => packet.メッセージ識別 === 'input_audio'), false);
    assert.equal(f.notices.length, 0, '開始待ち中の通知はBotに任せ、重複送信しない');
  } finally { await f.cleanup(); }
});

test('停止するとDiscordボイス接続の準備待ちも解除し、AIコアへ接続しない', { timeout: 10000 }, async () => {
  let waiting = false;
  const f = await fixture('', 'openai_live', 'openai_live', { ready: (_voice, signal) => new Promise((_resolve, reject) => {
    waiting = true;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const pending = f.connection.接続();
  const rejected = assert.rejects(pending, /Discordボイス接続/);
  try {
    await waitFor(() => waiting);
    f.connection.終了();
    await rejected;
    assert.equal(f.closed(), 1);
    assert.equal(f.sockets.size, 0);
    assert.equal(f.voice.state.status, VoiceConnectionStatus.Destroyed);
  } finally { await f.cleanup(); }
});

test('AI出力音声を再生し、cancel_audioで古いリソースを破棄、片側切断で全体を終了', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.connection.接続();
    const initial = f.voice.player!.state;
    assert.ok('resource' in initial);
    f.sockets.get('audio')!.send(JSON.stringify({ メッセージ識別: 'output_audio', メッセージ内容: 'audio/pcm;rate=24000', ファイル名: Buffer.alloc(960).toString('base64') }));
    await waitFor(() => initial.resource.playStream.readableLength > 0);
    f.sockets.get('audio')!.send(JSON.stringify({ メッセージ識別: 'cancel_audio' }));
    await waitFor(() => 'resource' in f.voice.player!.state && f.voice.player!.state.resource !== initial.resource);
    assert.equal(initial.resource.playStream.destroyed, true);
    f.sockets.get('0')!.close();
    await waitFor(() => f.closed() === 1);
    assert.equal(f.voice.state.status, VoiceConnectionStatus.Destroyed);
    await waitFor(() => f.notices.some(text => text.includes('接続が切れました')));
  } finally { await f.cleanup(); }
});

test('接続後のボイスエラーは通信状態と元の例外を保持し、秘密値を伏せて一度だけ終了する', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.connection.接続();
    Object.assign(f.voice.state, { networking: { state: { code: 4, connectionOptions: { token: 'private-voice-token' },
      connectionData: { secretKey: 'private-voice-key' } } } });
    const error = Object.assign(new Error('send failed test-token token=private-session-token'), { code: 'ENETUNREACH' });
    f.voice.emit('error', error);
    f.voice.emit('error', error);
    await waitFor(() => f.notices.length === 1);
    assert.match(f.notices[0], /Discord のボイス接続でエラー/);
    assert.match(f.notices[0], /ボイス状態: ready \/ 音声通信: Ready/);
    assert.match(f.notices[0], /ENETUNREACH/);
    assert.match(f.notices[0], /send failed/);
    assert.doesNotMatch(f.notices[0], /test-token|private-/);
    assert.equal(f.closed(), 1);
    assert.equal(f.voice.state.status, VoiceConnectionStatus.Destroyed);
    await waitFor(() => f.sockets.size === 3 && [...f.sockets.values()].every(socket => socket.readyState === 3));
  } finally { await f.cleanup(); }
});

test('受信ストリームの暗号化エラーを一般案内で隠さず、音声中継の失敗として通知する', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.connection.接続();
    f.speaking.emit('start', userId);
    f.streams.get(userId)!.emit('error', new Error('Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)'));
    await waitFor(() => f.notices.length === 1);
    assert.match(f.notices[0], /失敗段階: 音声中継/);
    assert.match(f.notices[0], /DecryptionFailed\(UnencryptedWhenPassthroughDisabled\)/);
    assert.equal(f.closed(), 1);
    assert.equal(f.streams.get(userId)!.destroyed, true);
  } finally { await f.cleanup(); }
});

for (const [provider, rate] of [['openai_live', 24000], ['gemini_live', 16000], ['freeai_live', 16000]] as const) {
  test(`${provider}の入力は初期選択よりinitを優先し、20msのPCM16 monoを同じaudioソケットへ送る`, { timeout: 10000 }, async () => {
    const f = await fixture('', provider, provider === 'openai_live' ? 'gemini_live' : 'openai_live');
    try {
      await f.connection.接続();
      await waitFor(() => f.received.some(packet => packet.メッセージ識別 === 'input_audio'));
      const frames = f.received.filter(packet => packet.メッセージ識別 === 'input_audio');
      for (const frame of frames) {
        assert.equal(frame.socket, 'audio');
        assert.equal(frame.メッセージ内容, 'audio/pcm');
        assert.equal(Buffer.from(frame.ファイル名, 'base64').length, rate / 50 * 2);
        assert.ok(Buffer.from(frame.ファイル名, 'base64').equals(Buffer.alloc(rate / 50 * 2)));
      }
    } finally { await f.cleanup(); }
  });
}

test('音声ソケットの接続拒否でも先に開いたソケットとDiscord接続を回収する', { timeout: 10000 }, async () => {
  const f = await fixture('audio');
  try {
    await assert.rejects(f.connection.接続());
    assert.equal(f.closed(), 1); assert.equal(f.voice.state.status, VoiceConnectionStatus.Destroyed);
    await waitFor(() => [...f.sockets.values()].every(socket => socket.readyState === 3));
  } finally { await f.cleanup(); }
});

test('文字起こしはパネルへ逐次表示し、Discord へは人間側の最後の発言とAIの応答を1件にまとめて送る', { timeout: 10000 }, async () => {
  const f = await fixture();
  const shown: string[] = [];
  f.connection.表示 = (who, text, role) => { shown.push(`${role}:${who}:${text}`); };
  try {
    await f.connection.接続();
    const send = (type: string, text: string) => f.sockets.get('0')!.send(JSON.stringify({ チャンネル: '0', メッセージ識別: type, メッセージ内容: text }));
    send('recognition_input', '最初の発言'); send('recognition_input', '今日の天気は？');
    send('recognition_output', '晴れです。'); send('output_text', '晴れです。'); send('recognition_output', '気温は20度です。');
    await waitFor(() => shown.length === 5);
    assert.equal(shown[1], 'user:あなた（音声）:今日の天気は？');
    assert.equal(f.notices.length, 0, '応答が続く間は投稿しない');
    await waitFor(() => f.notices.length === 1, 4000);
    assert.equal(f.notices[0], '**あなた（音声）**: 今日の天気は？\n**AiDiy**: 晴れです。\n気温は20度です。');
  } finally { await f.cleanup(); }
});

test('モニター送信は設定した間だけ、無音を除く通過音声をレート付きで渡す', { timeout: 10000 }, async () => {
  const f = await fixture();
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const monitored: { kind: string; size: number; rate: number }[] = [];
  try {
    await f.connection.接続();
    await waitFor(() => f.received.some(packet => packet.メッセージ識別 === 'input_audio'));
    assert.equal(monitored.length, 0, '既定ではモニターしない');
    f.connection.モニター送信 = (kind, pcm, rate) => { monitored.push({ kind, size: pcm.length, rate }); };
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(monitored.length, 0, '無音フレームは送らない');
    f.speaking.emit('start', userId);
    const pcm = Buffer.alloc(3840);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 12000), i * 2);
    f.streams.get(userId)!.write(encoder.encode(pcm, 960));
    await waitFor(() => monitored.length > 0);
    assert.deepEqual(monitored[0], { kind: 'input', size: 960, rate: 24000 });
  } finally { encoder.delete(); await f.cleanup(); }
});
