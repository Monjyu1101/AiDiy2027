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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { AI_WS_ENDPOINT } from '@/api/config'
import { AIWebSocket, type IWebSocketClient } from '@/api/websocket'
import apiClient from '@/api/client'
import ファイル内容表示ダイアログ from '@/components/ファイル内容表示.vue'
import { AIストリーム制御判定, AIストリーム表示内容 } from '@/utils/AIストリーム制御'

type チャットモード = 'chat' | 'live' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'

// props（messages/チャット接続済み/モデル設定 はdeprecated扱い）
const プロパティ = defineProps<{
  messages?: any[]
  ウェルカム情報: string
  セッションID: string
  チャンネル?: string
  active?: boolean
  chatMode: チャットモード
  入力接続済み: boolean
  チャット接続済み?: boolean
  モデル設定?: any
}>()

const 通知 = defineEmits<{
  'send-input-payload': [message: Record<string, unknown>]
  'mode-change': [mode: チャットモード]
  'chat-state': [connected: boolean]
  activate: []
}>()

interface メッセージ {
  role: 'input_text' | 'output_text' | 'input_file' | 'output_file' | 'recognition_input' | 'recognition_output' | 'input_request' | 'output_request' | 'welcome_text'
  content: string
  id: string
  kind?: 'text' | 'file'
  render?: 'effect' | 'static'
  fileName?: string | null
  thumbnail?: string | null
  isStream?: boolean
  isCollapsed?: boolean
}

const 入力テキスト = ref('')
const チャット領域 = ref<HTMLElement | null>(null)
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
const ドラッグ中 = ref(false)
const 入力欄最大到達 = ref(false)
const 入力欄固定中 = ref(false)
const 入力欄固定高さ = ref(60)
const 入力欄最小高さ = 60
const 入力欄最大高さ = ref(380)

const 出力WebSocket = ref<IWebSocketClient | null>(null)
let ストリームメッセージID: string | null = null
let メッセージID連番 = 0

const 出力接続済み = ref(false)
const メッセージ一覧 = ref<メッセージ[]>([])
const ウェルカムテキスト受信済み = ref(false)

const ファイル内容ダイアログ表示 = ref(false)
const 表示ファイル名 = ref('')
const 表示base64_data = ref('')

const 画像拡張子セット = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const テキスト拡張子セット = new Set([
  'py', 'vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt',
  'html', 'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml',
  'ini', 'env', 'sql', 'csv', 'log', 'xml', 'sh', 'ps1', 'bat'
])

const 拡張子取得 = (ファイル名: string): string => {
  const クエリ除去 = (ファイル名 || '').split(/[?#]/u, 1)[0] || ''
  const 最後のスラッシュ位置 = Math.max(クエリ除去.lastIndexOf('/'), クエリ除去.lastIndexOf('\\'))
  const ベース名 = 最後のスラッシュ位置 >= 0 ? クエリ除去.slice(最後のスラッシュ位置 + 1) : クエリ除去
  const ドット位置 = ベース名.lastIndexOf('.')
  if (ドット位置 < 0) return ''
  return ベース名.slice(ドット位置 + 1).toLowerCase()
}

const ファイル内容表示対象 = (ファイル名: string): boolean => {
  const 拡張子 = 拡張子取得(ファイル名)
  return 画像拡張子セット.has(拡張子) || テキスト拡張子セット.has(拡張子)
}

const ファイル内容ダイアログ閉じる = () => {
  ファイル内容ダイアログ表示.value = false
  表示ファイル名.value = ''
  表示base64_data.value = ''
}

const ファイル内容表示を開く = async (ファイル名: string) => {
  if (!ファイル内容表示対象(ファイル名)) return
  try {
    const response = await apiClient.post('/core/files/内容取得', { ファイル名 })
    if (response?.data?.status !== 'OK') return
    const base64_data = response?.data?.data?.base64_data
    if (typeof base64_data !== 'string' || !base64_data) return
    表示ファイル名.value = ファイル名
    表示base64_data.value = base64_data
    ファイル内容ダイアログ表示.value = true
  } catch (error) {
    console.error('[チャット] ファイル内容取得エラー:', error)
  }
}
const 選択モード = ref<チャットモード>(プロパティ.chatMode || 'live')

const 送信モードラベル = computed(() => {
  const m = 選択モード.value
  if (m.startsWith('code')) return `CODE ${m.replace('code', '')}`
  if (m === 'live') return 'LIVE'
  return 'CHAT'
})

const ウェルカム内容 = ref(プロパティ.ウェルカム情報 || '')
const WebSocket接続中 = computed(() => 出力接続済み.value)

// --- ターミナルエフェクト ---

type 演出状態 = {
  container: HTMLElement
  textSpan: HTMLElement
  cursorSpan: HTMLElement
  queue: string[]
  running: boolean
  ready: boolean
  finalizeOnEmpty: boolean
}

const 演出状態Map = new Map<string, 演出状態>()

const 速度設定 = (文字数: number) => {
  const batch = Math.floor(文字数 / 50) + 1
  return { interval: 10, batch }
}

const 演出初期化 = (メッセージID: string, 表示領域: HTMLElement, カーソル色: string = '#00ff00') => {
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
  const state: 演出状態 = {
    container: 表示領域, textSpan, cursorSpan,
    queue: [], running: false, ready: false, finalizeOnEmpty: false,
  }
  演出状態Map.set(メッセージID, state)
  ;(state as any).blinkInterval = blinkInterval
  最下部スクロール()
  window.setTimeout(() => {
    state.ready = true
    演出実行(メッセージID)
  }, 500)
}

const 演出キュー追加 = (メッセージID: string, 文字列: string, finalize: boolean) => {
  const state = 演出状態Map.get(メッセージID)
  if (!state) return
  if (文字列) state.queue.push(文字列)
  if (finalize) state.finalizeOnEmpty = true
  演出実行(メッセージID)
}

const 演出実行 = (メッセージID: string) => {
  const state = 演出状態Map.get(メッセージID)
  if (!state || state.running || !state.ready) return
  if (state.queue.length === 0) {
    if (state.finalizeOnEmpty) {
      if (state.cursorSpan && state.cursorSpan.parentNode) state.cursorSpan.remove()
      if ((state as any).blinkInterval) clearInterval((state as any).blinkInterval)
      演出状態Map.delete(メッセージID)
      最下部スクロール()
    }
    return
  }
  state.running = true
  const chunk = state.queue.shift() ?? ''
  const { interval, batch } = 速度設定(chunk.length)
  let index = 0
  const tick = () => {
    if (演出状態Map.get(メッセージID) !== state) return
    const end = Math.min(index + batch, chunk.length)
    if (end > index) {
      state.textSpan.textContent += chunk.slice(index, end)
      index = end
      nextTick(() => 最下部スクロール())
    }
    if (index >= chunk.length) {
      state.running = false
      nextTick(() => 最下部スクロール())
      演出実行(メッセージID)
      return
    }
    window.setTimeout(tick, interval)
  }
  tick()
}

// --- メッセージID ---

const 新規メッセージID = () => {
  const ソケット = プロパティ.セッションID || 'nosocket'
  const チャンネル = プロパティ.チャンネル ?? '0'
  return `chat-${ソケット}-${チャンネル}-${メッセージID連番++}`
}

// --- メッセージ追加 ---

const ターミナルメッセージ追加 = (role: メッセージ['role'], 内容: string, 追加オプション?: Partial<メッセージ>, finalize = true) => {
  const メッセージID = 新規メッセージID()
  メッセージ一覧.value.push({
    role, content: 内容, id: メッセージID, kind: 'text', render: 'effect',
    ...(追加オプション || {}),
  })
  let カーソル色 = '#00ff00'
  switch (role) {
    case 'input_text':         カーソル色 = '#ffffff'; break
    case 'input_request':      カーソル色 = '#ffaa66'; break
    case 'output_text':        カーソル色 = '#00ff00'; break
    case 'output_request':     カーソル色 = '#00ffff'; break
    case 'welcome_text':       カーソル色 = '#00ff00'; break
    case 'recognition_input':  カーソル色 = '#e5e7eb'; break
    case 'recognition_output': カーソル色 = '#9ae6b4'; break
  }
  nextTick(() => {
    const メッセージ要素 = document.getElementById(メッセージID)
    if (!メッセージ要素) return
    const bubbleElement = メッセージ要素.querySelector('.bubble-content') as HTMLElement | null
    if (!bubbleElement) return
    演出初期化(メッセージID, bubbleElement, カーソル色)
    演出キュー追加(メッセージID, 内容, finalize)
  })
}

const ファイルメッセージ追加 = (role: メッセージ['role'], fileName?: string | null, thumbnail?: string | null) => {
  メッセージ一覧.value.push({
    role, content: '', id: 新規メッセージID(),
    kind: 'file', render: 'static',
    fileName: fileName ?? null, thumbnail: thumbnail ?? null,
  })
  最下部スクロール()
}

// --- WebSocketハンドラーヘルパー ---

const 受信内容文字列 = (受信データ: any) => {
  const 内容 = 受信データ.メッセージ内容 ?? 受信データ.text ?? ''
  if (!内容) return ''
  return typeof 内容 === 'string' ? 内容 : JSON.stringify(内容)
}

const 表示時アクティブ化 = () => {
  if (!ウェルカムテキスト受信済み.value) return
  通知('activate')
}

const 受信チャンネル一致 = (受信データ: any): boolean => {
  const 期待チャンネル = String(プロパティ.チャンネル ?? '0')
  const 実受信チャンネル = 受信データ?.チャンネル
  if (実受信チャンネル === undefined || 実受信チャンネル === null || 実受信チャンネル === '') {
    return true
  }
  return String(実受信チャンネル) === 期待チャンネル
}

// --- 個別受信ハンドラー ---

const ウェルカム受信処理 = (受信データ: any) => {
  if (!受信チャンネル一致(受信データ)) return
  console.log('[チャット] welcome_info受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) return
  // welcome_info の後には会話履歴が再送される。再接続前の表示へ追記しない。
  // 履歴の受信中はタブを自動選択せず、利用者が開いている画面を保つ。
  for (const state of 演出状態Map.values()) clearInterval((state as any).blinkInterval)
  演出状態Map.clear()
  メッセージ一覧.value = []
  ストリームメッセージID = null
  ウェルカムテキスト受信済み.value = false
  ウェルカム内容.value = 内容
}

const 入力テキスト受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  console.log('[チャット] input_text受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) { console.log('[チャット] input_text 内容なしでスキップ'); return }
  console.log('[チャット] input_text表示開始:', 内容)
  ターミナルメッセージ追加('input_text', 内容)
}

const 入力リクエスト受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  console.log('[チャット] input_request受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) { console.log('[チャット] input_request 内容なしでスキップ'); return }
  console.log('[チャット] input_request表示開始:', 内容)
  ターミナルメッセージ追加('input_request', 内容)
}

const 入力ファイル受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  ファイルメッセージ追加('input_file', 受信データ.ファイル名 ?? null, 受信データ.サムネイル画像 ?? null)
}

const 出力テキスト受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  console.log('[チャット] output_text受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) { console.log('[チャット] output_text 内容なしでスキップ'); return }
  console.log('[チャット] output_text表示開始:', 内容)
  ターミナルメッセージ追加('output_text', 内容)
}

const 出力リクエスト受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  console.log('[チャット] output_request受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) { console.log('[チャット] output_request 内容なしでスキップ'); return }
  console.log('[チャット] output_request表示開始:', 内容)
  ターミナルメッセージ追加('output_request', 内容)
}

const ウェルカムテキスト受信処理 = (受信データ: any) => {
  if (!受信チャンネル一致(受信データ)) return
  if (ウェルカムテキスト受信済み.value) {
    表示時アクティブ化()
  }
  ウェルカムテキスト受信済み.value = true
  console.log('[チャット] welcome_text受信:', 受信データ)
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) { console.log('[チャット] welcome_text 内容なしでスキップ'); return }
  console.log('[チャット] welcome_text表示開始:', 内容)
  ターミナルメッセージ追加('welcome_text', 内容)
}

const 出力ファイル受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  ファイルメッセージ追加('output_file', 受信データ.ファイル名 ?? null, 受信データ.サムネイル画像 ?? null)
}

const 音声入力受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) return
  ターミナルメッセージ追加('recognition_input', 内容)
}

const 音声出力受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) return
  ターミナルメッセージ追加('recognition_output', 内容)
}

const 出力ストリーム受信処理 = (受信データ: any) => {
  表示時アクティブ化()
  const 内容 = 受信内容文字列(受信データ)
  if (!内容) return
  const 制御種別 = AIストリーム制御判定(内容)

  if (制御種別 === '開始') {
    const メッセージID = `stream-${新規メッセージID()}`
    ストリームメッセージID = メッセージID
    メッセージ一覧.value.push({
      role: 'output_text', content: '', id: メッセージID,
      kind: 'text', render: 'effect', isStream: true,
    })
    nextTick(() => {
      const メッセージ要素 = document.getElementById(メッセージID)
      if (!メッセージ要素) return
      const bubbleElement = メッセージ要素.querySelector('.bubble-content') as HTMLElement | null
      if (!bubbleElement) return
      演出初期化(メッセージID, bubbleElement)
    })
    return
  }

  if (制御種別 === '終了' || 制御種別 === '中断') {
    const 対象メッセージ = メッセージ一覧.value.find(m => m.id === ストリームメッセージID)
    if (対象メッセージ) {
      対象メッセージ.isCollapsed = true
    }
    if (ストリームメッセージID) 演出キュー追加(ストリームメッセージID, '', true)
    ストリームメッセージID = null
    最下部スクロール()
    return
  }

  const 表示内容 = AIストリーム表示内容(内容)
  if (!表示内容) return

  const 対象メッセージ = メッセージ一覧.value.find(m => m.id === ストリームメッセージID)
  if (対象メッセージ) {
    対象メッセージ.content += `${表示内容}\n`
    if (ストリームメッセージID) 演出キュー追加(ストリームメッセージID, `${表示内容}\n`, false)
    最下部スクロール()
  }
}

// --- WSハンドラ登録/解除 ---

function WSハンドラ登録(socket: IWebSocketClient) {
  socket.on('welcome_info',       ウェルカム受信処理)
  socket.on('input_text',         入力テキスト受信処理)
  socket.on('input_request',      入力リクエスト受信処理)
  socket.on('input_file',         入力ファイル受信処理)
  socket.on('output_text',        出力テキスト受信処理)
  socket.on('output_request',     出力リクエスト受信処理)
  socket.on('welcome_text',       ウェルカムテキスト受信処理)
  socket.on('output_stream',      出力ストリーム受信処理)
  socket.on('output_file',        出力ファイル受信処理)
  socket.on('recognition_input',  音声入力受信処理)
  socket.on('recognition_output', 音声出力受信処理)
}

function WSハンドラ解除(socket: IWebSocketClient) {
  socket.off('welcome_info',       ウェルカム受信処理)
  socket.off('input_text',         入力テキスト受信処理)
  socket.off('input_request',      入力リクエスト受信処理)
  socket.off('input_file',         入力ファイル受信処理)
  socket.off('output_text',        出力テキスト受信処理)
  socket.off('output_request',     出力リクエスト受信処理)
  socket.off('welcome_text',       ウェルカムテキスト受信処理)
  socket.off('output_stream',      出力ストリーム受信処理)
  socket.off('output_file',        出力ファイル受信処理)
  socket.off('recognition_input',  音声入力受信処理)
  socket.off('recognition_output', 音声出力受信処理)
}

// --- チャット接続管理 ---

function チャットリセット() {
  出力接続済み.value = false
  ウェルカム内容.value = ''
  メッセージ一覧.value = []
  ストリームメッセージID = null
  ウェルカムテキスト受信済み.value = false
  通知('chat-state', false)
}

async function 出力ソケット接続() {
  if (!プロパティ.セッションID) return
  const チャンネル = プロパティ.チャンネル ?? '0'
  出力WebSocket.value?.disconnect()
  チャットリセット()
  const nextSocket = new AIWebSocket(AI_WS_ENDPOINT, プロパティ.セッションID, チャンネル)
  // 接続待ちのソケットも先に保持し、待機中に再度呼ばれた場合は確実に閉じる。
  // （待機後に保持すると旧ソケットが残り、同じチャンネルへ2本つながってサーバー側で押し合いになる）
  出力WebSocket.value = nextSocket
  // ref は中身を Proxy で包むため、同一性は toRaw で比べる
  const 現在のソケット = () => toRaw(出力WebSocket.value) === nextSocket
  nextSocket.onStateChange((connected) => {
    if (!現在のソケット()) return
    出力接続済み.value = connected
    通知('chat-state', connected)
  })
  WSハンドラ登録(nextSocket)
  try {
    await nextSocket.connect()
  } catch {
    nextSocket.disconnect()
    if (現在のソケット()) {
      出力WebSocket.value = null
      チャットリセット()
    }
  }
}

// --- 折りたたみ ---

const 折りたたみ切替 = (メッセージID: string) => {
  const 対象メッセージ = メッセージ一覧.value.find(m => m.id === メッセージID)
  if (対象メッセージ && 対象メッセージ.isStream) {
    対象メッセージ.isCollapsed = !対象メッセージ.isCollapsed
  }
}

// --- 貼り付けヘルパー ---

const 右トリム = (text: string) => text.replace(/\s+$/u, '')

const 貼り付け対象ロール: メッセージ['role'][] = [
  'input_text', 'input_request', 'input_file',
  'output_text', 'output_request', 'output_file',
  'recognition_input', 'recognition_output',
]

const 貼り付け用文字列取得 = (メッセージ項目: メッセージ) => {
  if (メッセージ項目.kind === 'file') {
    const ファイル名 = メッセージ項目.fileName ?? ''
    return ファイル名 ? `"${ファイル名}"` : ''
  }
  return メッセージ項目.content ?? ''
}

const メッセージ貼り付け可能 = (メッセージ項目: メッセージ) => {
  if (メッセージ項目.isStream) return false
  return 貼り付け対象ロール.includes(メッセージ項目.role)
}

// --- クリック処理 ---

const メッセージ行クリック処理 = async (メッセージ項目: メッセージ) => {
  if (メッセージ項目.isStream) {
    if (メッセージ項目.isCollapsed) 折りたたみ切替(メッセージ項目.id)
    return
  }
  if (!メッセージ貼り付け可能(メッセージ項目)) return
  const 貼り付け文字列 = 右トリム(貼り付け用文字列取得(メッセージ項目))
  if (!貼り付け文字列) return
  const ファイル系 = メッセージ項目.role === 'input_file' || メッセージ項目.role === 'output_file'
  if (ファイル系) {
    const 区切り = 入力テキスト.value && !入力テキスト.value.endsWith('\n') ? '\n' : ''
    入力テキスト.value = `${入力テキスト.value}${区切り}${貼り付け文字列}\n`
  } else {
    入力テキスト.value = `${貼り付け文字列}\n`
  }
  nextTick(() => {
    if (!テキストエリア.value) return
    テキストエリア.value.focus()
    テキストエリア自動調整()
    const 末尾 = テキストエリア.value.value.length
    テキストエリア.value.setSelectionRange(末尾, 末尾)
  })
  if (ファイル系 && メッセージ項目.fileName) {
    await ファイル内容表示を開く(メッセージ項目.fileName)
  }
}

const メッセージ行カーソル = (メッセージ項目: メッセージ): string => {
  if (メッセージ項目.isStream && メッセージ項目.isCollapsed) return 'pointer'
  return メッセージ貼り付け可能(メッセージ項目) ? 'pointer' : 'default'
}

// --- 入力欄 ---

function 入力欄状態リセット() {
  入力欄最大到達.value = false
  入力欄固定中.value = false
  入力欄固定高さ.value = 入力欄最小高さ
  if (テキストエリア.value) テキストエリア.value.style.height = `${入力欄最小高さ}px`
}

function 入力欄クリア() {
  入力テキスト.value = ''
  入力欄状態リセット()
  nextTick(() => {
    if (!テキストエリア.value) return
    テキストエリア.value.focus()
    テキストエリア自動調整()
  })
}

const 入力欄最大高さ更新 = () => {
  const テキストエリア要素 = テキストエリア.value
  if (!テキストエリア要素) return
  const コンテナ = テキストエリア要素.closest('.chat-container') as HTMLElement | null
  if (!コンテナ) return
  const 候補高さ = Math.floor(コンテナ.clientHeight * 0.78)
  入力欄最大高さ.value = Math.max(入力欄最小高さ, 候補高さ)
}

function テキストエリア自動調整() {
  if (!テキストエリア.value) return
  入力欄最大高さ更新()
  if (入力テキスト.value.length === 0) { 入力欄状態リセット(); return }
  if (入力欄固定中.value) {
    入力欄最大到達.value = true
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`
    return
  }
  テキストエリア.value.style.height = `${入力欄最小高さ}px`
  const スクロール高 = テキストエリア.value.scrollHeight
  const 次の高さ = Math.max(スクロール高, 入力欄最小高さ)
  const 上限到達 = 次の高さ >= 入力欄最大高さ.value
  入力欄最大到達.value = 上限到達
  if (上限到達) {
    入力欄固定中.value = true
    入力欄固定高さ.value = 入力欄最大高さ.value
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`
    return
  }
  テキストエリア.value.style.height = `${次の高さ}px`
}

// --- 送信 ---

function メッセージ送信() {
  const text = 入力テキスト.value.trim()
  if (!text || !WebSocket接続中.value) return
  const 現在モード = 選択モード.value
  const コードモード = 現在モード.startsWith('code')
  const コード番号 = コードモード ? (現在モード.replace('code', '') || '1') : ''
  const 送信モード = コードモード ? `Code${コード番号}` : (現在モード === 'live' ? 'Live' : 'Chat')
  通知('send-input-payload', {
    チャンネル: '0',
    送信モード: 送信モード,
    メッセージ識別: 'input_text',
    メッセージ内容: text,
  })
  入力欄クリア()
}


// --- ファイル送信 ---

const ファイルをBase64読込 = (入力ファイル: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const 読込 = new FileReader()
    読込.onload = () => {
      const result = 読込.result
      if (typeof result === 'string') {
        const commaIndex = result.indexOf(',')
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
        return
      }
      if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
        resolve(window.btoa(binary))
        return
      }
      reject(new Error('不明なファイル形式です'))
    }
    読込.onerror = () => reject(読込.error || new Error('ファイル読み込みに失敗しました'))
    読込.readAsDataURL(入力ファイル)
  })
}

const 入力ファイル送信 = async (入力ファイル: File) => {
  try {
    const Base64データ = await ファイルをBase64読込(入力ファイル)
    通知('send-input-payload', {
      チャンネル: '0',
      メッセージ識別: 'input_file',
      メッセージ内容: Base64データ,
      ファイル名: 入力ファイル.name,
      サムネイル画像: null,
    })
  } catch (error) {
    console.error('[チャット] ファイル送信エラー:', error)
    ターミナルメッセージ追加('output_text', 'ファイル送信に失敗しました。')
  }
}

// --- D&D ---

function ドラッグオーバー処理(event: DragEvent) {
  event.preventDefault()
  if (!WebSocket接続中.value) return
  ドラッグ中.value = true
}

function ドラッグ離脱処理(event: DragEvent) {
  event.preventDefault()
  if (event.currentTarget === event.target) ドラッグ中.value = false
}

async function ドロップ処理(event: DragEvent) {
  event.preventDefault()
  ドラッグ中.value = false
  if (!WebSocket接続中.value) return
  const ファイル一覧 = Array.from(event.dataTransfer?.files || [])
  if (ファイル一覧.length === 0) return
  for (const ファイル of ファイル一覧) {
    await 入力ファイル送信(ファイル)
  }
}

// --- スクロール ---

function 最下部スクロール() {
  nextTick(() => {
    if (チャット領域.value) チャット領域.value.scrollTop = チャット領域.value.scrollHeight
  })
}

// --- Watch ---

watch(入力テキスト, () => nextTick(テキストエリア自動調整))

watch(() => プロパティ.セッションID, (新ID, 旧ID) => {
  if (!新ID || 新ID === 旧ID) return
  ウェルカムテキスト受信済み.value = false
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value)
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
    出力接続済み.value = false
  }
  void 出力ソケット接続()
})

watch(() => プロパティ.chatMode, (新モード) => {
  if (新モード && 新モード !== 選択モード.value) 選択モード.value = 新モード
})

watch(選択モード, (新モード) => {
  通知('mode-change', 新モード)
})

// --- ライフサイクル ---

onMounted(() => {
  if (プロパティ.セッションID) void 出力ソケット接続()
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
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
  }
  for (const state of 演出状態Map.values()) {
    clearInterval((state as any).blinkInterval)
  }
  演出状態Map.clear()
})

defineExpose({
  WebSocket接続中,
  チャット接続済み: 出力接続済み,
})
</script>

<template>
  <section class="chat-container" data-interactive="true">
    <div ref="チャット領域" class="chat-area">
      <div v-if="ウェルカム内容" class="welcome-message">
        {{ ウェルカム内容 }}
      </div>

      <div
        v-for="メッセージ項目 in メッセージ一覧"
        :key="メッセージ項目.id"
        :id="メッセージ項目.id"
        :class="[
          'message',
          メッセージ項目.role,
          メッセージ項目.kind === 'file' ? 'is-file' : '',
          メッセージ項目.isStream ? 'stream-output' : '',
          メッセージ項目.isCollapsed ? 'collapsed' : '',
        ]"
      >
        <div
          class="message-bubble"
          @click="メッセージ行クリック処理(メッセージ項目)"
          :style="{ cursor: メッセージ行カーソル(メッセージ項目) }"
        >
          <!-- 折りたたみ表示 -->
          <div v-if="メッセージ項目.isStream && メッセージ項目.isCollapsed" class="collapsed-wrapper">
            <span class="collapsed-indicator">...</span>
            <span class="collapsed-arrow">&#x25C0;</span>
          </div>

          <div v-show="!(メッセージ項目.isStream && メッセージ項目.isCollapsed)" class="bubble-content">
            <!-- ファイルメッセージ -->
            <template v-if="メッセージ項目.kind === 'file'">
              <div class="file-message">
                <div class="file-name">
                  <span v-if="メッセージ項目.role === 'input_file'">ファイル入力: </span>
                  <span v-if="メッセージ項目.role === 'output_file'">ファイル出力: </span>
                  {{ メッセージ項目.fileName || 'ファイル受信' }}
                </div>
                <img
                  v-if="メッセージ項目.thumbnail"
                  class="file-thumbnail"
                  :src="`data:image/png;base64,${メッセージ項目.thumbnail}`"
                  alt="thumbnail"
                />
              </div>
            </template>
            <!-- テキストメッセージ: ターミナルエフェクトが直接DOMを書き込む -->
          </div>

          <span
            v-if="メッセージ項目.isStream && !メッセージ項目.isCollapsed"
            class="expand-indicator"
            @click.stop="折りたたみ切替(メッセージ項目.id)"
            title="折りたたむ"
          >&#x25BC;</span>
        </div>
      </div>

      <div v-if="メッセージ一覧.length === 0" class="empty-message">
        <p>セッション: {{ プロパティ.セッションID || '未接続' }}</p>
      </div>
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
            :disabled="!WebSocket接続中"
            @input="テキストエリア自動調整"
            @keydown="キー入力処理"
          ></textarea>
        </div>
      </div>

      <div class="mode-panel">
        <div class="mode-grid">
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="chat" name="avatar-chat-mode" />
            <span>Chat</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code3" name="avatar-chat-mode" />
            <span>Code3</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="live" name="avatar-chat-mode" />
            <span>Live</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code4" name="avatar-chat-mode" />
            <span>Code4</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code1" name="avatar-chat-mode" />
            <span>Code1</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code5" name="avatar-chat-mode" />
            <span>Code5</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code2" name="avatar-chat-mode" />
            <span>Code2</span>
          </label>
          <label class="mode-option">
            <input type="radio" v-model="選択モード" value="code6" name="avatar-chat-mode" />
            <span>Code6</span>
          </label>
        </div>
      </div>

      <button
        ref="送信ボタン"
        class="chat-send-btn"
        :class="{
          'ws-disabled': !WebSocket接続中,
          'has-text': 入力テキスト.length > 0,
        }"
        type="button"
        :disabled="!入力テキスト.trim() || !WebSocket接続中"
        title="送信（フォーカス中に Enter）"
        @click="メッセージ送信"
      >
        <img src="/icons/sending.png" alt="送信" />
        <span class="send-mode-label">{{ 送信モードラベル }}</span>
      </button>
    </div>

    <component
      :is="ファイル内容表示ダイアログ"
      :show="ファイル内容ダイアログ表示"
      :ファイル名="表示ファイル名"
      :base64_data="表示base64_data"
      @close="ファイル内容ダイアログ閉じる"
    />
  </section>
</template>

<style scoped>
.chat-container {
  background: #ffffff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.chat-area {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  overflow-x: auto;
  background: #000000;
  position: relative;
}

.chat-area::-webkit-scrollbar { width: 8px; height: 8px; }
.chat-area::-webkit-scrollbar-track { background: #1a1a1a; }
.chat-area::-webkit-scrollbar-thumb { background: #666666; border-radius: 2px; }
.chat-area::-webkit-scrollbar-thumb:hover { background: #888888; }

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
  font-family: "Courier New", monospace;
  font-size: 11px;
  white-space: pre-line;
}

.message {
  margin-bottom: 1px;
  animation: slideIn 0.3s ease;
  text-align: left;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-bubble {
  display: inline-block;
  max-width: 95%;
  padding: 2px 8px;
  border-radius: 2px;
  word-wrap: break-word;
  line-height: 1.2;
  font-family: "Courier New", monospace;
  font-size: 11px;
  white-space: pre-wrap;
}

.message.input_text .message-bubble { color: #ffffff; border-left: 4px solid rgba(255, 255, 255, 0.7); }
.message.input_file .message-bubble { color: #ffffff; border-left: 4px solid rgba(255, 255, 255, 0.7); }
.message.input_request .message-bubble { color: #ffaa66; border-left: 4px solid rgba(255, 170, 102, 0.7); }
.message.input_request .message-bubble::before { content: "REQ > "; font-weight: bold; color: #ffaa66; }
.message.recognition_input .message-bubble { color: #e5e7eb; border-left: 4px solid rgba(187, 187, 187, 0.7); }
.message.output_text .message-bubble,
.message.welcome_text .message-bubble { color: #00ff00; border-left: 4px solid rgba(0, 255, 0, 0.7); min-width: 200px; }
.message.output_request .message-bubble { color: #00ffff; border-left: 4px solid rgba(0, 255, 255, 0.7); min-width: 200px; }
.message.output_file .message-bubble { color: #00ff00; border-left: 4px solid rgba(0, 255, 0, 0.7); }
.message.recognition_output .message-bubble { color: #9ae6b4; border-left: 4px solid rgba(0, 153, 204, 0.7); }

.message.stream-output .message-bubble {
  background: rgba(0, 255, 0, 0.08);
  border-radius: 4px;
  padding: 8px 12px;
  position: relative;
}

.message.stream-output.collapsed .message-bubble { padding: 4px 8px; }

.collapsed-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  cursor: pointer;
}

.collapsed-indicator { color: #00cc00; font-weight: bold; font-size: 16px; }
.collapsed-arrow { color: #00cc00; font-size: 14px; }

.expand-indicator {
  position: absolute;
  top: 4px;
  right: 8px;
  color: #00cc00;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.expand-indicator:hover { color: #00ff00; }

:deep(.terminal-text) {
  display: inline;
  white-space: pre-wrap;
  font-family: "Courier New", monospace;
  line-height: 1.1;
}

:deep(.terminal-cursor) {
  display: inline !important;
  background-color: #00ff00 !important;
  color: #000000 !important;
  padding: 0 2px !important;
  font-family: "Courier New", monospace !important;
  font-weight: bold !important;
}

.file-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.message.is-file .message-bubble { display: block; }
.message.output_file.is-file .message-bubble { min-width: 0; }

.file-name {
  font-family: "Courier New", monospace;
  font-size: 11px;
  color: #ffffff;
}

.message.output_file .file-name { color: #00ff00; }

.file-thumbnail {
  max-width: 240px;
  max-height: 180px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  object-fit: contain;
  background: #111;
}

.bubble-content,
.empty-message p { margin: 0; }

.empty-message {
  margin-top: auto;
  color: #8f9aa9;
  font-family: "Courier New", monospace;
  font-size: 12px;
}

.control-area {
  padding: 10px 20px 0 20px;
  background: #101010;
  border-top: 1px solid #2c2c2c;
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: flex-end;
}

.text-input-area {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  flex: 1;
}

.text-input-area.drag-over {
  background-color: rgba(102, 126, 234, 0.2);
  border: 2px dashed #667eea;
  border-radius: 4px;
  padding: 6px;
}

.input-container {
  position: relative;
  flex: 1;
  margin-bottom: 0;
}

.prompt-symbol {
  position: absolute;
  left: 8px;
  top: 12px;
  color: #ffffff;
  font-family: "Courier New", monospace;
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
  resize: none;
  min-height: 60px;
  max-height: 380px;
  overflow-y: auto;
  line-height: 1.4;
  height: 60px;
}

.input-field.at-limit { font-size: 8px; line-height: 1.1; }
.input-field:disabled { border-color: #808080; color: #666; background: rgba(128, 128, 128, 0.1); }
.input-field:focus { border-color: #ffffff; }
.input-field::placeholder { color: #888; }

.mode-panel {
  display: flex;
  justify-content: center;
  padding-bottom: 12px;
  margin-top: -4px;
}

.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 16px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #e0e0e0;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  line-height: 1;
  padding: 0;
}

.mode-option input[type="radio"] {
  width: 11px;
  height: 11px;
  cursor: pointer;
  accent-color: #667eea;
  margin: 0;
  position: relative;
  top: -6px;
}

.mode-option span {
  font-family: "Courier New", monospace;
  font-weight: normal;
  position: relative;
  top: -3px;
}

.chat-send-btn {
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
  flex-shrink: 0;
}

.chat-send-btn img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0);
}

.chat-send-btn:hover:not(:disabled) { background: rgba(240, 240, 240, 0.95); border-color: #5a6fd8; }
.chat-send-btn.has-text { background: #667eea; border-color: #667eea; }
.chat-send-btn.has-text img { filter: brightness(0) invert(1); }
.chat-send-btn.has-text:hover:not(:disabled) { background: #5a6fd8; border-color: #5a6fd8; }
.chat-send-btn:disabled:not(.ws-disabled) { background: rgba(255, 255, 255, 0.95); border-color: #667eea; cursor: not-allowed; opacity: 1; }
.chat-send-btn:disabled:not(.ws-disabled) img { filter: brightness(0); }
.chat-send-btn.ws-disabled { background: #808080 !important; border-color: #808080 !important; cursor: not-allowed; opacity: 1; }
.chat-send-btn.ws-disabled img { filter: brightness(0) invert(1) !important; }

.send-mode-label {
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
  white-space: nowrap;
}
.chat-send-btn.has-text .send-mode-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.chat-send-btn.ws-disabled .send-mode-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

@media (max-width: 480px) {
  .control-area { flex-direction: column; align-items: stretch; padding-bottom: 12px; }
  .mode-panel { padding-bottom: 0; }
  .chat-send-btn { width: 100%; margin-bottom: 0; }
}
</style>
