# frontend_avatar AiDiy.vue 全体構成と状態管理

> 文書: `frontend_avatar,AiDiy.vue全体構成と状態管理.md` | 実装: `frontend_avatar/src/AiDiy.vue`

## このメモを使う場面

- frontend_avatar のアプリ全体構造を理解するとき
- 認証・WebSocket・パネル管理の流れを追うとき
- 新しいパネルやウィンドウロールを追加するとき
- Electron と Web モードの分岐を修正するとき

## 概要

`AiDiy.vue` は frontend_avatar の唯一のエントリコンポーネントです。`src/main.ts` はこのコンポーネントを直接マウントします（Vue Router や Pinia は使用しません）。

- **状態管理**: 全てコンポーネントローカルの `ref()` / `computed()`。Pinia / Vue Router なし
- **マルチモード**: Electron と Web ブラウザの両方で動作

## WindowRole 体系

アプリは「ウィンドウロール」によって表示内容を切り替えます。

```typescript
type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'
type WindowRole = 'login' | 'core' | PanelKey | 'settings'
```

| WindowRole | 表示内容 | Electron | Web |
|-----------|---------|----------|-----|
| `login` | ログインフォーム（`ログイン.vue`） | 独立 BrowserWindow | 画面全体 |
| `core` | AIコア制御パネル（`AIコア.vue`）+ レイアウト | 独立 BrowserWindow | 左右分割レイアウト |
| `chat` / `file` / `image` / `code1`〜`code6` | 各パネル（`_WindowShell` でラップ） | 独立 BrowserWindow | 同一ページ内タブ |
| `settings` | AI設定再起動ダイアログ | 独立 BrowserWindow | オーバーレイ |

## 状態一覧

AiDiy.vue で管理される主要状態:

| 状態 | 型 | 役割 |
|------|-----|------|
| `認証トークン` | string | JWT token |
| `利用者` | AuthUser \| null | ログイン利用者情報 |
| `セッションID` | string | AIコアセッション |
| `ウィンドウロール` | WindowRole | 現在の表示モード |
| `チャットモード` | チャットモード型 | chat / live / code1〜code6 |
| `パネル表示状態` | Record\<PanelKey, boolean\> | 各パネルの開閉状態 |
| `入力接続済み` / `チャット接続済み` | boolean | WebSocket 接続状態 |
| `モデル設定` | ModelSettings | AIモデル設定値 |
| `メッセージ一覧` | ChatMessage[] | チャットメッセージ履歴 |
| `コア処理中` / `コアエラー` | boolean / string | AIコア状態 |
| `分割比率` | number | Web モードの左右ペイン比率 |

## 初期化フロー（onMounted）

```text
1. ロール検出 (フォールバックロール解決)
   ├─ URL が "/" or "/index.html" → login
   ├─ URL クエリ "role" が有効 → そのロール
   └─ token + セッションID あり → core

2. BroadcastChannel "avatar-desktop-sync" 作成

3. PanelState リスナー登録（Electron IPC）

4. WindowShow リスナー登録

5. サブウィンドウ（chat/file/code*）の場合 → snapshot 要求で終了
6. settings の場合 → settings prepare 待機で終了

7. トークンあり → 現在利用者取得 → コア初期化
   ├─ REST: /core/AIコア/初期化 → セッションID 取得
   ├─ WebSocket: core チャンネル接続 → init メッセージ受信
   ├─ WebSocket: input チャンネル接続
   └─ スナップショット送信
```

## コア接続とチャンネル

AIコアとは2本の WebSocket で接続します。

| チャンネル | 変数 | 役割 |
|-----------|------|------|
| `core` | `コアソケット` | init 受信, welcome, 字幕, エラー通知 |
| `input` | `入力ソケット` | テキスト/ファイル/コード送信, 状態同期 |

```typescript
// core: 受信専用 + 制御
nextCoreSocket.on('init', 初期化処理)
nextCoreSocket.on('welcome_info', ...)
nextCoreSocket.on('welcome_text', ...)
nextCoreSocket.on('output_text', ...)
nextCoreSocket.on('recognition_output', ...)

// input: 送信専用
nextInputSocket = new AIWebSocket(wsUrl, nextSessionId, 'input')
```

## BroadcastChannel 同期

Electron マルチウィンドウ間の状態同期は `BroadcastChannel('avatar-desktop-sync')` で行います。

| メッセージ type | 送信元 | 内容 |
|----------------|--------|------|
| `snapshot` | core ウィンドウ | 全状態のスナップショット |
| `request-snapshot` | 子パネル | snapshot 要求 |
| `send-message` | 子パネル | チャットメッセージ送信要求 |
| `send-input-payload` | 子パネル | 任意ペイロード送信要求 |
| `set-chat-mode` | 子パネル | チャットモード変更要求 |
| `chat-state` | core ウィンドウ | チャット接続状態通知 |
| `settings-saved` | settings ウィンドウ | 設定保存完了 + 再起動待機 |
| `reboot-reconnect` | 任意 | 再起動後再接続通知 |

子パネル（chat/file/code*）は core ウィンドウのスナップショットを `補助スナップショット` として保持し、表示に使います。

## Electron / Web 分岐パターン

```typescript
const isElectron = !!window.desktopApi
const 認証Storage = isElectron ? localStorage : sessionStorage
```

| 機能 | Electron | Web |
|------|----------|-----|
| パネル開閉 | `window.desktopApi.togglePanel()` | `アクティブタブ` / `右アクティブタブ` の切り替え |
| 設定画面 | 独立 BrowserWindow（`openSettingsWindow`） | オーバーレイ表示（`Web設定表示`） |
| ログイン後 | `openCoreWindow()` でウィンドウ遷移 | `ウィンドウロール.value = 'core'` で画面遷移 |
| URL 同期 | 不要 | `WebURL同期()` で URL にセッションID 付与 |
| 認証期限切れ | `openLoginWindow()` | 画面切り替え |
| リサイズ | `_WindowShell.vue` → IPC → Electron | 左右分割のドラッグリサイズ |

## 注意点

- **Pinia / Vue Router がない**: コンポーネント間の状態共有は props + BroadcastChannel のみ。大規模リファクタリング時は注意
- **AiDiy.vue が肥大化している**: 2050 行。新規機能は可能な限り子コンポーネントに切り出す
- **スナップショットの陳腐化**: 子パネルはスナップショットをキャッシュするため、core の状態変更が即時反映されないことがある
- **Web モードの左右分割**: 左ペインに chat/file/code2/4/6、右ペインに core/image/code1/3/5 と固定割り振り。変更時は `webTabs` / `webRightTabs` 両方を修正する
