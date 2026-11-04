# frontend_ide/viewer 実装概要

## 本書の目的

このファイルは `frontend_ide/viewer`（表示名 **AiDiy IDE**）の構成、設計方針、決定の経緯、今後の候補を AI エージェント向けにまとめたメモです。
利用方法と操作は [`README.md`](./README.md) に置きます。

## 位置付け

- 現行実装では、画面は `frontend_ide/src/`、このフォルダはファイルAPI・文書表示・互換起動入口を所有する。
- Code / Live と同じ AiDiy の正式なサブシステムとして、ルートの `_setup.py` / `_start.py` / `_cleanup.py` に「IDE群(Console / Code / Live / IDE / Task / Team / Browser)」として組み込み済み。ルートの概要・構成表にも掲載する。VS Code 拡張とは独立して動作する。
- **独立性を保つ。** ビューアは他サブシステムの `node_modules` を借りない。Code / Live パネルは例外として、ユーザー指定により既存単独版のビルド成果物・画面を再利用する。Monaco と文書表示ライブラリ（docx-preview / SheetJS / PptxViewJS / PDF.js など）は自前の `package.json` で導入する。Monaco がない場合は行番号付きの簡易コード表示になる。
- **利用方法を手動で選ぶ。** 初期画面は Live と同じターミナル演出。「AiDiy接続利用」はConsoleと同じtoolsポートのpingで稼働を確認して開始し、シアンバーを明滅させる。初回接続失敗は手動で再試行する。利用開始後のtools停止では作業セッション・ファイルAPI・Code子窓を維持し、同じ起点のまま再接続する。明示的な利用終了で初期状態へ戻す。「オフライン利用」はコアに接続せず閲覧でき、バーを赤で明滅させる。ファイルAPIは利用開始後だけ有効にする。
- 呼び名は「space ファイルビューア」。見た目は宇宙、役割はファイルビューア。IDE 全体（Code / Live を含む）のコンセプト名は **開発スペース（宇宙をテーマにした IDE 開発環境）**。

## 目指す姿: ソースをほぼ触らない IDE

- 人はコードを書かない・ほぼ触らない。**全体を眺める（宇宙）→ 正確に辿る（エクスプローラー）→ 中身を読む（ビューア）**で把握し、変更は AI に任せる。
- そのため編集機能は持たない（ビューアは読み取り専用）。代わりに「どこが変わったか」を見つける仕組み（起点日時の明滅、ツリーの金色表示）を厚くする。
- 機能を足す時は「読む・探す・見つける・AI へ渡す」を優先する。本文の編集機能は持たず、エクスプローラーの明示操作としてコピー・名前変更・新規作成・確認付きゴミ箱移動を提供する。

## 概要

作業フォルダを走査し、**いつも1階層だけ**を宇宙として描く。入口は起動したプロジェクトフォルダ。

| 見た目 | 実体 |
|---|---|
| 銀河 | 今の階層の直下フォルダ。星の数 = 配下の全ファイル数（深さを問わない） |
| 銀河の星 | そのフォルダ配下のファイル。色 = 種類（拡張子）、大きさ = サイズ、明るさ = 更新の新しさ |
| 惑星（名前による固定位置） | 今の階層の直下ファイル |
| 渦（ワームホール） | 1つ上のフォルダへ戻る入口 |
| 金色の点線 | この階層で開いた・選んだ順の移動経路 |
| 速い明滅 / ゆっくり明滅する銀河 | 起点日時より後に更新したファイル / それを含むフォルダ |

中央の銀河・帰還ゲートはダブルクリック、一覧のフォルダ名はクリックでワープ移動する。ツリーの▸／▾は開閉専用。フォルダに入ると1階層下を同じ見せ方で描き直す。

## 基本方針

- **表示テーマは宇宙、画面の文字は一般名。** 「銀河数」ではなく「フォルダ」、「星」ではなく「ファイル」、「航海日誌」ではなく「履歴」、「接近」ではなく「フォーカス」。コード内の識別子・コメントは宇宙の比喩のままでよい（`galaxy` / `star` / `planet` / `gate` / `voyage` / `journal`）。
- **いつも1階層だけを表示する。** 
- **フォルダ名・ファイル名はそのまま表示する**（大文字化しない）。
- **パネル類は角丸なし（スクエア）。** `border-radius` は 0。円形は種類の点と読み込みリングだけ。
- 凡例は出さない（種類での絞り込みもなし）。銀河の名前は `名前 (ファイル数)` の1行だけ。更新があれば金色でゆっくり明滅し、件数の行は出さない。
- **エクスプローラーは左側の VS Code 風ツリー。左上の ☰ / Ctrl+B で開閉する。** 見た目は `frontend_web` の `AIファイル.vue` の階層表示（フォルダ先・名前順、▸/▾、📁/📂、右に更新日時）に合わせ、ファイルには宇宙と同じ種類色の点を付ける。起点以降の更新は金色、フォルダは「更新 N」。宇宙側の選択と双方向に連動する。
- **右側はファイル選択時だけビューアを表示する。** フォルダ一覧は左のエクスプローラーに集約し、右の一覧・履歴タブは置かない。星・一覧のファイル選択でズームし、空白クリック・✕ / Esc で解除して選択前の階層・視点へ戻る。宇宙の中心・パンくずは表示中のパネルの間に揃え、ビューアを閉じた時は右端まで使う。
- **ファイルの操作性を優先する。** 演出は操作の邪魔をしない範囲に留める。フォルダ・ファイルは名前由来の固定3D配置とし、戻る入口は中心に置く。自動回転は初期停止。件数の増減で既存の座標を変えない。
- 画面の変更は共通Vue画面の手順に沿って確認する。

## 技術スタック

- Node.js 24（`node:http` / `node:fs/promises`、グローバル `WebSocket` / `fetch`）。
- XYZ座標と視点回転を透視投影して Canvas 2D へ描画（WebGL・外部ライブラリなし）。合成は `lighter`（光）と `source-over`（惑星・文字）を使い分ける。
- 通常は Electron の専用ウィンドウ。起動したフォルダをプロジェクトにする。Codespaces・画面のない Linux・Electron 起動失敗時は同じ画面を Web で開き、`--browser` でも明示できる。
- ファイルビューアは Monaco Editor（`monaco-editor` 0.56 の `min/`、AMD 版）。設定は `frontend_web` の `AIファイル.vue` に合わせる（読み取り専用・ミニマップ・折りたたみ・折り返し・文字 12px）。テーマは `vs-dark` を元に背景だけ宇宙に合わせた `aidiy-space`。現行の画面側実装は `frontend_ide/src/` にあり、旧 `web/app.js` は使用しない。
- Word / Excel / PowerPoint / PDF は独立した iframe 内の読み取り専用ビューアで表示する。Office Viewer 拡張そのものではなく、同拡張で採用・紹介する表示ライブラリを利用する。構成・対応形式・制限・検証方法は [`frontend_ide,文書ビューア.md`](../../_AIDIY/knowledge/frontend_ide,文書ビューア.md) を参照する。

## ファイル構成

| パス | 役割 |
|---|---|
| `package.json` | Monaco・文書表示ライブラリの依存と構文チェック・自動テスト |
| `_setup.py` / `_start.py` / `_cleanup.py` | ルートから呼ばれる「フロントエンド(IDE)」のセットアップ・起動・クリーンアップ（単独実行も可） |
| `launcher.py` | `aidiy_ide` の PATH ランチャー（`~/.local/bin/aidiy_ide.cmd`）の登録・解除 |
| `launch.mjs` / `launch-options.mjs` | 引数（作業フォルダ・`--project`・`--browser`・`--port`・`--strict-port`・`--no-open`）、サーバー起動、Electron / Web 切り替えと終了処理 |
| `core-connection.mjs` | 配置先の `PORT_TOOLS` による稼働確認、Code / Live用の `PORT_CORE` 解決、手動開始、初期画面と接続／オフラインの状態バー |
| `panels.mjs` | Code / Live の遅延起動・同一公開元中継。オフライン時はCodeだけ |
| `server.mjs` | `127.0.0.1` だけで待ち受け。ツリー（`/api/galaxy`）、ファイルの中身（`/api/file`・`/api/raw`・`/api/document`）、表示の準備（`/api/preview`）、Monaco（`/monaco/`）・文書表示資産（`/office-vendor/`）、`web/` の文書ビューア・ライセンス表示を配信。画面本体（`/`）は `frontend_ide/server.mjs` が Vue 画面を返す |
| `preview.mjs` | HTML の「表示」用の別オリジン静的サーバー。最初の要求で起動し、`server.mjs` の close で停止。ファイルは書き出さない |
| `vue-preview.mjs` | `.vue` の「表示」。`frontend_web` の Vite 開発サーバーが起動中の時だけ、その部品を使う画面（ルート）を返す |
| `media-types.mjs` | 「ブラウザ」で再生する音声・動画の拡張子（mp3 / wav / ogg / oga / opus / flac / aac / m4a / mp4 / m4v / webm / mov）。Vue 画面・IDE サーバー・Electron で共用 |
| `web/layout.js` | 名前のハッシュによる球内の固定3D配置・基準視点・回転と平行移動（Vue 画面の `src/components/開発スペース/宇宙描画.js` が取り込む） |
| `web/office.html` / `web/office.js` / `web/office.css` | Word / Excel / PowerPoint / PDF の読み取り専用ビューア |
| `checks/` | 文書APIの自動テストと一時フォルダ用の検証データ生成 |
| `scripts/shot.mjs` | 画面確認用スクリーンショット（ヘッドレス Chrome を DevTools Protocol で操作） |

### server.mjs

- ツリー形式は `{ n: 名前, d: [子フォルダ], f: [[名前, サイズ, 更新ms]] }`。
- `IGNORED`（`node_modules` / `.git` / `dist` / `out` / `build` / `__pycache__` / `.venv` / `venv` / `_cache` など）は走査しない。上限 30000 ファイルで打ち切り、`truncated` を返す。
- 単独起動・全体起動ともポートは固定せず、OS が空きポートを自動割り当てする。明示的な `--port` 指定時だけその番号を優先し、`--strict-port` 併用時は競合で失敗する。
- 接続状態は当該 IDE サーバーの画面間で共有する。オンライン確認はConsoleと同じtoolsのpingを使い、IDE 自体ではAI会話・音声セッションを生成しない。接続先・画面・確認方法は README の「AiDiyへの接続」を参照する。
- `/api/preview?path=` は「表示」の準備。`.html` は `preview.mjs` の URL を返す。静的サーバーは IDE と別ポート（別オリジン）で、URL に起動ごとの token を含め、Host を `127.0.0.1` / `localhost` に限る。HTML には `CSP: sandbox allow-scripts …` を付け、画面側の iframe も `allow-same-origin` なしの sandbox にして、ページのスクリプトを IDE のファイル API から隔離する。`_config`・隠しファイル（`.` 始まり）・鍵らしいファイル・`node_modules`・`.venv`・`.aidiy_backup` は配らない。`/…` 始まりの参照は Referer のページの `public` を根に解決し、Range に対応する。
- `.vue` の「表示」は **AiDiy の `frontend_web/src` の .vue だけ、かつ `frontend_web` の Vite 開発サーバー（`vite.config.ts` の `PORT_WEB`、既定 8090）が起動中の時だけ**。`frontend_web/src/router/` のルート定義（`path` と `component`。日本語の識別子にも対応）と import の関係をたどり、その部品を使う画面の URL を返す。HTTP で見に行くだけで、`frontend_web` の `node_modules` は借りない。他プロジェクト・他フォルダの .vue は理由を表示する。
- `/api/file?path=` はテキスト（先頭 1MB、UTF-8 → Shift_JIS の順に判定）・画像・Office文書・バイナリを判定して返す。`/api/raw` は画像だけを生で返す（SVG は CSP でスクリプトを止める）。`/api/document` は対応するOffice文書・PDFだけを最大50MBまで返す。
- 音声・動画はビューア内で再生せず、ファイルビューアの「ブラウザ」で開く。Electron は AiDiy 保守中（`frontend_web/public/` 内、`frontend_web/vite.config.ts` があり Vite 起動中）なら正式なリンク、それ以外は `file://` で Browser ウィンドウを開く（`デスクトップ/ブラウザ.cjs` の `browserFileTarget`）。Web 版の `/api/preview` は同じ条件で正式なリンク、それ以外（転送経由を含む）は Range 対応の `preview.mjs` の URL を返す。
- 安全策: 相対パスは `realpath` で解決し、作業フォルダの外（`..`・別ドライブ・リンク先）は 404。Host / Origin は localhost と、Codespaces 環境変数から特定した当該転送先だけを許可し、cross-site 要求を拒否する。

### 全体起動での扱い

- IDE群のsetup / cleanupは Console → Code → Live → IDE → Task → Team → Browser。全体startではIDEは既定で起動せず、Task / Team / Browser は独立コマンドから起動する。
- 全体起動ではリポジトリ直下を空きポートで独立起動し、ログをファイルへ保存する。親の終了後も継続し、自動再起動はしない。
- 全体起動の起動前整理・終了・リブートでは IDE とその子孫を停止しない。cleanup 時だけ `kill_ports()` でこの配置先の実行入口を照合して停止する。ポート番号による停止は行わない。

### 画面

画面（宇宙表示・エクスプローラー・ファイルビューア・Code / Live パネル）は `frontend_ide/src/` の Vue 画面です。Electron ウィンドウ・タイトルバー・マイク許可は `frontend_ide/desktop.cjs` と `frontend_ide/デスクトップ/` が担当します。Vue 移行前の Canvas 画面（`web/app.js` など）と Electron 本体（`desktop.cjs` / `preload.cjs`）は削除済みです。

## 参照先

- [共通画面の構成](../AGENTS.md)
- [起動・操作](../README.md)
- [Vue共通画面の変更手順](../../_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md)
- [文書ビューアの確認手順](../../_AIDIY/knowledge/frontend_ide,文書ビューア.md)
- [cleanup後の確認](../../_AIDIY/knowledge/共通,クリーンアップ手順.md)

## Vue共通画面

現行のConsole / Code / Live / IDE / Task / Team / Browserの画面は `frontend_ide` のVue部品を使用します。VS Code拡張はCode / Liveのみ、単独実行は7種類です。エクスプローラーは `ファイル一覧.vue` に集約し、選択と検索マークを宇宙表示へ通知します。既存の `frontend_ide/host` は拡張ホスト・Code/Hermes・Live音声基盤、`frontend_ide/viewer` はファイルAPI・Office表示資産を提供します。旧起動入口からもVue版へ進みます。詳細は `frontend_ide/AGENTS.md` と `_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md` を参照してください。
