# frontend_channels 実装概要

## 役割

外部接続チャンネルを配置するフォルダです。直下が Discord 接続（`aidiy_discord`）、`slack/` が Slack 接続（`aidiy_slack`）です。Slack 版は Discord 版から音声会話を除いた双子のプログラムで、ファイル構成・画面・起動引数・試験をそろえています（詳細は [slack/AGENTS.md](./slack/AGENTS.md)）。片方の画面・起動・停止を変えたら、もう片方の同じ場所も同じように変えてください。

Discord Bot を AiDiy の Code / Live へ接続する Node.js / TypeScript クライアントです。
Code は `aidiy_hermes` CLI を直接起動し、Live は既存 AIコアの WebSocket へ接続します。
接続情報はプロジェクト共通の `_config/AiDiy_key.json` に保存します。

## 構成

| ファイル | 役割 |
|----------|------|
| `src/main.ts` | 起動、設定確認、終了処理 |
| `panel/` | `aidiy_live` に合わせた接続パネル（`desktop.cjs` の Electron 起動・安全な IPC、`launch.mjs` の起動入口、`components/接続/接続パネル.vue` の Vue 画面、`components/接続/パネル状態.js` の状態管理、`components/ライブ/音声表示.js` の円型インジケーター、ブラウザ版用の `web-bridge.js`） |
| `src/接続パネル/パネル操作.ts` | 開始・停止・起動時の自動接続、モデル選択と Live ON/OFF の保存、モニター切替 |
| `src/接続パネル/パネル設定.ts` | `~/.aidiy/aidiy_discord.json`（`live` / `live_models` / `code_name` / `code_model`）の検証・原子的保存・旧3ファイルからの移行 |
| `src/接続パネル/パネル中継.ts` | Electron 版（`src/panel-worker.ts`）とブラウザ版（`src/web-server.ts`）共通のパネル操作・通知の中継 |
| `src/接続/接続設定.ts` | 共通 JSON の読込・検証、パスと接続先の解決 |
| `src/ライブ/ライブモデル候補.ts` / `src/モデル情報/モデル情報.ts` | モデル情報APIを優先し、取得失敗時はdiagのモデル・音声合成JSONを読む。共通初期値の補正 |
| `src/接続/ネットワーク接続.ts` / `src/gateway-worker.mjs` | REST / Gateway / 音声 WebSocket のプロキシ対応 |
| `src/接続/接続エラー.ts` | 接続失敗の段階別案内と、秘密値を伏せたエラー詳細 |
| `src/接続/コマンド処理.ts` | コマンド解析、利用許可、回答分割 |
| `src/接続/Bot接続.ts` | Discord イベント、Code / Live 操作、返信 |
| `src/コード/コード会話.ts` | ユーザー・チャンネルごとの Hermes 会話継続、停止 |
| `src/コード/Hermesモデル.ts` | aidiy_hermes のモデル文字列の検証・候補・Hermes 引数への変換（AIコアと同じ規則）、`code_name` の既定と対応一覧 |
| `src/ライブ/ライブ会話.ts` | ボイスチャンネルと AIコアの双方向中継、切断回収 |
| `src/ライブ/音声処理.ts` | PCM 変換、話者混合、Opus 再生 |
| `src/共通連携/IDE連携.ts` | `frontend_ide/host` の既存 CLI / Live protocol の直接共有 |
| `checks/` | Discord に接続せずに行う動作検証 |
| `_setup.py` | 依存導入と共通設定の不足キー補完 |
| `_start.py` / `launcher.py` | パネル単独起動、PATH コマンド登録、cleanup 用停止 API |
| `_cleanup.py` / `discord_processes.py` | 実行パスによる対象 Bot の停止確認と依存物・キャッシュ削除 |

## 基本方針

- Bot トークン、サーバー・チャンネル・ユーザー ID は `AiDiy_key.json` の `DISCORD_*` を参照する。
- `discord_allowed_user_id`、`discord_text_channel_id`、`discord_voice_channel_id` はそれぞれ単一の文字列で指定し、利用者1人・テキスト1チャンネル・ボイス1チャンネルに限定する。
- Discord 専用設定は接続情報の5項目だけとし、Live は `LIVE_*`、接続先は `PORT_CORE`、Code / Live の作業フォルダは `CODE_BASE_PATH`、Hermes は `CODE_AIDIY_HERMES_MODEL` と `CODE_MAX_TURNS` を共用する。
- `frontend_ide/host/src/runner.ts`、`src/protocol.ts`、`aidiy_live/src/protocol.ts` を再利用し、CLI 実行・通信仕様を複製しない。
- CommonJS の日本語 export は `src/共通連携/IDE連携.ts` の `createRequire` 経由で読み込む。
- Code はシェルを介さず UTF-8 stdin で渡す。`--yolo` を追加しない。
- Discord の受信イベントはサーバー・チャンネル・ユーザーの許可を確認してから処理する。
- 専用テキストチャンネルの通常投稿を Hermes に渡し、同じ会話の連続投稿は送信順に処理する。接頭辞やメンションを必須にしない。
- Live はサーバーにつき1接続。許可ユーザーの入退室に合わせて自動接続・終了し、Bot 起動時にも参加状態を確認する。音声は許可された参加者のみを取り込み、切断時は関連リソースをすべて終了する。
- 設定値や Discord API エラーオブジェクト全体をログに出さない。
- Bot は `tsx` で起動し、VSIX を必要としない。Vue 画面は事前コンパイル済み `panel/view.js` を同梱し、通常起動時のビルドを前提にしない。ソースと配布物の一致は `scripts/verify-panel.mjs` で確認する。
- `aidiy_discord` は画面中央上部に小さなパネルを開き、前回のモデルで自動接続する（`--no-connect` で未接続）。初回（`aidiy_discord.json` が未保存）は自動接続せずモデル設定画面から始め、Live の初期値は OFF（`パネル操作.ts` の `設定済み` / `自動開始`、起動時の要求は `auto-start`）。切断・接続失敗ではモデル選択の画面に戻る。ルート `_start.py` の Discord 選択は既定 No とし、Yes の場合も同じく自動接続する。停止・終了はパネルから操作できる。
- 画面下部は aidiy_code / aidiy_live と同じ「モデル ▾」と現在のモデル表示。接続中に押すと設定を開き、「適用して再接続」で切断・保存・再接続する（`panel/components/接続/パネル状態.js` の `モデル設定` / `設定適用` / `設定取消`）。
- パネルの選択は `~/.aidiy/aidiy_discord.json` の1ファイル（`live` / `live_models` / `code_name` / `code_model`）に保存し、両方の起動方法で共通設定より優先する（`src/接続パネル/パネル設定.ts`。旧形式の3ファイルは初回に移して削除）。Slack 版の `aidiy_slack.json` と同じ作り。`code_name` は将来の別スタンドアロンハーネス用で、現在は `aidiy_hermes` だけを実行する（ない保存は読込時に書き足し、未対応の値では接続しない）。
- コードは aidiy_hermes 固定で、モデルは1つの文字列（`auto` / `same` / `codex_cli/same` / `openai_oauth/gpt-…`）。Hermes への引数は AIコア（`AIコード_cli.py`）と同じ規則で `src/コード/Hermesモデル.ts` の `Hermes会話引数` が作る。未保存時の初期表示は `CODE_AIDIY_HERMES_MODEL`。
- 接続中（接続処理中・再接続待ちを含む）に閉じると `panel/desktop.cjs` が終了を確認する。切断中はそのまま終了する。
- Live の ON/OFF は `aidiy_discord.json` の `live`（未保存時は OFF）に保存し、Bot へは `Discord設定.liveEnabled` / `codeEnabled` で渡す。Code は現在 ON 固定（`src/接続パネル/パネル操作.ts` の `コード固定ON`）。OFF の機能は接続前の確認も Bot 側の処理も行わず、両方 OFF では接続しない。
- 接続中のパネルへは音量と帯域分布だけを送る。PCM は「モニター」を ON にした間だけ渡し、モニターは接続ごとに OFF から始める（スピーカー音のエコー防止）。
- Renderer は sandbox と contextIsolation を有効にし、Node API やトークンを渡さない。パネル終了時は worker 内の Code / Live 接続も回収する。

導入・操作は [README.md](./README.md)、変更と検証は [接続機能の変更手順](../_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md) を参照してください。
