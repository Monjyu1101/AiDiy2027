// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import { AI_WS_ENDPOINT } from '@/api/config'
import apiClient from '@/api/client'

const 認証延長対象メッセージ識別 = new Set(['input_text', 'input_file', 'input_image', 'input_request'])
let 認証トークン更新中 = false

function 認証Storage取得(): Storage {
  return window.desktopApi ? localStorage : sessionStorage
}

function 入力系認証トークン更新(message: WebSocketMessage): void {
  const メッセージ識別 = String(message.メッセージ識別 || message.type || '')
  if (!認証延長対象メッセージ識別.has(メッセージ識別) || 認証トークン更新中) return

  const 認証Storage = 認証Storage取得()
  const requestToken = 認証Storage.getItem('token')
  if (!requestToken) return

  認証トークン更新中 = true
  void apiClient.post('/core/auth/トークン更新')
    .then((response) => {
      const nextToken = response.data?.data?.access_token
      if (response.data?.status === 'OK' && nextToken && 認証Storage.getItem('token') === requestToken) {
        認証Storage.setItem('token', nextToken)
      }
    })
    .catch(() => {
      // 401はapiClient側で認証期限切れとして処理する
    })
    .finally(() => {
      認証トークン更新中 = false
    })
}


// 期限の事前確認のみ。署名・利用者・権限の検証は必ずサーバー側で行う。
function ログイントークン取得(): { token: string; expires: number } {
  const token = 認証Storage取得().getItem('token') || ''
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

export type WebSocketMessage = {
  type?: string
  セッションID?: string
  プロジェクトパス?: string | null
  ソケット番号?: string
  チャンネル?: string | null
  出力先チャンネル?: string
  メッセージ識別?: string
  メッセージ内容?: unknown
  ファイル名?: string | null
  サムネイル画像?: string | null
  error?: string
  [key: string]: unknown
}

export type MessageHandler = (message: WebSocketMessage) => void
export type StateHandler = (connected: boolean) => void

export interface IWebSocketClient {
  connect(): Promise<string>
  send(message: WebSocketMessage): void
  on(messageType: string, handler: MessageHandler): void
  off(messageType: string, handler?: MessageHandler): void
  disconnect(): void
  セッションID取得(): string | null
  isConnected(): boolean
  sendPing(): void
  updateState(ボタン: unknown): void
  sendChatMessage(message: string): void
  sendInputText(text: string, 出力先チャンネル?: string): void
  requestStream(data: unknown): void
  onStateChange(handler: StateHandler): () => void
}

/** backend_server の AIセッション管理 が、同じチャンネルの新しい接続へ置き換えるときに使う切断コード */
export const REPLACED_CLOSE_CODE = 4000

export class AIWebSocket implements IWebSocketClient {
  private socket: WebSocket | null = null
  private sessionId: string | null = null
  private readonly handlers = new Map<string, Set<MessageHandler>>()
  private readonly stateHandlers = new Set<StateHandler>()
  private reconnectAttempts = 0
  // Avatar には手動の再接続ボタンがないため、回数で打ち切らず間隔を延ばしながら再接続を続ける。
  // バックエンドの再起動（約30秒）後も、利用者の操作なしで接続を戻す。
  private readonly maxReconnectDelayMs = 15000
  private reconnectTimer: number | null = null
  private intentionallyClosed = false


  private 接続取消: (() => void) | null = null
  private 認証期限タイマー: number | null = null
  private readonly 認証切断 = () => this.disconnect()
  private readonly 認証変更 = (event: StorageEvent) => {
    if (event.key === null || (event.key === 'token' && !event.newValue)) this.disconnect()
  }
  private 認証確認(): string {
    try { return ログイントークン取得().token } catch (error) {
      this.disconnect()
      window.dispatchEvent(new Event('auth-expired'))
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

  constructor(
    private readonly url: string,
    private requestedSessionId = '',
    private requestedSocketNumber = '',
    private readonly codeBasePath = '',
  ) {}

  async connect(): Promise<string> {
    this.disconnect()
    const token = this.認証確認()
    this.intentionallyClosed = false
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
      this.socket = socket
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
        if (this.socket !== socket || this.intentionallyClosed) {
          socket.close()
          return
        }
        if (!this.認証利用可能()) return
        this.reconnectAttempts = 0
        socket.send(JSON.stringify({
          type: 'connect',
          セッションID: this.requestedSessionId || null,
          ソケット番号: this.requestedSocketNumber || null,
          ...(this.codeBasePath ? { CODE_BASE_PATH: this.codeBasePath } : {}),
        }))
        // 接続通知を先に送り、状態ハンドラの送信が初回受信になるのを防ぐ。
        this.emitState(true)
      }

      socket.onmessage = (event) => {
        if (this.socket !== socket || this.intentionallyClosed) return
        let message: WebSocketMessage
        try {
          message = JSON.parse(String(event.data)) as WebSocketMessage
        } catch {
          return
        }

        const messageType = String(message.メッセージ識別 || message.type || '')
        if (!settled && messageType === 'error') {
          this.intentionallyClosed = true
          window.clearTimeout(timeoutId)
          fail(new Error(String(message.メッセージ内容 || '接続に失敗しました。')))
          this.disconnect()
        }
        if (messageType === 'init' && typeof message.セッションID === 'string' && message.セッションID) {
          this.sessionId = message.セッションID
          this.requestedSessionId = message.セッションID
          if (typeof message.ソケット番号 === 'string' && message.ソケット番号) {
            this.requestedSocketNumber = message.ソケット番号
          }
          if (!settled) {
            settled = true
            window.clearTimeout(timeoutId)
            resolve(this.sessionId)
          }
        }

        this.dispatchMessage(messageType, message)
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
        if (this.socket !== socket) return
        this.emitState(false)
        this.socket = null
        this.sessionId = null
        window.clearTimeout(timeoutId)

        if (!settled) return

        // 4000: サーバーが同じセッション・チャンネルの新しい接続へ置き換えた。
        // 再接続すると新しい接続を閉じ返し、互いに置き換え合う繰り返しになるため再接続しない。
        if ([4000, 1008, 4401, 4403].includes(event.code)) {
          this.disconnect()
          return
        }

        if (!this.intentionallyClosed) {
          this.reconnectAttempts += 1
          this.reconnectTimer = window.setTimeout(() => {
            if (!this.intentionallyClosed) void this.connect().catch(() => undefined)
          }, Math.min(3000 * this.reconnectAttempts, this.maxReconnectDelayMs))
        }
      }
    })
  }

  send(message: WebSocketMessage): void {
    if (!this.認証利用可能()) return
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    入力系認証トークン更新(message)

    // 別ウィンドウで確定済みの値は保持し、未指定時だけ接続時のプロジェクトを使う。
    const 入力要求 = 認証延長対象メッセージ識別.has(String(message.メッセージ識別 || message.type || ''))
    const payload: WebSocketMessage = {
      ...message,
      ...(入力要求 ? { プロジェクトパス: message.プロジェクトパス ?? (this.codeBasePath || null) } : {}),
      セッションID: message.セッションID ?? this.sessionId ?? this.requestedSessionId,
    }
    this.socket.send(JSON.stringify(payload))
  }

  on(messageType: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(messageType) ?? new Set<MessageHandler>()
    handlers.add(handler)
    this.handlers.set(messageType, handlers)
  }

  off(messageType: string, handler?: MessageHandler): void {
    if (!handler) {
      this.handlers.delete(messageType)
      return
    }

    const handlers = this.handlers.get(messageType)
    if (!handlers) return
    handlers.delete(handler)
    if (handlers.size === 0) {
      this.handlers.delete(messageType)
    }
  }

  セッションID取得(): string | null {
    return this.sessionId
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  sendPing(): void {
    this.send({ type: 'ping', timestamp: Date.now() })
  }

  updateState(ボタン: unknown): void {
    this.send({
      チャンネル: null,
      メッセージ識別: 'operations',
      メッセージ内容: { ボタン },
    })
  }

  sendChatMessage(message: string): void {
    this.sendInputText(message, '0')
  }

  sendInputText(text: string, 出力先チャンネル = '0'): void {
    this.send({
      チャンネル: 'input',
      メッセージ識別: 'input_text',
      メッセージ内容: text,
      出力先チャンネル,
      ファイル名: null,
      サムネイル画像: null,
    })
  }

  requestStream(_data: unknown): void {
    console.warn('[AIWebSocket] requestStream は未使用です')
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    handler(this.isConnected())
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  disconnect(): void {
    this.intentionallyClosed = true

    this.接続取消?.()
    this.接続取消 = null
    if (this.認証期限タイマー !== null) window.clearTimeout(this.認証期限タイマー)
    this.認証期限タイマー = null
    window.removeEventListener('auth-cleared', this.認証切断)
    window.removeEventListener('storage', this.認証変更)
    this.clearReconnectTimer()
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    this.sessionId = null
    this.emitState(false)
  }

  private dispatchMessage(messageType: string, message: WebSocketMessage): void {
    if (!messageType) return

    const channel = typeof message.チャンネル === 'string' ? message.チャンネル : null
    if (channel) {
      this.handlers.get(`${messageType}_${channel}`)?.forEach((handler) => handler(message))
    }
    this.handlers.get(messageType)?.forEach((handler) => handler(message))
    this.handlers.get('*')?.forEach((handler) => handler(message))
  }

  private emitState(connected: boolean): void {
    this.stateHandlers.forEach((handler) => handler(connected))
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

export { AIWebSocket as AIコアWebSocket }

export function createWebSocketUrl(path: string): string {
  if (path === '/core/ws/AIコア') {
    return AI_WS_ENDPOINT
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.hostname
  const port = window.location.port
  return `${protocol}//${host}:${port}${path}`
}
