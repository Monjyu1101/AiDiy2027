// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

/**
 * WebSocketクライアント
 * AIコアのWebSocket接続を管理
 */

import { useAuthStore } from '@/stores/auth';

const 認証延長対象メッセージ識別 = new Set(['input_text', 'input_file', 'input_image', 'input_request']);
let 認証トークン更新中 = false;

function 入力系認証トークン更新(message: WebSocketMessage): void {
  const メッセージ識別 = String(message.メッセージ識別 || message.type || '');
  if (!認証延長対象メッセージ識別.has(メッセージ識別) || 認証トークン更新中) return;

  認証トークン更新中 = true;
  void useAuthStore().refreshToken()
    .finally(() => {
      認証トークン更新中 = false;
    });
}


// 期限の事前確認のみ。署名・利用者・権限の検証は必ずサーバー側で行う。
function ログイントークン取得(): { token: string; expires: number } {
  const token = useAuthStore().token
  try {
    if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error()
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const expires = Number(JSON.parse(atob(payload)).exp) * 1000
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error()
    return { token, expires }
  } catch {
    throw new Error('認証の有効期限が切れました。再ログインしてください。')
  }
}

export interface WebSocketMessage {
  type?: string;
  セッションID?: string;
  プロジェクトパス?: string | null;
  [key: string]: any;
}

export type MessageHandler = (message: WebSocketMessage) => void;
export type StateHandler = (connected: boolean) => void;

// WebSocketクライアントの公開インターフェース
export interface IWebSocketClient {
  connect(): Promise<string>;
  send(message: WebSocketMessage): void;
  on(messageType: string, handler: MessageHandler): void;
  off(messageType: string, handler?: MessageHandler): void;
  disconnect(): void;
  セッションID取得(): string | null;
  isConnected(): boolean;
  sendPing(): void;
  updateState(ボタン: any): void;
  sendChatMessage(message: string): void;
  sendInputText(text: string, 出力先チャンネル?: string): void;
  requestStream(data: any): void;
  onStateChange(handler: StateHandler): () => void;
}

export class AIWebSocket implements IWebSocketClient {
  private ws: WebSocket | null = null;
  private セッションID: string | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private stateHandlers: Set<StateHandler> = new Set();
  private reconnectAttempts = 0;
  private isIntentionallyClosed = false;
  private 要求セッションID: string | null = null; // 要求されたセッションID
  private 要求ソケット番号: string | null = null; // 要求されたソケット番号


  private 接続取消: (() => void) | null = null
  private 認証期限タイマー: number | null = null
  private readonly 認証切断 = () => this.disconnect()
  private readonly 認証変更 = (event: StorageEvent) => {
    if (event.key === null || (event.key === 'token' && !event.newValue)) {
      this.disconnect()
      useAuthStore().logout()
    }
  }
  private 認証確認(): string {
    try { return ログイントークン取得().token } catch (error) {
      this.disconnect()
      useAuthStore().logout()
      throw error
    }
  }
  private 認証利用可能(): boolean {
    try { this.認証確認(); return true } catch { return false }
  }
  private 認証期限監視(): void {
    if (!this.認証利用可能()) return
    const remaining = ログイントークン取得().expires - Date.now()
    this.認証期限タイマー = window.setTimeout(() => this.認証期限監視(), Math.min(remaining, 2147483647))
  }

  private reconnectTimer: number | null = null
  private readonly maxReconnectAttempts = 5
  private readonly maxReconnectDelayMs = 15000
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  constructor(private url: string, セッションID?: string, ソケット番号?: string, private codeBasePath = '') {
    this.要求セッションID = セッションID || null;
    this.要求ソケット番号 = typeof ソケット番号 === 'string' ? ソケット番号 : null;
  }

  /**
   * WebSocket接続を確立
   */
  async connect(): Promise<string> {
    this.disconnect()
    const token = this.認証確認()
    this.isIntentionallyClosed = false
    window.addEventListener('auth-cleared', this.認証切断)
    window.addEventListener('storage', this.認証変更)
    this.認証期限監視()

    return new Promise<string>((resolve, reject) => {
      let socket: WebSocket
      try {
        // JWT は URL・connect packet・ログへ入れず、upgrade 時だけ提示する。
        socket = new WebSocket(this.url, ['aidiy-auth', `bearer.${token}`])
      } catch {
        this.disconnect()
        reject(new Error('WebSocket connection error'))
        return
      }
      this.ws = socket
      let settled = false

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      const timeoutId = window.setTimeout(() => {
        fail(new Error('WebSocket initialization timeout'))
        this.disconnect()
      }, 30000)
      this.接続取消 = () => {
        window.clearTimeout(timeoutId)
        fail(new Error('WebSocket connection cancelled'))
      }

      socket.onopen = () => {
        if (this.ws !== socket || this.isIntentionallyClosed) {
          socket.close()
          return
        }
        if (!this.認証利用可能()) return
        this.reconnectAttempts = 0
        socket.send(JSON.stringify({
          type: 'connect',
          セッションID: this.要求セッションID || null,
          ソケット番号: this.要求ソケット番号 || null,
          ...(this.codeBasePath ? { CODE_BASE_PATH: this.codeBasePath } : {}),
        }))
        // 接続通知を先に送り、状態ハンドラの送信が初回受信になるのを防ぐ。
        this.emitState(true)
      }

      socket.onmessage = (event) => {
        if (this.ws !== socket || this.isIntentionallyClosed) return
        let message: WebSocketMessage
        try {
          message = JSON.parse(String(event.data)) as WebSocketMessage
        } catch {
          return
        }

        const messageType = String(message.メッセージ識別 || message.type || '')
        if (!settled && messageType === 'error') {
          this.isIntentionallyClosed = true
          window.clearTimeout(timeoutId)
          fail(new Error(String(message.メッセージ内容 || '接続に失敗しました。')))
          this.disconnect()
        }
        if (messageType === 'init' && typeof message.セッションID === 'string' && message.セッションID) {
          this.セッションID = message.セッションID
          this.要求セッションID = message.セッションID
          if (typeof message.ソケット番号 === 'string' && message.ソケット番号) {
            this.要求ソケット番号 = message.ソケット番号
          }
          if (!settled) {
            settled = true
            window.clearTimeout(timeoutId)
            resolve(this.セッションID)
          }
        }

        this.handleMessage(message)
      }

      socket.onerror = () => {
        if (!settled) {
          window.clearTimeout(timeoutId)
          fail(new Error('WebSocket connection error'))
        }
      }

      socket.onclose = (event) => {
        window.clearTimeout(timeoutId)
        if (!settled) {
          fail(new Error(`WebSocket connection closed: ${event.code} ${event.reason}`.trim()))
        }
        if (this.ws !== socket) return
        this.emitState(false)
        this.ws = null
        this.セッションID = null
        window.clearTimeout(timeoutId)

        if (!settled) return

        // 4000: サーバーが同じセッション・チャンネルの新しい接続へ置き換えた。
        // 再接続すると新しい接続を閉じ返し、互いに置き換え合う繰り返しになるため再接続しない。
        if ([4000, 1008, 4401, 4403].includes(event.code)) {
          this.disconnect()
          return
        }

        if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts += 1
          this.reconnectTimer = window.setTimeout(() => {
            if (!this.isIntentionallyClosed) void this.connect().catch(() => undefined)
          }, Math.min(3000 * this.reconnectAttempts, this.maxReconnectDelayMs))
        }
      }
    })
  }


  /**
   * メッセージを送信
   */
  send(message: WebSocketMessage): void {
    if (!this.認証利用可能()) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      入力系認証トークン更新(message);

      // 接続時に確定したプロジェクトを要求単位で渡す。選択ファイルのパスは使わない。
      const 入力要求 = 認証延長対象メッセージ識別.has(String(message.メッセージ識別 || message.type || ''));
      const payload: WebSocketMessage = {
        ...message,
        ...(入力要求 ? { プロジェクトパス: message.プロジェクトパス ?? (this.codeBasePath || null) } : {}),
        セッションID: message.セッションID ?? this.セッションID ?? this.要求セッションID,
      };
      this.ws.send(JSON.stringify(payload));
      console.log('[WebSocket] 送信:', message.type);
    } else {
      console.error('[WebSocket] 送信失敗: 接続されていません');
    }
  }

  /**
   * メッセージハンドラを登録
   */
  on(messageType: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType)!.push(handler);
  }

  /**
   * メッセージハンドラを削除
   */
  off(messageType: string, handler?: MessageHandler): void {
    if (!handler) {
      // ハンドラ指定なしの場合は全て削除
      this.messageHandlers.delete(messageType);
    } else {
      const handlers = this.messageHandlers.get(messageType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    }
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.isConnected());
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /**
   * 受信メッセージを処理
   */
  private handleMessage(message: WebSocketMessage): void {
    // メッセージ識別をtypeに統一
    const messageType = message.メッセージ識別 || message.type || '';
    if (!message.type && message.メッセージ識別) {
      message.type = message.メッセージ識別;
    }
    const channel = message.チャンネル ?? null;

    // チャンネルが指定されている場合はチャンネル別イベントを配信
    if (channel !== null && channel !== undefined) {
      const channelSpecificType = `${messageType}_${channel}`;
      const channelHandlers = this.messageHandlers.get(channelSpecificType);
      if (channelHandlers) {
        channelHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (error) {
            console.error('[WebSocket] チャンネル別ハンドラエラー:', error);
          }
        });
      }
    }

    // チャンネル指定の有無に関わらず、共通イベントハンドラを実行
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocket] ハンドラエラー:', error);
        }
      });
    }

    // 全てのメッセージを受け取る汎用ハンドラ
    const allHandlers = this.messageHandlers.get('*');
    if (allHandlers) {
      allHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocket] 汎用ハンドラエラー:', error);
        }
      });
    }
  }

  /**
   * 接続を切断
   */
  disconnect(): void {
    this.isIntentionallyClosed = true

    this.接続取消?.()
    this.接続取消 = null
    if (this.認証期限タイマー !== null) window.clearTimeout(this.認証期限タイマー)
    this.認証期限タイマー = null
    window.removeEventListener('auth-cleared', this.認証切断)
    window.removeEventListener('storage', this.認証変更)
    this.clearReconnectTimer()
    if (this.ws) this.ws.close()
    this.ws = null
    this.セッションID = null
    this.emitState(false)
  }

  /**
   * セッションIDを取得
   */
  セッションID取得(): string | null {
    return this.セッションID;
  }

  /**
   * 接続状態を取得
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Pingを送信
   */
  sendPing(): void {
    this.send({
      type: 'ping',
      timestamp: Date.now()
    });
  }

  /**
   * ボタン状態を更新
   */
  updateState(ボタン: any): void {
    this.send({
      セッションID: this.セッションID,
      チャンネル: null,
      メッセージ識別: 'operations',
      メッセージ内容: { ボタン }
    });
  }

  /**
   * チャットメッセージを送信
   */
  sendChatMessage(message: string): void {
    console.warn('[WebSocket] sendChatMessage は廃止されました');
  }

  /**
   * テキスト入力を送信
   * 入力は常にチャンネルinputで送信、出力先チャンネルを別途指定
   */
  sendInputText(text: string, 出力先チャンネル: string): void {
    console.log(`[WebSocket] sendInputText: 入力チャンネル="input", 出力先チャンネル=${出力先チャンネル}, text="${text.substring(0, 50)}..."`);
    this.send({
      セッションID: this.セッションID,
      チャンネル: 'input',  // 入力は常にinput
      メッセージ識別: 'input_text',
      メッセージ内容: text,
      出力先チャンネル: 出力先チャンネル,  // バックエンドが参照して振り分け
      ファイル名: null,
      サムネイル画像: null
    });
  }

  /**
   * ストリーミングリクエストを送信
   */
  requestStream(data: any): void {
    console.warn('[WebSocket] requestStream は廃止されました');
  }

  private emitState(connected: boolean): void {
    this.stateHandlers.forEach((handler) => handler(connected));
  }
}

export { AIWebSocket as AIコアWebSocket };

/**
 * WebSocket URLを生成
 */
export function createWebSocketUrl(path: string): string {
  // 現在のプロトコルとホストを使用（Vite proxyを経由）
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = window.location.port;

  const url = `${protocol}//${host}:${port}${path}`;
  console.log('[WebSocket] URL生成:', url, '(DEV:', import.meta.env.DEV, ')');
  return url;
}


