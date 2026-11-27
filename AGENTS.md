# プロジェクト全体方針 (AGENTS.md)

## 本書の目的

このファイルは **AiDiy プロジェクト全体の重要事項と、各サブシステムの文書への入口** です。
サブシステムごとの実装概要は各フォルダの `AGENTS.md`、起動・追加・検証・トラブル対応などの HowTo は `_AIDIY/knowledge/` に置きます。

本書は日本語で分かりやすく記載し、重要事項と入口だけに保ちます。AI エージェントは、本書に個別手順・サブシステムの詳細・一時的な作業メモを追記しないでください（追記先は各フォルダの `AGENTS.md` か `_AIDIY/knowledge/`）。

## 重要事項

- 著作権・利用条件の正本は [LICENSE](./LICENSE)。既存の著作権表示を維持し、第三者資材の LICENSE / NOTICE を AiDiy 独自の表記で置き換えない。
- 画面、URL、JSONキー、識別子は日本語を原則とする。DB項目名、API項目名、フロントエンド変数名はできるだけ一致させる。`request`、`query`、`item`、`items`、`total`、`limit` などの一般名は英字のままでよい。
- 文字コードは UTF-8 固定。ファイル内容も UTF-8 指定で読む。
- 実装を確認するときは、該当フォルダの `AGENTS.md` を確認したうえで実際のコードを優先する。docs と実装が食い違う場合は、現行実装を確認して「現行実装では」と明記する。
- DB は現行スキーマでの新規作成が前提。破壊的なスキーマ変更は該当 DB のファイル名を `_vyyyymmdd.db` で更新する。旧テーブル・旧カラムの自動移行や互換フォールバックは行わず、アプリ起動やコード検証で既存 DB を削除・再構築しない（再作成は利用者が手動で行う）。
- `npm run build` は日常的な確認手順に含めない。配布物作成、ビルド成果物確認、利用者の明示依頼など、実行理由が明確な場合だけ実行する。
- `.aidiy_backup/` は `aidiy_backup` MCP の差分バックアップ出力先で、ソースではない。編集・参照の対象にしない。

## HowTo の参照先

ファイル操作や実装作業を伴う場合は、まず [`_AIDIY/knowledge/_index.md`](./_AIDIY/knowledge/_index.md) を確認してください。業務システム機能追加は `docs/` の開発ガイドを優先し、コアシステム機能調整は `_AIDIY/knowledge/_index.md` を入口にします。

| 目的 | 参照先 |
|------|--------|
| 起動、依存関係、DB、API確認、よくある問題 | [`共通,開発環境運用手順.md`](./_AIDIY/knowledge/共通,開発環境運用手順.md) |
| Backend API / DB 追加、スキーマ変更、設定管理 | [`backend_server,M系マスタ追加手順.md`](./_AIDIY/knowledge/backend_server,M系マスタ追加手順.md) ほか T系・V系・S系の追加手順、[`backend_server,スキーマ変更手順.md`](./_AIDIY/knowledge/backend_server,スキーマ変更手順.md)、[`backend_server,設定管理(conf).md`](<./_AIDIY/knowledge/backend_server,設定管理(conf).md>) |
| frontend_web 画面追加・Router・Store | [`frontend_web,画面追加手順.md`](./_AIDIY/knowledge/frontend_web,画面追加手順.md)、[`frontend_web,Vue Routerパターン.md`](./_AIDIY/knowledge/frontend_web,Vue Routerパターン.md)、[`frontend_web,Pinia Storeパターン.md`](./_AIDIY/knowledge/frontend_web,Pinia Storeパターン.md) |
| frontend_avatar / Electron / VRM / 音声 | [`frontend_avatar,ElectronIPC追加手順.md`](./_AIDIY/knowledge/frontend_avatar,ElectronIPC追加手順.md)、[`frontend_avatar,VRM_VRMA追加手順.md`](./_AIDIY/knowledge/frontend_avatar,VRM_VRMA追加手順.md)、[`backend_server,frontend_avatar,AI音声処理.md`](./_AIDIY/knowledge/backend_server,frontend_avatar,AI音声処理.md) |
| frontend_ide の Vue 共通画面（IDE / Term / Navi / Code / Live ほか） | [`frontend_ide,Vue共通画面変更手順.md`](./_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md) |
| VS Code 拡張（Code / Live） | [`frontend_ide,VSCodeチャット拡張変更手順.md`](./_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md) |
| frontend_diag / 環境診断・付箋メモ | [`frontend_diag,環境診断運用.md`](./_AIDIY/knowledge/frontend_diag,環境診断運用.md) |
| Discord・Slack | [`frontend_channels,Discord接続変更手順.md`](./_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md) |
| AI コア / Code CLI / MCP | [`AIコアWebSocket仕様.md`](./_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md)、[`CodeCLI追加手順.md`](./_AIDIY/knowledge/共通,CodeCLI追加手順.md)、[`MCP活用手順.md`](./_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md) |
| Hermes の Provider / Slash Command、Pi の AiDiy 連携 | [`command_hermes,Provider一覧と選択ロジック.md`](./_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md)、[`command_hermes,Slash Command一覧.md`](./_AIDIY/knowledge/command_hermes,Slash Command一覧.md)、[`command_pi,AiDiy連携.md`](./_AIDIY/knowledge/command_pi,AiDiy連携.md) |
| GitHub issue 運用 | [`共通,GitHubIssue運用手順.md`](./_AIDIY/knowledge/共通,GitHubIssue運用手順.md) |

`_AIDIY/knowledge` は作業ログ置き場ではありません。残す内容は、次回以降に再利用できる HowTo、判断基準、注意点、確認方法だけです。

## AiDiy とは

**AiDiy** (AI Do-It-Yourself) は、日本語を第一言語とするフルスタック業務管理システムの開発フレームワーク / テンプレートです。日本語ネイティブな開発環境、FastAPI + SQLite + Vue 3 の業務管理テンプレート（権限・マスタ・トランザクション・スケジューラ・在庫管理の実装例）、マルチベンダー AI・音声・画像・Code CLI・MCP を統合する実験基盤を提供します。

全レイヤーで日本語識別子を使い、日本語話者が業務ドメインとコードを直接対応づけられることを優先します。

| レイヤー | 例 |
|----------|----|
| Database | テーブル名 `C権限`、カラム名 `利用者ID` |
| API | `/core/利用者/一覧`、`{"利用者名": "admin"}` |
| Frontend | `C利用者一覧.vue`、`/C管理/C利用者/一覧` |

## サブシステムと詳細文書

常駐バックエンド 5 つ、on-demand の CLI 基盤 3 つ（Hermes / Pi / Codex）、各フロントエンドで構成します。各行の詳細は「詳細」列の文書を参照してください。

| コンポーネント | 役割 | ポート | 詳細 |
|----------------|------|--------|------|
| `frontend_diag` | 環境診断・設定・導入・サービス起動管理（`aidiy_diag`）、付箋メモ（`aidiy_memo`） | 自動・loopback | [AGENTS.md](./frontend_diag/AGENTS.md) |
| `backend_server` core / apps | core: C系・対応V系・A系・認証・AIコア／apps: M系・T系・V系・S系 | 8091 / 8098 | [AGENTS.md](./backend_server/AGENTS.md) |
| `backend_tools` | MCP サーバー群（Windows 21 個・Linux / macOS 20 個）と OpenAI / Ollama 互換 Chat Completions | 8095 | [AGENTS.md](./backend_tools/AGENTS.md) |
| `backend_local` | ローカル LLM（OpenAI 互換 Gemma 推論） | 8096 | [AGENTS.md](./backend_local/AGENTS.md) |
| `backend_taskteam` | AIタスク実行・定期タスク・複数AIエージェントのチーム活動 | 8093 | [AGENTS.md](./backend_taskteam/AGENTS.md) |
| `command_hermes` | `aidiy_hermes` CLI 基盤 | 常駐なし | [AGENTS.md](./command_hermes/AGENTS.md) |
| `command_pi` | `aidiy_pi` CLI 基盤（MIT の Pi を同梱。AiDiy 独自部分は `command_pi/aidiy/`） | 常駐なし | [AiDiy連携](./_AIDIY/knowledge/command_pi,AiDiy連携.md)、[AGENTS.md](./command_pi/AGENTS.md)（Pi 本体の開発規則） |
| `command_codex` | `aidiy_codex` CLI 基盤（Apache-2.0 の Codex を内包し、`_compile.py` でコンパイルして `~/.aidiy/bin` に配置） | 常駐なし | [AGENTS.md](./command_codex/AGENTS.md)、[変更点と最新版再移行要点](./command_codex/変更点と最新版再移行要点.md) |
| `frontend_web` | 通常 Web UI（Vue 3 + Vite + TypeScript） | 8090 | [AGENTS.md](./frontend_web/AGENTS.md) |
| `frontend_avatar` | Electron / Web デュアルモードの AI Avatar | 8092 | [AGENTS.md](./frontend_avatar/AGENTS.md) |
| `frontend_ide` | IDE / Term / Browser / Navi / Code / Live / Task / Team / CPU の共通 Vue 画面と単独起動 | 自動 | [AGENTS.md](./frontend_ide/AGENTS.md)、[host](./frontend_ide/host/AGENTS.md)（VS Code 拡張 Code / Live）、[viewer](./frontend_ide/viewer/AGENTS.md)（ファイルAPI・Office表示） |
| `frontend_channels` | Discord（Hermes / Pi チャット・AIコア Live 音声）と Slack（双子、音声なし）の任意起動 Bot | 待受なし | [AGENTS.md](./frontend_channels/AGENTS.md)、[discord](./frontend_channels/discord/AGENTS.md)、[slack](./frontend_channels/slack/AGENTS.md) |

Core / TaskTeam と Apps は別々の SQLite DB を使用し、現行ファイル名は `scripts/業務DB.json` で管理します。frontend_web は Vite proxy で `/core/*` を 8091、`/apps/*` を 8098 へ振り分け、Task / Team の `/task/*`・`/team/*` は 8093 へ接続します。

その他のフォルダ：`_config/`（API キー・AI モデル・MCP などの共通設定）、`_data/`（共通 SQLite DB などの永続データ）、`_icons/`（共通アイコン）、`docs/`（開発ガイド・セルフテスト）、`_AIDIY/knowledge/`（HowTo と再利用ナレッジ）、`scripts/`（補助スクリプト）、`docker/`（Docker + nginx 構成）。最小入口は [_AIDIY.md](./_AIDIY.md) と [CLAUDE.md](./CLAUDE.md)、人間向けの紹介資料は [X自己紹介](./frontend_web/public/X自己紹介/index.html) です。

## 業務システムの設計要点

- テーブルは接頭辞で種別を分ける：`C`（Core / Common）、`M`（Master）、`T`（Transaction）、`V`（View endpoint）、`S`（Scheduler / Special）、`A`（AI / Advanced）、`X`（Experimental）。`V` 系は DB VIEW を作らず、Router の生 SQL で JOIN / 集計する。
- API は POST 中心で、レスポンスは `status`・`message`・`data` の統一形式。Core は `/core/*`、Apps は `/apps/*`、認証は JWT。
- DB は SQLite。Alembic は使わない。採番は `C採番` で管理し AUTOINCREMENT を前提にしない。全テーブルが登録 / 更新の監査フィールドを持つ。
- ヘッダーと明細を単一テーブルで持つ明細型（`明細SEQ=0` がヘッダー）を使う。

提供機能・業務サンプル・明細型の詳細とAIコアの設定キーは [backend_server/AGENTS.md](./backend_server/AGENTS.md)、スキーマ変更の手順は [`backend_server,スキーマ変更手順.md`](./_AIDIY/knowledge/backend_server,スキーマ変更手順.md) を参照してください。
