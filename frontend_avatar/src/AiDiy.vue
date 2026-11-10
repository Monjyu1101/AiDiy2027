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
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AIコアチャット from '@/components/AIチャット.vue'
import AIコアコントロール from '@/components/AIコア.vue'
import AIコアコード from '@/components/AIコード.vue'
import AIコアファイル from '@/components/AIファイル.vue'
import AIコアイメージ from '@/components/AIイメージ.vue'
import ログイン from '@/components/ログイン.vue'
import AI設定再起動 from '@/dialog/AI設定再起動.vue'
import 再起動カウントダウン from '@/dialog/再起動カウントダウン.vue'
import WindowShell from '@/components/_WindowShell.vue'
import 再読込ボタン from '@/components/再読込ボタン.vue'
import apiClient from '@/api/client'
import { defaultModelSettings } from '@/api/config'
import { AIWebSocket, createWebSocketUrl } from '@/api/websocket'
import type { AuthUser, ChatMessage, MessageKind, ModelSettings } from '@/types'
import { AIストリーム制御判定, AIストリーム表示内容 } from '@/utils/AIストリーム制御'

type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'
type WindowRole = 'login' | 'core' | PanelKey | 'settings'
type チャットモード型 = 'chat' | 'live' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'
type コードチャンネル = '1' | '2' | '3' | '4' | '5' | '6'
type 右ペインタブ型 = 'core' | 'image' | 'code1' | 'code3' | 'code5'
type SharedSnapshot = {
  認証済み: boolean
  利用者ラベル: string
  セッションID: string
  入力ウェルカム情報: string
  入力ウェルカム本文: string
  メッセージ一覧: ChatMessage[]
  チャットモード: チャットモード型
  モデル設定: ModelSettings
  入力接続済み: boolean
  チャット接続済み: boolean
  パネル表示状態: Record<PanelKey, boolean>
  コア処理中: boolean
  コアエラー: string
}
type コードパネル参照型 = {
  WebSocket接続中: boolean;
  接続状態表示: string;
  出力接続済み: boolean;
}

const isElectron = !!window.desktopApi
// 単独Avatarはmainが認証を管理する。Webのqueryではこのモードに入れない。
const 単独Avatar = window.desktopApi?.avatarAlone === true
const 単独プロジェクト = 単独Avatar ? window.desktopApi?.projectPath || '' : ''
const 認証Storage = isElectron ? localStorage : sessionStorage
const PANEL_KEYS: PanelKey[] = ['chat', 'file', 'image', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6']
const WEB_CORE_PATH = '/AiDiy'

function URLセッションID取得(): string {
  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get('セッションID') || searchParams.get('sessionId') || ''
}

function Web新規開始URL判定(): boolean {
  if (isElectron) return false
  if (URLセッションID取得()) return false
  return window.location.pathname === '/' || window.location.pathname === '/index.html'
}

function 認証データ初期化() {
  認証Storage.removeItem('token')
  認証Storage.removeItem('user')
  認証Storage.removeItem('avatar_session_id')
  認証Storage.removeItem(認証エラーメッセージKey)
}

function WebURL同期(sessionId = '') {
  if (window.desktopApi) return

  const url = new URL(window.location.href)
  url.pathname = WEB_CORE_PATH
  url.search = ''
  if (sessionId) {
    url.searchParams.set('セッションID', sessionId)
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

const PANEL_TITLES = computed<Record<PanelKey, string>>(() => {
  const s = 表示モデル設定.value
  const t = (n: number, name: string) =>
    name ? `AiDiy Code Agent ${n} (${name})` : `AiDiy Code Agent ${n}`
  const chatNames = [s.CHAT_AI_NAME, s.LIVE_AI_NAME].filter(Boolean).join(', ')
  return {
    chat: chatNames ? `AiDiy AI (${chatNames})` : 'AiDiy AI',
    file: 'AiDiy File Manager',
    image: 'AiDiy Live Capture',
    code1: t(1, s.CODE_AI1_NAME),
    code2: t(2, s.CODE_AI2_NAME),
    code3: t(3, s.CODE_AI3_NAME),
    code4: t(4, s.CODE_AI4_NAME),
    code5: t(5, s.CODE_AI5_NAME),
    code6: t(6, s.CODE_AI6_NAME),
  }
})
const チャットモード一覧: チャットモード型[] = ['chat', 'live', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6']

function パネル状態生成(): Record<PanelKey, boolean> {
  return {
    chat: false,
    file: false,
    image: false,
    code1: false,
    code2: false,
    code3: false,
    code4: false,
    code5: false,
    code6: false,
  }
}

function フォールバックロール解決(): WindowRole {
  if (単独Avatar) return 'core'
  if (Web新規開始URL判定()) {
    return 'login'
  }
  const role = new URLSearchParams(window.location.search).get('role')
  if (
    role === 'core' || role === 'login' || role === 'settings'
    || PANEL_KEYS.includes(role as PanelKey)
  ) {
    return role as WindowRole
  }
  if (!window.desktopApi && 認証Storage.getItem('token') && URLセッションID取得()) {
    return 'core'
  }
  return 'login'
}

function 保存利用者読込(): AuthUser | null {
  const raw = 認証Storage.getItem('user')
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    認証Storage.removeItem('user')
    return null
  }
}

const ウィンドウロール = ref<WindowRole>(フォールバックロール解決())
const 認証トークン = ref(単独Avatar ? '' : 認証Storage.getItem('token') || '')
const 利用者 = ref<AuthUser | null>(単独Avatar ? null : 保存利用者読込())
const 認証読込中 = ref(true)
const 認証処理中 = ref(false)
const 認証エラー = ref('')
const コア処理中 = ref(false)
const コアエラー = ref('')
const セッションID = ref(単独Avatar ? '' : URLセッションID取得() || 認証Storage.getItem('avatar_session_id') || '')
const 入力ウェルカム情報 = ref('')
const 入力ウェルカム本文 = ref('')
const メッセージ一覧 = ref<ChatMessage[]>([])
const チャットモード = ref<チャットモード型>('live')
const モデル設定 = ref<ModelSettings>(defaultModelSettings())
const 補助スナップショット = ref<SharedSnapshot | null>(null)

const 入力接続済み = ref(false)
const チャット接続済み = ref(false)
const 初期マイク有効 = ref(false)
const 初期スピーカー有効 = ref(true)
const 音声状態シード = ref(0)
const パネル表示状態 = ref(パネル状態生成())
const 再起動カウントダウン表示 = ref(false)
const 再起動待機秒数 = ref(30)
const パネル再接続キー = ref(0)

const コアソケット = shallowRef<AIWebSocket | null>(null)
const 入力ソケット = shallowRef<AIWebSocket | null>(null)
const ファイルRef = ref<{ 出力接続済み: boolean; 読込中: boolean; ファイルリスト要求: () => void } | null>(null)
const イメージRef = ref<{ 接続状態: 'disconnected' | 'connecting' | 'sending'; 状態表示テキスト: string; WebSocket接続中: boolean } | null>(null)
const チャットRef = ref<{ WebSocket接続中: boolean; チャット接続済み: boolean } | null>(null)
const コードRef = ref<コードパネル参照型 | null>(null)
const コード1Ref = ref<コードパネル参照型 | null>(null)
const コード2Ref = ref<コードパネル参照型 | null>(null)
const コード3Ref = ref<コードパネル参照型 | null>(null)
const コード4Ref = ref<コードパネル参照型 | null>(null)
const コード5Ref = ref<コードパネル参照型 | null>(null)
const コード6Ref = ref<コードパネル参照型 | null>(null)
const 自動選択表示 = ref(true)
const 認証エラーメッセージKey = 'avatar_auth_error'
const コアViewRef = ref<{ 字幕追加: (text: string) => void } | null>(null)
const versions = window.desktopApi?.versions

const アクティブタブ = ref<PanelKey>('chat')
const 右アクティブタブ = ref<右ペインタブ型>('core')
const 分割比率 = ref(50)
const リサイズ中 = ref(false)

function リサイズ開始(e: MouseEvent) {
  e.preventDefault()
  リサイズ中.value = true
  const 弾唖マウス移動 = (ev: MouseEvent) => {
    const コンテナ = (e.target as HTMLElement).closest('.web-split-layout') as HTMLElement
    if (!コンテナ) return
    const rect = コンテナ.getBoundingClientRect()
    const pct = ((ev.clientX - rect.left) / rect.width) * 100
    分割比率.value = Math.min(80, Math.max(20, pct))
  }
  const 弾唖マウスアップ = () => {
    リサイズ中.value = false
    window.removeEventListener('mousemove', 弾唖マウス移動)
    window.removeEventListener('mouseup', 弾唖マウスアップ)
  }
  window.addEventListener('mousemove', 弾唖マウス移動)
  window.addEventListener('mouseup', 弾唖マウスアップ)
}

const webTabs: { key: PanelKey; label: string }[] = [
  { key: 'chat',  label: 'チャット' },
  { key: 'file',  label: 'ファイル' },
  { key: 'code2', label: 'コード2' },
  { key: 'code4', label: 'コード4' },
  { key: 'code6', label: 'コード6' },
]

const webRightTabs: { key: 右ペインタブ型; label: string }[] = [
  { key: 'core', label: 'コア' },
  { key: 'image', label: 'イメージ' },
  { key: 'code1', label: 'コード1' },
  { key: 'code3', label: 'コード3' },
  { key: 'code5', label: 'コード5' },
]

const WebアクティブコードRef = computed<コードパネル参照型 | null>(() => {
  switch (アクティブタブ.value) {
    case 'code2':
      return コード2Ref.value
    case 'code4':
      return コード4Ref.value
    case 'code6':
      return コード6Ref.value
    default:
      return null
  }
})

const Web右アクティブコードRef = computed<コードパネル参照型 | null>(() => {
  switch (右アクティブタブ.value) {
    case 'code1':
      return コード1Ref.value
    case 'code3':
      return コード3Ref.value
    case 'code5':
      return コード5Ref.value
    default:
      return null
  }
})

const Webアクティブタイトル = computed(() => PANEL_TITLES.value[アクティブタブ.value])
const Web入力接続状態表示 = computed(() => (入力接続済み.value ? '接続中' : '切断'))
const Webコア用パネル表示状態 = computed<Record<PanelKey, boolean>>(() => ({
  chat: true,
  file: true,
  image: true,
  code1: true,
  code2: true,
  code3: true,
  code4: true,
  code5: true,
  code6: true,
}))

const Webアクティブ状態表示 = computed(() => {
  switch (アクティブタブ.value) {
    case 'chat':
      return チャットRef.value?.WebSocket接続中 ? '接続中' : '切断'
    case 'file':
      return ファイルRef.value?.出力接続済み ? '接続中' : '切断'
    case 'image':
      return イメージRef.value?.状態表示テキスト || '切断'
    case 'code1':
    case 'code2':
    case 'code3':
    case 'code4':
    case 'code5':
    case 'code6':
      return WebアクティブコードRef.value?.接続状態表示 || '切断'
  }
})

const Webアクティブ状態クラス = computed(() => {
  switch (アクティブタブ.value) {
    case 'chat':
      return { on: Boolean(チャットRef.value?.WebSocket接続中), sending: false }
    case 'file':
      return { on: Boolean(ファイルRef.value?.出力接続済み), sending: false }
    case 'image':
      return {
        on: Boolean(イメージRef.value?.WebSocket接続中) && イメージRef.value?.接続状態 !== 'sending',
        sending: イメージRef.value?.接続状態 === 'sending',
      }
    case 'code1':
    case 'code2':
    case 'code3':
    case 'code4':
    case 'code5':
    case 'code6':
      return { on: Boolean(WebアクティブコードRef.value?.WebSocket接続中), sending: false }
  }
})

const Web右ペインタイトル = computed(() => {
  if (右アクティブタブ.value === 'code1' || 右アクティブタブ.value === 'code3' || 右アクティブタブ.value === 'code5') {
    return PANEL_TITLES.value[右アクティブタブ.value]
  }
  return PANEL_TITLES.value.image
})

const Web右ペイン状態表示 = computed(() => {
  if (右アクティブタブ.value === 'code1' || 右アクティブタブ.value === 'code3' || 右アクティブタブ.value === 'code5') {
    return Web右アクティブコードRef.value?.接続状態表示 || '切断'
  }
  return イメージRef.value?.状態表示テキスト || '切断'
})

const Web右ペイン状態クラス = computed(() => {
  if (右アクティブタブ.value === 'code1' || 右アクティブタブ.value === 'code3' || 右アクティブタブ.value === 'code5') {
    return { on: Boolean(Web右アクティブコードRef.value?.WebSocket接続中), sending: false }
  }
  return {
    on: Boolean(イメージRef.value?.WebSocket接続中) && イメージRef.value?.接続状態 !== 'sending',
    sending: イメージRef.value?.接続状態 === 'sending',
  }
})

function Web右ペイン対象(panel: PanelKey): panel is Extract<右ペインタブ型, PanelKey> {
  return panel === 'image' || panel === 'code1' || panel === 'code3' || panel === 'code5'
}

function コードAI名(channel: コードチャンネル): string {
  switch (channel) {
    case '1': return 表示モデル設定.value.CODE_AI1_NAME
    case '2': return 表示モデル設定.value.CODE_AI2_NAME
    case '3': return 表示モデル設定.value.CODE_AI3_NAME
    case '4': return 表示モデル設定.value.CODE_AI4_NAME
    case '5': return 表示モデル設定.value.CODE_AI5_NAME
    case '6': return 表示モデル設定.value.CODE_AI6_NAME
  }
}

const 認証済み = computed(() => 単独Avatar || Boolean(認証トークン.value && 利用者.value))
const コアウィンドウ = computed(() => ウィンドウロール.value === 'core')
const ログインウィンドウ = computed(() => ウィンドウロール.value === 'login')
const 設定ウィンドウ = computed(() => ウィンドウロール.value === 'settings')
const 設定SessionID = ref(new URLSearchParams(window.location.search).get('sessionId') || '')
const 設定キー = ref(0)
const Web設定表示 = ref(false)
const 現在パネルキー = computed<PanelKey | null>(() => {
  return PANEL_KEYS.includes(ウィンドウロール.value as PanelKey) ? (ウィンドウロール.value as PanelKey) : null
})
const 利用者ラベル = computed(() => 利用者.value?.利用者名 || 利用者.value?.利用者ID || '未ログイン')

const 表示メッセージ一覧 = computed(() => (コアウィンドウ.value ? メッセージ一覧.value : 補助スナップショット.value?.メッセージ一覧 || []))
const 表示ウェルカム情報 = computed(() =>
  コアウィンドウ.value ? 入力ウェルカム情報.value : 補助スナップショット.value?.入力ウェルカム情報 || '',
)
const 表示セッションID = computed(() =>
  コアウィンドウ.value ? セッションID.value : 補助スナップショット.value?.セッションID || '',
)
const 表示チャットモード = computed(() =>
  コアウィンドウ.value ? チャットモード.value : 補助スナップショット.value?.チャットモード || 'live',
)
const 表示入力接続済み = computed(() =>
  コアウィンドウ.value ? 入力接続済み.value : Boolean(補助スナップショット.value?.入力接続済み),
)
const 表示チャット接続済み = computed(() =>
  コアウィンドウ.value ? チャット接続済み.value : Boolean(補助スナップショット.value?.チャット接続済み),
)
const 表示チャットモデル = computed(() =>
  コアウィンドウ.value
    ? モデル設定.value.CHAT_AI_NAME || 'chat'
    : 補助スナップショット.value?.モデル設定.CHAT_AI_NAME || 'chat',
)
const 表示モデル設定 = computed(() =>
  コアウィンドウ.value ? モデル設定.value : 補助スナップショット.value?.モデル設定 || defaultModelSettings(),
)
const 現在コードチャンネル = computed<コードチャンネル | null>(() => {
  switch (現在パネルキー.value) {
    case 'code1':
      return '1'
    case 'code2':
      return '2'
    case 'code3':
      return '3'
    case 'code4':
      return '4'
    case 'code5':
      return '5'
    case 'code6':
      return '6'
    default:
      return null
  }
})
const 現在コードモデル = computed(() => {
  switch (現在パネルキー.value) {
    case 'code1':
      return 表示モデル設定.value.CODE_AI1_NAME
    case 'code2':
      return 表示モデル設定.value.CODE_AI2_NAME
    case 'code3':
      return 表示モデル設定.value.CODE_AI3_NAME
    case 'code4':
      return 表示モデル設定.value.CODE_AI4_NAME
    case 'code5':
      return 表示モデル設定.value.CODE_AI5_NAME
    case 'code6':
      return 表示モデル設定.value.CODE_AI6_NAME
    default:
      return ''
  }
})
const 認証期限切れ処理 = () => {
  認証クリア('認証の有効期限が切れました。再ログインしてください。')
}

let デスクトップチャンネル: BroadcastChannel | null = null
let パネル状態リスナー解除: (() => void) | null = null
let ウィンドウ表示リスナー解除: (() => void) | null = null
let スナップショット再試行タイマー: ReturnType<typeof setInterval> | null = null

function ストレージ認証同期(options: { syncError?: boolean } = {}) {
  if (単独Avatar) return
  認証トークン.value = 認証Storage.getItem('token') || ''
  利用者.value = 認証トークン.value ? 保存利用者読込() : null

  if (options.syncError) {
    認証エラー.value = 認証Storage.getItem(認証エラーメッセージKey) || ''
    if (認証エラー.value) {
      認証Storage.removeItem(認証エラーメッセージKey)
    }
  }
}

function ストレージ変更処理(event: StorageEvent) {
  if (
    event.key
    && event.key !== 'token'
    && event.key !== 'user'
    && event.key !== 認証エラーメッセージKey
    && event.key !== 'avatar_session_id'
  ) {
    return
  }

  ストレージ認証同期({ syncError: event.key === 認証エラーメッセージKey || !event.key })
}

function スナップショット要求() {
  デスクトップチャンネル?.postMessage({ type: 'request-snapshot' })
}

function スナップショット再試行開始() {
  if (スナップショット再試行タイマー) return
  スナップショット再試行タイマー = setInterval(() => {
    if (補助スナップショット.value?.セッションID) {
      スナップショット再試行停止()
      return
    }
    スナップショット要求()
  }, 1000)
}

function スナップショット再試行停止() {
  if (!スナップショット再試行タイマー) return
  clearInterval(スナップショット再試行タイマー)
  スナップショット再試行タイマー = null
}

function パネル状態更新(states?: Record<PanelKey, boolean>) {
  パネル表示状態.value = {
    ...パネル状態生成(),
    ...(states || {}),
  }
}

async function パネル状態再読込() {
  const states = await window.desktopApi?.getPanelStates?.()
  if (states) {
    パネル状態更新(states)
  }
}

function スナップショット構築(): SharedSnapshot {
  return {
    認証済み: 認証済み.value,
    利用者ラベル: 利用者ラベル.value,
    セッションID: セッションID.value,
    入力ウェルカム情報: 入力ウェルカム情報.value,
    入力ウェルカム本文: 入力ウェルカム本文.value,
    メッセージ一覧: [...メッセージ一覧.value],
    チャットモード: チャットモード.value,
    モデル設定: { ...モデル設定.value },
    入力接続済み: 入力接続済み.value,
    チャット接続済み: チャット接続済み.value,
    パネル表示状態: { ...パネル表示状態.value },
    コア処理中: コア処理中.value,
    コアエラー: コアエラー.value,
  }
}

function スナップショット送信() {
  if (!デスクトップチャンネル || !コアウィンドウ.value) return
  デスクトップチャンネル.postMessage({ type: 'snapshot', snapshot: スナップショット構築() })
}

function デスクトップチャンネルメッセージ処理(event: MessageEvent) {
  const payload = event.data
  if (!payload || typeof payload !== 'object') return
  // プロジェクト別プロファイル・一時origin内の 各パネルと設定だけを同期する。
  if (単独Avatar && !['settings-saved', 'request-snapshot', 'snapshot', 'send-input-payload', 'reboot-reconnect', 'send-message', 'set-chat-mode', 'chat-state'].includes(payload.type)) return

  if (コアウィンドウ.value) {
    if (payload.type === 'request-snapshot') {
      スナップショット送信()
      return
    }

    if (payload.type === 'send-message' && typeof payload.text === 'string') {
      メッセージ送信(payload.text)
      return
    }

    if (payload.type === 'send-input-payload' && payload.message) {
      入力ペイロード送信(payload.message as Record<string, unknown>)
      return
    }

    if (payload.type === 'set-chat-mode' && チャットモード一覧.includes(payload.mode as チャットモード型)) {
      チャットモード.value = payload.mode
      return
    }

    if (payload.type === 'chat-state' && typeof payload.connected === 'boolean') {
      チャット接続済み.value = payload.connected
      return
    }

    if (payload.type === 'settings-saved') {
      // 全設定リセットは共通既定プロジェクトへ戻るため、新しい会話で起動時の場所を再確定する。
      if (単独Avatar && payload.resetSession === true) セッションID.value = ''
      再起動待機秒数.value = typeof payload.waitSeconds === 'number' ? payload.waitSeconds : 30
      再起動カウントダウン表示.value = true
      return
    }

    return
  }

  if (payload.type === 'snapshot') {
    補助スナップショット.value = payload.snapshot as SharedSnapshot
    if (補助スナップショット.value?.セッションID) {
      スナップショット再試行停止()
    }
  }

  if (payload.type === 'reboot-reconnect') {
    パネル再接続キー.value++
    スナップショット要求()
  }
}

async function ウィンドウロール検出() {
  ウィンドウロール.value = (await window.desktopApi?.getWindowRole?.()) || フォールバックロール解決()
}

let ストリームメッセージID: string | null = null

function 新規メッセージID(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function メッセージ追加(kind: MessageKind, text: string, extra?: Partial<ChatMessage>) {
  const normalized = String(text || '').trim()
  if (!normalized && !extra?.fileName) return

  メッセージ一覧.value.push({
    id: 新規メッセージID(),
    kind,
    text: normalized,
    timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    ...extra,
  })
}

function 受信内容文字列(受信データ: any) {
  const 内容 = 受信データ?.メッセージ内容 ?? 受信データ?.text ?? ''
  if (!内容) return ''
  return typeof 内容 === 'string' ? 内容 : JSON.stringify(内容)
}

function 出力ストリーム処理(message: Record<string, any>) {
  const content = String(message.メッセージ内容 || '')
  if (!content) return
  const 制御種別 = AIストリーム制御判定(content)

  if (制御種別 === '開始') {
    const id = 新規メッセージID()
    ストリームメッセージID = id
    メッセージ一覧.value.push({
      id,
      kind: 'stream',
      text: '',
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      isStream: true,
      isCollapsed: false,
    })
    return
  }

  if (制御種別 === '終了' || 制御種別 === '中断') {
    const target = メッセージ一覧.value.find((m) => m.id === ストリームメッセージID)
    if (target) {
      target.isCollapsed = true
    }
    ストリームメッセージID = null
    return
  }

  const 表示内容 = AIストリーム表示内容(content)
  if (!表示内容) return

  const target = メッセージ一覧.value.find((m) => m.id === ストリームメッセージID)
  if (target) {
    target.text += `${表示内容}\n`
  }
}

function コア状態リセット() {
  入力接続済み.value = false
  チャット接続済み.value = false
  コア処理中.value = false
  コアエラー.value = ''
  入力ウェルカム情報.value = ''
  入力ウェルカム本文.value = ''
  メッセージ一覧.value = []
  初期マイク有効.value = false
  初期スピーカー有効.value = true
  音声状態シード.value = 0
  モデル設定.value = defaultModelSettings()
  if (!単独Avatar) チャットモード.value = 'live'
}

let コア接続世代 = 0
let 単独再接続タイマー: ReturnType<typeof setTimeout> | null = null
let 終了中 = false

function 単独再接続予約() {
  if (!単独Avatar || 終了中 || 単独再接続タイマー || !コアウィンドウ.value) return
  単独再接続タイマー = setTimeout(() => {
    単独再接続タイマー = null
    void コア初期化(セッションID.value)
  }, 5000)
}

function コア切断() {
  コア接続世代++
  if (単独再接続タイマー) clearTimeout(単独再接続タイマー)
  単独再接続タイマー = null
  コアソケット.value?.disconnect()
  入力ソケット.value?.disconnect()
  コアソケット.value = null
  入力ソケット.value = null
  コア状態リセット()
}

function 認証クリア(message = '') {
  if (単独Avatar) {
    if (message) {
      コア切断()
      コアエラー.value = 'ローカルCoreの内部認証を確認できません。Coreの起動状態を確認してください。'
      単独再接続予約()
    } else {
      終了中 = true
      コア切断()
      void window.desktopApi?.closeCurrentWindow?.()
    }
    return
  }
  認証トークン.value = ''
  利用者.value = null
  認証処理中.value = false
  認証エラー.value = message
  補助スナップショット.value = null
  パネル状態更新()
  認証Storage.removeItem('token')
  認証Storage.removeItem('user')
  認証Storage.removeItem('avatar_session_id')
  window.dispatchEvent(new Event('auth-cleared'))
  if (message) {
    認証Storage.setItem(認証エラーメッセージKey, message)
  } else {
    認証Storage.removeItem(認証エラーメッセージKey)
  }
  セッションID.value = ''
  WebURL同期('')
  コア切断()
  ウィンドウロール.value = 'login'
  void window.desktopApi?.openLoginWindow?.()
}

function ソケット状態バインド(client: AIWebSocket, target: typeof 入力接続済み) {
  // 接続情報（モデル・プロジェクトフォルダ）の反映後に各パネルを接続する。
  client.onStateChange((connected) => {
    if (!connected) target.value = false
  })
  client.on('init', () => {
    target.value = client.isConnected()
  })
}

function 初期化処理(message: Record<string, any>) {
  const payload = message.メッセージ内容 ?? {}
  const buttons = payload.ボタン ?? {}
  const settings = payload.モデル設定 ?? {}

  モデル設定.value = {
    CODE_BASE_PATH: 単独プロジェクト || settings.CODE_BASE_PATH || '',
    CHAT_AI_NAME: settings.CHAT_AI_NAME || '',
    LIVE_AI_NAME: settings.LIVE_AI_NAME || '',
    CODE_AI1_NAME: settings.CODE_AI1_NAME || '',
    CODE_AI2_NAME: settings.CODE_AI2_NAME || '',
    CODE_AI3_NAME: settings.CODE_AI3_NAME || '',
    CODE_AI4_NAME: settings.CODE_AI4_NAME || '',
    CODE_AI5_NAME: settings.CODE_AI5_NAME || '',
    CODE_AI6_NAME: settings.CODE_AI6_NAME || '',
    CODE_PERMISSIONS: settings.CODE_PERMISSIONS || 'auto',
    TASK_AI_NAME: settings.TASK_AI_NAME || 'codex_cli',
    TASK_AI_MODEL_plan: settings.TASK_AI_MODEL_plan || 'auto',
    TASK_AI_MODEL_do: settings.TASK_AI_MODEL_do || 'auto',
    TASK_AI_MODEL_check: settings.TASK_AI_MODEL_check || 'auto',
    TEAM_AI_NAME: settings.TEAM_AI_NAME || 'codex_cli',
    TEAM_AI_MODEL_plan: settings.TEAM_AI_MODEL_plan || 'auto',
    TEAM_AI_MODEL_do: settings.TEAM_AI_MODEL_do || 'auto',
    TEAM_AI_MODEL_check: settings.TEAM_AI_MODEL_check || 'auto',
  }

  初期スピーカー有効.value = buttons.スピーカー ?? true
  初期マイク有効.value = buttons.マイク ?? false
  チャットモード.value = 単独Avatar ? チャットモード.value : (String(buttons.チャットモード || 'live').toLowerCase() as チャットモード型) || 'live'
  音声状態シード.value += 1

  const nextStates = {
    chat: Boolean(buttons.チャット ?? true),
    file: Boolean(buttons.ファイル),
    image: Boolean(buttons.イメージ),
    code1: Boolean(buttons.エージェント1),
    code2: Boolean(buttons.エージェント2),
    code3: Boolean(buttons.エージェント3),
    code4: Boolean(buttons.エージェント4),
    code5: Boolean(buttons.エージェント5),
    code6: Boolean(buttons.エージェント6),
  }

  if (単独Avatar) { void パネル状態再読込().then(スナップショット送信); return }

  // Electronパネルウィンドウを目的の状態に合わせて開閉
  window.desktopApi?.applyPanelStates?.(nextStates).then((states) => {
    パネル状態更新(states)
  }).catch(() => {
    パネル状態更新(nextStates)
  }) ?? パネル状態更新(nextStates)
}

async function コア初期化(preferredSessionId = '') {
  if ((!単独Avatar && !利用者.value) || 終了中) return

  コア切断()
  const 接続世代 = コア接続世代
  const 接続取消済み = () => 終了中 || 接続世代 !== コア接続世代
  let 接続失敗 = false
  コア処理中.value = true
  コアエラー.value = ''

  const sessionHint = preferredSessionId || セッションID.value || ''

  try {
    if (単独Avatar) await 現在利用者取得()
    if (接続取消済み()) return
    let resolvedSessionId = sessionHint
    // 単独版は最初のWS接続でプロジェクトを確定する。
    // 従来のREST初期化は共通CODE_BASE_PATHでセッションを作るため使用しない。
    if (!単独Avatar) {
      try {
        const initRes = await apiClient.post('/core/AIコア/初期化', { セッションID: sessionHint })
        if (initRes.data.status === 'OK' && initRes.data.data?.セッションID) {
          resolvedSessionId = initRes.data.data.セッションID
        }
      } catch {
        // REST失敗時はヒントをそのまま使用（WebSocket側で生成される）
      }
    }

    if (接続取消済み()) return
    // coreチャンネルを先に接続（init・制御メッセージ・welcome を一括受信）
    const wsUrl = createWebSocketUrl('/core/ws/AIコア')
    const nextCoreSocket = new AIWebSocket(wsUrl, resolvedSessionId, 'core', 単独プロジェクト)
    ソケット状態バインド(nextCoreSocket, 入力接続済み)
    nextCoreSocket.on('init', 初期化処理)
    nextCoreSocket.on('error', (message) => {
      コアエラー.value = String(message.メッセージ内容 || message.error || 'AIコア接続エラー')
    })
    nextCoreSocket.on('welcome_info', (message) => {
      const text = 受信内容文字列(message).trim()
      if (text) 入力ウェルカム情報.value = text
    })
    nextCoreSocket.on('welcome_text', (message) => {
      const text = 受信内容文字列(message)
      if (!text) return
      入力ウェルカム本文.value = text
    })
    nextCoreSocket.on('output_text', (message) => {
      const text = String(message.メッセージ内容 || '')
      if (text) コアViewRef.value?.字幕追加(text)
    })
    nextCoreSocket.on('recognition_output', (message) => {
      const text = String(message.メッセージ内容 || '')
      if (text) コアViewRef.value?.字幕追加(text)
    })

    コアソケット.value = nextCoreSocket
    const nextSessionId = await nextCoreSocket.connect()
    if (接続取消済み()) { nextCoreSocket.disconnect(); return }
    セッションID.value = nextSessionId
    if (!単独Avatar) 認証Storage.setItem('avatar_session_id', nextSessionId)
    WebURL同期(nextSessionId)

    // core で確認したプロジェクトを input に引き継ぐ。入力拒否は画面へ通知する。
    const nextInputSocket = new AIWebSocket(wsUrl, nextSessionId, 'input', 単独プロジェクト || モデル設定.value.CODE_BASE_PATH)
    nextInputSocket.on('error', (message) => {
      コアエラー.value = String(message.メッセージ内容 || message.error || 'AIコア入力エラー')
    })
    nextInputSocket.onStateChange((connected) => {
      if (connected) void 操作状態同期()
    })
    nextInputSocket.connect().catch((e) => console.error('[Avatar] inputチャンネル接続エラー:', e))
    入力ソケット.value = nextInputSocket
    スナップショット送信()
  } catch (error) {
    if (接続取消済み()) return
    接続失敗 = true
    コア切断()
    コアエラー.value = 単独Avatar
      ? 'ローカルCoreに接続できません。Coreの起動状態と内部認証を確認してください。自動で再接続します。'
      : error instanceof Error ? error.message : 'AIコアへ接続できませんでした。'
    単独再接続予約()
  } finally {
    if (接続世代 === コア接続世代 || 接続失敗) コア処理中.value = false
  }
}

function ボタン状態取得() {
  return {
    ファイル: パネル表示状態.value.file,
    チャット: パネル表示状態.value.chat,
    エージェント1: パネル表示状態.value.code1,
    イメージ: パネル表示状態.value.image,
    エージェント2: パネル表示状態.value.code2,
    エージェント3: パネル表示状態.value.code3,
    エージェント4: パネル表示状態.value.code4,
    エージェント5: パネル表示状態.value.code5,
    エージェント6: パネル表示状態.value.code6,
    チャットモード: チャットモード.value,
  }
}

async function 操作状態同期() {
  if (!セッションID.value || !入力ソケット.value?.isConnected()) return

  const ボタン = ボタン状態取得()

  try {
    入力ソケット.value.updateState(ボタン)
  } catch (error) {
    console.error('[AIコア] 操作状態同期エラー:', error)
  }
}

async function 現在利用者取得() {
  if (!単独Avatar && !認証トークン.value) return

  const response = await apiClient.post('/core/auth/現在利用者')
  if (response.data.status !== 'OK') {
    throw new Error(response.data.message || '利用者情報を取得できませんでした。')
  }

  利用者.value = response.data.data
  if (!単独Avatar) 認証Storage.setItem('user', JSON.stringify(利用者.value))
}

async function ログイン送信(payload: { 利用者ID: string; パスワード: string }) {
  認証処理中.value = true
  認証エラー.value = ''

  try {
    const URL内セッションID = URLセッションID取得()
    const response = await apiClient.post('/core/auth/ログイン', payload)
    if (response.data.status !== 'OK') {
      認証エラー.value = response.data.message || 'ログインに失敗しました。'
      return
    }

    認証トークン.value = response.data.data.access_token
    認証Storage.setItem('token', 認証トークン.value)
    localStorage.setItem('avatar_last_user', payload.利用者ID)
    認証Storage.removeItem('user')
    認証Storage.removeItem(認証エラーメッセージKey)
    認証Storage.removeItem('avatar_session_id')
    セッションID.value = URL内セッションID
    if (isElectron) {
      await window.desktopApi?.openCoreWindow?.()
    } else {
      try {
        await 現在利用者取得()
        ウィンドウロール.value = 'core'
        await コア初期化(URL内セッションID)
      } catch {
        認証クリア()
      }
    }
  } catch (error) {
    認証エラー.value = error instanceof Error ? error.message : 'ログインエラーが発生しました。'
  } finally {
    認証処理中.value = false
  }
}

async function パネル切替(panel: PanelKey) {
  if (!isElectron) {
    if (Web右ペイン対象(panel)) {
      右アクティブタブ.value = panel
    } else {
      アクティブタブ.value = panel
    }
    return
  }

  try {
    if (panel === 'image') {
      自動選択表示.value = true
    }
    const states = await window.desktopApi?.togglePanel?.(panel)
    if (states) {
      パネル状態更新(states)
      await 操作状態同期()
      スナップショット送信()
    }
  } catch (error) {
    console.warn('[Avatar] パネル表示切替の反映に失敗しました。ローカル状態を維持します。', panel, error)
  }
}

async function パネル有効化(panel: PanelKey) {
  if (!isElectron) {
    if (Web右ペイン対象(panel)) {
      if (右アクティブタブ.value !== panel) {
        右アクティブタブ.value = panel
      }
    } else if (アクティブタブ.value !== panel) {
      アクティブタブ.value = panel
    }
    return
  }

  if (パネル表示状態.value[panel]) {
    return
  }

  try {
    const states = await window.desktopApi?.togglePanel?.(panel)
    if (states) {
      パネル状態更新(states)
      await 操作状態同期()
      スナップショット送信()
    }
  } catch (error) {
    console.warn('[Avatar] パネル自動表示の反映に失敗しました。', panel, error)
  }
}

function 現在コードパネル有効化() {
  const panel = 現在パネルキー.value
  if (!panel || !panel.startsWith('code')) {
    return
  }
  void パネル有効化(panel)
}

async function イメージ選択キャンセル() {
  自動選択表示.value = false
  if (現在パネルキー.value === 'image') {
    const states = await window.desktopApi?.togglePanel?.('image')
    if (states) {
      パネル状態更新(states)
    }
  }
}

function イメージ選択完了() {
  自動選択表示.value = false
}

async function 再接続() {
  await コア初期化(セッションID.value || '')
}

async function 再起動後再接続() {
  再起動カウントダウン表示.value = false
  await コア初期化(セッションID.value || '')

  // Web モードでは同一ウィンドウ内の各パネルを自前で再マウントしないと、
  // code/chat/file コンポーネントが旧接続・旧welcome表示を保持することがある。
  パネル再接続キー.value++

  // Electron の別ウィンドウパネルには BroadcastChannel で再接続を通知する。
  デスクトップチャンネル?.postMessage({ type: 'reboot-reconnect' })
}

function 設定再起動を開く() {
  if (isElectron) {
    void window.desktopApi?.openSettingsWindow?.(セッションID.value || '')
  } else {
    設定SessionID.value = セッションID.value || ''
    設定キー.value++
    Web設定表示.value = true
  }
}

function 設定ウィンドウを閉じる() {
  if (isElectron) {
    void window.desktopApi?.closeSettingsWindow?.()
  } else {
    Web設定表示.value = false
  }
}

async function 設定保存完了通知(waitSeconds: number = 30, resetSession = false) {
  if (isElectron) {
    void window.desktopApi?.closeSettingsWindow?.()
    デスクトップチャンネル?.postMessage({ type: 'settings-saved', waitSeconds, resetSession })
  } else {
    Web設定表示.value = false
    再起動待機秒数.value = waitSeconds
    再起動カウントダウン表示.value = true
  }
}

function チャット状態中継(connected: boolean) {
  if (コアウィンドウ.value) {
    チャット接続済み.value = connected
    return
  }
  デスクトップチャンネル?.postMessage({ type: 'chat-state', connected })
}

function 入力ペイロード送信(message: Record<string, unknown>) {
  if (!入力ソケット.value?.isConnected()) {
    コアエラー.value = 'AIコアに未接続です。再接続してください。'
    return
  }

  入力ソケット.value.send({
    セッションID: セッションID.value,
    ...message,
  })
}

function メッセージ送信(text: string) {
  入力ペイロード送信({
    チャンネル: '0',
    送信モード: チャットモード.value,
    メッセージ識別: 'input_text',
    メッセージ内容: text,
  })
}

function ウィンドウからメッセージ送信(text: string) {
  if (コアウィンドウ.value) {
    メッセージ送信(text)
    return
  }

  デスクトップチャンネル?.postMessage({ type: 'send-message', text })
}

function ウィンドウから入力ペイロード送信(message: Record<string, unknown>) {
  // BroadcastChannel の中継前に、送信元が表示しているプロジェクトを固定する。
  if (['input_text', 'input_request', 'input_file', 'input_image'].includes(String(message.メッセージ識別 || message.type || ''))) {
    message = { ...message, プロジェクトパス: message.プロジェクトパス ?? (表示モデル設定.value.CODE_BASE_PATH || null) }
  }
  if (コアウィンドウ.value) {
    入力ペイロード送信(message)
    return
  }

  デスクトップチャンネル?.postMessage({ type: 'send-input-payload', message })
}

async function ファイルをBase64変換(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const i = result.indexOf(',')
        resolve(i >= 0 ? result.slice(i + 1) : result)
      } else {
        reject(new Error('unexpected result type'))
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function チャットファイルドロップ処理(files: File[]) {
  for (const file of files) {
    try {
      const base64 = await ファイルをBase64変換(file)
      ウィンドウから入力ペイロード送信({
        チャンネル: '0',
        メッセージ識別: 'input_file',
        メッセージ内容: base64,
        ファイル名: file.name,
        サムネイル画像: null,
      })
    } catch (error) {
      コアエラー.value = `ファイル送信エラー: ${file.name}`
    }
  }
}

function コード送信処理(text: string, channel: コードチャンネル, 検証ループ回数: number = 1) {
  ウィンドウから入力ペイロード送信({
    チャンネル: channel,
    メッセージ識別: 'input_text',
    メッセージ内容: text,
    self_check_loop: 検証ループ回数,
  })
}

function コードキャンセル処理(channel: コードチャンネル) {
  ウィンドウから入力ペイロード送信({
    チャンネル: channel,
    メッセージ識別: 'cancel_run',
    メッセージ内容: '強制停止！',
  })
}

function コードファイル送信処理(payload: { channel: コードチャンネル; fileName: string; base64: string }) {
  ウィンドウから入力ペイロード送信({
    チャンネル: payload.channel,
    メッセージ識別: 'input_file',
    メッセージ内容: payload.base64,
    ファイル名: payload.fileName,
    サムネイル画像: null,
  })
}

function イメージ送信処理(payload: { text: string; mimeType: string; base64: string }) {
  const text = payload.text.trim()
  if (text) {
    ウィンドウから入力ペイロード送信({
      チャンネル: 'input',
      メッセージ識別: 'input_text',
      メッセージ内容: text,
    })
  }

  ウィンドウから入力ペイロード送信({
    チャンネル: 'input',
    出力先チャンネル: '0',
    メッセージ識別: 'input_image',
    メッセージ内容: payload.mimeType,
    ファイル名: payload.base64,
  })
}

function イメージテキスト送信処理(text: string) {
  if (!text.trim()) return
  ウィンドウから入力ペイロード送信({
    チャンネル: 'input',
    メッセージ識別: 'input_text',
    メッセージ内容: text.trim(),
  })
}

function チャットモード更新(nextMode: チャットモード型) {
  if (コアウィンドウ.value) {
    チャットモード.value = nextMode
    return
  }

  if (補助スナップショット.value) {
    補助スナップショット.value = {
      ...補助スナップショット.value,
      チャットモード: nextMode,
    }
  }
  デスクトップチャンネル?.postMessage({ type: 'set-chat-mode', mode: nextMode })
}

watch(チャットモード, () => {
  if (!コアウィンドウ.value) return
  void 操作状態同期()
})

watch(パネル表示状態, () => {
  if (!コアウィンドウ.value) return
  void 操作状態同期()
}, { deep: true })

watch(
  () => ({
    role: ウィンドウロール.value,
    認証済み: 認証済み.value,
    セッションID: セッションID.value,
    入力ウェルカム情報: 入力ウェルカム情報.value,
    入力ウェルカム本文: 入力ウェルカム本文.value,
    メッセージ一覧: メッセージ一覧.value,
    チャットモード: チャットモード.value,
    モデル設定: モデル設定.value,
    入力接続済み: 入力接続済み.value,
    チャット接続済み: チャット接続済み.value,
    パネル表示状態: パネル表示状態.value,
    コア処理中: コア処理中.value,
    コアエラー: コアエラー.value,
    利用者ラベル: 利用者ラベル.value,
  }),
  () => {
    スナップショット送信()
  },
  { deep: true },
)

onMounted(async () => {
  window.addEventListener('auth-expired', 認証期限切れ処理)
  window.addEventListener('storage', ストレージ変更処理)

  if (Web新規開始URL判定()) {
    認証データ初期化()
    認証トークン.value = ''
    利用者.value = null
    セッションID.value = ''
    認証エラー.value = ''
    ウィンドウロール.value = 'login'
  }

  デスクトップチャンネル = new BroadcastChannel(単独Avatar ? 'avatar-alone-settings-sync' : 'avatar-desktop-sync')
  デスクトップチャンネル.addEventListener('message', デスクトップチャンネルメッセージ処理)

  await ウィンドウロール検出()

  パネル状態リスナー解除 = window.desktopApi?.onPanelStatesChanged?.((states) => {
    パネル状態更新(states)
  }) || null

  ウィンドウ表示リスナー解除 = window.desktopApi?.onWindowShown?.(() => {
    ストレージ認証同期({ syncError: ログインウィンドウ.value })
    if (現在パネルキー.value) {
      void パネル状態再読込()
      スナップショット要求()
      スナップショット再試行開始()
    }
  }) || null

  if (現在パネルキー.value) {
    await パネル状態再読込()
    認証読込中.value = false
    スナップショット要求()
    スナップショット再試行開始()
    return
  }

  if (設定ウィンドウ.value) {
    認証読込中.value = false
    window.desktopApi?.onSettingsPrepare?.((sid) => {
      設定SessionID.value = sid
      設定キー.value++
    })
    window.desktopApi?.onWindowShown?.(() => {
      設定キー.value++
    })
    return
  }

  if (単独Avatar) {
    await コア初期化()
    認証読込中.value = false
    return
  }

  await パネル状態再読込()
  ストレージ認証同期({ syncError: true })

  if (!認証トークン.value) {
    認証読込中.value = false
    return
  }

  try {
    await 現在利用者取得()

    if (ログインウィンドウ.value) {
      if (isElectron) {
        await window.desktopApi?.openCoreWindow?.()
        return
      }
      ウィンドウロール.value = 'core'
    }

    await コア初期化(セッションID.value || '')
  } catch {
    認証クリア()
  } finally {
    認証読込中.value = false
    await パネル状態再読込()
  }
})

onBeforeUnmount(() => {
  終了中 = true
  window.removeEventListener('auth-expired', 認証期限切れ処理)
  window.removeEventListener('storage', ストレージ変更処理)
  パネル状態リスナー解除?.()
  ウィンドウ表示リスナー解除?.()
  デスクトップチャンネル?.removeEventListener('message', デスクトップチャンネルメッセージ処理)
  デスクトップチャンネル?.close()
  スナップショット再試行停止()
  コア切断()
})
</script>

<template>
  <main class="app-root">
    <component
      :is="ログイン"
      v-if="ログインウィンドウ && (!認証済み || 認証処理中) && !認証読込中"
      :loading="認証処理中"
      :error-message="認証エラー"
      :versions="versions"
      @submit="ログイン送信"
    />

    <!-- ======= Web版 左右分割レイアウト ======= -->
    <div v-else-if="コアウィンドウ && 認証済み && !isElectron" class="web-core-root">
    <div class="web-split-layout" :class="{ resizing: リサイズ中 }">

      <!-- 左ペイン：タブナビ + タブコンテンツ -->
      <div class="web-left-pane" :style="{ width: 分割比率 + '%' }">
        <nav class="web-tab-bar">
          <button
            v-for="tab in webTabs"
            :key="tab.key"
            :class="['web-tab-btn', アクティブタブ === tab.key ? 'active' : '']"
            type="button"
            @click="アクティブタブ = tab.key"
          >{{ tab.label }}</button>
          <span class="web-tab-spacer" />
        </nav>

        <!-- タイトルバー -->
        <div class="web-tab-title">
          <div class="web-tab-title-left">
            <span>{{ Webアクティブタイトル }}</span>
          </div>
          <div class="web-tab-title-right">
            <span :class="['web-panel-status-dot', Webアクティブ状態クラス]"></span>
            <span class="web-panel-status-text">{{ Webアクティブ状態表示 }}</span>
            <component :is="再読込ボタン"
              v-if="アクティブタブ === 'file'"
              :disabled="ファイルRef?.読込中"
              @click="ファイルRef?.ファイルリスト要求()"
            />
          </div>
        </div>

        <div class="web-tab-content">
          <!-- チャット -->
          <div v-show="アクティブタブ === 'chat'" class="web-tab-panel">
            <component
              :is="AIコアチャット"
              :key="パネル再接続キー"
              ref="チャットRef"
              :messages="メッセージ一覧"
              :ウェルカム情報="入力ウェルカム情報"
              :セッションID="セッションID"
              :active="アクティブタブ === 'chat'"
              :chat-mode="チャットモード"
              :入力接続済み="入力接続済み"
              :チャット接続済み="チャット接続済み"
              :モデル設定="モデル設定"
              @send-input-payload="入力ペイロード送信"
              @mode-change="チャットモード更新"
              @chat-state="チャット状態中継"
              @activate="パネル有効化('chat')"
            />
          </div>

          <!-- ファイル -->
          <div v-show="アクティブタブ === 'file'" class="web-tab-panel">
            <component
              :is="AIコアファイル"
              :key="パネル再接続キー"
              ref="ファイルRef"
              :セッションID="セッションID"
              :active="アクティブタブ === 'file'"
              :入力接続済み="入力接続済み"
              @send-input-payload="入力ペイロード送信"
            />
          </div>

          <!-- コード2 -->
          <div v-show="アクティブタブ === 'code2'" class="web-tab-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-2`"
              ref="コード2Ref"
              :セッションID="セッションID"
              チャンネル="2"
              :active="アクティブタブ === 'code2'"
              :code-ai="コードAI名('2')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('2')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code2')"
            />
          </div>

          <!-- コード4 -->
          <div v-show="アクティブタブ === 'code4'" class="web-tab-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-4`"
              ref="コード4Ref"
              :セッションID="セッションID"
              チャンネル="4"
              :active="アクティブタブ === 'code4'"
              :code-ai="コードAI名('4')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('4')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code4')"
            />
          </div>

          <!-- コード6 -->
          <div v-show="アクティブタブ === 'code6'" class="web-tab-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-6`"
              ref="コード6Ref"
              :セッションID="セッションID"
              チャンネル="6"
              :active="アクティブタブ === 'code6'"
              :code-ai="コードAI名('6')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('6')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code6')"
            />
          </div>
        </div>
      </div>

      <!-- リサイザー -->
      <div class="web-resizer" @mousedown="リサイズ開始" />

      <!-- 右ペイン：コア / イメージ 切替 -->
      <div class="web-right-pane" :style="{ width: (100 - 分割比率) + '%' }">
        <nav class="web-right-tab-bar">
          <button
            v-for="tab in webRightTabs"
            :key="tab.key"
            :class="['web-right-tab-btn', 右アクティブタブ === tab.key ? 'active' : '']"
            type="button"
            @click="右アクティブタブ = tab.key"
          >{{ tab.label }}</button>
          <span class="web-tab-spacer" />
          <span class="web-right-user" :title="利用者ラベル">{{ 利用者ラベル }}</span>
          <div class="web-right-status">
            <span :class="['web-conn-dot', 入力接続済み ? 'on' : '']" :title="`input: ${Web入力接続状態表示}`" />
            <span class="web-right-status-text">{{ Web入力接続状態表示 }}</span>
          </div>
        </nav>
        <div v-if="右アクティブタブ !== 'core'" class="web-tab-title">
          <div class="web-tab-title-left">
            <span>{{ Web右ペインタイトル }}</span>
          </div>
          <div class="web-tab-title-right">
            <span :class="['web-panel-status-dot', Web右ペイン状態クラス]"></span>
            <span class="web-panel-status-text">{{ Web右ペイン状態表示 }}</span>
          </div>
        </div>
        <div class="web-right-content">
          <div v-show="右アクティブタブ === 'core'" class="web-right-panel">
            <component
              :is="AIコアコントロール"
              ref="コアViewRef"
              :session-id="セッションID"
              :user-label="利用者ラベル"
              :code-base-path="モデル設定.CODE_BASE_PATH"
              :live-model="モデル設定.LIVE_AI_NAME"
              :welcome-info="入力ウェルカム情報"
              :welcome-body="入力ウェルカム本文"
              :input-connected="入力接続済み"
              :input-socket="入力ソケット"
              :initial-mic-enabled="初期マイク有効"
              :initial-speaker-enabled="初期スピーカー有効"
              :audio-state-seed="音声状態シード"
              :panel-visibility="Webコア用パネル表示状態"
              :core-busy="コア処理中"
              :core-error="コアエラー"
              :show-user-label="false"
              title-status-source="input"
              @toggle-panel="パネル切替"
              @reconnect="再接続"
              @open-setting-restart="設定再起動を開く"
              @logout="認証クリア()"
            />
          </div>
          <div v-show="右アクティブタブ === 'image'" class="web-right-panel">
            <component
              :is="AIコアイメージ"
              :key="パネル再接続キー"
              ref="イメージRef"
              :セッションID="セッションID"
              :入力接続済み="入力接続済み"
              :active="右アクティブタブ === 'image'"
              :auto-show-selection="false"
              @submit-image="イメージ送信処理"
              @submit-text="イメージテキスト送信処理"
              @selection-cancel="() => {}"
              @selection-complete="() => {}"
            />
          </div>
          <div v-show="右アクティブタブ === 'code1'" class="web-right-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-1`"
              ref="コード1Ref"
              :セッションID="セッションID"
              チャンネル="1"
              :active="右アクティブタブ === 'code1'"
              :code-ai="コードAI名('1')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('1')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code1')"
            />
          </div>
          <div v-show="右アクティブタブ === 'code3'" class="web-right-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-3`"
              ref="コード3Ref"
              :セッションID="セッションID"
              チャンネル="3"
              :active="右アクティブタブ === 'code3'"
              :code-ai="コードAI名('3')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('3')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code3')"
            />
          </div>
          <div v-show="右アクティブタブ === 'code5'" class="web-right-panel">
            <component
              :is="AIコアコード"
              :key="`${パネル再接続キー}-5`"
              ref="コード5Ref"
              :セッションID="セッションID"
              チャンネル="5"
              :active="右アクティブタブ === 'code5'"
              :code-ai="コードAI名('5')"
              :入力接続済み="入力接続済み"
              @submit="コード送信処理"
              @cancel="() => コードキャンセル処理('5')"
              @send-file="コードファイル送信処理"
              @activate="パネル有効化('code5')"
            />
          </div>
        </div>
      </div>
    </div>

    </div>

    <!-- ======= Electron コアウィンドウ ======= -->
    <component
      :is="AIコアコントロール"
      v-else-if="コアウィンドウ && 認証済み && isElectron"
      ref="コアViewRef"
      :session-id="セッションID"
      :user-label="利用者ラベル"
      :code-base-path="モデル設定.CODE_BASE_PATH"
      :live-model="モデル設定.LIVE_AI_NAME"
      :welcome-info="入力ウェルカム情報"
      :welcome-body="入力ウェルカム本文"
      :input-connected="入力接続済み"
      :input-socket="入力ソケット"
      :initial-mic-enabled="初期マイク有効"
      :initial-speaker-enabled="初期スピーカー有効"
      :audio-state-seed="音声状態シード"
      :panel-visibility="パネル表示状態"
      :standalone="単独Avatar"
      :show-user-label="!単独Avatar"
      :core-busy="コア処理中"
      :core-error="コアエラー"
      @toggle-panel="パネル切替"
      @reconnect="再接続"
      @open-setting-restart="設定再起動を開く"
      @logout="認証クリア()"
    />

    <div v-else-if="設定ウィンドウ" class="settings-window-root">
      <component
        :is="WindowShell"
        title="AiDiy モデル設定 / 再起動"
        theme="purple"
        close-mode="event"
        @close="設定ウィンドウを閉じる"
      >
        <component
          :is="AI設定再起動"
          :key="設定キー"
          :is-open="true"
          :session-id="設定SessionID"
          :fixed-project-path="単独プロジェクト"
          @close="設定ウィンドウを閉じる"
          @saved="(s: number, resetSession?: boolean) => 設定保存完了通知(s, resetSession)"
        />
      </component>
    </div>

    <component
      :is="WindowShell"
      v-else-if="現在パネルキー === 'chat'"
      :title="PANEL_TITLES.chat"
      theme="purple"
    >
      <template #title-right>
        <span :class="['chat-status-dot', チャットRef?.WebSocket接続中 ? 'on' : '']"></span>
        <span class="chat-status-text">{{ チャットRef?.WebSocket接続中 ? '接続中' : '切断' }}</span>
      </template>

      <component
        :is="AIコアチャット"
        :key="パネル再接続キー"
        ref="チャットRef"
        :messages="表示メッセージ一覧"
        :ウェルカム情報="表示ウェルカム情報"
        :セッションID="表示セッションID"
        :active="パネル表示状態.chat"
        :chat-mode="表示チャットモード"
        :入力接続済み="表示入力接続済み"
        :チャット接続済み="表示チャット接続済み"
        :モデル設定="表示モデル設定"
        @send-input-payload="ウィンドウから入力ペイロード送信"
        @mode-change="チャットモード更新"
        @chat-state="チャット状態中継"
        @activate="パネル有効化('chat')"
      />
    </component>

    <component
      :is="WindowShell"
      v-else-if="現在パネルキー === 'file'"
      :title="PANEL_TITLES.file"
      theme="purple"
    >
      <template #title-right>
        <span :class="['file-status-dot', ファイルRef?.出力接続済み ? 'on' : '']"></span>
        <span class="file-status-text">{{ ファイルRef?.出力接続済み ? '接続中' : '切断' }}</span>
        <component :is="再読込ボタン" :disabled="ファイルRef?.読込中" @click="ファイルRef?.ファイルリスト要求()" />
      </template>
      <component
        :is="AIコアファイル"
        :key="パネル再接続キー"
        ref="ファイルRef"
        :セッションID="表示セッションID"
        :active="パネル表示状態.file"
        :入力接続済み="表示入力接続済み"
        @send-input-payload="ウィンドウから入力ペイロード送信"
      />
    </component>

    <component
      :is="WindowShell"
      v-else-if="現在パネルキー === 'image'"
      :title="PANEL_TITLES.image"
      theme="purple"
    >
      <template #title-right>
        <span
          :class="[
            'image-status-dot',
            イメージRef?.接続状態 === 'sending' ? 'sending' : イメージRef?.WebSocket接続中 ? 'on' : '',
          ]"
        ></span>
        <span class="image-status-text">{{ イメージRef?.状態表示テキスト || '切断' }}</span>
      </template>
      <component
        :is="AIコアイメージ"
        :key="パネル再接続キー"
        ref="イメージRef"
        :セッションID="表示セッションID"
        :入力接続済み="表示入力接続済み"
        :active="パネル表示状態.image"
        :auto-show-selection="自動選択表示"
        @submit-image="イメージ送信処理"
        @submit-text="イメージテキスト送信処理"
        @selection-cancel="イメージ選択キャンセル"
        @selection-complete="イメージ選択完了"
      />
    </component>

    <component
      :is="WindowShell"
      v-else-if="現在パネルキー && 現在コードチャンネル"
      :title="現在パネルキー ? PANEL_TITLES[現在パネルキー] : ''"
      theme="purple"
    >
      <template #title-right>
        <span :class="['code-status-dot', コードRef?.WebSocket接続中 ? 'on' : '']"></span>
        <span class="code-status-text">{{ コードRef?.接続状態表示 || '切断' }}</span>
      </template>
      <component
        :is="AIコアコード"
        :key="パネル再接続キー"
        ref="コードRef"
        :セッションID="表示セッションID"
        :チャンネル="現在コードチャンネル || '1'"
        :active="現在パネルキー ? パネル表示状態[現在パネルキー] : false"
        :code-ai="現在コードモデル"
        :入力接続済み="表示入力接続済み"
        @submit="コード送信処理"
        @cancel="コードキャンセル処理"
        @send-file="コードファイル送信処理"
        @activate="現在コードパネル有効化"
      />
    </component>

    <section v-else class="loading-state">
      <img class="loading-logo" src="/icons/loading.gif" alt="loading" />
      <p>認証状態を確認しています...</p>
    </section>

    <component
      v-if="コアウィンドウ"
      :is="再起動カウントダウン"
      :show="再起動カウントダウン表示"
      :wait-seconds="再起動待機秒数"
      @end="再起動後再接続"
    />

    <!-- Web モード 設定ダイアログ（position:fixed オーバーレイ） -->
    <component
      v-if="!isElectron && Web設定表示"
      :is="AI設定再起動"
      :key="設定キー"
      :is-open="Web設定表示"
      :session-id="設定SessionID"
          :fixed-project-path="単独プロジェクト"
      @close="設定ウィンドウを閉じる"
      @saved="(s: number, resetSession?: boolean) => 設定保存完了通知(s, resetSession)"
    />
  </main>
</template>

<style scoped>
.file-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}
.file-status-dot.on { background: #44ff44; }
.file-status-text { font-size: 10px; font-weight: bold; }
.chat-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}
.chat-status-dot.on { background: #44ff44; }
.chat-status-text { font-size: 10px; font-weight: bold; }
.image-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}
.image-status-dot.on { background: #44ff44; }
.image-status-dot.sending { background: #ff4444; }
.image-status-text { font-size: 10px; font-weight: bold; }
.code-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
  flex-shrink: 0;
}
.code-status-dot.on { background: #44ff44; }
.code-status-text { font-size: 10px; font-weight: bold; }
.settings-window-root {
  width: 100%;
  height: 100%;
  background: #f8fafc;
}
/* _WindowShell 内でダイアログを全体表示: overlayを静的配置に */
.settings-window-root :deep(.config-panel-overlay) {
  position: static;
  background: transparent;
  z-index: auto;
  display: flex;
  align-items: flex-start;
  justify-content: stretch;
  height: 100%;
}
/* 既存ヘッダーは_WindowShellのタイトルバーで代替 */
.settings-window-root :deep(.config-panel-header) { display: none; }
/* パネルカードを全幅・角丸なしで展開 */
.settings-window-root :deep(.config-panel) {
  width: 100%;
  max-width: 720px;
  max-height: 100%;
  border-radius: 0;
  box-shadow: none;
  border-left: none;
  border-right: none;
  border-bottom: none;
}
.settings-window-root :deep(.window-shell),
.settings-window-root :deep(.window-body) {
  background: #f8fafc;
}
.settings-window-root :deep(button),
.settings-window-root :deep(select),
.settings-window-root :deep(input) { -webkit-app-region: no-drag; }

/* 外寸は維持し、枠の1pxを内容領域から確保する（操作面に重ねない）。 */
.web-left-pane,
.web-right-pane {
  box-sizing: border-box;
  border: 1px solid var(--avatar-title-edge);
  border-image: none;
}
/* 外側ペインが枠を所有。内部の同じ枠を二重表示しない。 */
.web-right-content :deep(.window-shell) {
  border-color: transparent;
  border-image: none;
}

.web-right-content :deep(.window-shell::after) {
  display: none;
}

/* ===== Web版 左右分割レイアウト ===== */
.web-core-root {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
.web-split-layout {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100vh;
  background: #0a0a12;
  overflow: hidden;
}
.web-split-layout.resizing {
  user-select: none;
  cursor: col-resize;
}

/* 左ペイン */
.web-left-pane {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 280px;
  overflow: hidden;
}

/* リサイザー */
.web-resizer {
  width: 5px;
  flex-shrink: 0;
  background: rgba(118, 97, 204, 0.4);
  cursor: col-resize;
  transition: background 0.15s;
}
.web-resizer:hover,
.web-split-layout.resizing .web-resizer {
  background: rgba(150, 120, 240, 0.9);
}

/* 右ペイン（コア/アバター）*/
.web-right-pane {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
.web-right-topbar {
  height: 37px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(10, 8, 20, 0.96);
  border-bottom: 1px solid rgba(118, 97, 204, 0.5);
  flex-shrink: 0;
}
.web-right-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
}
.web-right-status-text {
  font-size: 11px;
  color: #ffffff;
  font-weight: 700;
  white-space: nowrap;
}
.web-right-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.web-right-panel {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.web-right-user {
  max-width: 220px;
  font-size: 11px;
  color: #ffffff;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* _WindowShell の 100vw/100vh を上書きして右ペインに収める */
.web-right-content :deep(.window-shell) {
  width: 100% !important;
  height: 100% !important;
}
.web-right-tab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(10, 8, 20, 0.96);
  border-bottom: 1px solid rgba(118, 97, 204, 0.5);
  flex-shrink: 0;
}
.web-right-tab-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: bold;
  color: #aaa;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(118, 97, 204, 0.3);
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.web-right-tab-btn:hover {
  background: rgba(118, 97, 204, 0.25);
  color: #ddd;
}
.web-right-tab-btn.active {
  background: rgba(118, 97, 204, 0.45);
  color: #fff;
  border-color: rgba(150, 120, 240, 0.8);
  border-bottom-color: transparent;
}

/* タブバー */
.web-tab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(10, 8, 20, 0.96);
  border-bottom: 1px solid rgba(118, 97, 204, 0.5);
  flex-shrink: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
}
.web-tab-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: bold;
  color: #aaa;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(118, 97, 204, 0.3);
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.web-tab-btn:hover { background: rgba(118, 97, 204, 0.25); color: #ddd; }
.web-tab-btn.active {
  background: rgba(118, 97, 204, 0.45);
  color: #fff;
  border-color: rgba(150, 120, 240, 0.8);
  border-bottom-color: transparent;
}
.web-tab-spacer { flex: 1; min-width: 4px; }
.web-conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
  margin-right: 4px;
}
.web-conn-dot.on { background: #44ff44; }

/* タイトルバー */
.web-tab-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  background: var(--avatar-title-background);
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
  flex-shrink: 0;
}
.web-tab-title-left,
.web-tab-title-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.web-tab-title-left {
  overflow: hidden;
}
.web-tab-title-left span {
  font-size: 0.74rem;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.web-panel-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}
.web-panel-status-dot.on { background: #44ff44; }
.web-panel-status-dot.sending { background: #ff4444; }
.web-panel-status-text {
  font-size: 10px;
  font-weight: bold;
  white-space: nowrap;
}

/* タブコンテンツ */
.web-tab-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}
.web-tab-panel {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
