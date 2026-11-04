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

import { internalAuthorization, internalSocket, type InternalAuthorization } from '../../src/internal-auth';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { 接続エラー詳細 } from './connection-error';
import { validateFileUpload } from '../../src/file-attachments';

type Message = { type?: string; id?: number; path?: string; body?: unknown; data?: string };
type Mic = { id: number; process: ChildProcessWithoutNullStreams; stop: () => void };
export function backendUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('接続先は http(s)://ホスト:ポート で指定してください。');
  return url;
}

/** Live 拡張専用。Code 拡張や単独サーバーへ依存しない。 */
export class LiveHost {
  private sockets = new Map<number, WebSocket>();
  private requests = new Set<AbortController>();
  private mic?: Mic;
  private disposed = false;
  private visible = true;
  private input?: { id: number; session: string; speaker: boolean; projectPath: string | null };
  private heartbeat?: ReturnType<typeof setInterval>;
  private target: URL;
  constructor(backend: string, private post: (message: unknown) => void, private python: () => string, private microphoneFile: string, private authorization: InternalAuthorization = internalAuthorization(new URL(backend), [__dirname]),
    private createSocket: (url: URL, headers: Record<string, string>) => WebSocket = internalSocket) {
    this.target = backendUrl(backend);
  }
  async receive(message: Message) {
    if (this.disposed || !message || !Number.isSafeInteger(message.id) || message.id! <= 0) return;
    const id = message.id!;
    if (message.type === 'socket-open') {
      if (this.sockets.has(id) || this.sockets.size >= 3) { this.post({ type: 'socket-error', id }); this.post({ type: 'socket-closed', id }); return; }
      const url = new URL('/core/ws/AIコア', this.target); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket: WebSocket;
      try { socket = this.createSocket(url, this.authorization()); }
      catch { this.post({ type: 'socket-error', id }); this.post({ type: 'socket-closed', id }); return; }
      this.sockets.set(id, socket);
      socket.onopen = () => this.post({ type: 'socket-opened', id });
      socket.onmessage = event => {
        if (typeof event.data === 'string' && Buffer.byteLength(event.data, 'utf8') <= 20 * 1024 * 1024) {
          if (this.input?.id === id) {
            try {
              const packet = JSON.parse(event.data);
              if (packet.メッセージ識別 === 'init' && typeof packet.セッションID === 'string') {
                this.input.session = packet.セッションID;
                // 非表示中は Webview のタイマーが停止するため、拡張ホストで維持する。
                if (!this.heartbeat) this.heartbeat = setInterval(() => this.sendInput({ type: 'ping' }), 20000);
              }
            } catch { /* 非 JSON は画面側で無視する */ }
          }
          this.post({ type: 'socket-data', id, data: event.data });
        }
      };
      socket.onerror = () => this.post({ type: 'socket-error', id });
      socket.onclose = () => {
        this.sockets.delete(id);
        if (this.input?.id === id) this.clearHeartbeat();
        if (!this.disposed) this.post({ type: 'socket-closed', id });
      };
    } else if (message.type === 'socket-send') {
      const socket = this.sockets.get(id), data = message.data;
      const failed = (error: string) => this.post({ type: 'socket-send-error', id, error });
      if (typeof data !== 'string') return;
      if (Buffer.byteLength(data, 'utf8') > 20 * 1024 * 1024) { failed('要求が送信上限（20 MiB）を超えています。'); return; }
      let packet: any;
      try { packet = JSON.parse(data); } catch { /* 非JSON音声も上記の転送上限内で中継する */ }
      const file = packet?.メッセージ識別 === 'input_file';
      if (file) {
        try {
          validateFileUpload({ name: packet.ファイル名, base64: packet.メッセージ内容 });
          if (this.input?.id !== id || !this.input.session || packet.セッションID !== this.input.session
            || packet.チャンネル !== '0' || packet.出力先チャンネル !== '0'
            || !this.input.projectPath || packet.プロジェクトパス !== this.input.projectPath) throw new Error('接続中の会話・プロジェクトへ送信してください。');
        } catch (error) { failed(error instanceof Error ? error.message : 'ファイルを送信できません。'); return; }
      }
      if (socket?.readyState !== 1 || socket.bufferedAmount >= 128000) { if (file) failed('送信できませんでした。接続または送信待ちを確認してください。'); return; }
      if (packet?.type === 'connect' && packet.ソケット番号 === 'input') this.input = { id, session: '', speaker: true, projectPath: typeof packet.CODE_BASE_PATH === 'string' ? packet.CODE_BASE_PATH : null };
      if (this.input?.id === id && packet?.メッセージ識別 === 'operations') {
        this.input.speaker = !!packet.メッセージ内容?.ボタン?.スピーカー;
        if (!this.visible) {
          this.sendInput({ チャンネル: 'input', メッセージ識別: 'operations', メッセージ内容: { ボタン: { マイク: false, スピーカー: this.input.speaker } } });
          return;
        }
      }
      if (!this.visible && packet?.メッセージ識別 === 'input_audio') return;
      try { socket.send(data); } catch { failed('送信できませんでした。接続を確認してください。'); }
    } else if (message.type === 'socket-close') {
      this.sockets.get(id)?.close();
    } else if (message.type === 'api') {
      if (!['core/AIコア/モデル情報/取得', 'core/AIコア/モデル情報/設定'].includes(message.path || '') || this.requests.size >= 4) {
        this.post({ type: 'reply', id, error: '許可されていない要求です。' }); return;
      }
      const body = JSON.stringify(message.body || {});
      if (Buffer.byteLength(body, 'utf8') > 20 * 1024 * 1024) { this.post({ type: 'reply', id, error: '要求が大きすぎます。' }); return; }
      const controller = new AbortController(); this.requests.add(controller);
      const timeout = setTimeout(() => controller.abort(new DOMException('AIコアの応答が35秒以内に返りませんでした。', 'TimeoutError')), 35000);
      try {
        const response = await fetch(new URL('/' + message.path, this.target), { method: 'POST', headers: { 'Content-Type': 'application/json', ...this.authorization() }, redirect: 'error', body, signal: controller.signal });
        const value = await response.json() as { message?: string };
        if (!response.ok) throw new Error(value.message || `接続エラー (${response.status})`);
        if (!this.disposed) this.post({ type: 'reply', id, value });
      } catch (error) { if (!this.disposed) this.post({ type: 'reply', id, error: 接続エラー詳細(this.target, error) }); }
      finally { clearTimeout(timeout); this.requests.delete(controller); }
    } else if (message.type === 'mic-start') {
      if (this.visible) this.startMicrophone(id);
      else this.post({ type: 'reply', id, error: '画面が非表示のためマイク入力を停止しました。' });
    } else if (message.type === 'mic-stop' && this.mic?.id === id) this.stopMicrophone();
  }
  private startMicrophone(id: number) {
    this.stopMicrophone();
    if (process.platform !== 'win32') { this.post({ type: 'reply', id, error: 'VS Code 内のマイク入力は Windows 版に対応しています。専用ウィンドウで開いてください。' }); return; }
    const child = spawn(this.python(), ['-u', this.microphoneFile], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stopped = false, ready = false, stderr = '', pending = Buffer.alloc(0);
    const stop = () => {
      if (stopped) return; stopped = true; child.stdin.end();
      const timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000); timeout.unref();
      child.once('exit', () => clearTimeout(timeout));
    };
    this.mic = { id, process: child, stop };
    child.stdout.on('data', (data: Buffer) => {
      if (stopped || this.disposed) return;
      if (!ready) { ready = true; this.post({ type: 'reply', id, value: { rate: 48000 } }); }
      pending = Buffer.concat([pending, data]);
      const bytes = 48000 * .064 * 2;
      while (pending.length >= bytes) {
        this.post({ type: 'mic-data', id, rate: 48000, data: pending.subarray(0, bytes).toString('base64') });
        pending = pending.subarray(bytes);
      }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-2000); });
    const fail = (error: string) => {
      if (stopped || this.disposed) return;
      if (this.mic?.id === id) this.mic = undefined;
      this.post({ type: ready ? 'mic-error' : 'reply', id, error: `マイクを開始・継続できません: ${error.trim() || '入力が終了しました。'} Python の設定とマイクを確認してください。` });
      stop();
    };
    child.on('error', error => fail(error.message)); child.on('exit', () => fail(stderr));
    child.stdin.on('error', () => undefined);
    const timeout = setTimeout(() => { if (!ready) { fail(stderr || 'マイクの起動がタイムアウトしました。'); stop(); } }, 10000);
    child.once('exit', () => clearTimeout(timeout));
  }
  private stopMicrophone() { this.mic?.stop(); this.mic = undefined; }
  private sendInput(packet: object) {
    const input = this.input, socket = input && this.sockets.get(input.id);
    if (input?.session && socket?.readyState === 1 && socket.bufferedAmount < 128000)
      socket.send(JSON.stringify({ ...packet, セッションID: input.session }));
  }
  private clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined; this.input = undefined;
  }
  visibility(visible: boolean) {
    const wasVisible = this.visible; this.visible = visible;
    if (!visible) {
      this.stopMicrophone();
      this.sendInput({ チャンネル: 'input', メッセージ識別: 'operations', メッセージ内容: { ボタン: { マイク: false, スピーカー: this.input?.speaker ?? true } } });
    }
    if (!visible || !wasVisible) this.post({ type: 'mic-paused' });
  }
  stop() {
    this.stopMicrophone();
    this.clearHeartbeat();
    for (const controller of this.requests) controller.abort(new DOMException('接続の変更または終了により要求を中断しました。', 'AbortError')); this.requests.clear();
    for (const socket of this.sockets.values()) socket.close(); this.sockets.clear();
    if (!this.disposed) this.post({ type: 'host-stop' });
  }
  dispose() { this.stop(); this.disposed = true; }
}

export function microphonePython(configured: string, folders: string[]) {
  if (configured.trim()) return configured.trim();
  for (const folder of folders) {
    for (const root of [folder, join(folder, '..')]) {
      const executable = join(root, 'backend_tools', '.venv', 'Scripts', 'python.exe');
      if (existsSync(executable)) return executable;
    }
  }
  return 'python';
}
