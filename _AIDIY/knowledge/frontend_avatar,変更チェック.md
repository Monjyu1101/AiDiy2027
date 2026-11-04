# frontend_avatar 変更チェック

> 文書: `frontend_avatar,変更チェック.md` | 実装: `frontend_avatar/src/AiDiy.vue`, `frontend_avatar/src/components/AIコア.vue`, `frontend_avatar/electron/main.ts`

## このメモを使う場面

- `frontend_avatar` の Electron / Web 両対応を崩さず修正する。
- WindowRole、PanelKey、IPC、WebSocket、VRM、音声、モデル設定を変更する。
- Electron だけ、または Web だけで発生する不具合を切り分ける。

## 関連ファイル

- `frontend_avatar/electron/main.ts`
- `frontend_avatar/electron/preload.ts`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_avatar/src/env.d.ts`
- `frontend_avatar/src/api/config.ts`
- `frontend_avatar/src/api/client.ts`
- `frontend_avatar/src/api/websocket.ts`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_avatar/src/dialog/AI設定再起動.vue`

## Electron / Web の前提

| 項目 | Electron | Web |
|------|----------|-----|
| 判定 | `!!window.desktopApi` | `!window.desktopApi` |
| 認証 storage | `localStorage` | `sessionStorage` |
| パネル | BrowserWindow + IPC | 右ペインのタブ |
| 状態同期 | BroadcastChannel + IPC | BroadcastChannel / 単一タブ内 state |
| API | Vite proxy または config | Vite proxy / 動的 URL |

修正後は Electron と Web の両方を確認する。

Electronの操作・表示は [共通の基本方針](./共通,Electronウィンドウ基本方針.md) に従う。全12種類の表示は `electron/main.ts` の `ウィンドウ表示` に集約し、読込・配置後に最終寸法の透明パネルで領域を確保して、その内側だけをズームする。表示中の再要求はフォーカスのみ、連打は同じ処理を共有する。`ウィンドウ非表示` と共通 `拡大表示` の `canShow` で、待機中に閉じた画面を再表示しない。`checks/window-opening.test.cjs` は全表示経路と連打・取消・読込中の破棄を、同期済みの `dist-electron` から検査する。

Electron の全12種類の窓（ログイン、AIコア、Chat / File / Image / Code1〜6、設定）は、同じ位置で左ボタンを0.5秒押すと窓をドラッグできる。`electron/main.ts` の `createBaseWindow` と、独立した `openSettingsWindow` が `frontend_ide/デスクトップ/長押し窓移動.cjs` の `attachNativeWindowMove` を取り付ける。短押しはクリック、判定前の移動は通常の文字選択・ドラッグ、成立後の解放はクリックへ渡さない。Esc・フォーカス喪失・破棄で終了し、最大化・全画面では開始しない。Web版のタブへは適用しない。IPC・preloadの公開APIは増やさない。

変更後は `npm run build:electron` で実行出力を同期する。リポジトリルートで `node frontend_avatar/checks/window-move-desktop.mjs` を実行すると、導入済みDiag Electronの隔離プロファイルで全12種類の本番生成関数・移動処理を検査する。本文だけ無害な合成ボタン・入力欄に置換し、AI・音声・実サービスへ接続しない。カーソル位置とフォーカス判定だけを模擬し、Electron入力、0.5秒の判定、実OSの位置・サイズ、移動後の誤クリック防止、短押し、窓破棄時の購読解除を確認する。結果は `temp/window-move-check/avatar-result.json` とマーカー画像へ保存する。Mac / Linux 実機での確認は別途行う。

Avatarの設定済アイコンは `public/icons/AiDiy_avatar.png` です。通常窓・設定窓・Mac Dockは `electron/main.ts` の `AVATAR_ICON_PATH` を共有します。`aidiy_avatar`、`npm start`、開発起動は `dist-electron/main.js` を直接Electronへ渡すため、`app.getAppPath()` は `dist-electron` になります。画像は `__dirname` から `../public/icons/AiDiy_avatar.png` として解決し、作業ディレクトリやパッケージ起動方式に依存させません。Windowsの `AiDiy.frontend_avatar` AppUserModelIdは窓生成前に維持します。`npm run build:electron` 後に `node --test checks/window-opening.test.cjs checks/macos-menu.test.cjs` で全12窓・再作成・直接/パッケージ起動の画像パスと存在を確認します。移設fixtureは実行出力とPNGだけを別の `frontend_avatar` 配下へコピーし、異なる作業ディレクトリでもアイコンが同フォルダ内で解決することを検査します（共通UI依存は試験用に差し替え、アプリ全体の単独配布可否は対象外です）。実際のWindowsタスクバー表示と既にピン留めされたショートカットの表示は、モックとは別に確認してください。

Mac のアプリ名と最小メニューは `electron/main.ts` から `frontend_ide/host/scripts/MacOS-Menu.cjs` を共用する。表示名は `AiDiy Avatar`。メニューの閉じる・⌘Q は `app.quit()` で主窓と子窓を閉じ、⌘W はフォーカス中の窓だけを閉じる。コピー等は非表示の native role を維持し、キー入力を横取りしない。変更後は `npm run build:electron` で `dist-electron` を同期し、`node --test checks/macos-menu.test.cjs` で実行出力を確認する。Mac 実機の描画確認は別途行う。

## パネル外枠とタイトル配色

Avatar は他の単独アプリのグレー配色へ統一せず、`src/style.css` の Avatar 専用タイトル変数を使います。ログイン・本体・Chat / File / Image / Code1〜6・別窓設定・Web左右ペインの外枠は1pxの実線で、タイトルの紫グラデーションの基準色（`--avatar-title-edge`）を共有します。透明Electron窓でも四辺を判別できるよう、`border-image` は使いません。`_WindowShell` の light テーマとWeb内の設定ダイアログは、それぞれ既存の淡色タイトル背景を枠へ使います。`_WindowShell` は子パネルに線が隠れないよう、`::after` の1px線を前面に描画します。枠は `pointer-events: none` とし、通常のborderは透明で領域だけ確保します。キャラクター単体表示とWeb右ペイン内では `::after` も非表示にします。最小化・最大化・ピン・閉じるの背景は通常時・ホバー時とも透明とし、ピンONも背景や影を追加しません。

キャラクター単体表示の `chrome-hidden` とWeb右ペイン内の二重枠抑止では、`border-color: transparent` だけでなく `border-image: none` も必要です。背景透過、外寸、リサイズ操作域は変更しません。`node --test checks/panel-border.test.cjs` で色・1px・透明状態と反復切替を検査し、CSS出力を確認する場合は `npm run build:renderer` を使います。実OSの透明窓描画はモック試験とは別に確認します。

## WindowRole / PanelKey を増やす場合

連動修正:

- `electron/main.ts` の `WindowRole` / `PanelKey`
- `electron/preload.ts` の公開 API 型
- `src/env.d.ts`
- `src/AiDiy.vue` の `PanelKey`、タイトル、表示制御、`PANEL_KEYS`
- `AIコア.vue` のボタンやタブ表示
- snapshot の `buildSnapshot()` と受信側反映

## パネル表示を変える場合

確認箇所:

- `electron/main.ts` の `panelStates`
- `setPanelVisibility()`
- `createPanelWindow()`
- `closePanelWindow()`
- `panel:toggle`
- `panel:apply-states`
- `src/AiDiy.vue` の `アクティブタブ`
- BroadcastChannel `avatar-desktop-sync`

Web では IPC がないため、必ず `isElectron` 分岐と fallback を確認する。

## Task / Team

Task / Team は独立アプリ `aidiy_task` / `aidiy_team`（`frontend_ide`）を使用します。Avatar 内の画面・メニュー・専用 IPC はありません。共通モデル設定は従来通り維持します。

## IPC を追加する場合

最小セット:

1. `electron/main.ts` に `ipcMain.handle(...)` を追加する。
2. `electron/preload.ts` の `desktopApi` に公開する。
3. `src/env.d.ts` に型を追加する。
4. renderer 側では `window.desktopApi?.xxx` の optional chaining で呼ぶ。
5. Web モードで `desktopApi` 不在でも落ちないことを確認する。

詳細は `ElectronIPC追加手順.md` を使う。

## 接続まわりを変える場合

確認箇所:

- `src/api/config.ts`
- `src/api/client.ts`
- `src/api/websocket.ts`
- backend の `/core/ws/AIコア`
- Vite proxy。

WebSocket packet は `AIコアWebSocket仕様.md` を確認する。

## モデル設定を変える場合

- `CHAT_AI_NAME` は原則 `_chat` 末尾。OAuth 接続の `openai_oauth` は例外。
- `LIVE_AI_NAME` は `_live` 末尾。
- `CODE_AI*_NAME` は原則 `_sdk` または `_cli`、例外として `aidiy_hermes` を許容する。
- 比較は完全一致を使い、`startswith` に寄せない。
- プロジェクトルートの `_config/AiDiy_key.json`、backend の `conf/conf_model.py`、`AIコア/AIセッション管理.py` と整合させる。

詳細は `AIモデル設定変更手順.md` と `AIコードパネル拡張手順.md` を使う。

## アバター演出を変える場合

確認箇所:

- `AIコア_アバター.vue`
- `AIコア_自立身体制御.ts`
- `AIコア_自動カメラワーク.ts`
- `WindowShell.vue`
- `style.css`

透明ウィンドウでは Electron の `transparent`、renderer 背景、補助 UI、字幕、発光要素が重なるため、1箇所だけの修正で完結しない。

詳細は `アバター表示とVRMA.md` と `VRM_VRMA追加手順.md` を使う。

## 音声を変える場合

確認箇所:

- `AIコア_音声処理.ts`
- `AudioController`
- `input_audio`
- `output_audio`
- `cancel_audio`
- AudioContext resume。

詳細は [`backend_server,frontend_avatar,AI音声処理.md`](./backend_server,frontend_avatar,AI音声処理.md) を使う。

## よくある問題

| 症状 | 確認先 |
|------|--------|
| 401 | token storage、`認証延長ルール.md` |
| 音声が出ない | speaker 有効、AudioContext、audio WebSocket |
| マイクが使えない | Electron 権限、audio socket |
| 補助パネルが同期しない | BroadcastChannel snapshot |
| 透明ウィンドウが不自然 | `WindowShell.vue`、`AIコア_アバター.vue`、CSS |
| デスクトップキャプチャできない | `desktop:set-source`、source 選択 |
| Web モードでセッションが消える | `sessionStorage` の仕様 |
| Web モードでパネルが開かない | IPC ではなく `アクティブタブ` 分岐 |
| WebSocket が繋がらない | Vite proxy と WebSocket URL 解決 |

## Electron 設定ウィンドウのサイズ調整

設定ウィンドウ (`AI設定再起動.vue` / settings role) は Electron では独立 BrowserWindow で表示される。

| 調整箇所 | 説明 |
|----------|------|
| `electron/main.ts` の `SETTINGS_BOUNDS` | 初期サイズ (`width`, `height`) と最小サイズ (`minWidth`, `minHeight`) |
| `src/dialog/AI設定再起動.vue` の `.config-panel` | `max-width: 720px` で幅を制限 (AiDiy.vue の `settings-window-root :deep` で上書き) |
| `src/dialog/AI設定再起動.vue` の `@media` | avatar 版では `max-width: 500px` に変更 (元 1000px だと常時1カラムになるため) |
| `src/dialog/AI設定再起動.vue` の `.config-panel-field` | `grid-template-columns: 25% 1fr` でラベル幅を比率指定 (固定pxだと狭い時に2段になる) |

`SETTINGS_BOUNDS.width` は `.config-panel` の `max-width` と揃えること。不整合があるとウィンドウ枠が余る。

## 最小確認

- Electron で login / core / chat / file / image / code1〜code6 / settings を開ける。
- Web で `http://127.0.0.1:8092` を開ける。
- Electron と Web で storage の使い分けが崩れていない。
- WebSocket 接続、チャット送信、コード送信が通る。
- DevTools Console に `desktopApi` 未定義エラーがない。
- `npm run type-check` が通る。
