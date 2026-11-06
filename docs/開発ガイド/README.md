# このプロジェクトの歩き方

このガイドは、**現在の AiDiy2027 実装** を前提に、最初に何を読めばよいかを整理するための案内です。

古いテンプレート由来の PostgreSQL / Alembic / `base_server` 前提ではなく、**FastAPI + SQLite + Vue 3 + Electron + VS Code 拡張 + Discord Bot**の現行構成に合わせています。

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
- VS Code 拡張は `frontend_ide/host`。AiDiy (Code) は `aidiy_hermes` を直接起動し、AiDiy (Live) は Core（`8091`）の AIコアへ接続する。どちらも常駐ポートなし（単独起動版は `aidiy_code` / `aidiy_live`）
- Discord Bot は `frontend_channels/discord`（任意起動、待受ポートなし）。専用テキストチャンネルを `aidiy_hermes`、専用ボイスチャンネルを Core（`8091`）の AIコア Live へ接続する。起動は `aidiy_discord`
- DB は **SQLite**
  - `_data/AiDiy/database.db`
- スキーマ変更は **Alembic なし**
  - モデル更新
  - 既存 DB への差分は `backend_server/core_crud/init.py` / `backend_server/apps_crud/init.py` の起動時冪等処理（`ALTER TABLE` など）で適用
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
├── frontend_ide/host/
│   ├── src/
│   ├── media/
│   ├── aidiy_code/
│   ├── aidiy_live/
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

`frontend_ide/host` を選ぶと、Hermes のセットアップ後に Code / Live の VSIX を生成して VS Code 拡張機能として配置し、単独起動用の `aidiy_code` / `aidiy_live` コマンドも作成します。Channels(Discord / Slack)（既定 Yes）を選ぶと、`frontend_channels/discord` と `frontend_channels/slack` の依存導入、パネル生成、`aidiy_discord` / `aidiy_slack` コマンドの作成、共通設定の不足キー補完を行います。Bot トークンやチャンネル ID の設定は [frontend_channels/discord/README.md](../../frontend_channels/discord/README.md) を参照してください。

### 起動

```powershell
python _start.py
```

`_start.py` は**対話形式**です。起動時に以下を選択します。

- バックエンド(local)（デフォルト No）
- tools
- バックエンド(core/apps)
- バックエンド(task,team)
- フロントエンド(Web)
- フロントエンド(Avatar)
- フロントエンド(Discord)（デフォルト No。Yes の場合は接続パネルを開いて自動接続）

### 個別起動

```powershell
# backend local（OpenAI 互換 Gemma、必要時のみ）
cd backend_local
.venv/Scripts/python.exe -m uvicorn local_main:app --reload --host 127.0.0.1 --port 8096

# backend mcp
cd backend_tools
.venv/Scripts/python.exe -m uvicorn tools_main:app --reload --host 0.0.0.0 --port 8095

# backend core
cd backend_server
.venv/Scripts/python.exe -m uvicorn core_main:app --reload --host 0.0.0.0 --port 8091

# backend apps
cd backend_server
.venv/Scripts/python.exe -m uvicorn apps_main:app --reload --host 0.0.0.0 --port 8098

# backend task,team
cd backend_taskteam
.venv/Scripts/python.exe -m uvicorn taskteam_main:app --reload --host 0.0.0.0 --port 8093

# frontend web
cd frontend_web
npm run dev

# frontend avatar
cd frontend_avatar
npm run dev

# frontend discord
aidiy_discord
```

---

## 4. アクセス URL

| 用途 | URL |
|------|-----|
| Web フロント | http://127.0.0.1:8090 |
| Core API Docs | http://127.0.0.1:8091/docs |
| Apps API Docs | http://127.0.0.1:8098/docs |
| Task / Team API Docs | http://127.0.0.1:8093/docs |
| Local API Docs | http://127.0.0.1:8096/docs |
| Backend MCP 一覧（Windows 19 / Linux・macOS 18） | http://127.0.0.1:8095/ |
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
  - 認証、C系、A系、files、AIコア
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
- Claude のブラウザ自動操作は `backend_tools` と `_config/AiDiy_mcp.json` を併用する

---

## 6. フロントエンド Web の見方

- ルーター: `frontend_web/src/router/`
- 認証: `frontend_web/src/stores/auth.ts`
- API: `frontend_web/src/api/client.ts`
- AI 画面ルート: `/AiDiy`
- AIタスク / AIチーム: `/AIタスク` / `/AIチーム`（APIは8093の`/task/*` / `/team/*`）
- Vite proxy: `/core`→8091、`/apps`→8098、`/task`・`/team`→8093、`/mcp`→8095
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

## 8. フロントエンド VS Code / Discord の見方

AiDiy (Code) と AiDiy (Live) の 2 つの独立した拡張と、同じ画面を使う単独起動版（`aidiy_code` / `aidiy_live`）で構成します。

- Code 拡張エントリと会話状態: `frontend_ide/host/src/extension.ts`
- Hermes CLI の解決・起動・停止: `frontend_ide/host/src/runner.ts`
- AIコード互換 packet: `frontend_ide/host/src/protocol.ts`
- Webview: `frontend_ide/host/src/webview.ts`, `frontend_ide/host/media/`
- Code 単独起動: `frontend_ide/host/aidiy_code/`（`launch.mjs`, `desktop.cjs`, `src/server.ts`, `bridge.js`）
- Live 拡張・単独起動: `frontend_ide/host/aidiy_live/`（`src/extension.ts`, `src/host.ts`, `src/view.ts`, `src/server.ts`, `launch.mjs`）

Code は常駐バックエンドや AI コア WebSocket を使わず、VS Code の拡張プロセスから `aidiy_hermes` を直接起動します。Live は `backend_server`（8091）の AIコア WebSocket とモデル情報 API へ接続し、音声・文字のライブ会話を行います。詳細は [frontend_ide/host/AGENTS.md](../../frontend_ide/host/AGENTS.md) を参照してください。

`frontend_channels/discord` は Discord Bot から同じ Code / Live を使う任意起動のクライアントです。`frontend_ide/host` の `src/runner.ts`、`src/protocol.ts`、`aidiy_live/src/protocol.ts`、`src/model-preferences.ts` を `frontend_channels/discord/src/共通連携/IDE連携.ts` 経由で直接共有するため、これらを変更すると Discord 側にも影響します。

- 起動・設定確認: `frontend_channels/discord/src/main.ts`
- 接続パネル: `frontend_channels/discord/panel/`、`src/接続パネル/パネル操作.ts`、`src/接続パネル/パネル中継.ts`、`src/panel-worker.ts`（Electron 版）、`src/web-server.ts`（ブラウザ版）
- Discord イベント・返信: `frontend_channels/discord/src/接続/Bot接続.ts`、`src/接続/コマンド処理.ts`
- Code（Hermes 会話継続）: `frontend_channels/discord/src/コード/コード会話.ts`
- Live（ボイスチャンネルと AIコアの中継）: `frontend_channels/discord/src/ライブ/ライブ会話.ts`、`src/ライブ/音声処理.ts`

接続情報は `_config/AiDiy_key.json` の `DISCORD_*` 5項目だけで、Live・作業フォルダ・Hermes モデルは共通設定を使います。詳細は [frontend_channels/discord/AGENTS.md](../../frontend_channels/discord/AGENTS.md) を参照してください。

---

## 9. 変更反映と再起動

`_start.py` で起動したバックエンドは `--reload` なしです。

### 推奨方法

```powershell
echo. > backend_server/temp/reboot_core.txt
echo. > backend_server/temp/reboot_apps.txt
```

または個別に `uvicorn --reload` で起動します。

---

## 10. テスト方針

自動テストは `backend_server/checks/` の `unittest`（AIコア・バックアップ・予測まわり）と、`frontend_ide/host/checks/`（Code）・`frontend_ide/host/aidiy_live/checks/`（Live）の Node.js テスト、`frontend_ide/host/checks/` の Python テスト、`frontend_channels/discord/checks/` の Node.js / Python テストがあります。`command_hermes/checks/`、`scripts/checks/`（セットアップ・起動・停止・Task / Team）にも `unittest` があります。`frontend_avatar/checks/` の Web / Avatar 接続テストもあります。実行方法は [開発環境運用手順](../../_AIDIY/knowledge/共通,開発環境運用手順.md) の「自動テスト」を参照してください。画面操作は手動でも確認します。

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
- Discord Bot: `npm run check` / `npm test`（ビルド不要、Discord への接続なし）

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
