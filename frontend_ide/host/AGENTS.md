# frontend_ide/host 実装概要

## 本書の目的

このファイルは `frontend_ide/host` の構成、設計方針、主要な実装入口を示す概要ドキュメントです。
導入、変更、検証、VSIX 配布、トラブル対応などの HowTo は `README.md` と `_AIDIY/knowledge` に置きます。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。

## HowTo 参照先

| 目的 | 参照先 |
|------|--------|
| Code の利用方法、設定、対応範囲 | [`README.md`](./README.md) |
| Live の利用方法、設定、検証 | [`aidiy_live/README.md`](./aidiy_live/README.md) |
| 実装変更、検証、VSIX 配布 | [`../../_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md`](../../_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md) |
| プロジェクト全体のセットアップ | [`../../_AIDIY/knowledge/共通,開発環境運用手順.md`](../../_AIDIY/knowledge/共通,開発環境運用手順.md) |
| 拡張機能と生成物のクリーンアップ | [`../../_AIDIY/knowledge/共通,クリーンアップ手順.md`](../../_AIDIY/knowledge/共通,クリーンアップ手順.md) |
| Hermes の Provider / モデル選択 | [`../../_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md`](../../_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md) |
| Discord / Slack Bot からの共有利用 | [`../../frontend_channels/AGENTS.md`](../../frontend_channels/AGENTS.md)、[`../../_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md`](../../_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md) |
| Hermes の Windows 対応 | [`../../_AIDIY/knowledge/command_hermes,Windows対応規則.md`](../../_AIDIY/knowledge/command_hermes,Windows対応規則.md) |

## 概要

`frontend_ide/host` は Code / Live の2つの独立した VS Code 拡張とスタンドアロンを提供します。Code（`aidiy.aidiy-code`）と Live（`aidiy.aidiy-live`）は既存 AIコアへ接続します。Code は `AIコード.vue` と同じ Code CLI・モデルを選択します。拡張 ID、ビュー、設定、配布物を分け、片方を無効にしても他方が動作する構成です。

通常の VS Code 拡張モードに加え、同じ Webview と AIコア接続層を使う `aidiy_code/` のスタンドアロンを持ちます。コード版の表示名は `AiDiy Code`、ライブ会話版の表示名は `AiDiy Live` です。

さらに Code / Live は、開発スペース（宇宙をテーマにした IDE 開発環境、AiDiy IDE）の部品としても動作します。IDE から同じプロジェクト・利用モード・セッションで呼び出され、VS Code 拡張・単独起動版とあわせて3つの使い方を持ちます。

`aidiy_live/` は Live 拡張とスタンドアロンの共通画面・音声処理を持ちます。拡張ホスト側で REST / WebSocket と Windows マイクを扱い、Webview へ渡します。マイク補助は Python 標準ライブラリだけを使います。利用・検証方法は [`aidiy_live/README.md`](./aidiy_live/README.md) を参照してください。

`frontend_channels`（`aidiy_discord`）と `frontend_channels/slack`（`aidiy_slack`）は、本フォルダの `src/runner.ts`、`src/protocol.ts`、`src/forwarded-origin.ts`（Discord は `aidiy_live/src/protocol.ts` と `aidiy_live/src/model-catalog.ts` も）と、`scripts/` の起動規則（`launch-project.mjs`・`single-instance.cjs`・`window-size.cjs`・`window-opening.cjs`）をビルドせず直接読み込み、同じ Code / Live を利用します。コードは aidiy_hermes 固定で、モデルの保存とモデル候補は各アプリ側（`aidiy_discord.json` / `aidiy_slack.json`、AIコアのモデル情報API）で扱います。

## 技術スタック

- TypeScript。
- VS Code Extension API / Webview API。
- Node.js `child_process` / `http`。
- Electron（単独起動のフレームレスウィンドウ）。
- Web Audio API / AudioWorklet（Live の音声入出力）。
- Python 標準ライブラリ `ctypes` / WinMM（Live 拡張の Windows マイク入力）。
- esbuild。
- `@vscode/vsce`。
- markdown-it。

## 基本方針

- Code / Live の `extensionKind` はどちらも `workspace` とし、配置・解除対象を同じ実行環境に揃える。リモート接続では接続先の拡張ホストで動作し、Live の Windows マイク入力は Windows の拡張ホストでのみ使う。
- 拡張バージョンは、固定解除の明示的な指示があるまで `0.1.0` を維持する。
- ワークスペースを信頼済みの場合だけ、Code の CLI 実行・コード添付と、Live のマイク入力・AIコア接続を許可する。
- 直接CLIを使う対話CLI・Discord・Slackでは `shell: false` と UTF-8 の標準入力を維持する。
- 拡張側から `--yolo` を付与せず、Hermes 側の承認・ツール設定を維持する。
- Code の AIコア接続と Webview 中継では、既存の `AIコード.vue` / `AIコード.py` / `AIコード_cli.py` と同じメッセージ識別子を使う。
- Live は既存 AIコアの WebSocket（`/core/ws/AIコア`）とモデル情報 API をそのまま使い、拡張専用の API を追加しない。
- `src/runner.ts`、`src/protocol.ts`、`aidiy_live/src/protocol.ts`、`src/model-preferences.ts`、`scripts/model-catalog.py` は `frontend_channels` と共有する。export 名や引数を変える場合は `frontend_channels/src/共通連携/IDE連携.ts` と利用箇所を合わせて更新する。
- HTML を含む Markdown は無効化し、外部画像や任意の command URI を回答から実行しない。
- Windows デスクトップ版 VS Code を主対象とする。Codespaces のブラウザ版ではリモートの Node.js 拡張ホストを使う。Live 拡張のマイク入力は Windows のローカルホストで扱い、Codespaces では単独ブラウザ版を使う。リモートホストの Live 接続先はそのホストの AIコアとなる。仮想ワークスペースと、リモート拡張ホストのない Web 版は対象外。

## ファイル構成

| パス | 役割 |
|------|------|
| `package.json` | 拡張 ID、ビュー、コマンド、設定、ビルド / 配布スクリプト |
| `src/extension.ts` | 拡張のエントリ、WebviewView、会話状態、VS Code コマンド、モデル選択 |
| `src/code-connection.ts` | AIコアの入力・コード出力接続、モデルAPI、接続状態、再接続 |
| `src/runner.ts` | 対話CLI・Discord・Slack用のCLI解決と実行 |
| `src/protocol.ts` | AIコード互換 packet と開始・進捗・終了・回答の変換 |
| `src/stream-control.ts` | STX / ETX / CAN 制御コードの判定と表示用除去 |
| `src/model-preferences.ts` | Code / Live の最終手動モデルを `~/.aidiy/aidiy_*_model.json` へ読込・保存（Live bundle にも内包） |
| `src/vscode-html.ts` | Webview に frontend_ide の Vue 画面（`dist/development`）を読み込む HTML |
| `aidiy_code/src/server.ts` | IDE / 単独起動の Vue 画面が使う localhost HTTP / SSE の API サーバー（画面は返さない） |
| `media/` | 拡張アイコンと、Vue 画面へ同梱する送信・停止ボタン画像 |
| `scripts/model-catalog.py` | Hermes 既存 picker から Provider / モデル候補を取得 |
| `aidiy_code/launch.mjs` | 作業フォルダから frontend_ide の Code 画面を起動する。`--browser` ではブラウザで開く |
| `scripts/build.mjs` | Code 拡張・API サーバーの bundle と第三者ライセンス生成。続けて `aidiy_live/build.mjs` で Live、frontend_ide の Vue 画面も生成 |
| `scripts/package.mjs` | Code / Live の 2 つの VSIX を `dist/` へ生成 |
| `scripts/vscode_extensions.py` / `scripts/standalone_processes.py` | セットアップ・クリーンアップ共通の `aidiy-*` 拡張解除と、この作業コピーの単独起動プロセス停止 |
| `checks/` | CLI 実行、protocol、停止、API サーバー、起動、拡張の Node.js テスト（`npm test`）と、セットアップ・クリーンアップ・モデル候補の Python テスト。Live のテストは `aidiy_live/checks/`（`npm run live:test`） |
| `aidiy_live/` | Live 拡張（`package.json` を別に持つ）、AudioWorklet 音声処理、localhost 通信中継、Windows マイク補助 |
| `aidiy_code.cmd` / `aidiy_live.cmd` | 単独起動の入口 |
| `_setup.py` / `_cleanup.py` | 依存・Electron の準備、VSIX の生成・配置、`aidiy_code` / `aidiy_live` ランチャーの作成と、拡張・単独起動プロセス・ランチャー・生成物の解除 |
| `launch-extension-dev.ps1` | Code / Live を読み込んだ VS Code 開発ホストの Windows 起動入口 |
| `scripts/test-extension-host.ps1` | 実 VS Code の拡張ホストで Code / Live の登録・起動を確認する（`-Scenario Both` / `Code` / `Live`） |

## 実行フロー

1. `extension.ts` または `aidiy_code/src/server.ts` が対象フォルダ・会話・モデル・添付コードを管理する。
2. `src/code-connection.ts` が Live と共通のローカル接続先を解決し、入力・コード出力ソケットとモデルAPIを管理する。
3. 送信・停止はAIコアへ渡し、frontend_ide の Vue 画面（`src/components/コード/`）が進捗・正式回答と接続状態を表示する。

画面は VS Code の Webview・単独起動・IDE とも frontend_ide の Vue 画面だけです。単独起動・IDE では `aidiy_code/src/server.ts` が VS Code API の代わりに HTTP / SSE の API を提供し、接続層を共用します。

AiDiy IDE はCode / Liveの単独サーバーと画面を同一公開元への中継で埋め込みます。Codeの `lockedMode` 起動オプションは、IDEの利用モードを維持し、サーバー寿命を親のIDEに委ねます。未指定の単独版の動作は従来どおりです。

Live の画面は frontend_ide の Vue 画面（`src/components/ライブ/`）で、音声処理は `aidiy_live/src/audio.ts`・`visualizer.ts` を共用します。VS Code 拡張では `host.ts`（拡張ホスト）が AIコアの WebSocket、モデル情報 API、Windows マイク（`microphone.py`）を扱い、Webview へ中継します。単独起動では `src/server.ts` の localhost 中継が同じ役割を担います。接続時は input / 0 / audio の 3 本の WebSocket を開き、`connect` パケットで作業フォルダ（`CODE_BASE_PATH`）と選択したモデル設定を渡します。

## 接続と会話

- Code は input／1、Live は input／0／audio のソケットを使う。
- Code のコードAIとモデルはAIコアのモデル情報APIから取得し、接続中のセッションへ反映する。
- Code は通信切断時に約10秒間隔で再接続する。明示的な切断・破棄は再試行を止める。
- Code の会話履歴は作業フォルダ別に管理し、AIコアのセッションIDで再開する。保存先はプロジェクトの `_AIDIY/aidiy_code/histories/<会話ID>.json`（`src/conversation-store.ts`）で、拡張・単独起動版・開発スペースが同じ形式で共用する。応答の途中経過ごとに書かないよう0.5秒まとめて書き、終了時に書き出す。拡張の旧 `workspaceState` 履歴は開いたフォルダへ移し、テストは一時フォルダへ書く（作業フォルダの `_AIDIY` に書かない）。旧Hermesの表示履歴は保持するが、CLIセッションIDをコアへ渡さない。
- 最終手動モデルは `~/.aidiy/aidiy_code_model.json` で拡張・単独画面共通に保存する。
- `src/runner.ts` と `src/protocol.ts` は引き続き Discord・Slack の直接CLI実行と対話CLIを支える。

## セキュリティ境界

- Webview は nonce 付き CSP とローカル resource root を使う。
- 回答内リンクは `http` / `https` だけを外部ブラウザで開く。
- 選択コードは 80,000 文字、要求本文は 200,000 文字、回答表示は 2,000,000 文字を上限とする。
- 単独起動のサーバー（Code / Live）は `127.0.0.1` のランダムポートとランダム path で待ち受け、Host / Origin / Content-Type を検証する。
- Live の中継（拡張ホスト・単独サーバー）は `/core/ws/AIコア` とモデル情報の取得 / 設定 API だけを通し、REST の要求本文は 64KB までに制限する。拡張ホストが同時に開く WebSocket は 3 本までとする。
- 専用ウィンドウは Node integration を無効、context isolation と sandbox を有効にする。Live のマイク許可は専用画面のメインフレームの音声入力だけに限定する。
- 停止時は Windows では `taskkill /T /F`、その他では process group へ signal を送り、子孫プロセスも終了対象にする。

## 実装時の入口

- VS Code のビュー、コマンド、設定を変える場合は `package.json` と `src/extension.ts` をセットで見る。
- CLI の探索、引数、標準入出力、停止を変える場合は `src/runner.ts` と `checks/runner.test.cjs` をセットで見る。
- packet を変える場合は `src/protocol.ts` と既存 AIコード実装との互換性を確認する。
- チャット UI を変える場合は frontend_ide の Vue 画面（`src/components/コード/`・`src/components/共通表示/`）を変更し、拡張の Webview・単独起動・IDE の 3 つで同じ画面になることを確認する。
- Code のコードAI／モデル候補を変える場合は `src/code-connection.ts` とAIコアのモデル情報APIを確認する。Discord・Slack の aidiy_hermes モデル候補は AIコアのモデル情報API（`code_models.aidiy_hermes`）を優先し、停止中は `_AIDIY/aidiy_diag/code_models_info.json` を読む（各アプリの `src/components/コード/Hermesモデル.ts`）。
- モデル選択の保存・復元を変える場合は `src/model-preferences.ts` と、Code / Live それぞれの拡張・単独起動の読込箇所をセットで見る。
- Live の画面を変える場合は frontend_ide の Vue 画面（`src/components/ライブ/`）、音声を変える場合は `aidiy_live/src/audio.ts`・`visualizer.ts`・`aidiy_live/media/capture.js` をセットで見る。
- Live の通信を変える場合は、拡張ホスト（`aidiy_live/src/host.ts`）と単独起動の中継（`aidiy_live/src/server.ts`）の許可範囲を揃える。
- 具体的な変更手順と検証項目は `_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md` を参照する。

## Vue共通画面

現行のConsole / Code / Live / IDE / Task / Team / Browserの画面は `frontend_ide` のVue部品を使用します。VS Code拡張はCode / Liveのみ、単独実行は7種類です。エクスプローラーは `ファイル一覧.vue` に集約し、選択と検索マークを宇宙表示へ通知します。既存の `frontend_ide/host` は拡張ホスト・Code/Hermes・Live音声基盤、`frontend_ide/viewer` はファイルAPI・Office表示資産を提供します。旧起動入口からもVue版へ進みます。詳細は `frontend_ide/AGENTS.md` と `_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md` を参照してください。
