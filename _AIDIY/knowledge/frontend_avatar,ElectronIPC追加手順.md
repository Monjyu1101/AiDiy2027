# Electron IPC 追加手順

> 文書: `frontend_avatar,ElectronIPC追加手順.md` | 実装: `frontend_avatar/electron/main.ts`, `frontend_avatar/electron/preload.ts`, `frontend_avatar/src/env.d.ts`

## このメモを使う場面
- Renderer（Vue）から OS 機能や BrowserWindow 操作を呼び出す
- Electron main process の機能を `window.desktopApi` 経由で公開する
- Electron / Web デュアルモードで壊れない分岐を追加する

## 関連ファイル
- `frontend_avatar/electron/main.ts` — `ipcMain.handle()` で handler 登録
- `frontend_avatar/electron/preload.ts` — `contextBridge.exposeInMainWorld()` で API 公開
- `frontend_avatar/src/env.d.ts` — `window.desktopApi` の型宣言
- `frontend_avatar/src/AiDiy.vue` — role / panel / BroadcastChannel 連動
- `frontend_avatar/src/components/AIコア.vue` — core ウィンドウ上の UI 連動

## 追加手順

### 1. main.ts に handler を登録する

```typescript
import { ipcMain } from 'electron'

ipcMain.handle('my-feature:do-something', async (_event, arg1: string, arg2?: number) => {
  return { result: 'OK', value: 42 }
})
```

### 2. preload.ts で renderer に公開する

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopApi', {
  // 既存 API と同じ object に追加する
  doSomething: (arg1: string, arg2?: number) =>
    ipcRenderer.invoke('my-feature:do-something', arg1, arg2),
})
```

### 3. env.d.ts に型を追加する

```typescript
declare global {
  interface Window {
    desktopApi?: {
      doSomething?: (arg1: string, arg2?: number) => Promise<{ result: string; value: number }>
    }
  }
}
```

### 4. Vue から optional chaining で呼ぶ

```typescript
const result = await window.desktopApi?.doSomething?.('hello', 3)
if (result) {
  console.log(result.value)
}
```

## Electron / Web デュアルモードの判断

IPC は Electron 専用。Web モードでは `window.desktopApi` がないため、呼び出し箇所でフォールバックを決める。

| 目的 | Electron | Web |
|------|----------|-----|
| ウィンドウ role 取得 | `window.desktopApi.getWindowRole()` | `?role=` または既定値 |
| パネル表示切替 | `panel:toggle` / `panel:apply-states` | `AiDiy.vue` の `アクティブタブ` |
| 認証 Storage | `localStorage` | `sessionStorage` |
| VRMA ファイル一覧 | `desktop:list-vrma-files` | `config.ts` の定数配列 |
| OS カーソル位置 | `window:get-pointer-snapshot` | DOM の `pointermove` |
| CPU 使用率 | `system:get-cpu-usage` | 0 扱い、または UI 非表示 |

## role / panel へ影響する場合の確認箇所

ウィンドウやパネル状態に関わる IPC は、main / preload / env.d.ts だけでは足りない。

- `electron/main.ts`: `WindowRole`, `PanelKey`, `panelStates`, `panelWindows`, `windowRoles`
- `electron/preload.ts`: 公開関数名と戻り値型
- `frontend_avatar/src/env.d.ts`: `Window.desktopApi` の型
- `frontend_avatar/src/AiDiy.vue`: `PANEL_KEYS`, role 解決, BroadcastChannel snapshot, Web タブ切替
- `frontend_avatar/src/components/AIコア.vue`: トグルボタンや表示選択

`settings` のような専用ウィンドウは `PanelKey` に混ぜず、`WindowRole` だけに追加する。パネル表示状態と混ぜると `panelStates` 同期や Web タブ表示の意味が崩れる。

## Main → Renderer 通知

一方向通知は `webContents.send()` と `ipcRenderer.on()` を使う。preload 側では解除関数を返す形にする。

```typescript
// main.ts
mainWindow.webContents.send('my-event:notify', { message: 'hello' })

// preload.ts
onMyEvent: (callback: (data: { message: string }) => void) => {
  const handler = (_event: IpcRendererEvent, data: { message: string }) => callback(data)
  ipcRenderer.on('my-event:notify', handler)
  return () => ipcRenderer.removeListener('my-event:notify', handler)
}

// Vue
onMounted(() => {
  const off = window.desktopApi?.onMyEvent?.((data) => { /* ... */ })
  onBeforeUnmount(() => off?.())
})
```

## 注意点
- main.ts / preload.ts / env.d.ts の 3 点セットを必ず更新する。
- `window.desktopApi?.xxx?.()` で呼ぶ。Web モードでは `desktopApi` が undefined。
- IPC チャンネル名は `namespace:action` 形式にする（例: `window:`, `panel:`, `system:`, `desktop:`）。
- `BrowserWindow` 操作は renderer から直接行わず、main process の handler に閉じ込める。
- preload で `ipcRenderer` をそのまま expose しない。必ず用途別のラップ関数にする。
- イベント購読は `onBeforeUnmount` で解除し、複数ウィンドウ開閉時の handler 増殖を避ける。
- 既存チャンネル名と被らないよう `electron/main.ts` を確認してから追加する。

## 確認方法
- `cd frontend_avatar && npm run type-check`
- Electron 起動後、DevTools Console で `window.desktopApi` に追加 API が出ているか確認する。
- Web モードで同じ画面を開き、`desktopApi` 不在でもエラーにならないことを確認する。
