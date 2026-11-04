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

import { MAX_FILE_PACKET_CHARS, validateFileUpload } from '../../src/file-attachments';

export type Packet = {
  メッセージ識別?: string; セッションID?: string; チャンネル?: string; プロジェクトパス?: string | null;
  メッセージ内容?: unknown; ファイル名?: string; [key: string]: unknown;
};
export interface LiveSocket {
  readyState: number; bufferedAmount: number;
  onopen: ((event: Event) => void) | null; onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null; onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void; close(): void;
}
export type LiveConnectOptions = { codeBasePath?: string; modelSettings?: Record<string, string>; waitForLiveReady?: boolean };

export function 入力レート(provider: string): number { return provider.includes('openai') ? 24000 : 16000; }
export function 音声入力(base64: string): Packet {
  return { チャンネル: 'audio', メッセージ識別: 'input_audio', メッセージ内容: 'audio/pcm', ファイル名: base64, サムネイル画像: null };
}
export function 音声操作(mic: boolean, speaker: boolean): Packet {
  return { チャンネル: 'input', メッセージ識別: 'operations', メッセージ内容: { ボタン: { マイク: mic, スピーカー: speaker } } };
}

// 通常は init、待受準備確認を要求した audio は live_ready 到着で確定する。
// 途中の失敗では3ソケット全部を閉じる。
export class LiveConnection {
  private sockets = new Map<string, LiveSocket>();
  private generation = 0;
  session = '';
  private projectPath: string | null = null;
  constructor(private url: string, private onPacket: (packet: Packet) => void, private onLost: () => void,
    private createSocket: (url: string) => LiveSocket = url => new WebSocket(url)) {}

  async connect(options: LiveConnectOptions = {}) {
    this.disconnect();
    this.projectPath = options.codeBasePath || null;
    const generation = this.generation;
    try {
      const session = await this.open('input', '', generation, options);
      if (generation !== this.generation) throw new Error('接続を中断しました。');
      this.session = session;
      await this.open('0', this.session, generation, options);
      if (generation !== this.generation) throw new Error('接続を中断しました。');
      await this.open('audio', this.session, generation, options);
    } catch (error) { if (generation === this.generation) this.disconnect(); throw error; }
  }
  private open(channel: string, session: string, generation: number, options: LiveConnectOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(this.url);
      this.sockets.set(channel, socket);
      let ready = false;
      let initialized = false;
      const waitForLive = channel === 'audio' && options.waitForLiveReady === true;
      const timer = setTimeout(() => {
        reject(new Error(waitForLive ? 'LiveAIの待受準備通知が届きませんでした。AIコアを再起動し、バックエンドのログを確認してください。' : '接続がタイムアウトしました。'));
        socket.close();
      }, 30000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'connect', セッションID: session || null, ソケット番号: channel,
        ...(options.codeBasePath ? { CODE_BASE_PATH: options.codeBasePath } : {}),
        ...(waitForLive ? { Live準備確認: true } : {}),
        ...(options.modelSettings && Object.keys(options.modelSettings).length ? { モデル設定: options.modelSettings } : {}) }));
      socket.onmessage = event => {
        if (generation !== this.generation) return;
        let packet: Packet;
        try { packet = JSON.parse(String(event.data)); } catch { return; }
        if (!ready && packet.メッセージ識別 === 'error') {
          clearTimeout(timer); reject(new Error(String(packet.メッセージ内容 || '接続に失敗しました。')));
        }
        if (packet.メッセージ識別 === 'init' && packet.セッションID) {
          if (session && packet.セッションID !== session) { reject(new Error('セッションが一致しません。')); socket.close(); return; }
          initialized = true;
          if (!waitForLive) { ready = true; clearTimeout(timer); resolve(packet.セッションID); }
        }
        if (waitForLive && initialized && packet.メッセージ識別 === 'live_ready' && packet.セッションID === session) {
          ready = true; clearTimeout(timer); resolve(session);
        }
        if (['input_file', 'output_file'].includes(packet.メッセージ識別 || '')) {
          // ファイルは会話用socketの現セッションだけ。欠落channelは実際のsocketで補う。
          if (channel !== '0' || packet.セッションID !== this.session || (packet.チャンネル != null && packet.チャンネル !== '0')) return;
          packet = { ...packet, チャンネル: '0' };
        }
        this.onPacket(packet);
      };
      socket.onerror = () => { clearTimeout(timer); if (!ready) reject(new Error('バックエンドに接続できません。')); };
      socket.onclose = () => {
        clearTimeout(timer);
        if (!ready) { reject(new Error('接続が閉じられました。')); return; }
        if (generation === this.generation) { this.disconnect(); this.onLost(); }
      };
    });
  }
  send(channel: string, packet: Packet): boolean {
    const socket = this.sockets.get(channel);
    if (!socket || socket.readyState !== 1 || socket.bufferedAmount > 128000) return false;
    try {
      const file = packet.メッセージ識別 === 'input_file';
      if (file) {
        if (channel !== 'input' || !this.session || !this.projectPath || packet.チャンネル !== '0' || packet.出力先チャンネル !== '0') return false;
        const upload = validateFileUpload({ name: packet.ファイル名, base64: packet.メッセージ内容 });
        packet = { ...packet, ファイル名: upload.name, メッセージ内容: upload.base64, プロジェクトパス: this.projectPath };
      }
      const data = JSON.stringify({ ...packet, セッションID: this.session });
      if (file && data.length > MAX_FILE_PACKET_CHARS) return false;
      socket.send(data); return true;
    } catch { return false; }
  }
  disconnect() {
    ++this.generation;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear(); this.session = ''; this.projectPath = null;
  }
}
