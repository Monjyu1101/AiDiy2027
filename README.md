# AiDiy - README

## 本書の目的

この README は、**AiDiy の初回セットアップ、起動、停止、クリーンアップ** を素早く確認するための入口です。

詳細設計や実装ルールは次を参照してください。

- [AGENTS.md](./AGENTS.md)
- [backend_server/AGENTS.md](./backend_server/AGENTS.md)
- [command_hermes/AGENTS.md](./command_hermes/AGENTS.md)
- [backend_tools/AGENTS.md](./backend_tools/AGENTS.md)
- [backend_local/AGENTS.md](./backend_local/AGENTS.md)
- [backend_taskteam/AGENTS.md](./backend_taskteam/AGENTS.md)
- [frontend_web/AGENTS.md](./frontend_web/AGENTS.md)
- [frontend_avatar/AGENTS.md](./frontend_avatar/AGENTS.md)
- [backend_diag/AGENTS.md](./backend_diag/AGENTS.md)
- [frontend_ide/AGENTS.md](./frontend_ide/AGENTS.md)
- [frontend_channels/slack/AGENTS.md](./frontend_channels/slack/AGENTS.md)
- [frontend_ide/host/AGENTS.md](./frontend_ide/host/AGENTS.md)
- [frontend_channels/AGENTS.md](./frontend_channels/AGENTS.md)
- [frontend_ide/viewer/AGENTS.md](./frontend_ide/viewer/AGENTS.md)
- [docs/](./docs/)

---

## プロジェクト概要

**AiDiy** は、日本語識別子を前提にしたフルスタック業務システムのテンプレートです。

- バックエンド: FastAPI + SQLAlchemy + SQLite
- Command Hermes: `command_hermes` / `aidiy_hermes`（コード支援用 CLI 基盤、常駐サーバーではない）
- バックエンド MCP: FastAPI (SSE / Streamable HTTP / stdio) + Python MCP SDK（**Windows は20、Linux / macOS は19サーバーを同居**: Chrome DevTools / Desktop Capture / SQLite / PostgreSQL / Logs / Code Check / Backup / Image Generation / Movie Generation / Speech-to-Text / Text-to-Speech / OBS Studio Control / FFmpeg Control / Notification Sounds / Code Agents / Chat LLM / Decisions Check / Task Agents / Team Agents / Windows Control）
- バックエンド Local: `backend_local`（ポート 8096、OpenAI 互換の Gemma ローカル推論サーバー）
- バックエンド TaskTeam: `backend_taskteam`（ポート 8093、AIタスク実行 + 定期タスクと複数AIエージェントのチーム活動を統合した FastAPI）
- フロントエンド Web: Node.js + Vue 3 + Vite + TypeScript + Pinia
- フロントエンド Avatar: Node.js + Vue 3 + Vite + TypeScript + Electron
- フロントエンド VS Code: Node.js + Vue 3 共通画面 + TypeScript + VS Code Extension API + Electron（AiDiy (Code) / AiDiy (Live) の 2 拡張と単独起動版。さらに開発スペース `aidiy_ide` の部品としても動作、常駐なし）
- フロントエンド Slack: Node.js + Vue 3 接続パネル + Electron / Web + TypeScript（HTTPS定期取得によるHermesチャット、音声なし）
- フロントエンド Discord: Node.js + Vue 3 接続パネル + Electron / Web + TypeScript + discord.js（Hermes チャット / AIコア Live 音声接続、任意起動の Bot）
- フロントエンド Navigator: `aidiy_navi` で開く読み取り専用の開発案内画面。目標・作業項目・推定達成率・次のプロンプトを表示し、提案を自動実行しません
- フロントエンド IDE（開発スペース）: Node.js + Vue 3 + Canvas 2D + Monaco Editor + Electron（宇宙をテーマにした IDE 開発環境。Code / Live を部品として組み込んだ `aidiy_ide`、ポート自動割り当て）
- 常駐バックエンドは **5 サーバー構成**
  - `core_main.py` : `8091`
  - `apps_main.py` : `8098`
  - `tools_main.py` : `8095`
  - `local_main.py` : `8096`（`_start.py` のデフォルトは起動しない）
  - `taskteam_main.py` : `8093`（`/task/*` と `/team/*`）
- 補助 CLI として `command_hermes` を統合
  - `aidiy_hermes` : on-demand 実行のコードエージェント CLI
- Web フロントは `8090`
- Avatar フロントは `8092`

### 主な特徴

- **開発スペース（宇宙をテーマにした IDE 開発環境）** — プロジェクトを宇宙に見立て、フォルダは銀河、ファイルは星・惑星として浮かびます。目指すのは「ソースをほぼ触らない IDE」。宇宙で全体を眺め、エクスプローラーで辿り、読み取り専用のビューアで中身を読み、変更は Code（コード支援）と Live（音声会話）に頼んで AI に任せます。起点日時より後に AI が更新したファイルは明滅し、どこが変わったかをひと目で見つけられます。Code / Live は単独起動・VS Code 拡張のまま使え、さらに開発スペースの部品として IDE の中から同じプロジェクトで呼び出せるため、IDE 開発への応用が広がります。`aidiy_ide` で起動します
- **マルチ Code CLI 対応** — `claude_sdk` / `claude_cli` / `copilot_cli` / `codex_cli` / `antigravity_cli` / `grok_cli` / `opencode_cli` / `aidiy_hermes` を切り替えて、`code1`〜`code6` の6コードパネルで同時並走
- **AIタスク自動実行** — 要求を登録すると AI が明細タスクへ分解し、`backend_taskteam` が Code CLI で実行。カンバン方式でも垂直の流れ作業だけでもなく、先行SEQ（複数指定可）で水平の並行分岐を含む**自由なタスクフロー**を定義でき、**クリティカルパス**基準のフロー図で可視化・実行（単独アプリ aidiy_task から操作）
- **自己改善機構** — コードエージェントが修正完了後に `_AIDIY/knowledge/` へ知見を自動整理し、使うほど修正精度が上がる
- **日本語ネイティブ** — テーブル名・API・コンポーネント名まで日本語で統一
- **AI 音声対話コーディング** — Avatar に話しかけながらコードを書き進められる
- **VS Code 拡張** — AiDiy (Code) はセカンダリサイドバーから `aidiy_hermes` を直接操作し、選択コード添付、モデル選択、会話継続、停止、実行ログを利用。AiDiy (Live) は AIコアへ接続し、作業フォルダを共有した音声・文字のライブ会話を利用。どちらも `aidiy_code` / `aidiy_live` で単独ウィンドウ起動が可能。さらに開発スペース（`aidiy_ide`）の部品としても動作し、IDE の「＋ Code」「＋ Live」から同じプロジェクトの Code / Live を開けます

---

## 0. 事前準備

### 必要なソフトウェア

| ソフトウェア | 目安 |
|---|---|
| Python | バックエンド・Hermes の宣言条件は 3.13 以上。uv が対象仮想環境を選択 |
| Node.js / npm | 全体構成では Node.js 22.13 以降を推奨。モジュール別条件は下記参照 |
| Git | 最新版推奨 |
| uv | Python パッケージ管理に使用 |
| Electron / Vue 3 | 各モジュールの npm 依存として導入。グローバル導入は不要 |
| VS Code | Code / Live **拡張**を使う場合のみ。宣言条件 `^1.106.0`、単独 Electron / Web では不要 |

実際の条件は各 `pyproject.toml` / `package.json` と依存 metadata を参照します。新しい版数確認は警告して続行し、コマンド未導入・実行失敗はエラーとして扱います。Diag の従来からの Node.js 18 未満停止は維持します。詳しくは[モジュール別の実行環境](./_AIDIY/knowledge/共通,開発環境運用手順.md#モジュール別の実行環境)を参照してください。

### リポジトリ取得

```bash
git clone https://github.com/Monjyu1101/AiDiy2026
cd AiDiy2026
```

---

## 1. セットアップ

初回は次を実行します。

```bash
python _setup.py
```

`_setup.py` は対話形式で以下を実施します。

1. 共通の Python / npm ツール確認
2. `backend_local` の `uv sync --upgrade`
3. `backend_tools` の `uv sync --upgrade`、必要に応じて MCP 設定ファイル書き込み（Claude / Gemini 向け）
4. `backend_server` の `uv sync --upgrade`
5. `backend_taskteam` の `uv sync --upgrade`
6. `frontend_web` の `npm install`
7. `frontend_avatar` の `npm install`、必要に応じて Electron バイナリの補完
8. `command_hermes` の `.venv` 作成 / `uv sync --upgrade` / `aidiy_hermes` 登録試行
9. `frontend_ide` の共通Vue依存、Navigator / Console / Code / Live / IDE / Task / Team / Browserのセットアップ、ランチャー登録、Code / LiveのVS Code拡張配置
10. `frontend_channels` のDiscord依存・パネル・ランチャー準備
11. `frontend_channels/slack` のSlack依存・パネル・ランチャー準備

Diagを選択した場合は診断UI・Electron・ランチャーを準備し、最後にheadless診断で導入状況とモデル情報を書き込みます。外部連携の認証試験はheadless対象外です。

補足:

- DB は SQLite です。
- Alembic は使いません。
- PostgreSQL 関連処理は現在の通常運用では使いません。
- API キー設定ファイル `_config/AiDiy_key.json` は初回起動時にひな形が生成されます。

---

## 2. 起動

### 推奨

```bash
python _start.py
```

`_start.py` は**対話形式**です。起動時に以下を確認します。

- バックエンド(local) を起動するか（デフォルト No）
- tools を起動するか
- バックエンド(core, apps) を起動するか
- バックエンド(task,team) を起動するか
- フロントエンド(Web) を起動するか
- フロントエンド(Avatar) を起動するか
- フロントエンド(IDE) を起動するか（デフォルト No、ポート自動割り当て）
- フロントエンド(Discord) を起動するか（デフォルト No）
- フロントエンド(Slack) を起動するか（デフォルト No）

その後、選択したサービスを順に起動し、必要なポートの既存プロセスも自動で整理します。

`command_hermes` は **常駐サーバーではないため `_start.py` の起動対象外** です。セットアップ後は、AIコードパネルから `aidiy_hermes` として呼び出すか、必要時に手動で起動します。
`frontend_ide/host` も常駐サービスではありません。セットアップ後は VS Code のコマンドパレットから **AiDiy (Code): チャットを開く** / **AiDiy (Live): ライブ会話を開く**を実行します。単独ウィンドウは作業フォルダで `aidiy_code` / `aidiy_live`を実行します。Live は `backend_server`（8091）の起動が必要です。

`frontend_channels` は `_config/AiDiy_key.json` の `DISCORD_*` を設定後、全体 `_start.py` で選択して起動します（デフォルト No）。`aidiy_discord` または `cd frontend_channels && npm start` での個別起動も可能です。保存済みの設定（`~/.aidiy/aidiy_discord.json`）があれば起動時に自動接続し、初回はモデル設定画面から始まります。専用テキストチャンネルへの普通の投稿に Hermes が返信し、専用ボイスチャンネルへの入退室に合わせて AIコアとの音声会話を自動開始・終了します。導入と権限設定は [frontend_channels/README.md](./frontend_channels/README.md) を参照してください。

`frontend_channels/slack` は `_config/AiDiy_key.json` の `slack_*` を設定後、同じく全体 `_start.py` で選択するか `aidiy_slack` で起動します（デフォルト No）。Discord 版と双子の接続パネルで、専用チャンネルへの投稿にスレッドで返信します（HTTPS の定期取得、音声なし）。保存は `~/.aidiy/aidiy_slack.json` です。導入は [frontend_channels/slack/README.md](./frontend_channels/slack/README.md) を参照してください。

Navigator はセットアップ後に `aidiy_navi` で単独起動するか、IDE の「＋ Navigator」から開きます。全体 `_start.py` の自動起動対象ではありません。使い方は [frontend_ide/README.md](./frontend_ide/README.md) を参照してください。

### 個別起動

```bash
# バックエンド Local（OpenAI 互換 Gemma、必要時のみ）
cd backend_local
.venv/Scripts/python.exe -m uvicorn local_main:app --reload --host 127.0.0.1 --port 8096 --ws-max-size 20971520

# バックエンド MCP
cd backend_tools
.venv/Scripts/python.exe -m uvicorn tools_main:app --reload --host 127.0.0.1 --port 8095 --ws-max-size 20971520

# バックエンド Core
cd backend_server
.venv/Scripts/python.exe -m uvicorn core_main:app --reload --host 0.0.0.0 --port 8091 --ws-max-size 20971520

# バックエンド Apps
cd backend_server
.venv/Scripts/python.exe -m uvicorn apps_main:app --reload --host 0.0.0.0 --port 8098 --ws-max-size 20971520

# バックエンド TaskTeam
cd backend_taskteam
.venv/Scripts/python.exe -m uvicorn taskteam_main:app --reload --host 0.0.0.0 --port 8093 --ws-max-size 20971520

# Command Hermes（対話 CLI）
cd command_hermes
.venv/Scripts/python.exe cli_main.py

# またはグローバル登録済みなら
aidiy_hermes

# フロントエンド Web
cd frontend_web
npm run dev

# フロントエンド Avatar
cd frontend_avatar
npm run dev
```

### 起動後の URL

| サービス | URL |
|---|---|
| Web フロント | http://127.0.0.1:8090 |
| Core API Docs | http://127.0.0.1:8091/docs |
| Apps API Docs | http://127.0.0.1:8098/docs |
| Backend Local Docs | http://127.0.0.1:8096/docs |
| Backend TaskTeam Docs | http://127.0.0.1:8093/docs |
| Backend MCP 一覧 | http://127.0.0.1:8095/ |
| Backend MCP ツール一覧 | http://127.0.0.1:8095/{mcp_name}/list |
| Backend MCP SSE 接続 | http://127.0.0.1:8095/{mcp_name}/sse （例: `aidiy_chrome_devtools`） |
| Avatar Web モード | http://127.0.0.1:8092 |
| Avatar Electron モード | `npm run dev` で Electron アプリ起動 |

MCP は Windows で20、Linux / macOS で19サーバー（Windows Control は Windows のみ。`aidiy_chrome_devtools` / `aidiy_desktop_capture` / `aidiy_sqlite` / `aidiy_postgres` / `aidiy_logs` / `aidiy_code_check` / `aidiy_backup` / `aidiy_image_generation` / `aidiy_movie_generation` / `aidiy_speech_to_text` / `aidiy_text_to_speech` / `aidiy_obs_studio_control` / `aidiy_ffmpeg_control` / `aidiy_notification_sounds` / `aidiy_code_agents` / `aidiy_chat_llms` / `aidiy_decisions_check` / `aidiy_task_agents` / `aidiy_team_agents` / `aidiy_windows_control`）です。詳細は [backend_tools/AGENTS.md](./backend_tools/AGENTS.md) を参照してください。
`aidiy_chrome_devtools` は `session` パラメータ（省略時 `default`）で複数の Chrome を並行セッション管理でき、システムテストの自動実行など並行実行が可能です（使用後は `close_session` で破棄）。

### 初期ログイン

- `admin / ********`
- `leader / secret`
- `user / user`
- `guest / guest`
- `other / other`

注意:

- 初期データ投入は **admin が未存在のときだけ** 実行されます。
- 既存 DB がある場合、初期ユーザー情報は自動更新されません。

---

## 3. 停止

全体起動の起動前整理・Ctrl+C・リブートでは Code / IDE / Discord / Slack は継続します。IDE は自動再起動せず、cleanup 時に停止します。

### `_start.py` で起動した場合

ターミナルで `Ctrl+C` を押してください。

### 手動で止めたい場合

`_stop.py` は現在ありません。必要ならポート使用プロセスを手動停止してください。

```powershell
netstat -ano | findstr :8090
netstat -ano | findstr :8091
netstat -ano | findstr :8098
netstat -ano | findstr :8093
netstat -ano | findstr :8096
netstat -ano | findstr :8095
netstat -ano | findstr :8092
taskkill /PID <pid> /F
```

補足:

- `_start.py` を再実行すると、対象ポートの既存プロセスは起動前に自動整理されます。
- バックエンドのみ再読込したい場合は `backend_server/temp/reboot_core.txt` または `backend_server/temp/reboot_apps.txt` を作成します。
- TaskTeam のみ再読込したい場合は `backend_taskteam/temp/reboot_taskteam.txt` を作成します。
- `command_hermes` はポート待受しない CLI のため、必要なら `Ctrl+C` でその場のプロセスだけ停止します。

---

## 4. クリーンアップ

環境を渡し直す、または開発環境を整理したい場合は次を実行します。

```bash
python _cleanup.py
```

主に次を対話的に削除します。

- `.venv`
- `node_modules`
- `dist`
- `__pycache__`
- `temp`
- `logs`
- 必要に応じて SQLite DB

`_cleanup.py` は `command_hermes` の `.venv` / `venv` と Python キャッシュに加え、`frontend_ide/host` の配置済み拡張機能（Code / Live）、単独起動ランチャー（`aidiy_code` / `aidiy_live`）、`node_modules`、`dist`、`out` も削除対象として確認します。
`frontend_channels` と `frontend_channels/slack` の依存物・生成物・キャッシュも削除対象です（既定 Yes）。削除前に実行パスを照合して Bot を停止し、全体監視の自動再起動も止めます。共通 `AiDiy_key.json` の Discord / Slack 設定は保持します。

`frontend_ide/viewer` も全体クリーンアップに対応しています（既定 Yes）。この配置先のサーバープロセス停止、`aidiy_ide` ランチャー解除、依存物・Python キャッシュの削除を行います。利用方法は [frontend_ide/viewer/README.md](./frontend_ide/viewer/README.md) を参照してください。
クリーンアップを実行すると、ファイル削除の前に、選択した対象に限らず全常駐サービスの待受プロセス（Avatar は残留 Electron も含む）を停止します。この作業コピーの Code / Live 単独実行と、tools の MCP 接続プロセスも終了します。ルート `_start.py` の監視中でも全常駐サービスが自動再起動の対象から外れ、クリーンアップ中や直後に再起動しません。

cleanup のために新しい Python / Node.js や対象仮想環境は要求しません（管理スクリプト自体を実行できる Python は必要）。選択したグローバル npm ツール・VS Code 拡張の解除には対応 CLI を使いますが、OS の Python / Node.js / VS Code 本体は削除しません。削除・解除に失敗した場合は場所を表示して終了コード 1 を返し、成功扱いにしません。

クリーンアップ後の残骸・資料確認は [cleanup後の確認](./_AIDIY/knowledge/共通,クリーンアップ手順.md) に従います。再起動には再度 `python _setup.py` が必要です。

---

## 5. よくある注意点

- `_start.py` は **CLI 引数で backend/web/avatar を切り替える方式ではありません**。起動時の対話で選びます。
- Claude 系のブラウザ自動操作を使う場合は `backend_tools` も起動してください。
- `_start.py` 起動時のバックエンドは `uvicorn --reload` なしです。コード変更を即反映したい場合は個別起動か reboot 機構を使います。
- `command_hermes` は `_start.py` では起動しません。`python _setup.py` で導入し、`aidiy_hermes` または `command_hermes\cli_main.py` を必要時に実行します。
- `frontend_ide/host` は `_start.py` の対象ではありません。拡張の設定や対応範囲は Code が `frontend_ide/host/README.md`、Live が `frontend_ide/host/aidiy_live/README.md` を参照してください。
- Web フロントの AI 画面ルートは **`/AiDiy`** です。
- Avatar は Electron と Web の両モードがあります。Web モードでは認証情報を `sessionStorage` に保持します。
- DB ファイルは通常 `_data/AiDiy/database.db` にあります。

---

## 6. 次に読むもの

1. [AGENTS.md](./AGENTS.md)
2. [backend_server/AGENTS.md](./backend_server/AGENTS.md)
3. [command_hermes/AGENTS.md](./command_hermes/AGENTS.md)
4. [backend_tools/AGENTS.md](./backend_tools/AGENTS.md)
5. [backend_local/AGENTS.md](./backend_local/AGENTS.md)
6. [backend_taskteam/AGENTS.md](./backend_taskteam/AGENTS.md)
7. [frontend_web/AGENTS.md](./frontend_web/AGENTS.md)
8. [frontend_avatar/AGENTS.md](./frontend_avatar/AGENTS.md)
9. [backend_diag/AGENTS.md](./backend_diag/AGENTS.md) — Diag の診断・Vue 画面
10. [frontend_ide/AGENTS.md](./frontend_ide/AGENTS.md) — Navigator / Console / Code / Live / IDE / Task / Team / Browser の共通 Vue 画面
11. [frontend_ide/host/AGENTS.md](./frontend_ide/host/AGENTS.md) — Code / Live の拡張ホスト・通信
12. [frontend_channels/AGENTS.md](./frontend_channels/AGENTS.md) — Discord の接続・Vue パネル
13. [frontend_channels/slack/AGENTS.md](./frontend_channels/slack/AGENTS.md) — Slack の接続・Vue パネル（Discord の双子）
14. [frontend_ide/viewer/AGENTS.md](./frontend_ide/viewer/AGENTS.md) — ファイルAPI・Office表示
15. [docs/開発ガイド/README.md](./docs/開発ガイド/README.md)


## 著作権・ライセンス

Copyright (c) 2014-2026 Mitsuo KONDOU and contributors

AiDiy 独自部分の利用条件は [AiDiy 公開利用ライセンス v1.1](./LICENSE) を参照してください。非商用利用に限る公開ライセンスで、OSI が定義するオープンソースライセンスではありません。商用利用には事前に全著作権者の書面承諾が必要です。再配布時はライセンス全文と著作権表示を含めてください。

第三者のコード・ライブラリ・画像等は、それぞれのライセンスと表示を確認・保持してください。主な確認先は [Hermes の出典](./command_hermes/NOTICE.md)、[IDE ビューアの第三者表記](./frontend_ide/viewer/web/THIRD_PARTY_NOTICES.txt)、[Discord パネル](./frontend_channels/panel/THIRD_PARTY_NOTICES.txt)、[Slack パネル](./frontend_channels/slack/panel/THIRD_PARTY_NOTICES.txt)、[Diag UI](./backend_diag/ui/THIRD_PARTY_NOTICES.txt) および各資材に付属する LICENSE / NOTICE です。この一覧は第三者資材の全件一覧ではありません。
