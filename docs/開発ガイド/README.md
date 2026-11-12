# このプロジェクトの歩き方

このガイドは、**現在の AiDiy2027 実装** を前提に、最初に何を読めばよいかを整理するための案内です。

古いテンプレート由来の PostgreSQL / Alembic / `base_server` 前提ではなく、**FastAPI + SQLite + Vue 3 + Electron + VS Code 拡張 + Discord / Slack Bot**の現行構成に合わせています。

---

## 1. まず押さえること

- 常駐バックエンドは **5 サーバー**
  - `core_main.py` : `8091`
  - `apps_main.py` : `8098`
  - `tools_main.py` : `8095`
  - `local_main.py` : `8096`（`_start.py` のデフォルトは起動しない）
  - `taskteam_main.py` : `8093`（AIタスク実行 + 定期タスク + 複数AIエージェントのチーム活動）
- Web フロントは `frontend_web`、ポート `8090`
- Avatar フロントは `frontend_avatar`、ポート `8092`
- VS Code 拡張は `frontend_ide/host`。AiDiy (Code) はオンライン時に Core（`8091`）の AIコアへ接続して各 Code CLI を選び、未接続時は `aidiy_hermes` を直接起動する。AiDiy (Live) は同じ AIコアへ接続する。どちらも常駐ポートなし（単独起動版は `aidiy_code` / `aidiy_live`）
- Discord Bot は `frontend_channels/discord`（任意起動、待受ポートなし）。専用テキストチャンネルを `aidiy_hermes`、専用ボイスチャンネルを Core（`8091`）の AIコア Live へ接続する。起動は `aidiy_discord`
- Slack Bot は `frontend_channels/slack`。HTTPS の定期取得で専用チャンネルの投稿を Hermes へ渡し、スレッドへ返信する（音声なし）。起動は `aidiy_slack`
- Navi / Console / Code / Live / IDE / Task / Team / Browser の共通 Vue 画面は `frontend_ide/src/`
- Diag は `backend_diag`。環境診断に加え、設定・導入操作とサービス起動管理を提供する
- DB は **SQLite**
  - `_data/AiDiy/database.db`
- スキーマ変更は **Alembic なし**
  - モデル更新
  - 現行スキーマでの新規作成が前提。旧テーブル・旧カラムの自動移行は行わない
  - スキーマ変更時の DB 再作成は利用者が手動で行い、コード検証で既存 DB を削除・再構築しない。詳細は [スキーマ変更手順](../../_AIDIY/knowledge/backend_server,スキーマ変更手順.md)
- 画面や API は日本語命名が基本

---

## 2. リポジトリ構成

```text
AiDiy2027/
├── AGENTS.md
├── README.md
├── _setup.py
├── _start.py
├── _cleanup.py
├── backend_diag/              # 診断・設定・起動管理と Vue / Electron 画面
├── backend_local/             # ローカル Gemma 推論
├── command_hermes/            # aidiy_hermes CLI
├── backend_tools/
│   ├── tools_main.py
│   ├── tools_proc/
│   └── AGENTS.md
├── backend_taskteam/
│   ├── taskteam_main.py
│   └── AGENTS.md
├── backend_server/
│   ├── core_main.py
│   ├── apps_main.py
│   ├── core_router/
│   ├── apps_router/
│   ├── core_models/
│   ├── apps_models/
│   ├── core_schema/
│   ├── apps_schema/
│   ├── core_crud/
│   ├── apps_crud/
│   ├── AIコア/
│   └── AGENTS.md
├── frontend_web/
│   ├── src/
│   │   ├── router/
│   │   ├── stores/
│   │   ├── api/
│   │   └── components/
│   └── AGENTS.md
├── frontend_avatar/
│   ├── electron/
│   ├── src/
│   ├── public/
│   └── AGENTS.md
├── frontend_ide/              # 8種類の単独アプリと共通 Vue 画面
│   ├── src/
│   ├── host/                 # Code / Live の拡張・通信・CLI基盤
│   ├── viewer/               # ファイル API・Office 表示
│   ├── タスクチーム/        # Task / Team API中継
│   ├── checks/
│   └── AGENTS.md
├── frontend_channels/          # 外部接続チャンネル群（将来のチャンネルも同じ階層へ追加）
│   ├── AGENTS.md / README.md / LICENSE  # 共通方針・ライセンス
│   ├── discord/               # Discord: src/・panel/・checks/・起動入口
│   └── slack/                 # Slack: src/・panel/・checks/・起動入口
└── docs/
```

---

## 3. 最短で動かす

### セットアップ

```powershell
python _setup.py
```

通常セットアップでは Diag を必ず準備します。IDE群を選ぶと、Navi / Console / Code / Live / IDE / Task / Team / Browser の共通依存・ランチャーを準備し、VS Code CLI がある場合は Code / Live の VSIX を生成・配置します。Channels (Discord / Slack) を選ぶと両 Bot の依存・パネル・ランチャーを準備します。

依存更新、MCP 設定、モデルダウンロードなどの選択と注意点は [ルート README のセットアップ](../../README.md#1-セットアップ) を参照してください。接続情報は [Discord README](../../frontend_channels/discord/README.md) と [Slack README](../../frontend_channels/slack/README.md) にまとめています。

### 起動

```powershell
python _start.py
```

最初の Diag 選択は既定 Yes です。Yes では `aidiy_diag --auto` へ起動管理を渡し、保存済みの設定で起動します。No ではバックエンド、Web / Avatar、Task / Team、Console / Code / Live / IDE、Discord / Slack を個別選択します。

個別起動コマンド、OS ごとの Python パス、停止対象は [ルート README の起動](../../README.md#2-起動) と [停止](../../README.md#3-停止) を参照してください。常駐バックエンド以外の起動入口は `aidiy_navi` / `aidiy_console` / `aidiy_code` / `aidiy_live` / `aidiy_ide` / `aidiy_task` / `aidiy_team` / `aidiy_browser` / `aidiy_avatar` / `aidiy_discord` / `aidiy_slack` です。

---

## 4. アクセス URL

| 用途 | URL |
|------|-----|
| Web フロント | http://127.0.0.1:8090 |
| Core API Docs | http://127.0.0.1:8091/docs |
| Apps API Docs | http://127.0.0.1:8098/docs |
| Task / Team API Docs | http://127.0.0.1:8093/docs |
| Local API Docs | http://127.0.0.1:8096/docs |
| Backend MCP 一覧（Windows 20 / Linux・macOS 19） | http://127.0.0.1:8095/ |
| Backend MCP ツール一覧 | http://127.0.0.1:8095/{mcp_name}/list |
| Backend MCP SSE 接続 | http://127.0.0.1:8095/{mcp_name}/sse （例: `aidiy_chrome_devtools`） |
| Avatar Web モード | http://127.0.0.1:8092 |

初期ユーザー:

- `admin / ********`
- `leader / secret`
- `user / user`
- `guest / guest`
- `other / other`

---

## 5. バックエンドの見方

### 役割分担

- `core_router/`
  - 認証、C系と対応するV系（V権限・V利用者・V採番）、A系、files、AIコア
- `apps_router/`
  - M系、T系、V系、S系
- `core_models/`, `apps_models/`
  - SQLAlchemy モデル
- `core_schema/`, `apps_schema/`
  - Pydantic スキーマ
- `core_crud/`, `apps_crud/`
  - DB 操作と初期化処理

### 大事な前提

- CRUD は原則 POST
- V 系は DB VIEW ではなく生 SQL
- `apps_crud/__init__.py` 追加漏れに注意
- M 系一覧は通常 V 系エンドポイントを使う
- API経由で登録するパスワードはbcryptハッシュ保存。初期投入アカウントは現行実装では平文互換のため、認証はプレーン一致→bcrypt照合の順で行う（`backend_server/core_crud/C利用者.py`）
- Claude のブラウザ自動操作は `backend_tools` と `_config/mcp_*.json` を併用する

---

## 6. フロントエンド Web の見方

- ルーター: `frontend_web/src/router/`
- 認証: `frontend_web/src/stores/auth.ts`
- API: `frontend_web/src/api/client.ts`
- AI 画面ルート: `/AiDiy`
- AIタスク / AIチーム: Web / Avatar 内ではなく `aidiy_task` / `aidiy_team` の単独画面。`frontend_ide/タスクチーム/api-proxy.mjs` が `/taskteam-api` を 8093 の `/task/*` / `/team/*` へ中継
- Vite proxy: `/core`→8091、`/apps`→8098、`/mcp`→8095。`/task`・`/team` の proxy は設けない（`frontend_web/vite.config.ts`）
- 一覧画面は `qTublerFrame` ベース

主要カテゴリ:

- `C管理`
- `Mマスタ`
- `Tトラン`
- `Sスケジュール`
- `Vビュー`
- `Xその他`

---

## 7. フロントエンド Avatar の見方

- Electron メイン: `frontend_avatar/electron/main.ts`
- preload: `frontend_avatar/electron/preload.ts`
- renderer エントリ: `frontend_avatar/src/AiDiy.vue`

動作モード:

- Electron
  - `localStorage`
  - 複数ウィンドウ
- Web
  - `sessionStorage`
  - `http://127.0.0.1:8092`
  - 単一タブ + 左右分割

---

## 8. IDE 共通画面 / VS Code / Channels の見方

AiDiy (Code) と AiDiy (Live) の 2 つの独立した拡張と、同じ画面を使う単独起動版（`aidiy_code` / `aidiy_live`）で構成します。

- Code 拡張エントリと会話状態: `frontend_ide/host/src/extension.ts`
- Hermes CLI の解決・起動・停止: `frontend_ide/host/src/runner.ts`
- AIコード互換 packet: `frontend_ide/host/src/protocol.ts`
- 共通 Vue 画面: `frontend_ide/src/`。拡張の画面読込は `frontend_ide/host/src/extension.ts` と `frontend_ide/host/aidiy_live/src/extension.ts`
- Code 単独起動: `frontend_ide/host/aidiy_code/`（`launch.mjs`, `desktop.cjs`, `src/server.ts`, `bridge.js`）
- Live 拡張・単独起動: `frontend_ide/host/aidiy_live/`（`src/extension.ts`, `src/host.ts`, `src/view.ts`, `src/server.ts`, `launch.mjs`）

Code はオンライン時に `frontend_ide/host/src/code-connection.ts` から AIコア WebSocket へ接続し、未接続時は `aidiy_hermes` を直接実行します。Live は `backend_server`（8091）の AIコア WebSocket とモデル情報 API へ接続し、音声・文字のライブ会話を行います。詳細は [frontend_ide/host/AGENTS.md](../../frontend_ide/host/AGENTS.md) を参照してください。

`frontend_channels/discord` は Discord Bot から同じ Code / Live を使う任意起動のクライアントです。`frontend_ide/host` の `src/runner.ts`、`src/protocol.ts`、`aidiy_live/src/protocol.ts`、`src/model-preferences.ts` を `frontend_channels/discord/src/共通連携/IDE連携.ts` 経由で直接共有するため、これらを変更すると Discord 側にも影響します。

- 起動・設定確認: `frontend_channels/discord/src/main.ts`
- 接続パネル: `frontend_channels/discord/panel/`、`src/接続パネル/パネル操作.ts`、`src/接続パネル/パネル中継.ts`、`src/panel-worker.ts`（Electron 版）、`src/web-server.ts`（ブラウザ版）
- Discord イベント・返信: `frontend_channels/discord/src/接続/Bot接続.ts`、`src/接続/コマンド処理.ts`
- Code（Hermes 会話継続）: `frontend_channels/discord/src/コード/コード会話.ts`
- Live（ボイスチャンネルと AIコアの中継）: `frontend_channels/discord/src/ライブ/ライブ会話.ts`、`src/ライブ/音声処理.ts`

Discord の接続情報は `_config/AiDiy_key.json` の小文字 `discord_*` 5項目で、Live・作業フォルダ・Hermes モデルは共通設定を使います。詳細は [frontend_channels/discord/AGENTS.md](../../frontend_channels/discord/AGENTS.md) を参照してください。

---

Slack は `frontend_channels/slack/` に配置し、Discord と双子の接続パネルを持ちます。共有範囲と HTTPS 定期取得は [Slack AGENTS](../../frontend_channels/slack/AGENTS.md) を参照してください。Navi のナビ・再評価は読み取り専用ですが、「自動航行」を明示的にオンにすると専用 Code が変更と再評価を繰り返します。画面・単独アプリの入口は [frontend_ide/AGENTS.md](../../frontend_ide/AGENTS.md) です。

## 9. 変更反映と再起動

`_start.py` で起動したバックエンドは `--reload` なしです。

### 推奨方法

```powershell
New-Item -ItemType Directory -Force backend_server/temp | Out-Null
New-Item -ItemType File -Force backend_server/temp/reboot_core.txt | Out-Null
New-Item -ItemType File -Force backend_server/temp/reboot_apps.txt | Out-Null
```

または個別に `uvicorn --reload` で起動します。

---

## 10. テスト方針

自動テストは `backend_server/checks/` の `unittest`（AIコア・バックアップ・予測まわり）と、`frontend_ide/host/checks/`（Code）・`frontend_ide/host/aidiy_live/checks/`（Live）の Node.js テスト、`frontend_ide/host/checks/` の Python テスト、`frontend_channels/discord/checks/`・`frontend_channels/slack/checks/` の Node.js / Python テストがあります。`command_hermes/checks/`、`scripts/checks/`（セットアップ・起動・停止・Task / Team）にも `unittest` があります。`frontend_avatar/checks/` の Web / Avatar 接続テスト、`frontend_ide/checks/` の共通画面・Navi・Console テスト、`backend_diag/checks/` の診断・起動管理の検証もあります。実行方法は [開発環境運用手順](../../_AIDIY/knowledge/共通,開発環境運用手順.md) の「自動テスト」を参照してください。画面操作は手動でも確認します。

```powershell
cd backend_server
.venv\Scripts\python.exe -X utf8 -m unittest discover -s checks -v

cd ../frontend_ide/host
npm run check
npm test
npm run live:test
python -m unittest discover -s checks -p "test_*.py"

cd ../../frontend_channels/discord
npm run check
npm test
```

- API: Swagger UI
- Web UI: ブラウザ
- Avatar: Electron / Web の両モード確認
- フロント型チェック: `npm run type-check`（`npm run build` は配布物作成・成果物確認・明示依頼など、実行理由がある場合のみ）
- VS Code 拡張: `npm run check` / `npm test` / `npm run live:test`。配布物確認時は `npm run package`（Code / Live の 2 つの VSIX を生成）
- IDE 共通画面: `frontend_ide` で `npm test`。Task / Team は `npm run taskteam:type-check` も実行
- Discord / Slack Bot: 各モジュールで `npm run check` / `npm test`（外部 Bot 接続なし）。通常の単体確認ではビルド不要。パネルソース・依存変更時は `npm run build:panel` で配布物を同期してから確認

実装追加後は最低でも以下を確認します。

1. 一覧取得
2. 取得
3. 登録
4. 変更
5. 削除または無効化
6. ルーティング
7. 初期データや採番の連動

---

## 11. まず読む順番

1. [README.md](../../README.md)
2. [AGENTS.md](../../AGENTS.md)
3. [backend_server/AGENTS.md](../../backend_server/AGENTS.md)
4. [backend_tools/AGENTS.md](../../backend_tools/AGENTS.md)
5. [backend_taskteam/AGENTS.md](../../backend_taskteam/AGENTS.md)
6. [backend_local/AGENTS.md](../../backend_local/AGENTS.md)
7. [command_hermes/AGENTS.md](../../command_hermes/AGENTS.md)
8. [frontend_web/AGENTS.md](../../frontend_web/AGENTS.md)
9. [frontend_avatar/AGENTS.md](../../frontend_avatar/AGENTS.md)
10. [frontend_ide/host/AGENTS.md](../../frontend_ide/host/AGENTS.md)
11. [frontend_channels/discord/AGENTS.md](../../frontend_channels/discord/AGENTS.md)
12. [frontend_channels/slack/AGENTS.md](../../frontend_channels/slack/AGENTS.md)
13. [frontend_ide/AGENTS.md](../../frontend_ide/AGENTS.md)
14. [backend_diag/AGENTS.md](../../backend_diag/AGENTS.md)

---

## 12. docs 配下の補助資料

- `00_このプロジェクトの歩き方/`
  - 全体像と導入
- `01_明日のために！その１_環境構築ハンズオン/`
  - セットアップと起動
- `02_明日のために！その２_設計/`
  - 設計サンプル
- `03_明日のために！その３_バックエンド開発/`
  - API 実装の流れ
- `04_明日のために！その４_フロントエンド開発/`
  - 画面実装の流れ
- `11_コーディングルール/`
  - 必読
- `12_フロントエンド画面追加例/`
  - CRUD 追加例

---

## 13. 迷ったとき

- 古いテンプレート由来の `PostgreSQL`, `Alembic`, `base_server`, `base_client` 記述は現行実装には当てはまりません。
- 実装事実を優先してください。
- 迷ったらまず `AGENTS.md` と各サブ `AGENTS.md` を見てください。
