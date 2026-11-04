# frontend_channels/slack 実装概要

## 役割

Slack Bot を AiDiy の Code へ接続する Node.js / TypeScript クライアントです。`aidiy_slack` コマンドで接続パネルを開きます。
Discord 版（`frontend_channels/`）から音声会話（Live）を除いた**双子のプログラム**で、ファイル構成・画面・起動引数・試験をそろえています。
違うのは接続部品（Slack Web API の定期取得）とモデル設定（コードのみ）だけです。
Code は `aidiy_hermes` CLI を直接起動します。接続情報はプロジェクト共通の `_config/AiDiy_key.json` に保存します。

## 構成（Discord 版との対応）

| ファイル | 役割 | Discord 版の対応先 |
|----------|------|------|
| `src/main.ts` | 設定確認（`--check`）と Bot だけの前面実行（`npm run bot`） | `src/main.ts` |
| `panel/` | 接続パネル（`desktop.cjs` の Electron 起動・安全な IPC、`launch.mjs` の起動入口、`components/接続/接続パネル.vue` の Vue 画面、`components/接続/パネル状態.js` の状態管理、ブラウザ版用の `web-bridge.js`）。音声表示・モニターは持たない | `panel/` |
| `src/接続パネル/パネル操作.ts` | 開始・停止、モデルの保存（`パネル設定.ts`：`aidiy_slack.json`）、再接続表示 | `src/接続パネル/パネル操作.ts` |
| `src/接続パネル/パネル中継.ts` | Electron 版（`src/panel-worker.ts`）とブラウザ版（`src/web-server.ts`）共通の操作・通知の中継 | 同名 |
| `src/接続/接続設定.ts` | 共通 JSON の読込・検証、パスと AIコア接続先の解決 | 同名 |
| `src/接続/ネットワーク接続.ts` | Slack Web API の HTTPS 呼出（プロキシ・429 再試行・終了） | 同名（Discord は Gateway / 音声 WSS） |
| `src/接続/コマンド処理.ts` | コマンド解析、利用許可、ts 比較、本文の復元・エスケープ・分割 | 同名 |
| `src/接続/Bot接続.ts` | 定期取得（`conversations.history` / `replies`）、スレッド返信、パネルへの発言通知 | 同名（Discord はイベント受信） |
| `src/モデル情報/モデル情報.ts` | AIコアのモデル情報APIからコード候補を取得（Live 候補は扱わない） | 同名 |
| `src/接続パネル/パネル設定.ts` | `~/.aidiy/aidiy_slack.json`（`code_name` / `code_model`）の検証・原子的保存・旧形式からの移行 | 同名（Discord は Live の項目も持つ） |
| `src/コード/コード会話.ts` | スレッドごとの Hermes 会話継続、停止 | 同名 |
| `src/コード/Hermesモデル.ts` | aidiy_hermes のモデル文字列の検証・候補・Hermes 引数への変換、`code_name` の既定と対応一覧 | 同名（内容も同一） |
| `src/共通連携/IDE連携.ts` | `frontend_ide/host` の CLI 実行・接続元許可の直接共有 | 同名 |
| `checks/` | Slack に接続せずに行う動作検証（Discord 版と同じ試験名・観点） | `checks/` |
| `_setup.py` / `_start.py` / `_cleanup.py` / `launcher.py` / `slack_processes.py` | 依存導入、パネル起動、PATH 登録、停止照合・削除 | `_setup.py` ほか / `discord_processes.py` |

## 基本方針

- Bot トークン、ワークスペース・チャンネル・ユーザー ID は `AiDiy_key.json` の `slack_*` を参照する。`slack_app_token`（Socket Mode）は使わない。
- VPN・社内プロキシで WebSocket が通らない環境を考慮し、外向き HTTPS の Web API だけで送受信する。新規投稿へスレッドで返信し、スレッド内の続きを同じ Hermes 会話として継続する。
- Discord 版と同じく `frontend_ide/host` の実装を共有し、Discord 側（`frontend_channels/src`・`panel`）の部品は読み込まない（`checks/layout.test.ts` で確認）。
- `aidiy_slack` は画面中央上部に小さなパネルを開き、前回のモデルで自動接続する（`--no-connect` で未接続）。初回（`aidiy_slack.json` が未保存）は自動接続せずモデル設定画面から始める（`パネル操作.ts` の `設定済み` / `自動開始`、起動時の要求は `auto-start`。Discord 版と同じ）。切断・接続失敗ではモデル選択の画面に戻る。起動引数は `aidiy_discord` と同じ（`--project` / `--browser` / `--check` / `--connect` / `--no-connect` / `--wait` / `--help`）。
- 画面下部は aidiy_code と同じ「モデル ▾」と `AI - モデル` の表示。接続中に押すと設定を開き、「適用して再接続」で切断・保存・再接続する。
- モデルの選択は `~/.aidiy/aidiy_slack.json`（`code_name` / `code_model`）の1ファイルに保存する（旧 `aidiy_slack_code_model.json` は初回に移して削除）。`code_name` は将来の別スタンドアロンハーネス用で、現在は `aidiy_hermes` だけを実行する（ない保存は読込時に書き足し、未対応の値では接続しない）。コードは aidiy_hermes 固定で、引数への変換は `src/コード/Hermesモデル.ts`（Discord 版と同一）。未保存時の初期表示は `CODE_AIDIY_HERMES_MODEL`。接続中に閉じると `panel/desktop.cjs` が終了を確認し、切断中はそのまま終了する。単一起動ロックは 18096（Discord は 18095）。起動ログは配置先リポジトリの `temp/aidiy_slack/`。
- パネルの回答者名は「AiDiy」、投稿者名は「あなた」（`users:read` 権限を求めない）。
- 設定値や Slack API のエラーオブジェクト全体をログに出さない。案内には Slack のエラーコードだけを使う。
- Vue 画面は事前コンパイル済み `panel/view.js` を同梱し、`scripts/verify-panel.mjs` でソースと配布物の一致を確認する。

## 双子の保守

画面・起動・停止・セットアップを変える場合は、Discord 版の同じファイルも同じように変えてください。対応表は上の「構成」です。
Slack 固有の差分は `src/接続/`（通信・Bot）、`src/モデル情報/`（コードのみ）、`panel/components/接続/パネル状態.js` の Live 関連の削除、`style.css` の音声表示の削除に限ります。

導入・操作は [README.md](./README.md)、Discord 版は [../AGENTS.md](../AGENTS.md) を参照してください。
