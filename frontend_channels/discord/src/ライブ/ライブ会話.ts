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

import { createAudioPlayer, createAudioResource, EndBehaviorType, entersState, joinVoiceChannel, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, type AudioReceiveStream, type VoiceConnection } from '@discordjs/voice';
import type { VoiceChannel } from 'discord.js';
import WebSocket from 'ws';
import OpusScript from 'opusscript';
import { Coreソケット, Core初期接続 } from './Coreソケット';
import type { LiveSocket, Packet } from '../../../../frontend_ide/host/aidiy_live/src/protocol';
import { LiveConnection, 入力レート, 音声入力, 音声操作 } from '../共通連携/IDE連携';
import type { Discord設定 } from '../接続/接続設定';
import { Discord音声出力, 音声入力ミキサー, 音声スペクトル, 音声レベル } from './音声処理';
import { ライブ接続エラー, type ライブ接続段階 } from '../接続/接続エラー';
import { Discord音声通信 } from '../接続/ネットワーク接続';

// 音声レベル（RMS×5）で 0.02 ≒ -48dBFS。これ未満はインジケーター上の無音とする。
const 無音閾値 = 0.02;

const 音声トランスポート = {
  join: (channel: VoiceChannel, network: Discord音声通信) => joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id,
    adapterCreator: methods => channel.guild.voiceAdapterCreator({ ...methods, onVoiceServerUpdate: packet => {
      if (packet.endpoint) network.接続先登録(packet.endpoint);
      methods.onVoiceServerUpdate(packet);
    } }), selfDeaf: false, selfMute: false }),
  ready: (voice: VoiceConnection, signal: AbortSignal) => entersState(voice, VoiceConnectionStatus.Ready, signal),
};

export class Live接続 {
  private core: InstanceType<typeof LiveConnection>;
  private voice?: VoiceConnection;
  private player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  private output?: Discord音声出力;
  private mixer = new 音声入力ミキサー();
  private inputs = new Map<string, { stream: AudioReceiveStream; decoder: OpusScript }>();
  private sockets = new Set<WebSocket>();
  private heartbeat?: NodeJS.Timeout;
  private capture?: NodeJS.Timeout;
  private rate = 16000;
  private closed = false;
  private ready = false;
  private started = false;
  private notifyQueue = Promise.resolve();
  private pendingNotices = 0;
  private joinAbort = new AbortController();
  private stage: ライブ接続段階 = 'Discordボイス接続';
  private startedAt = 0;
  private failure?: ライブ接続エラー;
  private coreInitialized = false;
  private handshakeRetry = false;
  private receivedVoice = false;
  private receivedOutput = false;
  private voiceNetwork?: Discord音声通信;
  /** 文字起こしをパネルへ逐次表示する。 */
  表示?: (who: string, text: string, role: 'user' | 'ai') => void;
  // Discord へは発言ごとに投稿せず、AI の応答が落ち着いたら「人間側の最後の発言＋AI の応答」を1件にまとめて送る。
  private lastUser?: { who: string; text: string };
  private aiTexts: string[] = [];
  private transcriptTimer?: NodeJS.Timeout;
  /** 通過する入力・再生音の音量と周波数分布。パネルの円型インジケーター用に50msごとへ間引く。 */
  メーター?: (kind: 'input' | 'output', level: number, bins: number[]) => void;
  /** パネルのモニター ON の間だけ設定される。通過する PCM16 mono（20ms分）をそのまま渡す。 */
  モニター送信?: (kind: 'input' | 'output', pcm: Buffer, rate: number) => void;
  private meterAt = { input: 0, output: 0 };
  private meterSilent = { input: true, output: true };
  private meterBins: Record<'input' | 'output', number[] | undefined> = { input: undefined, output: undefined };
  constructor(private config: Discord設定, readonly channel: VoiceChannel, private notify: (text: string) => Promise<void>, private onClose: () => void,
    private transport = 音声トランスポート) {
    this.rate = 入力レート(config.liveModels.LIVE_AI_NAME || '');
    this.core = new LiveConnection(config.coreUrl, packet => this.受信(packet), () => this.失敗('AIコアとの接続が切れました。ボイスチャンネルに入り直してください。'), url => {
      let socket: WebSocket;
      try { socket = Coreソケット(url, config.coreRoot); }
      catch (error) { this.handshakeRetry = true; throw error; }
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      socket.once('error', error => {
        this.handshakeRetry = /Unexpected server response: (401|403|502|503|504)/.test(error.message)
          || ['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code || '');
        this.failure ??= new ライブ接続エラー(error, 'AIコア接続', config.token, Date.now() - this.startedAt);
      });
      return socket as unknown as LiveSocket;
    });
    this.player.on('error', error => this.失敗('Discord の音声再生に失敗しました。', error, '音声中継'));
  }
  private 通知(text: string) {
    if (this.pendingNotices >= 8) return;
    this.pendingNotices++;
    this.notifyQueue = this.notifyQueue.then(() => this.notify(text)).catch(() => {
      console.error('[Discord] ライブ通知を送信できません。');
    }).finally(() => { this.pendingNotices--; });
  }
  private 失敗(text: string, cause?: unknown, stage = this.stage) {
    if (this.closed) return;
    const active = this.ready;
    this.failure ??= new ライブ接続エラー(cause ?? new Error(text), stage, this.config.token, Date.now() - this.startedAt);
    this.終了();
    // 開始待ち中は接続()の呼出し元が通知する。接続後の障害はここで一度だけ通知する。
    if (active) {
      console.error(`[Discord Live] ${this.failure.message}`);
      this.通知(`${text}\n${this.failure.details}`);
    }
  }
  private ボイス通信エラー(cause: unknown): Error {
    const state = this.voice?.state;
    // networking全体やSDKのdebugにはボイストークン・暗号鍵が含まれる。
    // 状態名だけを取り出し、元の例外は既存の伏せ字処理へ渡す。
    const code = state && 'networking' in state ? state.networking.state.code : undefined;
    const phases = ['WebSocket接続中', 'WebSocket認証中', 'UDP接続・IP検出中', '音声暗号方式選択中', 'Ready', '再接続中', 'Closed'];
    const phase = code === undefined ? '未開始' : phases[code] ?? '不明';
    return new Error(`ボイス状態: ${state?.status ?? '未開始'} / 音声通信: ${phase}\n音声接続先: ${this.voiceNetwork?.接続先 ?? '未通知'}`, { cause });
  }
  private 計測(kind: 'input' | 'output', pcm: Buffer) {
    if (this.モニター送信 && !this.closed && pcm.some(value => value !== 0)) this.モニター送信(kind, pcm, kind === 'input' ? this.rate : 24000);
    if (!this.メーター || this.closed) return;
    // dB 尺度の分布は、ほぼ聞こえない雑音（-50dBFS 程度）でも大きく出る。
    // 閾値未満は無音として扱い、aidiy_live と同じく音がない時の円を静かに保つ。
    const silent = 音声レベル(pcm) < 無音閾値;
    // 無音は変化した時だけ通知し、IPC を増やさない。
    if (silent) {
      this.meterBins[kind] = undefined;
      if (!this.meterSilent[kind]) { this.meterSilent[kind] = true; this.メーター(kind, 0, []); }
      return;
    }
    const now = Date.now();
    if (!this.meterSilent[kind] && now - this.meterAt[kind] < 50) return;
    this.meterSilent[kind] = false; this.meterAt[kind] = now;
    // AnalyserNode の smoothingTimeConstant 0.8（約16ms毎）を50ms間隔に換算した平滑化。
    const current = 音声スペクトル(pcm), previous = this.meterBins[kind];
    const bins = previous ? current.map((value, i) => Math.round(previous[i] * .5 + value * .5)) : current;
    this.meterBins[kind] = bins;
    // aidiy_live と同じ正規化: 入力は RMS、再生は周波数分布の平均。
    this.メーター(kind, kind === 'input' ? 音声レベル(pcm) : Math.min(1, bins.reduce((sum, value) => sum + value, 0) / bins.length / 128), bins);
  }
  private 再生開始() {
    this.player.stop(true);
    this.output?.destroy();
    if (this.closed) return;
    this.output = new Discord音声出力();
    this.output.通過 = pcm => this.計測('output', pcm);
    this.output.on('error', () => this.失敗('AI 音声を再生できません。'));
    this.player.play(createAudioResource(this.output, { inputType: StreamType.Opus }));
  }
  private 受信(packet: Packet) {
    if (this.closed) return;
    if (packet.メッセージ識別 === 'init') {
      this.coreInitialized = true;
      const settings = packet.モデル設定 as Record<string, unknown> | undefined;
      if (typeof settings?.LIVE_AI_NAME === 'string') this.rate = 入力レート(settings.LIVE_AI_NAME);
    } else if (packet.メッセージ識別 === 'cancel_audio') this.再生開始();
    else if (packet.メッセージ識別 === 'output_audio' && packet.ファイル名) {
      const mime = String(packet.メッセージ内容);
      const sampleRate = /rate=(\d+)/i.exec(mime)?.[1];
      if (!mime.startsWith('audio/pcm') || sampleRate && sampleRate !== '24000') {
        this.失敗('AIコアから対応外の音声形式を受信しました（24kHz PCM16 が必要です）。'); return;
      }
      try {
        const pcm = Buffer.from(packet.ファイル名, 'base64');
        this.output?.追加(pcm);
        if (!this.receivedOutput && pcm.some(value => value !== 0)) {
          this.receivedOutput = true;
          console.log('[Discord Live] AIの音声応答を受信しました。');
        }
      }
      catch { this.失敗('AI 音声のサイズまたは形式が不正です。接続し直してください。'); }
    } else if (packet.メッセージ識別 === 'error') this.失敗('AIコアでライブ接続エラーが発生しました。', {
      message: typeof packet.メッセージ内容 === 'string' ? packet.メッセージ内容 : 'バックエンドの設定・ログを確認してください。',
      code: packet.エラーコード,
    });
    else if (packet.チャンネル === '0' && ['output_text', 'output_request', 'recognition_input', 'recognition_output', 'output'].includes(packet.メッセージ識別 || '')) {
      const text = String(packet.メッセージ内容 || '').trim();
      if (text === '!') { this.失敗('LiveAI への送信に失敗しました。AIコアの接続設定を確認してください。'); return; }
      if (!text || ['\x02', '\x03', '\x18'].includes(text)) return;
      const user = packet.メッセージ識別 === 'recognition_input';
      const who = user ? `${this.channel.members.get(this.config.userId)?.displayName ?? 'あなた'}（音声）` : 'AiDiy';
      this.表示?.(who, text, user ? 'user' : 'ai');
      if (user) { this.lastUser = { who, text }; return; }
      if (this.aiTexts.at(-1) !== text) this.aiTexts = [...this.aiTexts, text].slice(-20);
      clearTimeout(this.transcriptTimer);
      this.transcriptTimer = setTimeout(() => this.文字起こし送信(), 1500);
    }
  }
  private 文字起こし送信() {
    this.transcriptTimer = undefined;
    if (this.closed || !this.aiTexts.length) return;
    const lines = [...(this.lastUser ? [`**${this.lastUser.who}**: ${this.lastUser.text}`] : []), `**AiDiy**: ${this.aiTexts.join('\n')}`];
    this.lastUser = undefined; this.aiTexts = [];
    this.通知(lines.join('\n').slice(0, 6000));
  }
  async 接続() {
    if (this.started || this.closed) throw new Error('ライブ接続は開始済みです。');
    this.started = true;
    this.startedAt = Date.now();
    try {
      console.log('[Discord Live] Discordボイス接続を開始します。');
      this.voiceNetwork = new Discord音声通信();
      this.voice = this.transport.join(this.channel, this.voiceNetwork);
      this.voice.on('error', error => this.失敗('Discord のボイス接続でエラーが発生しました。', this.ボイス通信エラー(error), 'Discordボイス接続'));
      this.voice.on(VoiceConnectionStatus.Disconnected, () => {
        const state = this.voice!.state;
        this.失敗('ボイス接続が切れました。ボイスチャンネルに入り直してください。', {
          message: 'Discord のボイス接続が切れました。',
          code: 'closeCode' in state ? state.closeCode : undefined,
          cause: { message: 'reason' in state ? `切断理由: ${state.reason}` : '切断理由なし' },
        }, 'Discordボイス接続');
      });
      this.voice.on(VoiceConnectionStatus.Destroyed, () => this.終了());
      await this.transport.ready(this.voice, AbortSignal.any([this.joinAbort.signal, AbortSignal.timeout(30000)]));
      if (this.closed) throw new Error('ライブ接続を中断しました。');
      console.log('[Discord Live] Discordボイス接続が完了しました。AIコアへ接続します。');
      this.stage = 'AIコア接続';
      this.voice.subscribe(this.player);
      this.再生開始();
      await Core初期接続(async () => {
        this.handshakeRetry = false; this.coreInitialized = false; this.failure = undefined;
        await this.core.connect({ codeBasePath: this.config.folder, modelSettings: this.config.liveModels, waitForLiveReady: true });
      }, () => !this.closed && !this.coreInitialized && this.handshakeRetry, { signal: this.joinAbort.signal });
      if (this.closed) throw new Error('ライブ接続を中断しました。');
      this.stage = '音声中継';
      if (!this.core.send('input', 音声操作(true, true))) throw new Error('AIコアへ音声設定を送信できません。');
      this.ready = true;
      this.voice.receiver.speaking.on('start', this.話者開始);
      // 接続中から話していた人も取り込む。
      for (const user of this.voice.receiver.speaking.users.keys()) this.話者開始(user);
      this.capture = setInterval(() => {
        for (const user of this.inputs.keys()) if (!this.話者許可(user)) this.話者停止(user);
        const frame = this.mixer.フレーム(this.rate);
        this.計測('input', frame);
        if (!this.core.send('audio', 音声入力(frame.toString('base64')))) {
          this.失敗('AIコアへの音声送信が滞留しました。ボイスチャンネルに入り直してください。');
        }
      }, 20);
      const alive = new WeakMap<WebSocket, boolean>();
      for (const socket of this.sockets) { alive.set(socket, true); socket.on('pong', () => alive.set(socket, true)); }
      this.heartbeat = setInterval(() => {
        for (const socket of this.sockets) {
          if (socket.readyState !== WebSocket.OPEN || !alive.get(socket)) { this.失敗('AIコアが応答しません。ボイスチャンネルに入り直してください。'); return; }
          alive.set(socket, false); socket.ping();
        }
      }, 20000);
      this.stage = 'LiveAI';
      console.log('[Discord Live] LiveAIの待受準備が完了し、音声中継を開始しました。');
    } catch (error) {
      const failure = this.failure ?? new ライブ接続エラー(this.stage === 'Discordボイス接続' ? this.ボイス通信エラー(error) : error, this.stage, this.config.token, Date.now() - this.startedAt);
      this.終了(); throw failure;
    }
  }
  private 話者許可(user: string): boolean {
    const member = this.channel.members.get(user);
    return !!member && !member.user.bot && user === this.config.userId;
  }
  private 話者開始 = (user: string) => {
    if (this.closed || !this.ready || !this.voice || this.inputs.has(user) || !this.話者許可(user)) return;
    try {
      const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
      const stream = this.voice.receiver.subscribe(user, { end: { behavior: EndBehaviorType.AfterSilence, duration: 300 } });
      this.inputs.set(user, { stream, decoder });
      stream.on('data', (opus: Buffer) => {
        if (!this.話者許可(user)) { this.話者停止(user); return; }
        try {
          this.mixer.追加(user, decoder.decode(opus));
          if (!this.receivedVoice) {
            this.receivedVoice = true;
            console.log('[Discord Live] Discordの受信音声を復号し、AIコアへ送信します。');
          }
        }
        catch (error) { this.失敗('Discord の受信音声を復号できません。ボイスチャンネルに入り直してください。', this.ボイス通信エラー(error), '音声中継'); }
      });
      stream.on('error', error => this.失敗('Discord の音声受信に失敗しました。', this.ボイス通信エラー(error), '音声中継'));
      stream.once('close', () => { if (this.inputs.get(user)?.stream === stream) this.話者停止(user); });
    } catch (error) { this.失敗('Discord の音声受信を開始できません。', this.ボイス通信エラー(error), '音声中継'); }
  };
  private 話者停止(user: string) {
    const input = this.inputs.get(user);
    if (!input) return;
    this.inputs.delete(user); this.mixer.削除(user); input.stream.destroy(); input.decoder.delete();
  }
  テキスト送信(text: string) {
    if (!this.ready || this.closed) throw new Error('ライブ接続の準備が完了していません。');
    if (!this.core.send('input', { チャンネル: '0', メッセージ識別: 'input_text', メッセージ内容: text, 送信モード: 'Live', 出力先チャンネル: '0' })) throw new Error('ライブに送信できません。');
  }
  終了() {
    if (this.closed) return;
    this.closed = true; this.ready = false;
    this.joinAbort.abort();
    clearInterval(this.capture); clearInterval(this.heartbeat); clearTimeout(this.transcriptTimer);
    this.core.send('input', 音声操作(false, false)); this.core.disconnect();
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.voice?.receiver.speaking.off('start', this.話者開始);
    for (const user of this.inputs.keys()) this.話者停止(user);
    this.player.stop(true); this.output?.destroy();
    for (const kind of ['input', 'output'] as const) if (!this.meterSilent[kind]) this.メーター?.(kind, 0, []);
    if (this.voice && this.voice.state.status !== VoiceConnectionStatus.Destroyed) this.voice.destroy();
    this.voiceNetwork?.終了();
    this.onClose();
  }
}
