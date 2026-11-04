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

import type { LiveSocket } from '../../../host/aidiy_live/src/protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
export type Folder = { 名前: string; パス: string };
type Config = { host?: boolean; backend?: string; captureUrl?: string; 作業フォルダ?: Folder | null; モデル設定?: Record<string, string>; 保存モデル設定?: Record<string, string>; 自動接続?: boolean };
type Reply = { type: string; id?: number; data?: string; value?: unknown; error?: string; rate?: number; 作業フォルダ?: Folder | null };

class HostSocket implements LiveSocket {
  readyState = 0; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly id: number, private post: (message: unknown) => void) { post({ type: 'socket-open', id }); }
  send(data: string) { if (this.readyState === 1) this.post({ type: 'socket-send', id: this.id, data }); }
  close() { if (this.readyState >= 2) return; this.readyState = 2; this.post({ type: 'socket-close', id: this.id }); }
  receive(reply: Reply) {
    if (reply.type === 'socket-opened') { this.readyState = 1; this.onopen?.(); }
    else if (reply.type === 'socket-data') this.onmessage?.({ data: reply.data || '' });
    else if (reply.type === 'socket-send-error') this.onmessage?.({ data: JSON.stringify({ メッセージ識別: 'error', エラーコード: 'SOCKET_SEND_FAILED', メッセージ内容: reply.error || 'ファイルを送信できませんでした。' }) });
    else if (reply.type === 'socket-error') this.onerror?.();
    else if (reply.type === 'socket-closed') { this.readyState = 3; this.onclose?.(); }
  }
}

export class LiveEnvironment {
  private config: Config;
  private vscode;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sockets = new Map<number, HostSocket>();
  private mic?: { id: number; context: AudioContext; destination: MediaStreamAudioDestinationNode; sources: Set<AudioBufferSourceNode>; next: number };
  private stopListeners: Array<(error?: string) => void> = [];
  private microphoneStopListeners: Array<() => void> = [];
  private folderListeners: Array<(folder?: Folder | null) => void> = [];
  private presence?: EventSource;
  readonly host: boolean;
  readonly captureUrl: string;
  readonly socketUrl: string;

  constructor(config: Config = {}, private base = location.href) {
    this.config = config;
    this.host = !!config.host;
    this.vscode = this.host ? acquireVsCodeApi() : undefined;
    this.captureUrl = config.captureUrl || new URL('capture.js', this.base).href;
    const url = new URL('socket', this.base); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socketUrl = this.host ? '' : url.href;
    if (this.host) window.addEventListener('message', this.receive);
  }
  socket = (url: string): LiveSocket => {
    if (!this.vscode) return new WebSocket(url);
    const socket = new HostSocket(++this.nextId, message => this.vscode!.postMessage(message));
    this.sockets.set(socket.id, socket); return socket;
  };
  private request(type: string, fields: object = {}) {
    const id = ++this.nextId;
    return { id, result: new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('応答がタイムアウトしました。')); }, 35000);
      this.pending.set(id, { resolve, reject, timer }); this.vscode!.postMessage({ type, id, ...fields });
    }) };
  }
  async context(): Promise<Config> {
    if (this.host) return this.config;
    return (await fetch(new URL('config', this.base))).json();
  }
  async saveModel(settings: Record<string, string>) {
    if (this.host) { await this.request('save-model', { settings }).result; return; }
    const response = await fetch(new URL('model', this.base), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'モデルを保存できません。');
  }
  async api(path: string, body: object) {
    if (this.host) return this.request('api', { path, body }).result;
    const response = await fetch(new URL(`api/${path}`, this.base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `接続エラー (${response.status})`);
    return result;
  }
  onStop(listener: (error?: string) => void) { this.stopListeners.push(listener); }
  onMicrophoneStop(listener: () => void) { this.microphoneStopListeners.push(listener); }
  onFolder(listener: (folder?: Folder | null) => void) { this.folderListeners.push(listener); }
  openFolder() { this.vscode?.postMessage({ type: 'open-folder' }); }
  ready() {
    this.vscode?.postMessage({ type: 'ui-ready', audioWorklet: typeof AudioWorkletNode !== 'undefined' });
    if (!this.host && !this.presence) this.presence = new EventSource(new URL('presence', this.base));
  }
  acquireMicrophone = async () => {
    this.releaseMicrophone();
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const request = this.request('mic-start');
    const mic = this.mic = { id: request.id, context, destination, sources: new Set<AudioBufferSourceNode>(), next: 0 };
    try { await request.result; }
    catch (error) { if (this.mic === mic) this.releaseMicrophone(); throw error; }
    return { stream: destination.stream, dispose: () => { if (this.mic === mic) this.releaseMicrophone(); } };
  };
  private releaseMicrophone() {
    const mic = this.mic; this.mic = undefined;
    if (!mic) return;
    this.vscode?.postMessage({ type: 'mic-stop', id: mic.id });
    for (const source of mic.sources) { try { source.stop(); } catch { /* 終了済み */ } source.disconnect(); }
    mic.destination.stream.getTracks().forEach(track => track.stop());
    void mic.context.close().catch(() => undefined);
    const request = this.pending.get(mic.id);
    if (request) { clearTimeout(request.timer); this.pending.delete(mic.id); request.reject(new Error('マイク入力を停止しました。')); }
  }
  private receive = (event: MessageEvent<Reply>) => {
    const reply = event.data;
    if (!reply || typeof reply.type !== 'string') return;
    if (reply.type === 'reply' && reply.id) {
      const request = this.pending.get(reply.id); if (!request) return;
      clearTimeout(request.timer); this.pending.delete(reply.id);
      if (reply.error) request.reject(new Error(reply.error)); else request.resolve(reply.value);
    } else if (reply.type.startsWith('socket-') && reply.id) {
      this.sockets.get(reply.id)?.receive(reply);
      if (reply.type === 'socket-closed') this.sockets.delete(reply.id);
    } else if (reply.type === 'mic-data' && this.mic && this.mic.id === reply.id && reply.data) {
      const mic = this.mic, binary = atob(reply.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const buffer = mic.context.createBuffer(1, Math.floor(bytes.length / 2), reply.rate || 48000);
      const values = buffer.getChannelData(0), pcm = new DataView(bytes.buffer);
      for (let i = 0; i < values.length; i++) values[i] = pcm.getInt16(i * 2, true) / 32768;
      const source = mic.context.createBufferSource(); source.buffer = buffer; source.connect(mic.destination);
      // IPC が遅れた音声を溜めない。最新の入力へ追いつく。
      if (mic.next - mic.context.currentTime > .5) {
        for (const old of mic.sources) { try { old.stop(); } catch { /* 終了済み */ } }
        mic.sources.clear(); mic.next = 0;
      }
      mic.sources.add(source); source.onended = () => { source.disconnect(); mic.sources.delete(source); };
      mic.next = Math.max(mic.context.currentTime + .015, mic.next);
      source.start(mic.next); mic.next += buffer.duration;
    } else if (reply.type === 'folder') {
      this.config.作業フォルダ = reply.作業フォルダ;
      for (const listener of this.folderListeners) listener(reply.作業フォルダ);
    } else if (reply.type === 'mic-paused') {
      this.releaseMicrophone(); for (const listener of this.microphoneStopListeners) listener();
    } else if (reply.type === 'host-stop' || reply.type === 'mic-error') {
      if (reply.type === 'mic-error' && this.mic?.id !== reply.id) return;
      this.releaseMicrophone(); for (const listener of this.stopListeners) listener(reply.error);
    }
  };
  dispose() {
    this.presence?.close(); this.presence = undefined;
    this.releaseMicrophone(); for (const socket of this.sockets.values()) socket.close(); this.sockets.clear();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('画面を閉じました。')); }
    this.pending.clear(); window.removeEventListener('message', this.receive);
  }
}
