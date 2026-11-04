# Electron ウィンドウ管理

> 文書: `frontend_avatar,Electronウィンドウ管理.md` | 実装: `frontend_avatar/electron/main.ts`, `frontend_avatar/electron/preload.ts`

## このメモを使う場面

- 新しいウィンドウロールを追加するとき
- ウィンドウの位置・サイズ・表示動作を変更するとき
- IPC ハンドラの一覧を確認するとき
- Electron 固有の問題を切り分けるとき

## アーキテクチャ

```text
electron/main.ts  (main process)
    │
    ├── createBaseWindow()   → BrowserWindow (transparent, frameless)
    ├── createLoginWindow()  → login ロール
    ├── createCoreWindow()   → core ロール
    ├── createPanelWindow()  → chat / file / image / code1〜code6
    └── openSettingsWindow() → settings ロール
         │
         └── ipcMain.handle()  ← preload.ts 経由で renderer から呼び出し
```

全ウィンドウは `transparent: true`, `frame: false`, `hasShadow: false` の透過フレームレスウィンドウです。

## ウィンドウ種類とサイズ定義

```typescript
const LOGIN_BOUNDS   = { width: 320, height: 240, minWidth: 320, minHeight: 240 }
const CORE_BOUNDS    = { width: 520, height: 620, minWidth: 440, minHeight: 420 }
const CHAT_BASE_BOUNDS = { width: 520, height: 620, minWidth: 440, minHeight: 420 }
const SETTINGS_BOUNDS = { width: 720, height: 580, minWidth: 580, minHeight: 400 }
```

パネルウィンドウ（chat/file/image/code1〜code6）は全て `CHAT_BASE_BOUNDS` を共用します。各パネルを個別サイズにする場合は `PANEL_BOUNDS` に追記します。

## ウィンドウ位置戦略

| 関数 | 用途 | 基準 |
|------|------|------|
| `getCenteredPosition()` | login, chat ウィンドウ | ワークエリア中央 |
| `getBottomRightPosition()` | core ウィンドウ | 右下（右端 24px オフセット） |
| `getBottomLeftPosition()` | image ウィンドウ | 左下（24px マージン） |
| `getPanelInitialPosition()` | file/code1〜code6 | 左上起点で 48px ずつステップ配置 |

## ウィンドウライフサイクル

### 独立起動と8092

`aidiy_avatar`、Diag の Avatar、ルート起動は `frontend_avatar/launch.mjs` を入口とします。Electron の単一起動ロックを確定してから Vite（8092）を起動し、ログイン画面の表示完了で呼出元へ戻ります。ログイン・Avatar 表示中は同じ8092で Web 版も利用できます。画面の切替では停止せず、ログイン画面を閉じたときは残った補助窓も終了します。Electron 終了で Vite を回収し、Vite が異常終了した場合も Electron を終了します。

二重起動では既存の Electron を前面に出します。Electron が存在せず8092だけが使用中の場合は、起動済みと扱わず使用中エラーを返します。Avatar は Live と同じく、全体 start の起動前整理・終了時と setup / cleanup の停止対象です。IDE・Code の通常終了時の継続方針は変更しません。

回帰確認は `node --test frontend_avatar/checks/launch.test.mjs frontend_avatar/checks/window-pin.test.cjs` と `python -B -X utf8 scripts/checks/test_avatar_lifetime.py`。8092を解放してから `node frontend_avatar/checks/lifecycle-desktop.mjs` を実行すると、実Electronのログイン表示、WebのHTTP応答、補助窓が残った状態でのログイン終了、8092解放、再起動を確認します。認証やAIへの送信は行いません。

### ログイン → コア

```text
createLoginWindow() → ログイン成功 → openCoreWindow()
  ├─ createCoreWindow() + ensureAllPanelWindows() で全パネル作成
  ├─ loginWindow.hide()
  └─ nextCoreWindow.show() + focus()
```

### コア → ログイン（認証期限切れ）

```text
openLoginWindow()
  ├─ closeAllPanelWindows() で全パネル破棄
  ├─ coreWindow.close()
  └─ loginWindow.show()
```

### パネル開閉

```text
togglePanel(panel)
  ├─ createPanelWindow() で遅延作成
  ├─ panelStates[panel] の反転
  ├─ visible → window.show()
  └─ hidden → window.hide()（destroy しない）
```

`closePanelWindow()` はウィンドウを完全破棄します（`window.destroy()`）。

## WindowRole 管理

各 BrowserWindow には `windowRoles` Map でロールを紐付けます。

```typescript
const windowRoles = new Map<number, WindowRole>()
windowRoles.set(window.id, role)  // 作成時
window.on('closed', () => windowRoles.delete(window.id))  // 破棄時
```

`getWindowByRole(role)` でロールからウィンドウを検索できます。

## IPC ハンドラ一覧

### ウィンドウ操作

| IPC チャンネル | パラメータ | 戻り値 | 処理 |
|---------------|-----------|--------|------|
| `window:get-role` | なし | WindowRole | 自ウィンドウのロールを返す |
| `window:set-mode` | mode: WindowMode | WindowMode | ウィンドウを login/core に再設定 |
| `window:open-core` | なし | 'core' | core ウィンドウを開く |
| `window:open-login` | なし | 'login' | login ウィンドウを開く |
| `window:close-self` | なし | void | 自ウィンドウを閉じる |
| `window:minimize-self` | なし | void | 自ウィンドウを最小化 |
| `window:get-bounds` | なし | WindowMetrics | bounds + minSize を返す |
| `window:get-pointer-snapshot` | role? | PointerSnapshot | カーソル位置 + ターゲットウィンドウ情報 |
| `window:set-bounds` | bounds | WindowBounds | 位置・サイズ変更（clamp 付き） |
| `window:set-interactive` | boolean | boolean | マウス透過の切替 |

### パネル操作

| IPC チャンネル | パラメータ | 戻り値 | 処理 |
|---------------|-----------|--------|------|
| `panel:toggle` | panel: PanelKey | Record\<PanelKey, boolean\> | パネルの表示/非表示をトグル |
| `panel:apply-states` | states | Record\<PanelKey, boolean\> | 複数パネルを一括設定 |
| `panel:get-states` | なし | Record\<PanelKey, boolean\> | 現在の全パネル状態を返す |

### 設定・デスクトップ・システム

| IPC チャンネル | パラメータ | 戻り値 | 処理 |
|---------------|-----------|--------|------|
| `settings:open` | sessionId: string | void | 設定ウィンドウを開く |
| `settings:close` | なし | void | 設定ウィンドウを閉じる |
| `desktop:list-sources` | なし | DisplaySourceInfo[] | 画面/ウィンドウ一覧 |
| `desktop:list-vrma-files` | folderName: string | string[] | VRMA ファイル一覧 |
| `desktop:set-source` | sourceId | string \| null | デスクトップキャプチャ対象設定 |
| `system:get-cpu-usage` | なし | number | CPU 使用率 (0〜100) |

## preload.ts との対応

`electron/preload.ts` は `contextBridge.exposeInMainWorld('desktopApi', { ... })` で IPC を renderer に公開します。
`src/env.d.ts` で `window.desktopApi` の型を定義しています。

IPC 追加時の修正セット:
1. `electron/main.ts` — `ipcMain.handle()` を追加
2. `electron/preload.ts` — `desktopApi` に公開
3. `src/env.d.ts` — 型定義を追加
4. Renderer — `window.desktopApi?.xxx()` で呼び出し

## Electron Windows 特有の注意点

- **透明ウィンドウ**: `transparent: true` ＋ `backgroundColor: '#00000000'`。CSS の透明部分がそのまま透過。タイトルバーがないため `_WindowShell.vue` で代替
- **最小サイズ問題**: Windows の `setMinimumSize()` が正しく機能しない場合があるため、`windowMinSizes` Map で独自管理＋`did-finish-load` で再適用
- **パネル非表示**: `window.hide()` はウィンドウを破棄せず非表示にするだけ。再表示が高速
- **contextIsolation**: `true`（セキュリティ）。preload 経由以外の Node.js API は renderer から使えない
