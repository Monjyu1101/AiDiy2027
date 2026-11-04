# プロジェクト全体方針 (AGENTS.md)

## 本書の目的

このファイルは **AiDiy プロジェクト全体の実装概要、基本方針、アーキテクチャ概要** を示す入口ドキュメントです。
具体的な起動手順、追加手順、検証手順、トラブル対応などの HowTo は `_AIDIY/knowledge/` に集約します。

本書は日本語で分かりやすく記載します。追記時も同じ方針を維持してください。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。

## HowTo の参照先

ファイル操作や実装作業を伴う場合は、まず `_AIDIY/knowledge/_index.md` を確認してください。
業務システム機能追加は `docs/` の開発ガイドを優先し、コアシステム機能調整は `_AIDIY/knowledge/_index.md` を入口にします。

| 目的 | 参照先 |
|------|--------|
| ナレッジ全体の入口 | [`_AIDIY/knowledge/_index.md`](./_AIDIY/knowledge/_index.md) |
| 起動、依存関係、DB、API確認、よくある問題 | [`_AIDIY/knowledge/共通,開発環境運用手順.md`](./_AIDIY/knowledge/共通,開発環境運用手順.md) |
| Backend API / DB 追加 | [`_AIDIY/knowledge/backend_server,M系マスタ追加手順.md`](./_AIDIY/knowledge/backend_server,M系マスタ追加手順.md)、[`_AIDIY/knowledge/backend_server,T系トランザクション追加手順.md`](./_AIDIY/knowledge/backend_server,T系トランザクション追加手順.md)、[`_AIDIY/knowledge/backend_server,V系エンドポイント追加手順.md`](./_AIDIY/knowledge/backend_server,V系エンドポイント追加手順.md)、[`_AIDIY/knowledge/backend_server,S系スケジューラ追加手順.md`](./_AIDIY/knowledge/backend_server,S系スケジューラ追加手順.md) |
| スキーマ変更 | [`_AIDIY/knowledge/backend_server,スキーマ変更手順.md`](./_AIDIY/knowledge/backend_server,スキーマ変更手順.md) |
| 設定管理 (conf/) | [`_AIDIY/knowledge/backend_server,設定管理(conf).md`](<./_AIDIY/knowledge/backend_server,設定管理(conf).md>) |
| frontend_web 画面追加 | [`_AIDIY/knowledge/frontend_web,画面追加手順.md`](./_AIDIY/knowledge/frontend_web,画面追加手順.md) |
| frontend_web Router / Store パターン | [`_AIDIY/knowledge/frontend_web,Vue Routerパターン.md`](./_AIDIY/knowledge/frontend_web,Vue Routerパターン.md)、[`_AIDIY/knowledge/frontend_web,Pinia Storeパターン.md`](./_AIDIY/knowledge/frontend_web,Pinia Storeパターン.md) |
| frontend_avatar / Electron / VRM / 音声 | [`_AIDIY/knowledge/frontend_avatar,ElectronIPC追加手順.md`](./_AIDIY/knowledge/frontend_avatar,ElectronIPC追加手順.md)、[`_AIDIY/knowledge/frontend_avatar,VRM_VRMA追加手順.md`](./_AIDIY/knowledge/frontend_avatar,VRM_VRMA追加手順.md)、[`_AIDIY/knowledge/backend_server,frontend_avatar,AI音声処理.md`](./_AIDIY/knowledge/backend_server,frontend_avatar,AI音声処理.md) |
| frontend_ide / Console・Code・Live・IDE の Vue 共通画面 | [`_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md`](./_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md) |
| backend_diag / 環境診断 | [`_AIDIY/knowledge/backend_diag,環境診断運用.md`](./_AIDIY/knowledge/backend_diag,環境診断運用.md) |
| frontend_ide/host / VS Code 拡張（Code / Live） | [`_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md`](./_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md) |
| frontend_channels / Discord（Code / Live）・Slack（Code、双子） | [`_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md`](./_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md) |
| AI コア / Code CLI / MCP | [`_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md`](./_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md)、[`_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md`](./_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md)、[`_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md`](./_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md) |
| command_hermes Provider / Slash Command | [`_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md`](./_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md)、[`_AIDIY/knowledge/command_hermes,Slash Command一覧.md`](./_AIDIY/knowledge/command_hermes,Slash Command一覧.md) |
| GitHub issue 運用 | [`_AIDIY/knowledge/共通,GitHubIssue運用手順.md`](./_AIDIY/knowledge/共通,GitHubIssue運用手順.md) |

`_AIDIY/knowledge` は作業ログ置き場ではありません。残す内容は、次回以降に再利用できる HowTo、判断基準、注意点、確認方法だけです。

## 関連ドキュメント

| ドキュメント | 役割 |
|--------------|------|
| [_AIDIY.md](./_AIDIY.md) | AI エージェント向け最小入口 |
| [CLAUDE.md](./CLAUDE.md) | `_AIDIY.md` と同一内容の最小入口（Claude Code 向け） |
| [backend_diag/AGENTS.md](./backend_diag/AGENTS.md) | Node.js 標準モジュールによる読み取り専用環境診断・ブラウザ起動 |
| [backend_server/AGENTS.md](./backend_server/AGENTS.md) | FastAPI + SQLAlchemy + SQLite の実装詳細 |
| [command_hermes/AGENTS.md](./command_hermes/AGENTS.md) | `aidiy_hermes` CLI 基盤の実装詳細 |
| [backend_tools/AGENTS.md](./backend_tools/AGENTS.md) | MCP サーバー群の実装詳細 |
| [backend_local/AGENTS.md](./backend_local/AGENTS.md) | ローカル LLM（OpenAI 互換 Gemma）サーバーの実装詳細 |
| [backend_taskteam/AGENTS.md](./backend_taskteam/AGENTS.md) | AIタスク実行・定期タスク・複数AIエージェントのチーム活動を統合した FastAPI サーバーの実装詳細 |
| [frontend_web/AGENTS.md](./frontend_web/AGENTS.md) | Vue 3 + Vite + TypeScript の Web UI 実装詳細 |
| [frontend_avatar/AGENTS.md](./frontend_avatar/AGENTS.md) | Electron/Web デュアルモード Avatar の実装詳細 |
| [frontend_ide/AGENTS.md](./frontend_ide/AGENTS.md) | Navigator / Console / Code / Live / IDE の共通 Vue 画面と単独起動の実装詳細 |
| [frontend_ide/host/AGENTS.md](./frontend_ide/host/AGENTS.md) | VS Code 拡張 AiDiy (Code) / AiDiy (Live) と単独起動版の実装詳細 |
| [frontend_channels/AGENTS.md](./frontend_channels/AGENTS.md) | Discord Bot の Hermes チャット / AIコア Live 音声接続の実装詳細 |
| [frontend_channels/slack/AGENTS.md](./frontend_channels/slack/AGENTS.md) | Slack Bot の Hermes チャット（Discord 版の双子、音声なし・HTTPS 定期取得）の実装詳細 |
| [frontend_ide/viewer/AGENTS.md](./frontend_ide/viewer/AGENTS.md) | AiDiy IDE のファイルAPI・Office表示・起動互換の実装詳細 |
| [docs/](./docs/) | HTML 形式の詳細ドキュメント |

人間向けの紹介資料は [frontend_web/public/X自己紹介/index.html](./frontend_web/public/X自己紹介/index.html) です。

## AiDiy とは

**AiDiy** (AI Do-It-Yourself) は、日本語を第一言語とするフルスタック業務管理システムの開発フレームワーク / テンプレートです。

目的:

- 日本語ネイティブな開発環境を提供する。
- FastAPI + SQLite + Vue 3 による実用的な業務管理テンプレートを提供する。
- 権限管理、マスタ管理、トランザクション管理、スケジューラ、在庫管理の実装例を提供する。
- マルチベンダー AI、音声、画像、Code CLI、MCP を統合する実験基盤として機能する。

## 基本方針

- 著作権・利用条件の正本は [LICENSE](./LICENSE)。既存の著作権表示を維持し、第三者資材の LICENSE / NOTICE を AiDiy 独自の表記で置き換えない。

- 画面、URL、JSONキー、識別子は日本語を原則とする。
- 文字コードは UTF-8 固定。
- DB項目名、API項目名、フロントエンド変数名はできるだけ一致させる。
- `request`、`query`、`item`、`items`、`total`、`limit` などの一般名は英字のまま使用してよい。
- ファイル内容確認は UTF-8 指定で読む。
- HowTo、検証手順、失敗対処は AGENTS.md ではなく `_AIDIY/knowledge/` に置く。
- `npm run build` は原則として日常的な確認手順に含めない。配布物作成、ビルド成果物確認、利用者明示依頼など、実行理由が明確な場合だけ実行する。

## 日本語ファースト設計

全レイヤーで日本語識別子を使います。

| レイヤー | 例 |
|----------|----|
| Database | テーブル名 `C権限`、カラム名 `利用者ID` |
| API | `/core/利用者/一覧`、`{"利用者名": "admin"}` |
| Frontend | `C利用者一覧.vue`、`/C管理/C利用者/一覧` |
| Code | `利用者名`、`配車日付`、`商品名` |

日本語話者が業務ドメインとコードを直接対応づけられることを優先します。

## アーキテクチャ概要

AiDiy は 5 つの常駐サーバーと 1 つの on-demand CLI 基盤で構成します。

| コンポーネント | 役割 | 主なポート |
|----------------|------|------------|
| `backend_diag/diag_main.mjs` | 外部プログラムの導入状態を確認する任意起動の診断 UI / API（`aidiy_diag`） | 自動割り当て・loopback |
| `backend_server/core_main.py` | C系、A系、認証、AIコア | 8091 |
| `backend_server/apps_main.py` | M系、T系、V系、S系 | 8098 |
| `backend_tools/tools_main.py` | MCP サーバー群 | 8095 |
| `backend_local/local_main.py` | ローカル LLM（OpenAI 互換 Gemma 推論） | 8096 |
| `backend_taskteam/taskteam_main.py` | AIタスク実行（要求の AI 分解 + Code CLI 実行）、定期タスク、複数AIエージェントのチーム活動管理 | 8093 |
| `command_hermes` | `aidiy_hermes` CLI 基盤 | 常駐なし |
| `frontend_web` | 通常 Web UI | 8090 |
| `frontend_avatar` | Electron/Web デュアルモード Avatar | 8092 |
| `frontend_ide/host` | AIコアへ接続するコード支援の AiDiy (Code) と、音声会話の AiDiy (Live) の VS Code 拡張 / 単独起動版 | 常駐なし |
| `frontend_channels` | Discord のテキストチャンネルを `aidiy_hermes`、ボイスチャンネルを AIコア Live へ接続する任意起動の Bot | 待受ポートなし |
| `frontend_channels/slack` | Slack の専用チャンネルを `aidiy_hermes` へ接続する任意起動の Bot（Discord 版の双子、HTTPS 定期取得） | 待受ポートなし |
| `frontend_ide` | Navigator / Console / Code / Live / IDE の共通 Vue 画面・単独起動。`viewer/` はファイルAPI・Office表示 | 自動割り当て |

`core_main.py`、`apps_main.py`、`taskteam_main.py` は同じ SQLite DB を共有します。`taskteam_main.py` は `Aタスク*` と `Aチーム*` を同一プロセスで管理します。
frontend_web は Vite proxy で `/core/*` を 8091、`/apps/*` を 8098 へ振り分けます。Task / Team は frontend_ide の単独アプリで操作し、`/task/*` と `/team/*` は同じ 8093 へ接続します。

## ディレクトリ概要

| ディレクトリ | 内容 |
|--------------|------|
| `backend_diag/` | Node.js のみで起動する環境診断。カテゴリ別一覧と詳細、認証付き読み取り専用チェック |
| `backend_server/` | FastAPI サーバー、SQLAlchemy モデル、CRUD、Router、AIコア |
| `command_hermes/` | `aidiy_hermes` CLI |
| `backend_tools/` | Windows では 20 個、Linux / macOS では 19 個の MCP（Chrome DevTools、Desktop Capture、SQLite、PostgreSQL、Logs、Code Check、Backup、Image / Movie Generation、Speech-to-Text、Text-to-Speech、OBS Studio Control、FFmpeg Control、Notification Sounds、Code Agents、Chat LLM、Decisions Check、Task Agents、Team Agents、Windows 限定の Windows Control）と OpenAI / Ollama 互換 Chat Completions |
| `backend_local/` | ローカル LLM サーバー（HuggingFace Gemma を `transformers` + `torch` で推論、OpenAI 互換 Chat Completions API） |
| `backend_taskteam/` | AIタスク実行 + 定期タスクと複数AIエージェントのチーム活動を統合した FastAPI サーバー（`/task/*`、`/team/*`、各監視ループ） |
| `frontend_web/` | Vue 3 + Vite + TypeScript の Web UI |
| `frontend_avatar/` | Electron/Web 対応の AI Avatar UI |
| `frontend_ide/` | Navigator / Console / Code / Live / IDEのVue共通画面と単独起動。`host/` にVS Code拡張・Code / Live通信、`viewer/` にファイルAPI・Office表示を統合 |
| `frontend_channels/` | `frontend_ide/host` の CLI / Live 接続処理を共有する Discord Bot。接続情報は `_config/AiDiy_key.json` の `DISCORD_*`。`slack/` に双子の Slack Bot（`slack_*`、音声なし） |
| `_config/` | API キー、AI モデル、MCP などの共通設定 |
| `_data/` | 共通 SQLite DB などの永続データ |
| `_icons/` | アプリケーション共通アイコン |
| `docs/` | HTML 形式の開発ガイド |
| `_AIDIY/knowledge/` | プロジェクト専用 HowTo と再利用ナレッジ |
| `scripts/` | 補助スクリプト（BOM 除去、画像変換、起動 / 停止 bat など） |
| `.aidiy_backup/` | `aidiy_backup` MCP の差分バックアップ出力先。初回保存時に生成されるため、未実行のリポジトリには存在しない。ソースではないため編集・参照対象にしない |
| `docker/` | Docker + nginx（HTTPS）構成一式 |

## テーブル命名規則

| 接頭辞 | 種別 | 例 |
|--------|------|----|
| `C` | Core / Common | `C権限`、`C利用者`、`C採番` |
| `M` | Master | `M商品`、`M取引先`、`M商品構成` |
| `T` | Transaction | `T配車`、`T生産`、`T商品入庫` |
| `V` | View endpoint | `V商品`、`V生産`、`V商品推移表` |
| `S` | Scheduler / Special | `S配車_週表示`、`S生産_日表示` |
| `A` | AI / Advanced | `A会話履歴`、`Aタスク要求`、`Aタスク明細` |
| `X` | Experimental | `Xテトリス`、`X世界の絶景` |

`V` 系は DB VIEW オブジェクトではなく、生SQLによる JOIN / 集計エンドポイントとして実装します。

## API 方針

- CRUD エンドポイントは POST 中心。
- レスポンスは `status`、`message`、`data` を持つ統一形式。
- Core API は `/core/*`、Apps API は `/apps/*` に分ける。
- 認証は JWT を使う。

レスポンス例:

```json
{
  "status": "OK",
  "message": "メッセージ",
  "data": {}
}
```

## DB 方針

- SQLite を使う。
- DB ファイルは `_data/AiDiy/database.db`。
- Alembic は使わない。
- DB は現行スキーマでの新規作成を前提とし、旧テーブル・旧カラムの自動移行や互換フォールバックは行わない。
- スキーマ変更時の DB 再作成は利用者が手動で行う。アプリ起動やコード検証で既存 DB を削除・再構築しない。
- カスタムID生成は `C採番` で管理し、AUTOINCREMENT を前提にしない。
- 全テーブルは登録 / 更新の監査フィールドを持つ。

スキーマ変更の具体手順は `_AIDIY/knowledge/backend_server,スキーマ変更手順.md` を参照してください。

## 提供機能

### C系 Core / Common

- `C権限`: 権限マスタ。
- `C利用者`: JWT 認証つき利用者マスタ。
- `C採番`: カスタムID生成。

### M系 Master

- 配車区分、生産区分、生産工程、商品分類、取引先分類、取引先、車両、商品。
- `M商品構成`: `明細SEQ=0` をヘッダー、`明細SEQ>=1` を材料明細とする明細型マスタ。

### T系 Transaction

- `T配車`: 配車トランザクション。
- `T生産`: `明細SEQ=0` をヘッダー、`明細SEQ>=1` を払出明細とする明細型トランザクション。
- `T商品入庫`、`T商品出庫`、`T商品棚卸`: 在庫管理トランザクション。

### V系 View Endpoint

- コア、マスタ、トランザクション、在庫推移の JOIN / 集計表示。
- DB VIEW は作らず、Router 内の SELECT + JOIN で実装する。

### S系 Scheduler / Special

- `S配車_週表示`、`S配車_日表示`。
- `S生産_週表示`、`S生産_日表示`。

### A系 AI / Advanced

- `AIコア`: WebSocket + マルチベンダー AI + Code CLI パネル。
- `A会話履歴`: 会話履歴保存。
- `Aタスク要求` / `Aタスク明細`: AIタスク自動実行（backend_taskteam が管理、単独アプリ aidiy_task から操作）。明細は `先行SEQ` による DAG で、直列だけでなく水平の並行分岐を含む自由なタスクフローを定義でき、フロー図はクリティカルパス基準で表示する。
- `Aチーム要員`: backend_taskteam のエージェント要員マスタ。初期要員 `admin` は削除不可。

### X系 Experimental

- `Xテトリス`、`Xインベーダー`、`Xリバーシ`、`X立体リバーシ`、`Xドッグファイト`。
- `X世界の絶景`、`X太陽系`、`X動画再生BGM`、`Xビデオ`。
- `X自己紹介`。

## 業務サンプル概要

| サンプル | 主な構成 |
|----------|----------|
| 配車管理 | `M配車区分`、`M車両`、`T配車`、`V配車`、`S配車_*` |
| 生産管理 | `M生産区分`、`M生産工程`、`M商品`、`M商品構成`、`T生産`、`V生産`、`S生産_*` |
| 資材在庫管理 | `M商品`、`T商品入庫`、`T商品出庫`、`T商品棚卸`、`V商品推移表` |

## 明細型パターン

ヘッダー行と明細行を単一テーブルで管理します。

```text
ID    | 明細SEQ | 意味
------+---------+----------------
P001  | 0       | ヘッダー行
P001  | 1       | 明細行
P001  | 2       | 明細行
```

代表例:

- `M商品構成`: 商品構成ヘッダー + 材料明細。
- `T生産`: 生産指示ヘッダー + 材料払出明細。

## AI コア概要

AIコアは、テキスト、音声、画像、ファイル、コード支援を統合する多パネル UI です。

| 種別 | 役割 |
|------|------|
| `CHAT_AI_NAME` | テキストチャット |
| `LIVE_AI_NAME` | 音声リアルタイム対話 |
| `PREDICTION_AI_NAME` と方式別 `PREDICTION_OPENAI_MODEL` / `PREDICTION_OAUTH_MODEL` / `PREDICTION_GEMINI_MODEL` / `PREDICTION_FREEAI_MODEL` / `PREDICTION_CODEX_CLI_MODEL` / `PREDICTION_COPILOT_CLI_MODEL` / `PREDICTION_AIDIY_HERMES_MODEL` | 内部RESTでプロジェクト履歴から次のユーザー入力を予測（初期値は方式とChat系が auto、CLI系が gpt-6-luna / Hermesは openai_oauth/gpt-6-luna、履歴非保存） |
| `CODE_AI1_NAME`〜`CODE_AI6_NAME` | code1〜code6 のコード支援 |
| `TASK_AI_NAME` / `TASK_AI_MODEL_plan` / `_do` / `_check` | backend_taskteam の AIタスク自動実行 |
| `TEAM_AI_NAME` / `TEAM_AI_MODEL_plan` / `_do` / `_check` | backend_taskteam の AIチーム依頼実行 |

TASK / TEAM のモデルは plan（計画）/ do（実施）/ check（検証）の3種指定です。

Code AI の有効値は `claude_sdk`、`claude_cli`、`copilot_cli`、`codex_cli`、`antigravity_cli`、`grok_cli`、`opencode_cli`、`aidiy_hermes` を想定します。

## frontend_web 概要

- Vue 3 + Vite + TypeScript。
- Vue Router と Pinia を使用。
- qTubler によるカスタムテーブル UI。
- `_Layout`、`_TopBar`、`_TopMenu` による共通レイアウト。
- qAlert、qConfirm、qColorPicker などの共通ダイアログを持つ。

## frontend_avatar 概要

frontend_avatar は Electron デスクトップアプリと通常 Web ブラウザの両方で動作します。

| 項目 | Electron モード | Web モード |
|------|----------------|-----------|
| 判定 | `window.desktopApi` あり | `window.desktopApi` なし |
| 認証 Storage | `localStorage` | `sessionStorage` |
| UI | 複数 Electron ウィンドウ | 左アバター + 右タブ |
| アクセス | `http://127.0.0.1:8092` | `http://127.0.0.1:8092` |

主な技術:

- Electron。
- Three.js。
- `@pixiv/three-vrm`。
- `@pixiv/three-vrm-animation`。
- WebSocket。
- BroadcastChannel `avatar-desktop-sync`。

## frontend_ide/host 概要

`frontend_ide/host` は、VS Code のセカンダリサイドバーに表示する 2 つの独立した拡張と、同じ画面を使う単独起動版を提供します。

| 拡張 | 拡張 ID | 役割 | 単独起動 |
|------|---------|------|----------|
| AiDiy (Code) | `aidiy.aidiy-code` | 既存AIコアへ接続するコード支援チャット。`AIコード.vue` と同じ Code CLI・モデルを選択する | `aidiy_code` |
| AiDiy (Live) | `aidiy.aidiy-live` | 既存 AIコア（`backend_server` 8091）へ接続するライブ音声・文字会話。VS Code 拡張内のマイクは Windows の Python 標準ライブラリ（WinMM）で取り込む | `aidiy_live` |

- 拡張 ID、ビュー、設定、VSIX（`dist/aidiy-code-0.1.0.vsix` / `dist/aidiy-live-0.1.0.vsix`）を分け、片方を無効にしても他方が動作する。
- Code は選択コード添付、Provider / モデル選択、会話継続、停止、実行ログ、対話 CLI を提供し、既存 AIコードと同じ packet 識別子で進捗と正式回答を分離する。
- Live は接続時に作業フォルダを `CODE_BASE_PATH` として渡し、LiveAI とコードエージェントの回答（`output_request`）を表示する。
- 単独起動版は Electron のフレームレスウィンドウ、または `--browser` でブラウザを使う。
- VS Code 拡張・単独起動版はそのまま維持し、さらに開発スペース（AiDiy IDE、`aidiy_ide`）の部品としても動作する。Electron 版 IDE は「＋ Code」「＋ Live」で同じプロジェクト・利用モード・セッションの別ウィンドウを開き、Web 版は画面内タブで使う。同じ部品が3つの場所で動くことで、IDE 開発への応用を広げる。
- Code / Live とも最後に手動選択したモデルを `~/.aidiy/aidiy_code_model.json` / `aidiy_live_model.json` に保存し、拡張と単独起動版で共用する。
- Windows デスクトップ版 VS Code を主対象とし、VS Code 1.106 以降を前提とする。

詳細は `frontend_ide/host/AGENTS.md` を参照してください。

## Navigator 概要

Navigator は `frontend_ide` が所有する読み取り専用の開発案内画面です。`aidiy_navi` で単独起動するか、IDE の「＋ Navigator」から開きます。目標・作業項目・推定達成率・次のプロンプトを表示し、提案を自動実行しません。全体 start の自動起動対象ではありません。

## frontend_ide / viewer 概要

AiDiy IDE の中心となる画面は `frontend_ide/src/components/開発スペース/` が所有し、`frontend_ide/viewer` はファイルAPI・Office表示を担当します。AiDiy の**開発スペース**（宇宙をテーマにした IDE 開発環境）は、作業フォルダを眺め、探し、中身を読むための開発用 UI です。目指すのは「ソースをほぼ触らない IDE」で、人は宇宙で全体を眺め、エクスプローラーで辿り、ビューアで読み、変更は部品として呼び出す Code / Live を通じて AI に任せます。

- フォルダを銀河、ファイルを星・惑星として1階層ずつ表示する。
- 左上のバーガーボタンで左側のエクスプローラーを開閉し、右側でコード・画像・フォルダ内容を表示する。
- ビューアは読み取り専用。起点日時以降の更新を明滅・金色表示で可視化する。
- Node.js、Vue 3、Canvas 描画、Monaco Editor で構成する。Navigator / Console / Code / Live / IDE の画面と依存物は `frontend_ide` で共有する。
- 全体のセットアップ・起動・クリーンアップに組み込み済み。単独起動コマンドは `aidiy_ide`、ポートは固定せず自動割り当て。

画面の詳細は [frontend_ide/AGENTS.md](./frontend_ide/AGENTS.md)、ファイルAPI・Office表示は [frontend_ide/viewer/AGENTS.md](./frontend_ide/viewer/AGENTS.md) を参照してください。

## 3D アバター概要

- VRM モデルを Three.js で表示する。
- VRMA モーションを `public/vrma/` から再生する。
- 背景透過により Electron の透明フレームレスウィンドウと重ねられる。
- マイク入力 / AI 音声出力のレベルを口パクや演出へ反映する。

## MCP 概要

`backend_tools` は Windows では 20 個、Linux / macOS では 19 個の MCP サーバーを同居させます。

| MCP | 役割 |
|-----|------|
| `aidiy_chrome_devtools` | Chrome ブラウザ自動操作（`session` パラメータで複数 Chrome の並行セッション管理。自動テストの並行実行が可能。使用後は `close_session` で破棄） |
| `aidiy_desktop_capture` | デスクトップキャプチャ |
| `aidiy_sqlite` | AiDiy SQLite DB 確認 |
| `aidiy_postgres` | 外部 PostgreSQL 確認 |
| `aidiy_logs` | backend_server / backend_tools ログ確認 |
| `aidiy_code_check` | Python 構文 / ruff / TypeScript 型チェック |
| `aidiy_backup` | 差分バックアップ保存 / 確認（HTTP は `save` / `check` に分岐） |
| `aidiy_image_generation` | AI 画像生成（OpenAI / Gemini / FreeAI / Codex CLI / Antigravity CLI） |
| `aidiy_movie_generation` | AI 動画生成（Google Gemini Veo） |
| `aidiy_speech_to_text` | 音声認識（speech_recognition / OpenAI Whisper） |
| `aidiy_text_to_speech` | テキスト音声合成（Edge / OpenAI / Gemini / FreeAI） |
| `aidiy_obs_studio_control` | OBS Studio WebSocket 制御（配信、録画、シーン、ソース、音声） |
| `aidiy_ffmpeg_control` | ffmpeg / ffprobe / ffplay 実行（動画合成、字幕焼き込み、プレビュー再生） |
| `aidiy_notification_sounds` | 通知音のローカル再生（scene 別の開始 / 終了 / 注意音、`tts` シーンは読み上げ合成） |
| `aidiy_code_agents` | AI コードエージェント実行（AIコード / CodeAI CLI 経由） |
| `aidiy_chat_llms` | AIチャット の ChatAI を MCP ツールとして公開（`aidiy_chat_completions` の OpenAI / Ollama 互換エンドポイントの実体） |
| `aidiy_decisions_check` | AI判断（Decisions API / OAuth Responses JSON Schema）の共通インターフェース |
| `aidiy_task_agents` | backend_taskteam の AIタスク要求への非同期投入（`submit`）と進捗確認（`get_request_status` / `get_detail_status`） |
| `aidiy_team_agents` | backend_taskteam の Aチーム依頼への非同期投入（`submit`）と進捗確認（`get_work_status` / `get_work_list` / `get_member_list`） |
| `aidiy_windows_control` | Windows でのみ公開するデスクトップ操作制御（マウス/キーボード、ウィンドウ、プロセス、クリップボード、UI Automation 要素操作） |

各 MCP は **SSE Transport**、**Streamable HTTP Transport**、**stdio gateway（`mcp_stdio.py`）** の 3 トランスポートを同一ポートで提供します。Python の `requests` でそのまま呼び出せるため、自動化スクリプトやバックエンドルーターからも利用できます。加えて OpenAI / Ollama 互換の標準チャットインターフェース `POST http://127.0.0.1:8095/aidiy_chat_completions/v1/chat/completions`（HTTP のみ）を提供します。

次のユーザー入力予測 `aidiy_prediction_llms` は MCP に公開せず、Live 試行と同様に内部REST `POST /internal/prediction_llms` のみで提供します。

MCP の使い分けと設定は `_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md` を参照してください。

## 実装確認の入口

実装内容を確認するときは、まずサブプロジェクトの AGENTS.md を確認し、実際のコードを優先してください。

- Backend: `backend_server/AGENTS.md`
- Hermes: `command_hermes/AGENTS.md`
- MCP: `backend_tools/AGENTS.md`
- Local: `backend_local/AGENTS.md`
- Task / Team: `backend_taskteam/AGENTS.md`
- Web: `frontend_web/AGENTS.md`
- Avatar: `frontend_avatar/AGENTS.md`
- VS Code: `frontend_ide/host/AGENTS.md`
- Discord: `frontend_channels/AGENTS.md`
- Slack: `frontend_channels/slack/AGENTS.md`
- Navigator / Console / Code / Live / IDE 共通画面: `frontend_ide/AGENTS.md`
- ファイルAPI・Office表示: `frontend_ide/viewer/AGENTS.md`

docs と実装が食い違う場合は、現行実装を確認したうえで「現行実装では」と明記します。

## Vue共通画面

現行のNavigator / Console / Code / Live / IDE / Task / Team / Browserの画面は `frontend_ide` のVue部品を使用します。VS Code拡張はCode / Liveのみ、単独実行は8種類です。エクスプローラーは `frontend_ide/src/components/ファイル閲覧/ファイル一覧.vue` に集約し、選択と検索マークを宇宙表示へ通知します。既存の `frontend_ide/host` は拡張ホスト・Code/Hermes・Live音声基盤、`frontend_ide/viewer` はファイルAPI・Office表示資産を提供します。旧起動入口からもVue版へ進みます。詳細は `frontend_ide/AGENTS.md` と `_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md` を参照してください。

Diag / Navigator / Code / Live / Console / IDE / Discord / Slack の独自実装は、日本語の機能名で配置し、共通処理は所有元から再利用します。`src`・`checks`・`scripts`・`dist` などの規約名、公開起動入口、配布URL、IPC/API・保存キーは互換性のため維持します。画面の所有元は Diag が `backend_diag/ui/src`、Navigator / Code / Live / Console / IDE / Task / Team / Browser が `frontend_ide/src`、Discord が `frontend_channels/panel`、Slack が `frontend_channels/slack/panel` です。
