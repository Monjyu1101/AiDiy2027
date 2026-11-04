<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import apiClient from '@/api/client'
import { AI_WS_ENDPOINT } from '@/api/config'
import { AIWebSocket, type IWebSocketClient } from '@/api/websocket'
import AIコードファイル内容表示 from '@/dialog/ファイル内容表示.vue'
import AIコード更新ファイル一覧 from '@/dialog/更新ファイル一覧.vue'
import { AIストリーム制御判定, AIストリーム表示内容 } from '@/utils/AIストリーム制御'

type コードチャンネル = '1' | '2' | '3' | '4' | '5' | '6'
type 行種別 =
  | 'input_text'
  | 'input_request'
  | 'output_text'
  | 'welcome_text'
  | 'input_file'
  | 'output_file'
  | 'cancel_run'

type 行データ = {
  id: string
  role: 行種別
  content: string
  render: 'effect' | 'static'
  kind: 'text' | 'file'
  fileName?: string | null
  thumbnail?: string | null
  isStream?: boolean
  isCollapsed?: boolean
}

const プロパティ = defineProps<{
  セッションID: string
  active?: boolean
  チャンネル: コードチャンネル
  codeAi: string
  入力接続済み: boolean
}>()

const 通知 = defineEmits<{
  submit: [text: string, channel: コードチャンネル, 検証ループ回数: number]
  cancel: [channel: コードチャンネル]
  'send-file': [payload: { channel: コードチャンネル; fileName: string; base64: string }]
  activate: []
}>()

const 出力接続済み = ref(false)
const WebSocket接続中 = computed(() => プロパティ.入力接続済み && 出力接続済み.value)
const 接続状態表示 = computed(() => (WebSocket接続中.value ? '接続中' : '切断'))

const メッセージ一覧 = ref<行データ[]>([])
const コンテンツ領域 = ref<HTMLElement | null>(null)
const 入力テキスト = ref('')
const テキストエリア = ref<HTMLTextAreaElement | null>(null)
const 送信ボタン = ref<HTMLButtonElement | null>(null)

// Enter は通常の改行。Tab で送信ボタンへ移動し、そこで Enter を押すと送信する。
function キー入力処理(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
      || event.isComposing || event.keyCode === 229) return
  if (!送信ボタン.value || 送信ボタン.value.disabled) return
  event.preventDefault()
  送信ボタン.value.focus()
}
const 送信中 = ref(false)
const 検証ループ回数 = ref(1)
const ストリーム受信中 = ref(false)
const ドラッグ中 = ref(false)
const 入力欄最大到達 = ref(false)
const 入力欄固定中 = ref(false)
const 入力欄固定高さ = ref(60)
const 入力欄最小高さ = 60
const 入力欄最大高さ = ref(380)
const ウェルカム内容 = ref('')
const 更新ファイル一覧 = ref<string[]>([])
const 更新ファイルダイアログ表示 = ref(false)
const ファイル内容ダイアログ表示 = ref(false)
const 表示ファイル名 = ref('')
const 表示base64_data = ref('')

const ウェルカムテキスト受信済み = ref(false)

const 出力WebSocket = ref<IWebSocketClient | null>(null)
let 出力状態購読解除: (() => void) | null = null
let メッセージID連番 = 0
let ストリームメッセージID: string | null = null

type 演出状態 = {
  textSpan: HTMLElement
  cursorSpan: HTMLElement
  queue: string[]
  running: boolean
  ready: boolean
  finalizeOnEmpty: boolean
  isStream: boolean
  blinkInterval: ReturnType<typeof setInterval>
}

const 演出状態Map = new Map<string, 演出状態>()

function 最下部スクロール() {
  nextTick(() => {
    if (コンテンツ領域.value) {
      コンテンツ領域.value.scrollTop = コンテンツ領域.value.scrollHeight
    }
  })
}

function 新規メッセージID() {
  return `code-${プロパティ.チャンネル}-${プロパティ.セッションID || 'nosession'}-${メッセージID連番++}`
}

function 速度設定(文字数: number, isStream: boolean) {
  if (isStream) {
    return { interval: 2, batch: Math.max(8, Math.floor(文字数 / 12) + 2) }
  }
  return { interval: 10, batch: Math.floor(文字数 / 50) + 1 }
}

function カーソル色取得(role: 行種別) {
  switch (role) {
    case 'input_text':
      return '#ffffff'
    case 'input_request':
      return '#00ffff'
    case 'cancel_run':
      return '#ff4444'
    default:
      return '#00ff00'
  }
}

function 演出初期化(メッセージID: string, 表示領域: HTMLElement, カーソル色: string, isStream: boolean) {
  表示領域.innerHTML = ''

  const textSpan = document.createElement('span')
  textSpan.className = 'terminal-text'
  表示領域.appendChild(textSpan)

  const cursorSpan = document.createElement('span')
  cursorSpan.className = 'terminal-cursor'
  cursorSpan.textContent = '\u0020'
  cursorSpan.style.display = 'inline-block'
  cursorSpan.style.width = '8px'
  cursorSpan.style.backgroundColor = カーソル色
  cursorSpan.style.color = '#000000'
  表示領域.appendChild(cursorSpan)

  let blinkVisible = true
  const blinkInterval = setInterval(() => {
    cursorSpan.style.backgroundColor = blinkVisible ? 'transparent' : カーソル色
    blinkVisible = !blinkVisible
  }, 300)

  演出状態Map.set(メッセージID, {
    textSpan,
    cursorSpan,
    queue: [],
    running: false,
    ready: false,
    finalizeOnEmpty: false,
    isStream,
    blinkInterval,
  })

  最下部スクロール()

  window.setTimeout(() => {
    const state = 演出状態Map.get(メッセージID)
    if (!state) return
    state.ready = true
    演出実行(メッセージID)
  }, isStream ? 30 : 500)
}

function 演出キュー追加(メッセージID: string, 文字列: string, finalize: boolean) {
  const state = 演出状態Map.get(メッセージID)
  if (!state) return
  if (文字列) {
    state.queue.push(文字列)
  }
  if (finalize) {
    state.finalizeOnEmpty = true
  }
  演出実行(メッセージID)
}

function 演出実行(メッセージID: string) {
  const state = 演出状態Map.get(メッセージID)
  if (!state || state.running || !state.ready) return

  if (state.queue.length === 0) {
    if (!state.finalizeOnEmpty) return
    state.cursorSpan.remove()
    clearInterval(state.blinkInterval)
    演出状態Map.delete(メッセージID)
    最下部スクロール()
    return
  }

  state.running = true
  const chunk = state.queue.shift() ?? ''
  const { interval, batch } = 速度設定(chunk.length, state.isStream)
  let index = 0

  const tick = () => {
    if (演出状態Map.get(メッセージID) !== state) return
    const end = Math.min(index + batch, chunk.length)
    if (end > index) {
      state.textSpan.textContent += chunk.slice(index, end)
      index = end
      nextTick(最下部スクロール)
    }
    if (index >= chunk.length) {
      state.running = false
      nextTick(最下部スクロール)
      演出実行(メッセージID)
      return
    }
    window.setTimeout(tick, interval)
  }

  tick()
}

function ファイルメッセージ追加(role: 行種別, fileName?: string | null, thumbnail?: string | null) {
  メッセージ一覧.value.push({
    id: 新規メッセージID(),
    role,
    content: '',
    render: 'static',
    kind: 'file',
    fileName: fileName ?? null,
    thumbnail: thumbnail ?? null,
  })
  最下部スクロール()
}

function ターミナルメッセージ追加(role: 行種別, 内容: string, 追加オプション?: Partial<行データ>, finalize = true) {
  const メッセージID = 新規メッセージID()
  メッセージ一覧.value.push({
    id: メッセージID,
    role,
    content: 内容,
    render: 'effect',
    kind: 'text',
    ...(追加オプション || {}),
  })

  nextTick(() => {
    const メッセージ要素 = document.getElementById(メッセージID)
    const bubbleElement = メッセージ要素?.querySelector('.content-area') as HTMLElement | null
    if (!bubbleElement) return
    演出初期化(メッセージID, bubbleElement, カーソル色取得(role), Boolean(追加オプション?.isStream))
    演出キュー追加(メッセージID, 内容, finalize)
  })
}

function 受信内容文字列(message: Record<string, unknown>) {
  const value = message.メッセージ内容 ?? message.text ?? ''
  if (!value) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function ウェルカム処理(message: Record<string, unknown>) {
  const 内容 = 受信内容文字列(message)
  if (内容) {
    // 接続時に再送される履歴は置き換え、履歴だけではタブを切り替えない。
    for (const state of 演出状態Map.values()) clearInterval(state.blinkInterval)
    演出状態Map.clear()
    メッセージ一覧.value = []
    ストリームメッセージID = null
    ウェルカムテキスト受信済み.value = false
    ウェルカム内容.value = 内容
  }
}

function 入力テキスト受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(message)
  if (内容) {
    ターミナルメッセージ追加('input_text', `> ${内容}`)
  }
}

function 入力リクエスト受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(message)
  if (内容) {
    ターミナルメッセージ追加('input_request', 内容)
  }
}

function 入力ファイル受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  ファイルメッセージ追加('input_file', String(message.ファイル名 || ''), (message.サムネイル画像 as string) ?? null)
}

function 出力テキスト受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(message)
  if (内容) {
    ターミナルメッセージ追加('output_text', 内容)
  }
  送信中.value = false
}

function ウェルカムテキスト受信処理(message: Record<string, unknown>) {
  if (ウェルカムテキスト受信済み.value) {
    表示時アクティブ化()
  }
  const 内容 = 受信内容文字列(message)
  if (内容) {
    ターミナルメッセージ追加('welcome_text', 内容)
    ウェルカムテキスト受信済み.value = true
  }
}

function 出力ファイル受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  ファイルメッセージ追加('output_file', String(message.ファイル名 || ''), (message.サムネイル画像 as string) ?? null)
}

function cancel_run受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(message)
  if (内容) {
    ターミナルメッセージ追加('cancel_run', `> ${内容}`)
  }
  送信中.value = false
  ストリーム受信中.value = false
  ストリームメッセージID = null
}

function update_info受信処理(message: Record<string, unknown>) {
  const content = message.メッセージ内容
  if (!content || typeof content !== 'object' || !Array.isArray((content as { update_files?: unknown[] }).update_files)) {
    return
  }

  const files = (content as { update_files: unknown[] }).update_files.filter(
    (file): file is string => typeof file === 'string' && file.length > 0,
  )
  if (files.length === 0) return

  表示時アクティブ化()
  更新ファイル一覧.value = files
  更新ファイルダイアログ表示.value = true
}

function 出力ストリーム受信処理(message: Record<string, unknown>) {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(message)
  if (!内容) return
  const 制御種別 = AIストリーム制御判定(内容)

  if (制御種別 === '開始') {
    const メッセージID = 新規メッセージID()
    ストリームメッセージID = メッセージID
    ストリーム受信中.value = true

    メッセージ一覧.value.push({
      id: メッセージID,
      role: 'output_text',
      content: '',
      render: 'effect',
      kind: 'text',
      isStream: true,
      isCollapsed: false,
    })

    nextTick(() => {
      const メッセージ要素 = document.getElementById(メッセージID)
      const bubbleElement = メッセージ要素?.querySelector('.content-area') as HTMLElement | null
      if (!bubbleElement) return
      演出初期化(メッセージID, bubbleElement, '#00ffff', true)
    })
    return
  }

  if (制御種別 === '終了' || 制御種別 === '中断') {
    if (ストリームメッセージID) {
      演出キュー追加(ストリームメッセージID, '', true)
      const target = メッセージ一覧.value.find((msg) => msg.id === ストリームメッセージID)
      if (target) {
        target.isCollapsed = true
      }
    }
    ストリームメッセージID = null
    ストリーム受信中.value = false
    送信中.value = false
    return
  }

  const 表示内容 = AIストリーム表示内容(内容)
  if (!表示内容) return

  if (ストリームメッセージID) {
    演出キュー追加(ストリームメッセージID, `${表示内容}\n`, false)
    return
  }

  const メッセージID = 新規メッセージID()
  ストリームメッセージID = メッセージID
  ストリーム受信中.value = true
  メッセージ一覧.value.push({
    id: メッセージID,
    role: 'output_text',
    content: '',
    render: 'effect',
    kind: 'text',
    isStream: true,
    isCollapsed: false,
  })

  nextTick(() => {
    const メッセージ要素 = document.getElementById(メッセージID)
    const bubbleElement = メッセージ要素?.querySelector('.content-area') as HTMLElement | null
    if (!bubbleElement) return
    演出初期化(メッセージID, bubbleElement, '#00ffff', true)
    演出キュー追加(メッセージID, `${表示内容}\n`, false)
  })
}

function 表示時アクティブ化() {
  if (!ウェルカムテキスト受信済み.value) return
  通知('activate')
}

function WSハンドラ登録(socket: IWebSocketClient) {
  socket.on('welcome_info', ウェルカム処理)
  socket.on('welcome_text', ウェルカムテキスト受信処理)
  socket.on('input_text', 入力テキスト受信処理)
  socket.on('input_request', 入力リクエスト受信処理)
  socket.on('input_file', 入力ファイル受信処理)
  socket.on('output_text', 出力テキスト受信処理)
  socket.on('output_stream', 出力ストリーム受信処理)
  socket.on('output_file', 出力ファイル受信処理)
  socket.on('update_info', update_info受信処理)
  socket.on('cancel_run', cancel_run受信処理)
}

function WSハンドラ解除(socket: IWebSocketClient) {
  socket.off('welcome_info', ウェルカム処理)
  socket.off('welcome_text', ウェルカムテキスト受信処理)
  socket.off('input_text', 入力テキスト受信処理)
  socket.off('input_request', 入力リクエスト受信処理)
  socket.off('input_file', 入力ファイル受信処理)
  socket.off('output_text', 出力テキスト受信処理)
  socket.off('output_stream', 出力ストリーム受信処理)
  socket.off('output_file', 出力ファイル受信処理)
  socket.off('update_info', update_info受信処理)
  socket.off('cancel_run', cancel_run受信処理)
}

async function 出力ソケット接続() {
  if (!プロパティ.セッションID) return
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value)
    出力状態購読解除?.()
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
    出力状態購読解除 = null
  }
  const socket = new AIWebSocket(AI_WS_ENDPOINT, プロパティ.セッションID, プロパティ.チャンネル)
  出力WebSocket.value = socket
  出力状態購読解除 = socket.onStateChange((connected) => {
    出力接続済み.value = connected
  })
  WSハンドラ登録(socket)
  try {
    await socket.connect()
  } catch (error) {
    ターミナルメッセージ追加('cancel_run', error instanceof Error ? error.message : '接続エラー')
  }
}

function 入力欄状態リセット() {
  入力欄最大到達.value = false
  入力欄固定中.value = false
  入力欄固定高さ.value = 入力欄最小高さ
  if (テキストエリア.value) {
    テキストエリア.value.style.height = `${入力欄最小高さ}px`
  }
}

function 入力欄クリア() {
  入力テキスト.value = ''
  入力欄状態リセット()
  nextTick(() => {
    テキストエリア.value?.focus()
    テキストエリア自動調整()
  })
}

function 入力欄最大高さ更新() {
  if (!テキストエリア.value) return
  const container = テキストエリア.value.closest('.agent-container') as HTMLElement | null
  if (container) {
    入力欄最大高さ.value = Math.max(入力欄最小高さ, Math.floor(container.clientHeight * 0.78))
  }
}

function テキストエリア自動調整() {
  if (!テキストエリア.value) return

  入力欄最大高さ更新()
  if (入力テキスト.value.length === 0) {
    入力欄状態リセット()
    return
  }

  if (入力欄固定中.value) {
    入力欄最大到達.value = true
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`
    return
  }

  テキストエリア.value.style.height = `${入力欄最小高さ}px`
  const nextHeight = Math.max(テキストエリア.value.scrollHeight, 入力欄最小高さ)
  if (nextHeight >= 入力欄最大高さ.value) {
    入力欄最大到達.value = true
    入力欄固定中.value = true
    入力欄固定高さ.value = 入力欄最大高さ.value
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`
    return
  }

  入力欄最大到達.value = false
  テキストエリア.value.style.height = `${nextHeight}px`
}

function メッセージ送信() {
  const text = 入力テキスト.value.trim()
  if (!text || 送信中.value || !WebSocket接続中.value) return
  通知('submit', text, プロパティ.チャンネル, 検証ループ回数.value)
  入力テキスト.value = ''
  入力欄状態リセット()
  送信中.value = true
}

function キャンセル送信() {
  if (!ストリーム受信中.value || !WebSocket接続中.value) return
  通知('cancel', プロパティ.チャンネル)
}

async function ファイルをBase64読込(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

async function 入力ファイル送信(ファイル: File) {
  const base64 = await ファイルをBase64読込(ファイル)
  通知('send-file', { channel: プロパティ.チャンネル, fileName: ファイル.name, base64 })
}

function ドロップ処理(event: DragEvent) {
  event.preventDefault()
  ドラッグ中.value = false
  if (!WebSocket接続中.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  for (const ファイル of files) {
    void 入力ファイル送信(ファイル)
  }
}

function ドラッグオーバー処理(event: DragEvent) {
  event.preventDefault()
  if (WebSocket接続中.value) {
    ドラッグ中.value = true
  }
}

function ドラッグ離脱処理(event: DragEvent) {
  event.preventDefault()
  if (event.currentTarget === event.target) {
    ドラッグ中.value = false
  }
}

const 貼り付け対象ロール: 行種別[] = ['input_text', 'input_request', 'input_file', 'output_file', 'output_text']
const 画像拡張子セット = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const テキスト拡張子セット = new Set([
  'py', 'vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt',
  'html', 'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml',
  'ini', 'env', 'sql', 'csv', 'log', 'xml', 'sh', 'ps1', 'bat',
])

function 右トリム(text: string) {
  return text.replace(/\s+$/u, '')
}

function 拡張子取得(fileName: string) {
  const queryRemoved = (fileName || '').split(/[?#]/u, 1)[0] || ''
  const slashIndex = Math.max(queryRemoved.lastIndexOf('/'), queryRemoved.lastIndexOf('\\'))
  const baseName = slashIndex >= 0 ? queryRemoved.slice(slashIndex + 1) : queryRemoved
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return baseName.slice(dotIndex + 1).toLowerCase()
}

function ファイル内容表示対象(fileName: string) {
  const ext = 拡張子取得(fileName)
  return 画像拡張子セット.has(ext) || テキスト拡張子セット.has(ext)
}

function 貼り付け用文字列取得(message: 行データ) {
  if (message.kind === 'file') {
    return message.fileName ? `"${message.fileName}"` : ''
  }
  if (message.role === 'input_text') {
    return message.content.replace(/^>\s*/, '')
  }
  return message.content
}

function メッセージ貼り付け可能(message: 行データ) {
  if (message.isStream) return false
  return 貼り付け対象ロール.includes(message.role)
}

async function ファイル内容表示を開く(fileName: string) {
  if (!ファイル内容表示対象(fileName)) return
  try {
    const response = await apiClient.post('/core/files/内容取得', { ファイル名: fileName })
    if (response?.data?.status !== 'OK') return
    const base64_data = response?.data?.data?.base64_data
    if (typeof base64_data !== 'string' || !base64_data) return
    表示ファイル名.value = fileName
    表示base64_data.value = base64_data
    ファイル内容ダイアログ表示.value = true
  } catch (error) {
    console.error('[AIコード] ファイル内容取得エラー:', error)
  }
}

function ファイル内容ダイアログ閉じる() {
  ファイル内容ダイアログ表示.value = false
  表示ファイル名.value = ''
  表示base64_data.value = ''
}

function 更新ファイルダイアログ閉じる() {
  更新ファイルダイアログ表示.value = false
  更新ファイル一覧.value = []
}

async function メッセージ行クリック処理(message: 行データ) {
  if (message.isStream) {
    if (message.isCollapsed) {
      折りたたみ切替(message.id)
    }
    return
  }

  if (!メッセージ貼り付け可能(message)) return

  const 貼り付け文字列 = 右トリム(貼り付け用文字列取得(message))
  if (!貼り付け文字列) return

  const fileMessage = message.role === 'input_file' || message.role === 'output_file'
  if (fileMessage) {
    const separator = 入力テキスト.value && !入力テキスト.value.endsWith('\n') ? '\n' : ''
    入力テキスト.value = `${入力テキスト.value}${separator}${貼り付け文字列}\n`
  } else {
    入力テキスト.value = `${貼り付け文字列}\n`
  }

  nextTick(() => {
    テキストエリア.value?.focus()
    テキストエリア自動調整()
    if (テキストエリア.value) {
      const length = テキストエリア.value.value.length
      テキストエリア.value.setSelectionRange(length, length)
    }
  })

  if (fileMessage && message.fileName) {
    await ファイル内容表示を開く(message.fileName)
  }
}

function 折りたたみ切替(メッセージID: string) {
  const target = メッセージ一覧.value.find((m) => m.id === メッセージID)
  if (target?.isStream) {
    target.isCollapsed = !target.isCollapsed
  }
}

function メッセージ行カーソル(message: 行データ) {
  if (message.isStream && message.isCollapsed) return 'pointer'
  return メッセージ貼り付け可能(message) ? 'pointer' : 'default'
}

watch(入力テキスト, () => {
  nextTick(テキストエリア自動調整)
})

watch(() => プロパティ.セッションID, (sessionId) => {
  if (sessionId) {
    void 出力ソケット接続()
    return
  }
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value)
    出力状態購読解除?.()
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
    出力状態購読解除 = null
  }
  出力接続済み.value = false
})

watch(() => プロパティ.active, (active) => {
  if (active) {
    最下部スクロール()
  }
})

onMounted(() => {
  if (プロパティ.セッションID) {
    void 出力ソケット接続()
  }
  window.addEventListener('resize', テキストエリア自動調整)
  nextTick(() => {
    入力欄最大高さ更新()
    テキストエリア自動調整()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', テキストエリア自動調整)
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value)
    出力状態購読解除?.()
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
    出力状態購読解除 = null
  }
  for (const state of 演出状態Map.values()) {
    clearInterval(state.blinkInterval)
  }
  演出状態Map.clear()
})

defineExpose({
  WebSocket接続中,
  接続状態表示,
  出力接続済み,
})
</script>

<template>
  <section class="agent-container">
    <div ref="コンテンツ領域" class="agent-content">
      <div v-if="ウェルカム内容" class="welcome-message">{{ ウェルカム内容 }}</div>

      <div
        v-for="message in メッセージ一覧"
        :key="message.id"
        :id="message.id"
        :class="['terminal-line', message.role, message.isStream ? 'stream-output' : '', message.isCollapsed ? 'collapsed' : '']"
      >
        <div class="line-content" @click="メッセージ行クリック処理(message)" :style="{ cursor: メッセージ行カーソル(message) }">
          <div v-if="message.isStream && message.isCollapsed" class="collapsed-wrapper">
            <span class="collapsed-indicator">...</span>
            <span class="collapsed-arrow">◀</span>
          </div>

          <div v-show="!(message.isStream && message.isCollapsed)" class="content-area">
            <template v-if="message.kind === 'file'">
              <div class="file-message">
                <div class="file-name">
                  <span v-if="message.role === 'input_file'">ファイル入力: </span>
                  <span v-else-if="message.role === 'output_file'">ファイル出力: </span>
                  {{ message.fileName || 'ファイル' }}
                </div>
                <img v-if="message.thumbnail" class="file-thumbnail" :src="`data:image/png;base64,${message.thumbnail}`" alt="" />
              </div>
            </template>
            <template v-else-if="message.render === 'static'">
              {{ message.content }}
            </template>
          </div>

          <span
            v-if="message.isStream && !message.isCollapsed"
            class="expand-indicator"
            @click.stop="折りたたみ切替(message.id)"
            title="折りたたむ"
          >▼</span>
        </div>
      </div>

      <div v-if="メッセージ一覧.length === 0" class="empty-message">コードチャンネル {{ プロパティ.チャンネル }}</div>
    </div>

    <div class="control-area">
      <div
        class="text-input-area"
        :class="{ 'drag-over': ドラッグ中 }"
        @dragover="ドラッグオーバー処理"
        @dragleave="ドラッグ離脱処理"
        @drop="ドロップ処理"
      >
        <div class="input-container">
          <span class="prompt-symbol" @click="入力欄クリア">&gt;</span>
          <textarea
            ref="テキストエリア"
            v-model="入力テキスト"
            :class="['input-field', { 'at-limit': 入力欄最大到達 }]"
            :style="{ maxHeight: `${入力欄最大高さ}px` }"
            placeholder="メッセージを入力..."
            maxlength="5000"
            title="Enter で改行、Tab で送信ボタンへ移動"
            :disabled="送信中 || !WebSocket接続中"
            @input="テキストエリア自動調整"
            @keydown="キー入力処理"
          ></textarea>
        </div>

        <div class="verification-options">
          <label class="verification-row">
            <span class="verification-label">検証</span>
            <select v-model.number="検証ループ回数" class="verification-select" title="0回はバックアップ・検証なし">
              <option :value="0">0回</option>
              <option :value="1">1回</option>
              <option :value="2">2回</option>
              <option :value="3">3回</option>
            </select>
          </label>
          <span class="verification-hint">0回:バックアップ・検証無</span>
        </div>

        <button
          ref="送信ボタン"
          class="agent-send-btn"
          :class="{ 'ws-disabled': !WebSocket接続中, 'has-text': 入力テキスト.length > 0 }"
          type="button"
          :disabled="!入力テキスト.trim() || 送信中 || !WebSocket接続中"
          @click="メッセージ送信"
          title="送信（フォーカス中に Enter）"
        >
          <img src="/icons/sending.png" alt="送信" />
          <span class="send-code-label">CODE</span>
        </button>

        <button
          class="agent-cancel-btn"
          :class="{ 'is-active': ストリーム受信中 }"
          type="button"
          :disabled="!ストリーム受信中 || !WebSocket接続中"
          @click="キャンセル送信"
          title="キャンセル"
        >
          <img src="/icons/abort.png" alt="停止" />
        </button>
      </div>
    </div>

    <AIコード更新ファイル一覧
      :show="更新ファイルダイアログ表示"
      :files="更新ファイル一覧"
      @close="更新ファイルダイアログ閉じる"
      @select-file="ファイル内容表示を開く"
    />

    <AIコードファイル内容表示
      :show="ファイル内容ダイアログ表示"
      :ファイル名="表示ファイル名"
      :base64_data="表示base64_data"
      @close="ファイル内容ダイアログ閉じる"
    />
  </section>
</template>

<style scoped>
.verification-options {
  display: grid;
  flex: 0 0 auto;
  height: 48px;
  margin-bottom: 20px;
  align-content: center;
  gap: 1px;
  white-space: nowrap;
}

.verification-row {
  display: grid;
  grid-template-columns: 1fr 52px;
  align-items: center;
  gap: 6px;
}

.verification-label {
  display: flex;
  align-items: center;
  justify-self: start;
  box-sizing: border-box;
  height: 22px;
  padding: 0 8px;
  line-height: normal;
  background: #fff;
  color: #000;
  font-size: 12px;
}

.verification-select {
  box-sizing: border-box;
  width: 52px;
  height: 22px;
  margin: 0;
  padding: 0 2px;
  border: 1px solid #666;
  border-radius: 0;
  background: #333;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.verification-hint {
  color: #999;
  font-size: 9px;
  line-height: 11px;
}

.agent-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.95);
}

.agent-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  overflow-x: auto;
  background: #000000;
  color: #00ff00;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  box-sizing: border-box;
}

.agent-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.agent-content::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.agent-content::-webkit-scrollbar-thumb {
  background: #666666;
  border-radius: 2px;
}

.welcome-message {
  background: rgba(102, 126, 234, 0.08);
  color: #b8c5f2;
  padding: 12px 16px;
  border-radius: 2px;
  margin: 8px auto;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-left: 4px solid rgba(102, 126, 234, 0.6);
  text-align: center;
  max-width: 85%;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  white-space: pre-line;
  line-height: normal;
}

.terminal-line {
  margin: 0;
  padding: 0;
}

.line-content {
  display: inline;
  position: relative;
}

.content-area {
  display: inline;
}

.terminal-line.input_text .line-content {
  color: #ffffff;
}

.terminal-line.input_request .line-content {
  color: #00ffff;
}

.terminal-line.input_request .line-content::before {
  content: 'REQ > ';
  font-weight: bold;
  color: #00ffff;
}

.terminal-line.output_text .line-content,
.terminal-line.welcome_text .line-content {
  color: #00ff00;
}

.terminal-line.cancel_run .line-content {
  color: #ff4444;
  font-weight: bold;
}

.terminal-line.stream-output .line-content {
  color: #00ffff;
  background: rgba(0, 255, 255, 0.12);
  border: 1px solid rgba(0, 255, 255, 0.5);
  border-radius: 4px;
  padding: 0;
  display: block;
  position: relative;
}

.terminal-line.stream-output.collapsed .line-content {
  padding: 8px;
}

.collapsed-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  cursor: pointer;
}

.collapsed-indicator,
.collapsed-arrow {
  color: #ffffff;
  font-size: 14px;
  line-height: 1;
  font-weight: bold;
}

.expand-indicator {
  position: absolute;
  top: 4px;
  right: 8px;
  color: #ffffff;
  font-size: 18px;
  cursor: pointer;
  user-select: none;
}

.expand-indicator:hover {
  color: #cccccc;
}

.terminal-line.input_file .line-content,
.terminal-line.output_file .line-content {
  display: block;
}

.file-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.terminal-line.input_file .file-message {
  border-left: 4px solid rgba(255, 255, 255, 0.7);
}

.terminal-line.output_file .file-message {
  border-left: 4px solid rgba(0, 255, 0, 0.7);
}

.terminal-line.input_file .file-thumbnail,
.terminal-line.output_file .file-thumbnail {
  display: none;
}

.file-name {
  font-size: 11px;
  font-family: 'Courier New', monospace;
  color: #ffffff;
}

.terminal-line.output_file .file-name {
  color: #00ff00;
}

:deep(.terminal-text) {
  display: inline;
  white-space: pre-wrap;
  font-family: 'Courier New', monospace;
  line-height: 1.1;
}

:deep(.terminal-cursor) {
  display: inline !important;
  color: #000000 !important;
  padding: 0 2px !important;
  margin-left: 0 !important;
  font-family: 'Courier New', monospace !important;
  font-weight: bold !important;
}

.empty-message {
  color: #7f8a99;
}

.control-area {
  padding: 10px 20px 0;
  background: #101010;
  border-top: 1px solid #2c2c2c;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.text-input-area {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.text-input-area.drag-over {
  background: rgba(102, 126, 234, 0.2);
  border: 2px dashed #667eea;
  border-radius: 4px;
  padding: 8px;
}

.input-container {
  position: relative;
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.prompt-symbol {
  position: absolute;
  left: 8px;
  top: 12px;
  color: #ffffff;
  font-family: 'Courier New', monospace;
  font-weight: bold;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  z-index: 1;
}

.input-field {
  width: 100%;
  padding: 10px 16px 6px 30px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 0;
  outline: none;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.35);
  color: #e0e0e0;
  box-sizing: border-box;
  resize: none;
  min-height: 60px;
  max-height: 380px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.4;
  height: 60px;
}

.input-field.at-limit {
  font-size: 8px;
  line-height: 1.1;
}

.input-field:disabled {
  border-color: #808080;
  color: #666666;
  background: rgba(128, 128, 128, 0.1);
}

.input-field:focus {
  border-color: #ffffff;
}

.input-field::placeholder {
  color: #888888;
}

.agent-send-btn {
  border: 2px solid #667eea;
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  padding: 0;
  width: 56px;
  height: 48px;
  margin-bottom: 20px;
  background: rgba(255, 255, 255, 0.95);
  color: #ffffff;
}

.agent-send-btn img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0);
}

.send-code-label {
  position: absolute;
  left: 50%;
  bottom: 3px;
  transform: translateX(-50%);
  pointer-events: none;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.7px;
  color: #334155;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.6);
}

.agent-send-btn:hover:not(:disabled) {
  background: rgba(240, 240, 240, 0.95);
  border-color: #5a6fd8;
}

.agent-send-btn.has-text {
  background: #667eea;
  border-color: #667eea;
}

.agent-send-btn.has-text img {
  filter: brightness(0) invert(1);
}

.agent-send-btn.has-text .send-code-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.agent-send-btn.has-text:hover:not(:disabled) {
  background: #5a6fd8;
  border-color: #5a6fd8;
}

.agent-send-btn:disabled:not(.ws-disabled) {
  background: rgba(255, 255, 255, 0.95);
  border-color: #667eea;
  cursor: not-allowed;
  opacity: 1;
}

.agent-send-btn:disabled:not(.ws-disabled) img {
  filter: brightness(0);
}

.agent-send-btn.ws-disabled {
  background: #808080 !important;
  border-color: #808080 !important;
  cursor: not-allowed;
  opacity: 1;
}

.agent-send-btn.ws-disabled img {
  filter: brightness(0) invert(1) !important;
}

.agent-send-btn.ws-disabled .send-code-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.agent-cancel-btn {
  border: 2px solid #808080;
  border-radius: 2px;
  cursor: not-allowed;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 56px;
  height: 48px;
  margin-bottom: 20px;
  margin-left: 4px;
  background: rgba(128, 128, 128, 0.3);
  transition: all 0.2s ease;
}

.agent-cancel-btn img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(0.6);
}

.agent-cancel-btn.is-active {
  background: #ff4444;
  border-color: #ff4444;
  cursor: pointer;
}

.agent-cancel-btn.is-active img {
  filter: brightness(0) invert(1);
}

.agent-cancel-btn.is-active:hover {
  background: #cc0000;
  border-color: #cc0000;
}

.agent-cancel-btn:disabled {
  opacity: 0.6;
}

.agent-cancel-btn.is-active:disabled {
  opacity: 1;
}
</style>
