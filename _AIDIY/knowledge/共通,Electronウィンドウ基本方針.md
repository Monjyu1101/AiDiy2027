# Electronウィンドウ基本方針

> 文書: `共通,Electronウィンドウ基本方針.md` | 実装: `frontend_ide/デスクトップ/長押し窓移動.cjs`, `frontend_ide/デスクトップ/code-drag.cjs`, `frontend_ide/host/scripts/window-opening.cjs`, `frontend_ide/desktop.cjs`, `frontend_ide/デスクトップ/panel-windows.cjs`, `frontend_avatar/electron/main.ts`, `backend_diag/起動/electron-main.cjs`, `frontend_channels/panel/desktop.cjs`

## このメモを使う場面

- AiDiy の Electron アプリ・関連パネルを追加、変更する。
- 長押しによる窓移動や、表示開始時のズームに適用漏れがないか確認する。
- Windows の白い縁・ちらつき・DPIによるサイズ変化を防ぐ。

## renderer のフォルダ構成（Avatar を実例にする）

`frontend_avatar/src` を構成の見本とする。`components/` と `dialog/` は **src 直下の兄弟フォルダ**であり、常に `components/dialog/` とする意味ではない。現行 Avatar の実在する抜粋は次のとおり。

```text
frontend_avatar/
├─ electron/                 # main.ts / preload.ts（OS 窓・IPC）
└─ src/
   ├─ main.ts                # renderer 初期化
   ├─ AiDiy.vue              # 画面全体の組み立て
   ├─ components/
   │  ├─ AIコア.vue
   │  ├─ AIコア_アバター.vue
   │  ├─ AIコア_音声処理.ts
   │  ├─ AIチャット.vue
   │  ├─ AIコード.vue
   │  └─ ログイン.vue
   ├─ dialog/
   │  ├─ AI設定再起動.vue
   │  ├─ 再起動カウントダウン.vue
   │  ├─ 更新ファイル一覧.vue
   │  └─ ファイル内容表示.vue
   ├─ api/                   # client.ts / config.ts / websocket.ts
   ├─ utils/                 # 共通の補助処理
   └─ _share/                # qAlert.vue 等の共通 UI
```

### 配置の判断基準

- renderer の入口・全体組み立ては `src` の直下、通常画面や部品は `components/`、独立したダイアログ部品は `dialog/` に分ける。大きな画面は `components/ファイル閲覧/` のような日本語の機能フォルダでまとめる。
- その機能だけの通信・状態・描画・CSS・素材は機能フォルダの中に置き、Vue ファイルだけを移して関連処理を散らさない。小さな機能のために空の階層や同義のフォルダを増やさない。
- 画面と機能は日本語で分かる名前にする。一方、`src` / `components` / `dialog` / `api` / `utils`、フレームワークの入口や既存の公開契約は理由なく改名しない。既に日本語で適切な名前は維持する。
- 自立した機能パッケージの内側に `components/` / `dialog/` を持つ構成も使える。Task / Team の専用 bundle と、その機能内のダイアログ・別窓を無理に全体へ引き上げない。通常画面内の小さな確認表示を分割すること自体は必須ではない。
- `components/ファイル内容表示.vue` と `dialog/ファイル内容表示.vue` のように表示部品とダイアログの役割が別なら両方置ける。重複という理由だけで統合せず、呼出し・責務を確かめる。
- Electron main / preload、Bot worker、VS Code 拡張ホスト、サーバー API を renderer の `components/` へ移さない。公開 URL、IPC/API 名、保存キー、起動入口は変えない。
- 素材は所有モジュール内に維持する。見た目を合わせるために他モジュールの資産へ新たな依存やコピーを作らない。既存の配布コピーと正本の関係も維持する。

### 適用範囲と順序

確認対象は次の **11 アプリ**。下の5系統はソース所有元の分類であり、「5アプリだけ確認する」という意味ではない。起動入口ごとの回帰確認と、共有 renderer の配置確認を両方行う。

| アプリ | 主な起動入口 | renderer の所有元 / bundle |
|--------|--------------|------------------------------|
| Diag | `backend_diag/diag_main.mjs` → `起動/electron-main.cjs` | `backend_diag/ui/src` → `static/app.js` |
| Avatar | `frontend_avatar/launch.mjs` → `electron/main.ts` | `frontend_avatar/src` |
| Navigator | `frontend_ide/aidiy_navi/launch.mjs` | `frontend_ide/src` → `dist/app.js` |
| Console | `frontend_ide/aidiy_console/launch.mjs` | `frontend_ide/src` → `dist/app.js` |
| Code | `frontend_ide/aidiy_code/launch.mjs` | 同上。VS Code 拡張へも同じ bundle を配布 |
| Live | `frontend_ide/aidiy_live/launch.mjs` | 同上。VS Code 拡張へも同じ bundle を配布 |
| IDE | `frontend_ide/aidiy_ide/launch.mjs` | `frontend_ide/src` → `dist/app.js` |
| Task | `frontend_ide/aidiy_task/launch.mjs` | `src/components/タスクチーム` → 専用 `dist/taskteam.js` |
| Team | `frontend_ide/aidiy_team/launch.mjs` | 同上。Task と別の起動種別・認証画面 |
| Browser | `frontend_ide/aidiy_browser/launch.mjs` | `frontend_ide/src` → `dist/app.js`。Electron 専用 |
| Discord | `frontend_channels/panel/launch.mjs` | `frontend_channels/panel` → `view.js` |
| Slack | `frontend_channels/slack/panel/launch.mjs` | `frontend_channels/slack/panel` → `view.js` |

Console / Code / Live / IDE / Task / Team / Browser の入口は共通 `frontend_ide/launch.mjs` / `desktop.cjs` へ進む。`host/aidiy_code` / `host/aidiy_live` 等の互換入口を別アプリとして複製しない。Viewer、Explorer、比較、軌跡、Task の要求・フロー・明細・編集などの関連窓も、それぞれの所有元で確認する。

Discord と Slack は **双子**として `panel/components/接続/接続パネル.vue`・`機能切替.vue`・`パネル状態.js` の配置と起動・停止・モデル設定の契約を揃える。Slack に Live / 音声部品を足さず、Discord の `components/ライブ/` だけが音声を持つ。互いの画像や実装を直接参照する新たな依存は作らない。

`aidiy_hermes` はこのリポジトリでは Python CLI / TUI で、Console 上で使う場合は Console の renderer が対象。upstream 由来の `command_hermes/package.json` に `install:desktop` / Electron の記述があっても、現行 checkout に `apps/desktop` の実装はないため独立 Electron UI の修正済みとして数えない。将来導入する場合は実在する main / renderer を改めて棚卸しする。Markdown PDF の非表示 Electron worker、表示演出の一時 canvas、Diag のアイコンメニューは通常の Vue renderer とは別の補助窓であり、空の `components` / `dialog` を無理に追加しない。

実際の renderer の所有元ごとに確認する。アプリ名ごとに同じ画面を複製しない。

| 所有元 | 対象 | 構成の境界 |
|--------|------|------------|
| `frontend_avatar/src` | Avatar の Electron / Web 共通画面 | 上記の参照実例。既に役割分離されている箇所は維持 |
| `backend_diag/ui/src` | Diag 通常・ミニ | `backend_diag/起動` の main 処理、配布先 `static/` と分離 |
| `frontend_ide/src` | Console / Code / Live / IDE / Task / Team / Browser と関連別窓 | 同じ所有元の共通画面。Task / Team の専用 bundle 境界は維持 |
| `frontend_channels/panel` | Discord 接続パネル | Bot の `frontend_channels/src` と分離。既存 `panel` を renderer ルートとして使う |
| `frontend_channels/slack/panel` | Slack 接続パネル | Discord と対応する構成だが別モジュール。音声機能は追加しない |

Avatar を基準に、Diag → IDE 共通画面 → Discord → Slack の順で一つずつ修正・検証する。`frontend_web` の Web 専用画面、`frontend_ide/host/src` の拡張ホスト、`viewer` のファイル API・Office 資産は、この構成整理のために移さない。共有 renderer を使う Code / Live の VS Code 表示は回帰対象として確認する。

### 移動後のナレッジ対照

1. 上表の各所有元で、入口・通常部品・ダイアログ・機能内補助処理の位置を実際の tree と比較する。未使用の旧コピーや壊れた import がないことを確認する。
2. 相対 import、動的 import、CSS の `url` / `@import`、素材読込、TypeScript alias / include、ビルド・manifest・検証スクリプトの直接参照を更新する。履歴・固定版の引用は機械的に書き換えない。
3. 各モジュールの静的検査と回帰テストを実行する。配布物を同梱するモジュールでは、ソース移動で manifest が変わるため、理由を明示して対象 bundle を再生成し、配布物の一致も確認する（通常確認として無条件に build しない）。
4. 全モジュールの修正後、もう一度この判断基準・所有境界と照合し、現行 AGENTS / README / ナレッジの参照先を確認する。
5. 自動テスト・コンパイルの合格と、Electron / Web / VS Code の実画面・OS 固有動作の合格を区別する。資格情報や外部 AI を必要とする試験を構成整理だけで勝手に実行しない。

構成そのものの回帰確認は、ルートで `node --test scripts/checks/electron-renderer-layout.test.cjs` を実行する。5 系統の配置、旧配置の不在、Task / Team の別 bundle 境界、Bot / main / host の分離を読み取りだけで確認する。これは実画面の合格判定ではない。

## 共通の基本動作

AiDiy が所有する Electron の操作画面は、**通常画面の背景を同じ位置で左ボタンで0.5秒長押しした後のドラッグ移動**と、**表示開始時のズーム**を基本とする。選択欄・入力欄などの操作と、ポップアップ中のモデル選択を窓移動より優先する。新規のアプリ・別窓にも最初から組み込む。光沢・影が走る追加の登場演出は入れない。

対象は aidiy_diag、Avatar、Console、Code、Live、IDE、Task、Team、Browser、Discord、Slack と、その機能別ウィンドウ。IDE の Explorer、Viewer、ソース比較、軌跡バー、Browser 本文、Avatar の設定、独立 Task の要求・フロー・明細・編集窓も含む。Webブラウザ版・VS Code拡張の埋め込み画面にはOS窓移動を導入しない。演出用の短命な透明キャンバスは操作画面ではないため、長押しを取り付けない。

## タイトル操作と最前面ピン

- 操作の並びは **ー □ 📌 Ｘ**。既存のタイトル位置・高さ・窓寸法は維持する。Diagのミニ表示では最大化を理由付きで無効化する。軌跡バーは通常タイトルバーを持たない例外で、最小化・最大化を追加しない。左端のバーガーを即時ドラッグ面とし、隣の二重縦線は表示しない。右端はピン・×の順にする。
- 最前面の管理は `frontend_ide/デスクトップ/最前面ピン.cjs` の `createWindowPins` を全アプリで共用する。通常起動はOFF、沈んだ表示。再起動を越えてON状態を保存しない。Diagのミニ表示への切替・復帰も、その時点のユーザー選択を維持する。
- IDEから開くConsole / Code / Live / Viewer / Browser / Explorer / 比較 / 軌跡だけはONで生成する。現在これらはIDEと同じElectronプロセスで、main側の `record.owner` が起動元の根拠となる。CLIの `--linked`、URL、rendererからの任意フラグを根拠にしない。
- Diagからのアプリ起動、単独Avatar（設定を含む）、単独Task / Team、単独Discord / SlackはIDE由来ではないためOFF。現行IDEにこれらの別プロセス起動経路はない。今後IDEから外部Electronを起動する場合は、mainが管理する起動元とVR状態の通知・切断処理を加え、単に別プロセスだからOFFと判断しない。
- ONは全OS・全アプリで同じ `floating` 層。選択されたON窓だけ `focus` 時に `moveTop` する。`focus()` の奪い返し、タイマー再固定、IDE選択時の子窓一括持上げ、`pop-up-menu` 等の上位層は使わない。これにより別プロセスのON窓同士も通常のOS選択順に従う。OFF窓の選択では持上げ処理をしない。
- IDEのVR中は、本体と所属する既存・新規子窓をONにロックする。UIは `aria-pressed` と理由付きdisabledで表示し、mainでもOFF要求を拒否する。F11・VR再押下・最大化によるVR終了後は、各窓のVR直前のユーザー選択へ戻す。VR中にIDEから新規生成した窓はONへ戻り、その後OFFにできる。
- IDE所属パネルの寿命・セッション・VR連携は `record.owner` で管理し、OS上はピンON・OFFとも独立したトップレベル窓にする。`setParentWindow(owner)` は使わない。DOM別窓も `setParentWindow(null)` で切り離し、window.openのDOM連携は維持する。タイトル・配置・終了連携でIDE所属を示す。通常の非モーダル親子窓でもOSは子を親より手前に保つため、独立した選択順とは両立しない。ピンONはOFFのIDEより手前だが、本体もONのときは本体を含め最後に選択した窓が手前になる。
- ページ内のExplorer・軌跡・Viewer・比較は従来の **📌** で別ウィンドウを開く。Explorer・軌跡の切離し📌は右端に置く。ElectronのExplorerはタイトルの×、軌跡は右端の×で独立窓を閉じ、同じDOMを本体内に開いたまま戻す。本文の↙は表示しない。Web popupの復帰操作と、別窓API・セッション・元DOMの保持は維持する。
- rendererは自分の状態取得・切替・状態変更購読だけをpreload経由で使用する。DOM別窓は親IDEの限定 `panelAction` と、所属する `panelName` の通知を使う。他窓IDや任意IPCを公開せず、mainで所有者・フレーム・セッション世代を照合する。

再検証:

- `node --test frontend_ide/checks/window-pin.test.mjs frontend_ide/checks/window-pin-renderer.test.mjs frontend_ide/checks/code-window-title.test.mjs frontend_ide/checks/panel-windows.test.mjs frontend_ide/checks/all-displays.test.mjs`。OFF/ON初期値、選択順、VR入出、F11、連打・古い通知・閉鎖時の回収、他窓操作拒否を確認する。
- `frontend_avatar/node_modules/.bin/electron frontend_ide/checks/window-pin-desktop.cjs --ozone-platform=headless` は隔離した合成画面だけを使う。Linux headlessでは `setAlwaysOnTop` を受け付けても `isAlwaysOnTop()` がfalseのままの環境がある。コントローラーの状態・API呼出検査と、OS最前面の実測を区別する。
- Windows実機では、別アプリを含むON窓A/Bの交互選択、OFFへ変更したIDE子窓とIDE本体の前後入替、他アプリ選択、VR中の解除拒否、VR終了後の復元を実窓で確認する。headless・モックの成功を実デスクトップのZ順検証として扱わない。
- `node frontend_ide/scripts/check-ide-pin-order.mjs` は隔離したWindows実窓とPython標準ライブラリの読み取りだけで、IDEを持ち上げた時の実際のWin32 Z順を検証する。ON同士・再ON・VRロックで本体とパネルを交互に持ち上げられること、OFFのIDEよりONパネルが前、OFFパネルはONのIDEより後ろになることを確認する。このプローブは入力フォーカスやクリック操作の実測ではないため、それらはWindows実窓で別途確認する。`isAlwaysOnTop()` の報告と実際のZ順は区別する。

## 通常タイトルの最大化・復元を確認するとき

通常フォームとして確認する操作は、タイトルのダブルクリックで最大化、再ダブルクリックで元の位置・寸法へ復元、最大化中のタイトルドラッグで復元してポインターに追従すること。最大化ボタンのテストだけで、この3操作を検証済みとして扱わない。

- Avatar の `_WindowShell.vue` / ログイン画面、Console / Code / Live / IDE / Task / Team / Browser の共通 `状態バー.vue`、Discord / Slack の header は通常タイトルを CSS `app-region: drag` としており、タイトルのダブルクリック専用ハンドラーは持たない。操作は Electron / OS の native hit-testing に委譲される。ボタン・入力・選択欄の `no-drag` と操作可能性を別途確認する。
- 共通の500ms背景長押しは最大化・全画面を拒否する。これは通常タイトルの即時ドラッグとは別経路であり、最大化解除ドラッグの代替実装ではない。
- 最大化ボタンの経路は、通常の `maximize` / `unmaximize`、Browser の専用表示領域controller、Diag の通常窓サイズcontrollerに分かれる。IDEのVR、BrowserのF11全画面・glass header、最大化操作を持たない軌跡バーは通常窓とは分けて扱う。

### Diag の標準・ミニ・アイコン表示

Diag は3表示で同じ透明窓・Vue状態を共有する。Windowsの透明窓はnativeタイトルのダブルクリック最大化に制約があるため、単に疑似最大化を撤去しない（[Electron公式の透明窓の制約](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)）。Avatar も透明窓なので、nativeタイトルへの委譲だけでWindowsの3操作を保証しない。

- **Windows標準パネル**：`backend_diag/起動/標準タイトル操作.cjs` がmainの入力イベントと実カーソルDIPを使い、`通常窓サイズ.cjs` の同じ保存bounds・最大化状態で処理する。OSから届く `clickCount` でダブルクリックを判定し、□ボタンと同じ最大化・復元経路へ送る。タイトルの押下だけでは最大化を解除せず、移動開始時に通常サイズへ戻し、押下位置の水平比率・タイトル内の縦位置をポインターへ合わせる。
- 標準タイトルの印はpreloadの固定readonly能力値 `customNormalTitle` によってWindowsだけへ付ける。CSSを `no-drag` にしてmainの判定へ統一し、同じ領域を500ms背景移動から除外する。任意のrenderer座標・窓ID・新たな汎用IPCは公開しない。
- **Mac / Linux標準パネル**と**ミニパネル**のタイトルは既存nativeドラッグを維持する。ミニは内容に合わせる特殊寸法と最大化禁止を維持し、標準へ戻すと通常寸法を現在の左肩から広げる。最大化前のサイズを保つが、表示切替後に自動で再最大化しない。
- **アイコン表示**は既存の透明領域・円形配置・専用移動・最前面管理を維持する。標準のタイトル操作は適用しない。
- 標準タイトルと背景長押しは同じサイズproxyを見る。これによりWindows疑似最大化中にraw窓のfalse判定を使って最大化寸法のまま背景移動する不整合を避ける。
- 入力部品・選択欄・開いたdialogを除外する。trusted pointer capture、文書・gestureの世代照合を使い、解放・capture喪失・Esc・フォーカス喪失・遷移・破棄・表示切替で回収する。最大化演出中の最小化・閉鎖・再読込・表示切替は古い操作を失効させる。

回帰確認は `node --test backend_diag/checks/normal-title.check.cjs backend_diag/checks/normal-size.check.cjs backend_diag/checks/mini-titlebar.check.cjs backend_diag/checks/desktop.check.mjs`。反復、元のbounds、負座標・倍率、速い押下と解放、遅い判定、capture喪失、各モードへの切替と取消を確認する。UIを変えた場合はDiagの対象bundleとmanifestも同期する。

`frontend_ide/host/node_modules/.bin/electron backend_diag/checks/normal-title-desktop.cjs --ozone-platform=headless` はsandboxを維持した合成画面に実trusted入力を送り、本番controllerと隔離DOMを検証する。headlessではOS窓寸法が1×1になるため、このプローブのbounds・カーソル・フォーカスは合成値を使う。**Windows実機の窓位置・DPI・複数画面・nativeジェスチャーの代用ではない。** 対象OS実画面からタイトルを操作し、保存位置・寸法・ポインター位置を実測する。DOMだけの合成 `dblclick` やmockの最大化フラグも実機の合格証拠にしない。

## 再取得・再読込の表示

再取得・再読込は `frontend_web/src/components/AiDiy/compornents/AIファイル.vue` の緑の **↺** に合わせる。通常は背景 `#22c55e`・枠 `#16a34a`・白い文字、hover は背景 `#34d399`・枠 `#22c55e`、disabled は背景 `#1f8a4b`・枠 `#166a39`・opacity `0.4` とする。記号だけのボタンは24px角・記号18pxで、hover時に1.2倍へ拡大する。文字付き操作は説明と既存の配置を保ち、記号だけを拡大する。

- IDE・Explorer・Viewer・Browser・検索／履歴は `frontend_ide/src/components/共通表示/再読込ボタン.vue`、Avatar は `frontend_avatar/src/components/再読込ボタン.vue`、Diag は `backend_diag/ui/src/components/共通表示/再取得ボタン.css` を使う。2D・別窓のテーマや本文の文字サイズで色・記号の大きさを上書きしない。
- 記号は `aria-hidden` とし、ボタンには操作名を付ける。既存の読込中・未接続・編集中などの無効条件と実行処理は維持する。Browser は読み込み中に停止操作へ切り替わり、停止を無効化しない。
- 再起動・再接続・再導入・ループ設定・画面切替は再取得と区別する。操作がない画面へ追加せず、削除済みのDiagミニCLI・Explorer右クリックの再取得も復活させない。ピン・閉じる・時刻検索の配置は変えない。
- 変更後は各Vueのコンパイルと配布物の一致に加え、通常・hover・disabled、繰り返し操作、Browserの停止切替、2D・別窓の表示を確認する。コンパイルや合成状態の検査を実画面の確認として扱わない。

## 0.5秒長押しドラッグ

- `frontend_ide/デスクトップ/長押し窓移動.cjs` と `code-drag.cjs` を共用する。500msの静止判定をアプリごとに複製しない。
- 通常の押下・解放は元のnativeイベントを直ちに通し、保留して再送しない。`select` / `option` / `datalist` / 入力欄・ラベル・ボタン・リンク・編集領域・iframe・ARIA操作部品は窓移動の対象外とする。Shadow DOMの内側と祖先も確認する。通常画面の背景だけを長押し候補にし、判定前に位置が動いたら文字選択・通常ドラッグを優先する。
- モデル選択などの`dialog[open]`、可視のモーダル・一覧・展開中コンボボックスでは、背景も含めて長押し窓移動を開始しない。nativeのselect/datalistにフォーカスがある間も選択操作を優先する。ただし、閉じた選択欄にフォーカスが残った場合でも、明示した `data-aidiy-window-move-handle` の非操作部分だけは次の長押しを受け付ける。開いた選択ポップアップ・モーダルやハンドル内のボタン・入力欄は例外にしない。ポップアップ中に窓をドラッグできなくても、モデル選択を妨げないことを優先する。
- 独立した軌跡バーの左端バーガーだけは `-webkit-app-region:drag` とし、タイトルバーの代わりに押した直後から移動できる。クリックで閉じず、×で本体へ戻す。分類・ピンを含む残りのバーは `no-drag` とし、短押し操作と共通500msの静止長押し移動を使い分ける。本体内のバーガーは従来どおり折り畳む。Explorer別窓のファイル一覧は `data-aidiy-window-move-list` を付けたtree要素のtabindexだけを例外にし、通常行・余白の静止した500ms長押しを受け付ける。展開ボタン・rename入力・メニュー・選択前のドラッグは保護する。
- DOMの対象と押下中のgestureは隔離worldで確認し、新しいpreload・IPC権限を追加しない。受動的な入力監視を使い、非同期の確認で元の入力の通過を待たせない。500ms後に同じgesture IDがまだ押下中の場合だけ移動を許可する。確認失敗時は移動を開始せず、解放・移動・フォーカス喪失・遷移・破棄・次の押下後に届いた結果を無視する。
- 背景の移動成立時だけ、元の対象へ`pointercancel`を送り、pointer captureとCanvasなどの操作状態を後始末する。実際の`pointerup` / `mouseup`は成立後もそのまま通し、同じgestureから生じる`click`だけを抑止する。次の押下・キー操作のクリックを抑止しない。選択欄やポップアップにはこの取消も送らない。
- 成立後は移動カーソルと静止した四方向マーカーを表示し、解放をクリックとして渡さない。解放・Esc・フォーカス喪失・遷移・破棄で解除する。最大化・全画面では窓移動を開始しない。IDEのVR時は既存の中心点移動へ分岐する。
- 他アプリは、mainが生成して所有する窓に `attachNativeWindowMove(window, screen, kind)` を一度だけ取り付ける。現在の外部アプリ種別は `diag` / `avatar` / `discord` / `slack`。新種別を足す場合は両共通ファイルの許可リストを揃える。
- rendererから任意の窓ID・座標を受け取るIPCを追加しない。Electronのカーソルと窓位置を同じDIP座標で扱い、既存の端数DPI補正・サイズ維持・購読解除を使う。

## 透明パネルで領域を先に確保するズーム

**最終位置・最終サイズの透明パネルを先に確保し、その内側だけをCSSでズームする。** 実ウィンドウの外枠をアニメーションの各フレームで拡大しない。

1. 実画面は `show: false` で生成し、内容の読込・最小サイズ・最終配置を先に整える。
2. `frontend_ide/host/scripts/window-opening.cjs` の `拡大表示` を使う。実画面の `getContentBounds()` と同じ領域へ、透明なキャンバス窓を作る。`transparent: true`、背景 `#00000000`、枠・影なし、タスクバー非表示を維持する。キャンバスの外枠は確定した領域のまま動かさない。
3. 非表示の実画面を `capturePage`（`stayHidden` / `stayAwake`）で取り込む。登場待ちで隠している不透明度だけを一時解除し、取得後に必ず戻す。HTML / body と画像の外側は透明とし、実画面の画像だけを中央から55%→100%へ750msで拡大する。白や背景色だけの代用面は出さない。倍率と時間の同期元は同ファイルの `開始倍率` / `演出時間`。実画面の位置・サイズを連続変更しない。
4. 実画面を透明度0で表示し、描画を待って透明度1へ戻す。実画面が見えてからキャンバスを破棄する。Windowsの白い縁や未描画フレームを露出させない。
5. キャンバスは `showInactive()` を使う。VR中のIDEなどに演出が隠れないよう、短命な画像だけは実窓の `isAlwaysOnTop()` と同じ層で作る。OFF窓の演出を最前面にしない。Windowsで透明部分が白くなる組合せを避けるため、本番の演出用キャンバスへ `focusable: false` や `setIgnoreMouseEvents` を追加しない。

非表示窓の初回取得はWindowsの描画待ちで失敗する場合があるため、再描画して最大3回取得する。拡大の終了は描画側のanimation.finishedで待つ。

実画面を取得できない場合は、色だけの代用面を出さずに通常表示へ進む。試験用HTMLにも `html` / `body` の透明背景・余白0・全高を指定し、ブラウザ既定の白地を混ぜない。

表示中の窓を手前へ戻す操作、再読込、aidiy_diagの通常・ミニ切替ではズームを重ねない。非表示から機能パネルを開く場合は表示開始として扱う。表示要求の連打はまとめ、ズーム待ちの非表示・破棄を優先する。共通 `拡大表示` の `canShow` は表示直前にも確認し、取り消された窓を遅れて再表示しない。

現時点では「動きを減らす」への専用対応は行わず、OSの設定によって規定のズーム・ページ繰り・更新表示などを省略しない。アプリ側のCSSメディアクエリーや表示入口の分岐を追加しない。第三者ライブラリ内部の実装とは区別し、共通処理から各アプリ・関連パネルまで順に確認する。

## 適用箇所

| 対象 | 長押しの取り付け | 表示開始 |
|------|------------------|----------|
| aidiy_diag 通常・ミニ | `backend_diag/起動/electron-main.cjs` | 内容読込と初期ミニ寸法の確定後に共通 `拡大表示` |
| Avatar 全12種類 | `createBaseWindow`、`openSettingsWindow` | `electron/main.ts` の `ウィンドウ表示` に集約。読込待ち、連打抑制、非表示要求を共用 |
| Console / Code / Live / IDE / Task / Team / 独立Viewer / Browser | `frontend_ide/desktop.cjs` の `attachWindowMove`。BrowserのWebContentsView本文にも取り付ける | `createWindow` で内容・配置確定後に共通 `拡大表示` |
| Explorer / 比較・Viewer / 軌跡の別窓 | `frontend_ide/デスクトップ/panel-windows.cjs` の `created` | `show` から共通 `拡大表示`。元DOM・状態・表示の保持を崩さない |
| Discord / Slack | `frontend_channels/panel/desktop.cjs` / `frontend_channels/slack/panel/desktop.cjs` | 内容・配置確定後に共通 `拡大表示`。Botの実接続は演出と独立 |

Task / Team も共通の500ms長押し移動に対応する。`frontend_ide/desktop.cjs` の `createWindow` は Team 本体と、Task の要求・フロー・明細・編集窓に同じ `attachWindowMove` を取り付ける。`長押し窓移動.cjs` / `code-drag.cjs` の両方の `movableKinds` に `task` / `team` を登録し、一方だけに追加しない。独立したTask編集窓の通常背景は移動できるが、その中で開いたDOM dialog・入力欄・ボタン等は共通の除外対象。押下位置の移動・スクロール・早い解放では開始せず、成立後の解放・Esc・フォーカス喪失・遷移・破棄で回収する。

## 再確認

リポジトリルートで実行する。画面検証は隔離プロファイル・合成データを使い、ユーザーのアプリやサーバーを停止しない。

- `node --test frontend_ide/checks/native-window-move.test.mjs frontend_ide/checks/code-drag.test.mjs frontend_ide/checks/panel-windows.test.mjs`：500ms、通常入力を遮断・再送しないこと、操作部品・ポップアップ除外、遅いDOM確認の取消、解除、DPI、所有元・表示境界。
- Task / Team の追加確認は `node --test frontend_ide/checks/native-window-move.test.mjs frontend_ide/checks/code-drag.test.mjs frontend_ide/checks/task-windows.test.mjs frontend_ide/checks/task-team-launchers.test.mjs`。Task の4窓とTeamで、499ms/500ms境界、実共有controllerへの到達、解放・再操作・Esc・blur・wheel・遷移・破棄、遅いDOM確認の取消を検査する。
- `node frontend_ide/scripts/check-panel-controls.mjs`：実Vue部品を隔離データで描画し、ページ内の📌、Explorerの既存タイトルと復帰、軌跡の一行表示、繰返し切離し、入力保持、VRロックを確認する。外部通信は行わず、結果と描画画像を一時フォルダへ保存する。
- `frontend_ide/host/node_modules/.bin/electron frontend_ide/checks/panel-hold-drag-desktop.cjs --ozone-platform=headless`：合成パネルへのtrusted入力で、一覧の行・余白、軌跡ハンドルの500ms長押しと、通常選択・rename・部品・ポップアップの保護を確認する。headlessの結果をWindows実機の位置・重なり確認とは扱わない。
- `node --test frontend_avatar/checks/window-opening.test.cjs frontend_channels/checks/desktop.test.ts backend_diag/checks/desktop.check.mjs`：全12種類の表示経路、連打・取消、Discordへの取り付け、aidiy_diagの初期表示・終了処理。
- 隔離した実Electron入力: `frontend_avatar/node_modules/.bin/electron frontend_ide/checks/native-input-desktop.cjs`。sandboxを維持した合成画面で、元のtrusted down/up、背景のpointercancelとclick抑止、取消・次の通常クリック、native selectのキー選択、2行listboxのマウス選択、dialog内の背景移動禁止を確認する。Linuxの画面なし環境では`--ozone-platform=headless`を指定できるが、OS固有dropdown popupの実機確認は別途必要。結果はOSの一時フォルダへ出力し、画面を取得できた場合だけPNGも残す。
- Task / Team の隔離Electron入力は上の `native-input-desktop.cjs` へ `AIDIY_TEST_WINDOW_KIND=task` / `team` を指定する（bash例: `AIDIY_TEST_WINDOW_KIND=task frontend_ide/host/node_modules/.bin/electron frontend_ide/checks/native-input-desktop.cjs --ozone-platform=headless`）。実native入力とDOMの保護を検査し、移動controllerは合成する。実controllerのDIP移動はNode回帰で別途検査するため、このheadless試験だけでOSの実窓位置・native dropdownを合格としない。
- Avatarのmain変更後は `frontend_avatar` の `npm run build:electron` で `dist-electron` を同期する。`node frontend_avatar/checks/window-move-desktop.mjs` は全12種類の実生成関数と共通ズーム・長押しを検査する。本文だけを無害な合成画面へ置き換える。
- `node backend_diag/checks/initial-mini-desktop.mjs`：実Vueの通常・ミニ表示、長押し、位置・サイズ・最前面・復元。
- `node frontend_channels/checks/window-behavior-desktop.mjs`：Discordの本番Vue・preload・ズーム・背景の長押し・選択欄と入力欄のnative操作。Bot workerだけを合成し、接続・保存・外部送信をしない。
- `node frontend_ide/scripts/check-module-move.mjs`：Code / Live / Consoleの単独・IDE連携、独立Viewer。`node frontend_ide/scripts/check-panel-desktop.mjs`：Explorer、Viewer、比較、iframe、軌跡。Monacoを含む既定の依存物を先にセットアップする。導入済みElectronの指定は各スクリプトの実装を確認する。
- ズームの画像確認では、キャンバスの透明領域と内側の拡大、実画面のサイズ維持、終了後のキャンバス回収を区別する。光沢の掃引を追加しない。

実Electronの入力とOSの窓位置・寸法を使う検証でも、無操作のためカーソル位置・フォーカス判定だけを模擬する場合がある。Windowsでの結果をMac / Linuxの実機確認として扱わない。異なるDPIの画面間移動やMac / Linuxの描画は各実機でも確認する。

nativeのモデル選択ポップアップはWindows実機で、クリックで開く→別候補を選ぶ→閉じて選択値を確認するところまで検証する。通常窓・最大化、マウス・キーボードの両方を確認し、Code / Live / Discord / Diag / Avatarのモデル・音声選択を含める。headless環境でnative popup自体が表示されない場合、イベント通過やVueの選択テストの合格をWindowsのpopup実機合格として扱わない。

## アプリごとの保存先と排他

単体ファイルをElectronへ渡す起動では、既定のアプリ名がElectronとなり、別アプリのuserDataと排他ロックが重なる場合がある。aidiy_diagは ready・requestSingleInstanceLock より前に、appData配下の `aidiy_diag` を専用userDataへ指定する。Avatarの既存保存先は変更しない。IDE共通とDiscordの既存アプリ別保存先も維持する。全アプリのMacメニューだけを確認して、Windowsの同時起動確認を省略しない。保存先APIは [Electron公式app API](https://www.electronjs.org/docs/latest/api/app) を参照する。

再検証は `node --test backend_diag/checks/desktop.check.mjs`（3OS分岐と排他前の保存先指定、既存終了確認等）と、aidiy_diagとAvatarを同時に表示する実画面試験を分ける。

## 大きな修正後の総合テスト

[システム起動編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,システム起動編.md) → [ランチャー編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,ランチャー編.md) → [IDE操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_ide,操作編.md)の順に行う。IDE編に起動部分は再掲載しない。実画面と実モデルの結果を記録し、良好な結果は✅ OK、未到達は未実施とする。

主目的は総合テストと実施記録であり、記録した操作と画面は副産物として操作手順書の素材に再利用する。各冊のテスト通過後、元のMarkdownと同じフォルダへ同名のPDFを作成し、本文の修正後は再生成する。

aidiy_diagの導入確認・モデル取得・外部連携は別冊の[環境確認編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,環境確認編.md)、モデル試行は[AIモデル・Tools編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,AIモデル・Tools編.md)で試験する。起動の成功はこれらの機能の合格とは別に判定する。

## 起動時のコマンド画面を出さない

Windowsで画面を持たない子プロセスは、Pythonでは `CREATE_NO_WINDOW`、Nodeでは `windowsHide: true` を指定する。環境確認・プロセス一覧・taskkillなどの短命な処理にも適用する。Electron本体はGUI形式の実行ファイルなので通常表示を許可し、窓そのものを隠す指定と混同しない。

AvatarのGUI起動は `electron/dev-start.cjs` がVite・TypeScript監視・Electron監視を直接管理する。npm/concurrentlyの入れ子のシェルを避ける。開発用の `npm run dev` も同じ入口を使う。

回帰試験は `node scripts/checks/Electron表示統合確認.cjs`。Pythonの実子プロセス、GUIバイナリ、各Electron画面と関連パネルを順に確認し、実施ごとのフォルダへログと結果を保存する。`AIDIY_ELECTRON_AUDIT_DIR` で保存先を指定できる。

試験用のクリック透過や1%不透明度を、共通ズームの `isAiDiyOpeningCanvas` が付いた窓へ適用しない。Windowsでは白い面になる条件がある。`capturePage`の透明な画像だけを根拠にせず、`Electron透明表示目視.cjs` とComputer UseでOS上の表示も確認する。目視用スクリプトへは、起動中IDEのURLを `AIDIY_PREVIEW_URL` で渡す。読み込み表示が消え、出航準備中を抜け、Canvasに星が描画されてから撮影する。撮影対象を前面に出し、別窓の重なりも確認する。ズーム途中を静止する試験なので、750msの時間測定には使わない。

## 起動元コンソールの保持

Console / Code / Live / IDE の Electron 起動完了は1行で案内し、ブラウザ版・`--no-open` / `--serve` のURL、失敗理由、診断ログは維持します。Windows の直接 `.cmd` と PATH ランチャーは起動元で `chcp` / `cls` を実行しません。登録時は `scripts/_setup_path.py` の共通生成を使い、実行ファイル・固定引数をASCIIの実行文から復元して渡すため、日本語の配置先でもコンソールのコードページを変更しません。既存の PATH ランチャーはセットアップで再登録してください。

Avatar の両 Vite 設定は `clearScreen: false` とし、開発サーバー再起動でも過去の出力を消しません。アプリ内のConsole・対話CLIの画面制御や、全体起動の明示的なリブート操作は別機能なので変更しません。Windows実機では、起動前の文字列が残ること、日本語の配置先・作業フォルダ、空白入り引数、失敗時の終了コード、`--wait` / Avatar の Ctrl+C を確認してください。
