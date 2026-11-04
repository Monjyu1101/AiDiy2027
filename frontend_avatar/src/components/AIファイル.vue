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
import { monaco, モナコ言語推定 } from '@/utils/monaco'
import { AIWebSocket } from '@/api/websocket'

const 認証Storage = window.desktopApi ? localStorage : sessionStorage

type ファイルエントリ = { パス: string; 更新日時: string }
type ツリーノード種別 = 'folder' | 'file'
type ツリーノード = {
  名前: string
  パス: string
  種別: ツリーノード種別
  更新日時?: string
  子ノード: ツリーノード[]
}
type ツリー表示行 = {
  キー: string
  名前: string
  パス: string
  種別: ツリーノード種別
  深さ: number
  展開中: boolean
  更新日時?: string
}
type ツリー内部ノード = {
  名前: string
  パス: string
  種別: ツリーノード種別
  更新日時?: string
  子Map: Map<string, ツリー内部ノード>
}

const プロパティ = defineProps<{
  セッションID: string
  active: boolean
  入力接続済み: boolean
}>()

const 通知 = defineEmits<{
  'send-input-payload': [message: Record<string, unknown>]
}>()

// --- 接続 ---
const 出力WebSocket = ref<AIWebSocket | null>(null)
const 出力接続済み = ref(false)
let fileSocketStateUnsubscribe: (() => void) | null = null
let ハイライト要求連番 = 0
let トークン更新中 = false
// --- ファイルリスト ---
const プロジェクトパス = ref('')
const バックアップベースパス = ref('')
const 最終ファイル日時 = ref<string | null>(null)
const 最終ファイルリスト = ref<ファイルエントリ[]>([])
const 作業ファイル日時 = ref<string | null>(null)
const 作業ファイルリスト = ref<ファイルエントリ[]>([])
const 左読込中 = ref(false)
const 右読込中 = ref(false)
const 左展開中フォルダ = ref<Set<string>>(new Set())
const 右展開中フォルダ = ref<Set<string>>(new Set())

// --- 選択ファイル ---
const 選択ファイル名 = ref('')
const 選択ファイルパス = ref('')
const 選択パネル = ref<'left' | 'right' | null>(null)
const 選択種別 = ref<'file' | 'folder' | null>(null)
const ファイル内容テキスト = ref<string | null>(null)
const ファイル内容画像 = ref<string | null>(null)
const ファイル内容エラー = ref<string | null>(null)
const ファイル読込中 = ref(false)
const 編集モード = ref(false)
const ファイル保存中 = ref(false)
const ファイルダウンロード中 = ref(false)

// --- Monaco ---
const fileコンテナ = ref<HTMLElement | null>(null)
const monacoコンテナ = ref<HTMLDivElement | null>(null)
let monacoエディタ: monaco.editor.IStandaloneCodeEditor | null = null
// --- 自動更新 ---
let テンプリスト自動送信タイマー: ReturnType<typeof setTimeout> | null = null
const 更新間隔選択肢 = [
  { 値: 0, 表示: '切' },
  { 値: 1, 表示: '1秒間隔' },
  { 値: 2, 表示: '2秒間隔' },
  { 値: 5, 表示: '5秒間隔' },
]
const テンプ更新間隔 = ref<number>(5)
const 要求日時選択肢 = [
  { 値: -2, 表示: '前日以内' },
  { 値: -1, 表示: '当日以内' },
  { 値: 0, 表示: '全て' },
  { 値: 1, 表示: '1分以内' },
  { 値: 5, 表示: '5分以内' },
  { 値: 10, 表示: '10分以内' },
  { 値: 60, 表示: '60分以内' },
]
const バックアップ要求日時 = ref<number>(0)
const テンプリスト要求日時 = ref<number>(60)
const 最終受信バックアップ要求日時 = ref<number | null>(null)
const 最終受信テンプリスト要求日時 = ref<number | null>(null)

const 画像拡張子 = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'])
const ANSI拡張子 = new Set(['bat', 'cmd'])

// ===================== ツリー構造 =====================

const パス正規化 = (パス: string): string =>
  (パス ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

const 更新日時が本日 = (更新日時?: string): boolean => {
  if (!更新日時) return false
  const now = new Date()
  const 今日 = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
  return 更新日時.trim().replace(/-/g, '/').startsWith(今日)
}

const 日時文字列をDate化 = (日時?: string | null): Date | null => {
  if (!日時) return null
  const m = 日時
    .trim()
    .replace(/-/g, '/')
    .match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0'))
  return Number.isNaN(d.getTime()) ? null : d
}

const 日時文字列正規化 = (日時?: string | null): string | null => {
  const d = 日時文字列をDate化(日時)
  if (!d) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}/${m}/${day} ${h}:${mm}:${s}`
}

const 右側更新日時表示 = (更新日時?: string): string => {
  const 正規化 = 日時文字列正規化(更新日時)
  if (!正規化) return 更新日時 ?? ''
  const parts = 正規化.split(' ')
  return parts.length >= 2 ? (parts[1] ?? 正規化) : 正規化
}

const 右更新日時が現在から10分以内 = (更新日時?: string): boolean => {
  const 対象 = 日時文字列をDate化(更新日時)
  if (!対象) return false
  const 差分ms = Date.now() - 対象.getTime()
  return 差分ms >= 0 && 差分ms <= 10 * 60 * 1000
}

const ノード並び替え = (a: ツリーノード, b: ツリーノード): number => {
  if (a.種別 !== b.種別) return a.種別 === 'folder' ? -1 : 1
  return a.名前.localeCompare(b.名前, 'ja')
}

const ファイル一覧をツリー化 = (ファイル一覧: ファイルエントリ[]): ツリーノード[] => {
  const ルートMap = new Map<string, ツリー内部ノード>()
  for (const エントリ of ファイル一覧) {
    const 正規パス = パス正規化(エントリ.パス)
    if (!正規パス) continue
    const セグメント = 正規パス.split('/').filter(Boolean)
    if (セグメント.length === 0) continue
    let 現在Map = ルートMap
    let 累積パス = ''
    for (let i = 0; i < セグメント.length; i++) {
      const 名前 = セグメント[i]!
      const isFile = i === セグメント.length - 1
      累積パス = 累積パス ? `${累積パス}/${名前}` : 名前
      let 既存 = 現在Map.get(名前)
      if (!既存) {
        既存 = {
          名前,
          パス: 累積パス,
          種別: isFile ? 'file' : 'folder',
          更新日時: isFile ? エントリ.更新日時 : undefined,
          子Map: new Map(),
        }
        現在Map.set(名前, 既存)
      } else if (!isFile && 既存.種別 === 'file') {
        既存.種別 = 'folder'
        既存.更新日時 = undefined
      }
      if (!isFile) 現在Map = 既存!.子Map
    }
  }
  const 内部を外部へ = (内部: ツリー内部ノード): ツリーノード => ({
    名前: 内部.名前,
    パス: 内部.パス,
    種別: 内部.種別,
    更新日時: 内部.更新日時,
    子ノード: Array.from(内部.子Map.values()).map(内部を外部へ).sort(ノード並び替え),
  })
  return Array.from(ルートMap.values()).map(内部を外部へ).sort(ノード並び替え)
}

const ツリー行化 = (ノード一覧: ツリーノード[], 展開中フォルダ: Set<string>, 深さ = 0): ツリー表示行[] => {
  const 行一覧: ツリー表示行[] = []
  for (const ノード of ノード一覧) {
    const 展開中 = ノード.種別 === 'folder' ? 展開中フォルダ.has(ノード.パス) : false
    行一覧.push({
      キー: `${ノード.種別}:${ノード.パス}`,
      名前: ノード.名前,
      パス: ノード.パス,
      種別: ノード.種別,
      深さ,
      展開中,
      更新日時: ノード.更新日時,
    })
    if (ノード.種別 === 'folder' && 展開中) {
      行一覧.push(...ツリー行化(ノード.子ノード, 展開中フォルダ, 深さ + 1))
    }
  }
  return 行一覧
}

const 全フォルダパス取得 = (ファイル一覧: ファイルエントリ[]): string[] => {
  const パスSet = new Set<string>()
  for (const エントリ of ファイル一覧) {
    const 正規パス = パス正規化(エントリ.パス)
    if (!正規パス) continue
    const セグメント = 正規パス.split('/').filter(Boolean)
    let 累積パス = ''
    for (let i = 0; i < セグメント.length - 1; i++) {
      累積パス = 累積パス ? `${累積パス}/${セグメント[i]!}` : セグメント[i]!
      パスSet.add(累積パス)
    }
  }
  return Array.from(パスSet)
}

const 最終ファイルツリー = computed(() => ファイル一覧をツリー化(最終ファイルリスト.value))
const 作業ファイルツリー = computed(() => ファイル一覧をツリー化(作業ファイルリスト.value))
const 最終ファイル行 = computed(() => ツリー行化(最終ファイルツリー.value, 左展開中フォルダ.value))
const 作業ファイル行 = computed(() => ツリー行化(作業ファイルツリー.value, 右展開中フォルダ.value))

const フォルダ開閉 = (フォルダパス: string, isBackup: boolean) => {
  const 展開中 = isBackup ? 左展開中フォルダ : 右展開中フォルダ
  const 次 = new Set(展開中.value)
  if (次.has(フォルダパス)) 次.delete(フォルダパス)
  else 次.add(フォルダパス)
  展開中.value = 次
}

const ツリー行クリック = (行: ツリー表示行, isBackup: boolean) => {
  const panel = isBackup ? 'left' : 'right'
  if (行.種別 === 'folder') {
    フォルダ開閉(行.パス, isBackup)
    // フォルダ選択トグル
    if (選択ファイル名.value === 行.パス && 選択パネル.value === panel && 選択種別.value === 'folder') {
      下部ファイル表示クリア()
      選択解除通知送信()
    } else {
      下部ファイル表示クリア()
      選択ファイル名.value = 行.パス
      選択パネル.value = panel
      選択種別.value = 'folder'
      選択通知送信(行.パス, 'folder', isBackup)
    }
    return
  }
  // ファイルトグル
  if (選択ファイル名.value === 行.パス && 選択パネル.value === panel && 選択種別.value === 'file') {
    下部ファイル表示クリア()
    選択解除通知送信()
    return
  }
  void ファイルクリック(行.パス, isBackup)
}

// ===================== Monaco Editor =====================

const monacoエディタ更新 = async (ファイル名: string, 内容: string) => {
  const 言語 = モナコ言語推定(ファイル名)
  await nextTick()
  if (!monacoコンテナ.value) return
  if (!monacoエディタ) {
    monacoエディタ = monaco.editor.create(monacoコンテナ.value, {
      value: 内容,
      language: 言語,
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'on',
      renderLineHighlight: 'none',
      domReadOnly: true,
      contextmenu: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    })
  } else {
    const model = monacoエディタ.getModel()
    if (model) monaco.editor.setModelLanguage(model, 言語)
    monacoエディタ.setValue(内容)
    monacoエディタ.revealLine(1)
  }
}

const monacoエディタ破棄 = () => {
  if (monacoエディタ) {
    monacoエディタ.dispose()
    monacoエディタ = null
  }
}

// ===================== 編集モード =====================

const 編集モード終了 = () => {
  編集モード.value = false
  if (monacoエディタ) {
    monacoエディタ.updateOptions({ readOnly: true, domReadOnly: true })
    monaco.editor.setTheme('vs-dark')
  }
}

const 編集モード開始 = () => {
  編集モード.value = true
  if (monacoエディタ) {
    monaco.editor.setTheme('vs')
    monacoエディタ.updateOptions({ readOnly: false, domReadOnly: false })
    monacoエディタ.focus()
  }
}

const 編集キャンセル = () => {
  if (!window.confirm('編集をキャンセルしますか？')) return
  if (monacoエディタ && ファイル内容テキスト.value !== null) {
    monacoエディタ.setValue(ファイル内容テキスト.value)
  }
  編集モード終了()
}

// ===================== ファイル操作 =====================

const 選択通知送信 = (パス: string, 種別: 'file' | 'folder', isBackup: boolean) => {
  if (!出力WebSocket.value?.isConnected()) return
  出力WebSocket.value.send({
    セッションID: プロパティ.セッションID,
    チャンネル: 'file',
    メッセージ識別: 'file_select',
    メッセージ内容: { パス, 種別, パネル: isBackup ? 'left' : 'right' },
  })
}

const 選択解除通知送信 = () => {
  if (!出力WebSocket.value?.isConnected()) return
  出力WebSocket.value.send({
    セッションID: プロパティ.セッションID,
    チャンネル: 'file',
    メッセージ識別: 'file_deselect',
    メッセージ内容: {},
  })
}

const 下部ファイル表示クリア = () => {
  ハイライト要求連番++
  選択ファイル名.value = ''
  選択ファイルパス.value = ''
  選択パネル.value = null
  選択種別.value = null
  ファイル内容テキスト.value = null
  ファイル内容画像.value = null
  ファイル内容エラー.value = null
  ファイル読込中.value = false
  ファイルダウンロード中.value = false
  編集モード終了()
  if (monacoエディタ) monacoエディタ.setValue('')
}

const ファイルクリック = async (ファイル名: string, isBackup: boolean) => {
  編集モード終了()
  選択パネル.value = isBackup ? 'left' : 'right'
  選択ファイル名.value = ファイル名
  選択種別.value = 'file'
  選択通知送信(ファイル名, 'file', isBackup)
  ファイル内容テキスト.value = null
  ファイル内容画像.value = null
  ファイル内容エラー.value = null
  ファイル読込中.value = true

  const パス = isBackup
    ? (プロジェクトパス.value ? プロジェクトパス.value.replace(/\\/g, '/') + '/' + ファイル名 : ファイル名)
    : ファイル名
  選択ファイルパス.value = パス

  try {
    const res = await apiClient.post('/core/files/内容取得', { ファイル名: パス })
    if (res.data.status !== 'OK') {
      ファイル内容エラー.value = res.data.message ?? 'エラー'
      return
    }
    const base64 = res.data.data.base64_data as string
    const ext = ファイル名.split('.').pop()?.toLowerCase() ?? ''
    if (画像拡張子.has(ext)) {
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      ファイル内容画像.value = `data:${mime};base64,${base64}`
    } else {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const encoding = ANSI拡張子.has(ext) ? 'shift_jis' : 'utf-8'
      const テキスト = new TextDecoder(encoding).decode(bytes)
      ファイル内容テキスト.value = テキスト
      ファイル読込中.value = false
      await monacoエディタ更新(ファイル名, テキスト)
    }
  } catch (e: any) {
    ファイル内容エラー.value = e?.message ?? '取得失敗'
  } finally {
    ファイル読込中.value = false
  }
}

const ファイル保存 = async () => {
  if (!選択ファイルパス.value || ファイル保存中.value || !monacoエディタ) return
  if (!window.confirm(`上書き保存しますか？\n${選択ファイルパス.value}`)) return

  ファイル保存中.value = true
  try {
    const 内容 = monacoエディタ.getValue()
    const res = await apiClient.post('/core/files/内容更新', {
      ファイル名: 選択ファイルパス.value,
      内容,
    })
    if (res.data.status !== 'OK') {
      ファイル内容エラー.value = res.data.message ?? '保存失敗'
      return
    }
    ファイル内容テキスト.value = 内容
    編集モード終了()
    // files_save → バックアップ処理 → files_backup / files_temp でリスト更新
    if (出力WebSocket.value?.isConnected()) {
      出力WebSocket.value.send({
        セッションID: プロパティ.セッションID,
        チャンネル: 'file',
        メッセージ識別: 'files_save',
        メッセージ内容: { ファイル名: 選択ファイルパス.value },
      })
      バックアップリスト要求(true)
      void テンプリスト要求(true)
    }
  } catch (e: any) {
    ファイル内容エラー.value = e?.message ?? '保存失敗'
  } finally {
    ファイル保存中.value = false
  }
}

const ダウンロードデータ取得 = async (): Promise<{ 配列バッファ: ArrayBuffer; ファイル名: string }> => {
  const res = await apiClient.post('/core/files/内容取得', { ファイル名: 選択ファイルパス.value })
  if (res.data.status !== 'OK') throw new Error(res.data.message ?? 'ダウンロード失敗')
  const base64 = res.data.data.base64_data as string
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const 配列バッファ = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const ファイル名 = 選択ファイル名.value.split(/[\\/]/).pop() || 'download'
  return { 配列バッファ, ファイル名 }
}

const ファイルダウンロード = async () => {
  if (!選択ファイルパス.value || ファイルダウンロード中.value) return
  ファイルダウンロード中.value = true
  try {
    const { 配列バッファ, ファイル名 } = await ダウンロードデータ取得()
    const blob = new Blob([配列バッファ], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = ファイル名
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    ファイル内容エラー.value = e?.message ?? 'ダウンロード失敗'
  } finally {
    ファイルダウンロード中.value = false
  }
}

const ファイル保存先選択 = async () => {
  if (!選択ファイルパス.value || ファイルダウンロード中.value) return

  const win = window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: Array<{
        description?: string
        accept: Record<string, `.${string}`[]>
      }>
      excludeAcceptAllOption?: boolean
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: ArrayBuffer) => Promise<void>
        close: () => Promise<void>
      }>
    }>
  }

  if (typeof win.showSaveFilePicker !== 'function') {
    await ファイルダウンロード()
    return
  }

  ファイルダウンロード中.value = true
  try {
    const { 配列バッファ, ファイル名 } = await ダウンロードデータ取得()
    const ext = ファイル名.includes('.') ? ファイル名.split('.').pop()?.toLowerCase() ?? '' : ''
    const handle = await win.showSaveFilePicker({
      suggestedName: ファイル名,
      ...(ext ? {
        types: [{
          description: `${ext.toUpperCase()} ファイル`,
          accept: { [`application/x-${ext}`]: [`.${ext}`] as `.${string}`[] },
        }],
        excludeAcceptAllOption: false,
      } : {}),
    })
    const writable = await handle.createWritable()
    await writable.write(配列バッファ)
    await writable.close()
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      ファイル内容エラー.value = e?.message ?? '保存失敗'
    }
  } finally {
    ファイルダウンロード中.value = false
  }
}

// ===================== WebSocket =====================

const 認証トークン更新 = async () => {
  const requestToken = 認証Storage.getItem('token')
  if (!requestToken || トークン更新中) return

  トークン更新中 = true
  try {
    const response = await apiClient.post('/core/auth/トークン更新')
    const nextToken = response.data?.data?.access_token
    if (response.data?.status === 'OK' && nextToken && 認証Storage.getItem('token') === requestToken) {
      認証Storage.setItem('token', nextToken)
    }
  } catch {
    // 401はapiClient側で認証期限切れとして処理する
  } finally {
    トークン更新中 = false
  }
}

const バックアップリスト要求 = (読込表示 = false) => {
  if (!出力WebSocket.value || !出力WebSocket.value.isConnected()) return
  if (読込表示) 左読込中.value = true
  出力WebSocket.value.send({
    セッションID: プロパティ.セッションID,
    チャンネル: 'file',
    メッセージ識別: 'files_backup',
    メッセージ内容: { 要求日時: バックアップ要求日時.value },
  })
}

const テンプリスト要求 = async (読込表示 = false) => {
  if (!出力WebSocket.value || !出力WebSocket.value.isConnected()) return
  if (読込表示) 右読込中.value = true
  // files_temp送信＝画面表示中＝操作中とみなしてトークンをリフレッシュ
  void 認証トークン更新()
  出力WebSocket.value.send({
    セッションID: プロパティ.セッションID,
    チャンネル: 'file',
    メッセージ識別: 'files_temp',
    メッセージ内容: { 要求日時: テンプリスト要求日時.value },
  })
}

const ファイルリスト要求 = () => {
  // 明示的な再要求時はdedupキャッシュをリセットして強制再描画
  最終受信バックアップ要求日時.value = null
  最終受信テンプリスト要求日時.value = null
  下部ファイル表示クリア()
  バックアップリスト要求(true)
  void テンプリスト要求(true)
}

const テンプリスト自動送信開始 = () => {
  テンプリスト自動送信停止()
  if (テンプ更新間隔.value === 0) return
  テンプリスト自動送信タイマー = setTimeout(() => {
    テンプリスト自動送信タイマー = null
    void テンプリスト要求()
  }, テンプ更新間隔.value * 1_000)
}

const テンプリスト自動送信停止 = () => {
  if (!テンプリスト自動送信タイマー) return
  clearTimeout(テンプリスト自動送信タイマー)
  テンプリスト自動送信タイマー = null
}

// 件数だけの変更では手動の開閉・選択を保ち、一覧から消えた対象だけを解除する。
const 件数変更後の表示維持 = (ファイル一覧: ファイルエントリ[], panel: 'left' | 'right') => {
  const 展開中 = panel === 'left' ? 左展開中フォルダ : 右展開中フォルダ
  const フォルダ一覧 = new Set(全フォルダパス取得(ファイル一覧))
  展開中.value = new Set([...展開中.value].filter((パス) => フォルダ一覧.has(パス)))
  if (選択パネル.value !== panel || !選択ファイル名.value) return
  const 選択パス = パス正規化(選択ファイル名.value)
  const 選択が残る = 選択種別.value === 'folder'
    ? フォルダ一覧.has(選択パス)
    : ファイル一覧.some((ファイル) => パス正規化(ファイル.パス) === 選択パス)
  if (!選択が残る) {
    選択解除通知送信()
    下部ファイル表示クリア()
  }
}

const バックアップリスト受信処理 = (受信データ: any) => {
  if (!プロパティ.active || 受信データ.セッションID !== プロパティ.セッションID) return
  const 内容 = 受信データ.メッセージ内容
  if (!内容) return
  const 新要求日時 = Number(内容.要求日時 ?? バックアップ要求日時.value)
  if (新要求日時 !== バックアップ要求日時.value) return
  const 新日時 = 内容.最終ファイル日時 ?? null
  const 新件数 = (内容.ファイルリスト ?? []).length
  const 件数のみ変更 = 新要求日時 === 最終受信バックアップ要求日時.value && 新日時 === 最終ファイル日時.value
  if (
    新要求日時 === 最終受信バックアップ要求日時.value &&
    新日時 === 最終ファイル日時.value &&
    新件数 === 最終ファイルリスト.value.length
  ) {
    左読込中.value = false
    return
  }
  最終受信バックアップ要求日時.value = 新要求日時
  プロジェクトパス.value = 内容.プロジェクトパス ?? ''
  バックアップベースパス.value = 内容.バックアップベースパス ?? ''
  最終ファイル日時.value = 新日時
  最終ファイルリスト.value = 内容.ファイルリスト ?? []
  if (件数のみ変更) {
    件数変更後の表示維持(最終ファイルリスト.value, 'left')
  } else {
    const 本日更新ファイル一覧 = 最終ファイルリスト.value.filter((f) => 更新日時が本日(f.更新日時))
    左展開中フォルダ.value = new Set(全フォルダパス取得(本日更新ファイル一覧))
  }
  左読込中.value = false
}

const テンプリスト受信処理 = async (受信データ: any) => {
  if (!プロパティ.active || 受信データ.セッションID !== プロパティ.セッションID) return
  const 内容 = 受信データ.メッセージ内容
  if (!内容) {
    if (プロパティ.active && テンプ更新間隔.value > 0) テンプリスト自動送信開始()
    return
  }
  const 新要求日時 = Number(内容.要求日時 ?? テンプリスト要求日時.value)
  if (新要求日時 !== テンプリスト要求日時.value) return
  const 正規化日時 = 日時文字列正規化(内容.作業ファイル日時)
  const 新日時 = 正規化日時 ?? 内容.作業ファイル日時 ?? null
  const 新リスト = ((内容.ファイルリスト ?? []) as ファイルエントリ[]).map((f) => ({
    パス: f.パス,
    更新日時: 日時文字列正規化(f.更新日時) ?? (f.更新日時 ?? ''),
  }))
  const 新件数 = 新リスト.length
  const 件数のみ変更 = 新要求日時 === 最終受信テンプリスト要求日時.value && 新日時 === 作業ファイル日時.value
  if (
    新要求日時 === 最終受信テンプリスト要求日時.value &&
    新日時 === 作業ファイル日時.value &&
    新件数 === 作業ファイルリスト.value.length
  ) {
    右読込中.value = false
    if (プロパティ.active && テンプ更新間隔.value > 0) テンプリスト自動送信開始()
    return
  }
  最終受信テンプリスト要求日時.value = 新要求日時
  作業ファイル日時.value = 新日時
  作業ファイルリスト.value = 新リスト
  if (件数のみ変更) {
    件数変更後の表示維持(作業ファイルリスト.value, 'right')
  } else {
    右展開中フォルダ.value = new Set(全フォルダパス取得(作業ファイルリスト.value))
  }
  右読込中.value = false

  if (新日時 && !件数のみ変更) {
    const 最終日時一致ファイル =
      新リスト.find((f) => f.更新日時 === 新日時) ??
      新リスト.find((f) => f.更新日時.slice(0, 16) === 新日時.slice(0, 16))
    if (最終日時一致ファイル) await ファイルクリック(最終日時一致ファイル.パス, false)
  }

  await nextTick()
  if (プロパティ.active && テンプ更新間隔.value > 0) テンプリスト自動送信開始()
}

const 出力ソケット接続 = async () => {
  if (!プロパティ.セッションID) return
  出力ソケット切断()
  出力WebSocket.value = new AIWebSocket(AI_WS_ENDPOINT, プロパティ.セッションID, 'file')
  fileSocketStateUnsubscribe = 出力WebSocket.value.onStateChange(() => {
    出力接続済み.value = Boolean(出力WebSocket.value?.isConnected())
  })
  出力WebSocket.value.on('files_backup', バックアップリスト受信処理)
  出力WebSocket.value.on('files_temp', テンプリスト受信処理)
  try {
    await 出力WebSocket.value.connect()
    出力接続済み.value = true
  } catch (error) {
    ファイル内容エラー.value = error instanceof Error ? error.message : 'file channel 接続失敗'
  }
}

const 出力ソケット切断 = () => {
  if (出力WebSocket.value) {
    出力WebSocket.value.off('files_backup', バックアップリスト受信処理)
    出力WebSocket.value.off('files_temp', テンプリスト受信処理)
    if (fileSocketStateUnsubscribe) {
      fileSocketStateUnsubscribe()
      fileSocketStateUnsubscribe = null
    }
    出力WebSocket.value.disconnect()
    出力WebSocket.value = null
  }
  出力接続済み.value = false
}

const コンテキストメニュー表示 = ref(false)
const コンテキストメニューX = ref(0)
const コンテキストメニューY = ref(0)

const コンテキストメニュー閉じる = () => {
  コンテキストメニュー表示.value = false
}

const コンテキストメニュー表示位置設定 = (x: number, y: number) => {
  const メニュー幅 = 140
  const メニュー高 = 40
  コンテキストメニューX.value = x + メニュー幅 > window.innerWidth ? x - メニュー幅 : x
  コンテキストメニューY.value = y + メニュー高 > window.innerHeight ? y - メニュー高 : y
  コンテキストメニュー表示.value = true
}

const ツリー行右クリック = (e: MouseEvent, 行: ツリー表示行, isBackup: boolean) => {
  if (行.種別 !== 'file') return
  e.preventDefault()
  void ファイルクリック(行.パス, isBackup)
  コンテキストメニュー表示位置設定(e.clientX, e.clientY)
}

const コンテキストメニューダウンロード = async () => {
  コンテキストメニュー閉じる()
  await ファイル保存先選択()
}

const 下段右クリック = (e: MouseEvent) => {
  if (!選択ファイルパス.value) return
  e.preventDefault()
  fileコンテナ.value?.focus()
  コンテキストメニュー表示位置設定(e.clientX, e.clientY)
}

const コンポーネントマウスダウン = (e: MouseEvent) => {
  const target = e.target
  if (!(target instanceof HTMLElement)) {
    fileコンテナ.value?.focus()
    return
  }
  if (target.closest('.monaco-editor, button, select, input, textarea, a, [contenteditable="true"]')) {
    return
  }
  fileコンテナ.value?.focus()
}

// --- キーボードナビ ---
const キーボードキーダウン = (e: KeyboardEvent) => {
  if (!プロパティ.active) return
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (!選択ファイル名.value || !選択パネル.value) return

  if (document.activeElement !== fileコンテナ.value) return

  const isBackup = 選択パネル.value === 'left'
  const ファイル行 = (isBackup ? 最終ファイル行.value : 作業ファイル行.value).filter((行) => 行.種別 === 'file')
  if (ファイル行.length === 0) return
  const 現在インデックス = ファイル行.findIndex((行) => 行.パス === 選択ファイル名.value)
  if (現在インデックス === -1) return
  e.preventDefault()
  const 次インデックス =
    e.key === 'ArrowDown'
      ? Math.min(現在インデックス + 1, ファイル行.length - 1)
      : Math.max(現在インデックス - 1, 0)
  if (次インデックス !== 現在インデックス) {
    void ファイルクリック(ファイル行[次インデックス]!.パス, isBackup)
  }
}

// --- watchers ---

watch(() => プロパティ.セッションID, async (newId, oldId) => {
  if (!newId || newId === oldId) return
  出力ソケット切断()
  await 出力ソケット接続()
  if (プロパティ.active) {
    ファイルリスト要求()
  }
})

// 接続リセット後の復帰時に再取得
watch(出力接続済み, (v, old) => {
  if (v && !old && プロパティ.active) {
    ファイルリスト要求()
  }
})

// 親の接続状態が回復したら自身のソケットも再接続
// inputSocket接続完了後にバックアップが走るため500ms待ってから要求
watch(() => プロパティ.入力接続済み, async (v, old) => {
  if (v && !old) {
    出力ソケット切断()
    await 出力ソケット接続()
    if (プロパティ.active) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      ファイルリスト要求()
    }
  }
})

watch(() => プロパティ.active, (active) => {
  if (active) {
    // 再オープン: 選択クリア後にリスト要求（auto-selectは受信後にファイルクリック経由で通知される）
    if (選択ファイル名.value) {
      選択解除通知送信()
    }
    下部ファイル表示クリア()
    ファイルリスト要求()
  } else {
    テンプリスト自動送信停止()
    // クローズ: 選択中であれば解除通知
    if (選択ファイル名.value) {
      選択解除通知送信()
    }
    下部ファイル表示クリア()
  }
})

watch(バックアップ要求日時, () => {
  if (!プロパティ.active) return
  下部ファイル表示クリア()
  バックアップリスト要求(true)
})

watch(テンプリスト要求日時, () => {
  if (!プロパティ.active) return
  下部ファイル表示クリア()
  void テンプリスト要求(true)
})

watch(テンプ更新間隔, () => {
  テンプリスト自動送信停止()
  if (プロパティ.active && テンプ更新間隔.value > 0) テンプリスト自動送信開始()
})

onMounted(async () => {
  await 出力ソケット接続()
  if (プロパティ.active) {
    ファイルリスト要求()
  }
  window.addEventListener('keydown', キーボードキーダウン)
  window.addEventListener('mousedown', コンテキストメニュー閉じる)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', キーボードキーダウン)
  window.removeEventListener('mousedown', コンテキストメニュー閉じる)
  テンプリスト自動送信停止()
  if (選択ファイル名.value) {
    選択解除通知送信()
  }
  出力ソケット切断()
  monacoエディタ破棄()
})

defineExpose({
  出力接続済み,
  読込中: computed(() => 左読込中.value || 右読込中.value),
  ファイルリスト要求,
})
</script>

<template>
  <section
    ref="fileコンテナ"
    class="file-container"
    data-aidiy-window-move-surface
    tabindex="0"
    @mousedown.capture="コンポーネントマウスダウン"
  >
    <div class="file-body">
      <!-- 上段: 左右分割ツリー -->
      <div class="upper-area">
        <!-- 左: バックアップ -->
        <div class="tree-panel">
          <div class="panel-header">
            <span>プロジェクト</span>
            <select v-model.number="バックアップ要求日時" class="request-select" title="要求日時">
              <option v-for="opt in 要求日時選択肢" :key="`b-${opt.値}`" :value="opt.値">{{ opt.表示 }}</option>
            </select>
            <span class="header-spacer"></span>
            <span v-if="最終ファイルリスト.length > 0" class="panel-count">({{ 最終ファイルリスト.length }})</span>
            <span v-if="最終ファイル日時" class="panel-datetime">{{ 最終ファイル日時 }}</span>
          </div>
          <div class="panel-content">
            <div v-if="左読込中" class="placeholder-content">
              <img src="/icons/loading.gif" alt="読込中" class="loading-panel-image" />
              <div>読込中...</div>
            </div>
            <div v-else-if="最終ファイルリスト.length === 0" class="placeholder-content">
              <span class="placeholder-icon">🗂️</span>
              <div>バックアップなし</div>
            </div>
            <ul v-else class="tree-list">
              <li
                v-for="行 in 最終ファイル行"
                :key="`left-${行.キー}`"
                class="tree-item"
              :class="{
                  folder: 行.種別 === 'folder',
                  selected: (行.種別 === 'file' && 選択ファイル名 === 行.パス && 選択パネル === 'left' && 選択種別 === 'file')
                         || (行.種別 === 'folder' && 選択ファイル名 === 行.パス && 選択パネル === 'left' && 選択種別 === 'folder'),
                }"
                @click="ツリー行クリック(行, true)"
                @contextmenu="ツリー行右クリック($event, 行, true)"
              >
                <span class="tree-indent" :style="{ width: `${行.深さ * 14}px` }"></span>
                <span class="tree-toggle">{{ 行.種別 === 'folder' ? (行.展開中 ? '▾' : '▸') : ' ' }}</span>
                <span class="tree-icon">{{ 行.種別 === 'folder' ? (行.展開中 ? '📂' : '📁') : '📄' }}</span>
                <span class="tree-name">{{ 行.名前 }}</span>
                <span
                  v-if="行.種別 === 'file' && 行.更新日時"
                  class="tree-datetime"
                  :class="{ 'tree-datetime-today': 更新日時が本日(行.更新日時) }"
                >{{ 行.更新日時 }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- 右: temp -->
        <div class="tree-panel">
          <div class="panel-header">
            <span>temp</span>
            <select v-model.number="テンプリスト要求日時" class="request-select" title="要求日時">
              <option v-for="opt in 要求日時選択肢" :key="`t-${opt.値}`" :value="opt.値">{{ opt.表示 }}</option>
            </select>
            <select v-model.number="テンプ更新間隔" class="request-select" title="更新間隔">
              <option v-for="opt in 更新間隔選択肢" :key="`i-${opt.値}`" :value="opt.値">{{ opt.表示 }}</option>
            </select>
            <span class="header-spacer"></span>
            <span v-if="作業ファイルリスト.length > 0" class="panel-count">({{ 作業ファイルリスト.length }})</span>
            <span v-if="作業ファイル日時" class="panel-datetime">{{ 作業ファイル日時 }}</span>
          </div>
          <div class="panel-content">
            <div v-if="右読込中" class="placeholder-content">
              <img src="/icons/loading.gif" alt="読込中" class="loading-panel-image" />
              <div>読込中...</div>
            </div>
            <div v-else-if="作業ファイルリスト.length === 0" class="placeholder-content">
              <span class="placeholder-icon">📁</span>
              <div>ファイルなし</div>
            </div>
            <ul v-else class="tree-list">
              <li
                v-for="行 in 作業ファイル行"
                :key="`right-${行.キー}`"
                class="tree-item"
              :class="{
                  folder: 行.種別 === 'folder',
                  selected: (行.種別 === 'file' && 選択ファイル名 === 行.パス && 選択パネル === 'right' && 選択種別 === 'file')
                         || (行.種別 === 'folder' && 選択ファイル名 === 行.パス && 選択パネル === 'right' && 選択種別 === 'folder'),
                }"
                @click="ツリー行クリック(行, false)"
                @contextmenu="ツリー行右クリック($event, 行, false)"
              >
                <span class="tree-indent" :style="{ width: `${行.深さ * 14}px` }"></span>
                <span class="tree-toggle">{{ 行.種別 === 'folder' ? (行.展開中 ? '▾' : '▸') : ' ' }}</span>
                <span class="tree-icon">{{ 行.種別 === 'folder' ? (行.展開中 ? '📂' : '📁') : '📄' }}</span>
                <span class="tree-name">{{ 行.名前 }}</span>
                <span
                  v-if="行.種別 === 'file' && 行.更新日時"
                  class="tree-datetime"
                  :class="{ 'tree-datetime-recent': 右更新日時が現在から10分以内(行.更新日時) }"
                >{{ 右側更新日時表示(行.更新日時) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 下段: ファイル内容 -->
      <div class="lower-area">
        <div class="panel-header">
          <span class="lower-header-left">
            <span class="lower-title">ファイル :</span>
            <span v-if="選択ファイル名" class="panel-datetime">{{ 選択ファイル名 }}</span>
            <button
              class="download-btn"
              type="button"
              @click="ファイルダウンロード"
              @contextmenu.prevent="ファイル保存先選択"
              :disabled="!選択ファイルパス || ファイル読込中 || ファイルダウンロード中"
              title="左クリック: ダウンロード / 右クリック: 保存先選択"
            >⬇</button>
          </span>
          <span class="header-spacer"></span>
          <span class="lower-header-right">
            <button
              v-if="ファイル内容テキスト !== null && !ファイル読込中 && !ファイル内容エラー"
              class="edit-btn"
              :class="{ 'edit-btn-active': 編集モード }"
              type="button"
              @click="編集モード ? 編集キャンセル() : 編集モード開始()"
              :title="編集モード ? '編集キャンセル' : '編集'"
            >✎</button>
            <button
              v-if="編集モード"
              class="upload-btn"
              type="button"
              @click="ファイル保存"
              :disabled="ファイル保存中"
              title="更新（上書き保存）"
            >⬆</button>
          </span>
        </div>
        <div class="lower-content">
          <div v-if="ファイル読込中" class="placeholder-content">
            <img src="/icons/loading.gif" alt="読込中" class="loading-panel-image" />
            <div>読込中...</div>
          </div>
          <div v-else-if="ファイル内容エラー" class="placeholder-content">
            <span class="placeholder-icon">⚠️</span>
            <div>{{ ファイル内容エラー }}</div>
          </div>
          <img v-else-if="ファイル内容画像" :src="ファイル内容画像" class="file-image" @contextmenu.prevent="下段右クリック($event)" />
          <div v-else-if="ファイル内容テキスト === null && !ファイル読込中" class="placeholder-content">
            <span class="placeholder-icon">📄</span>
            <div>上のツリーからファイルを選択すると<br>テキストまたは画像を表示します</div>
          </div>
          <div
            v-show="!ファイル読込中 && !ファイル内容エラー && !ファイル内容画像 && ファイル内容テキスト !== null"
            ref="monacoコンテナ"
            class="monaco-container"
            @contextmenu.prevent="下段右クリック($event)"
          ></div>
        </div>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="コンテキストメニュー表示"
      class="context-menu"
      :style="{ left: `${コンテキストメニューX}px`, top: `${コンテキストメニューY}px` }"
      @mousedown.stop
    >
      <button class="context-menu-item" type="button" @click="コンテキストメニューダウンロード">⬇ ダウンロード</button>
    </div>
  </Teleport>
</template>

<style scoped>
.file-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #000;
  overflow: hidden;
}

.file-container:focus {
  outline: none;
}

/* body: 上下分割 */
.file-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 1px;
  background: #333;
  padding: 1px;
}

/* 上段: 左右分割 */
.upper-area {
  flex: 1;
  display: flex;
  gap: 1px;
  overflow: hidden;
  min-height: 0;
}

/* 下段 */
.lower-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
  overflow: hidden;
  min-height: 0;
}

/* ツリーパネル */
.tree-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
  overflow: hidden;
}

.panel-header {
  background: rgba(102, 126, 234, 0.08);
  color: #b8c5f2;
  font-size: 12px;
  font-weight: bold;
  padding: 4px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(102, 126, 234, 0.3);
  display: flex;
  align-items: center;
  gap: 8px;
}

.request-select {
  height: 18px;
  width: 70px;
  min-width: 70px;
  max-width: 70px;
  flex: 0 0 70px;
  background: #111;
  color: #fff;
  border: 1px solid rgba(151, 168, 223, 0.55);
  border-radius: 2px;
  font-size: 10px;
  padding: 0 2px;
  cursor: pointer;
}

.request-select:focus { outline: none; }
.request-select option { background: #111; color: #fff; }

.header-spacer { flex: 1; }
.panel-count { font-size: 10px; font-weight: normal; color: #97a8df; }
.panel-datetime { font-size: 10px; font-weight: normal; color: #97a8df; }

.panel-content {
  flex: 1;
  overflow: auto;
  padding: 4px 8px;
}

.panel-content::-webkit-scrollbar { width: 6px; height: 6px; }
.panel-content::-webkit-scrollbar-track { background: #0a0a0a; }
.panel-content::-webkit-scrollbar-thumb { background: rgba(102, 126, 234, 0.45); border-radius: 2px; }

.placeholder-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #7480ac;
  font-size: 12px;
  text-align: center;
  gap: 8px;
}

.placeholder-icon {
  font-size: 32px;
  opacity: 0.4;
}

.loading-panel-image {
  width: 27px;
  max-width: 10.5%;
  height: auto;
  display: block;
}

/* ファイルツリー */
.tree-list { list-style: none; margin: 0; padding: 0; }

.tree-item {
  display: flex;
  align-items: center;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #b3bde2;
  padding: 1px 4px;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 2px;
  user-select: none;
}

.tree-item:hover { background: rgba(102, 126, 234, 0.12); color: #d6def8; }
.tree-item.folder { color: #fff; }
.tree-item.folder .tree-name { color: #fff; }
.tree-item:not(.folder) .tree-name { color: #00ff66; }
.tree-item:hover:not(.folder) .tree-name { color: #66ff9b; }
.tree-item.selected { background: rgba(102, 126, 234, 0.26); color: #edf2ff; }
.tree-item.selected:not(.folder) .tree-name { color: #fff; }

.tree-indent { flex: 0 0 auto; }
.tree-toggle { width: 12px; text-align: center; flex: 0 0 auto; color: #9cadf0; }
.tree-icon { width: 14px; text-align: center; flex: 0 0 auto; margin-right: 4px; }
.tree-name { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }

.tree-datetime {
  flex-shrink: 0;
  margin-left: 6px;
  font-size: 9px;
  color: #7a90b8;
  white-space: nowrap;
}

.tree-datetime-today { color: #fff; }
.tree-datetime-recent { color: #fff; }

/* 下段 */
.lower-header-left,
.lower-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lower-title { font-size: 12px; font-weight: bold; color: #b8c5f2; white-space: nowrap; }

.edit-btn {
  background: #667eea;
  border: 1px solid #5568c8;
  border-radius: 2px;
  color: #fff;
  font-size: 14px;
  line-height: 14px;
  cursor: pointer;
  padding: 0;
  width: 18px;
  height: 18px;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.edit-btn:hover:not(:disabled) { background: #768cf0; border-color: #667eea; transform: translateY(1px); }
.edit-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.edit-btn-active { animation: edit-blink 1s ease-in-out infinite; }

@keyframes edit-blink {
  0%, 100% { background: #667eea; opacity: 1; }
  50% { background: #3a4a9a; opacity: 0.5; }
}

.upload-btn {
  background: #e05a8a;
  border: 1px solid #c0456f;
  border-radius: 2px;
  color: #fff;
  font-size: 14px;
  line-height: 14px;
  cursor: pointer;
  padding: 0;
  width: 18px;
  height: 18px;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.upload-btn:hover:not(:disabled) { background: #f072a0; border-color: #e05a8a; transform: translateY(-1px); }
.upload-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.download-btn {
  margin-left: 4px;
  background: #667eea;
  border: 1px solid #5568c8;
  border-radius: 2px;
  color: #fff;
  font-size: 14px;
  line-height: 14px;
  cursor: pointer;
  padding: 0;
  width: 18px;
  height: 18px;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.download-btn:hover:not(:disabled) { background: #768cf0; border-color: #667eea; transform: translateY(1px); }
.download-btn:disabled { opacity: 0.35; background: #4b5da8; border-color: #3f4f8f; cursor: not-allowed; }

.lower-content {
  flex: 1;
  display: flex;
  align-items: stretch;
  justify-content: center;
  overflow: hidden;
  padding: 0;
}

.monaco-container {
  width: 100%;
  height: 100%;
  min-height: 100px;
  align-self: stretch;
}

.file-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  margin: auto;
  padding: 4px 8px;
}

.context-menu {
  position: fixed;
  z-index: 9999;
  background: #1e1e2e;
  border: 1px solid rgba(102, 126, 234, 0.5);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  min-width: 130px;
  padding: 4px 0;
  user-select: none;
}

.context-menu-item {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  color: #c8d0f0;
  font-size: 12px;
  text-align: left;
  padding: 6px 14px;
  cursor: pointer;
  white-space: nowrap;
}

.context-menu-item:hover {
  background: rgba(102, 126, 234, 0.25);
  color: #edf2ff;
}

@media (max-width: 480px) {
  .upper-area { flex-direction: column; }
  .tree-panel { min-height: 120px; }
}
</style>
