# command_hermes 実装概要

## 本書の目的

このファイルは `command_hermes` の位置づけ、構成、実装入口を示す概要ドキュメントです。
起動方法、CLI オプション、確認コマンドなどの HowTo は `_AIDIY/knowledge` に移動しています。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。
業務システム機能追加は `../docs/` の開発ガイドを優先し、コアシステム機能調整は `../_AIDIY/knowledge/_index.md` を入口にします。

## HowTo 参照先

| 目的 | 参照先 |
|------|--------|
| `aidiy_hermes` の起動、provider、CLI 確認 | [`../_AIDIY/knowledge/command_hermes,backend_server,運用手順.md`](../_AIDIY/knowledge/command_hermes,backend_server,運用手順.md) |
| TUI、slash command、補完、spinner の調整 | [`../_AIDIY/knowledge/command_hermes,TUI調整手順.md`](../_AIDIY/knowledge/command_hermes,TUI調整手順.md) |
| Code CLI として AiDiy に追加・調整する | [`../_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md`](../_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md) |
| Code CLI のプロンプト整形 | [`../_AIDIY/knowledge/backend_server,CodeCLIプロンプト整形.md`](../_AIDIY/knowledge/backend_server,CodeCLIプロンプト整形.md) |
| CLI 出力の ANSI 制御コード対処 | [`../_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md`](../_AIDIY/knowledge/backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md) |
| Provider 一覧と選択ロジック | [`../_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md`](../_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md) |
| Slash Command 一覧と追加手順 | [`../_AIDIY/knowledge/command_hermes,Slash Command一覧.md`](../_AIDIY/knowledge/command_hermes,Slash Command一覧.md) |
| upstream hermes-agent の新版へ移植する | [`../_AIDIY/knowledge/command_hermes,upstream移植手順.md`](../_AIDIY/knowledge/command_hermes,upstream移植手順.md) |

## 概要

`command_hermes` は AiDiy に統合された on-demand のコードエージェント CLI **AiDiy Hermes（AiDiy_hermes）** です。
自己紹介・利用者向け表示にはこの製品名、実行コマンドには `aidiy_hermes` を使います。上流由来のモジュール名・スキルID・環境変数と製品名を区別します。
upstream の `hermes-agent` 0.21 系を取り込み、AiDiy 固有のレイヤだけを重ねています。

- 常駐 HTTP サーバーではない。
- 実行名は `aidiy_hermes`。
- `_start.py` の常駐起動対象ではない。
- `_setup.py` / `_cleanup.py` の対象。
- `backend_server` の AI コードパネルでは `CODE_AI*_NAME = "aidiy_hermes"` として呼び出される。

## 技術スタック

| 項目 | 内容 |
|------|------|
| 言語 | Python |
| 依存管理 | `pyproject.toml` / `uv sync --upgrade` |
| TUI | `prompt_toolkit` |
| 通信 | `requests`、`httpx`、OpenAI 互換 client、Claude API 連携 |
| MCP サーバー | MCP SDK 2.x の `MCPServer`（`hermes mcp serve`） |
| upstream | hermes-agent 0.21.0 |
| 実行方式 | 単体 CLI / subprocess 呼び出し |

## Windows ホストでの動作

upstream 0.21 は Windows ネイティブ実行を本体側で対応しています。`tools/environments/local.py`
が Git Bash（`HERMES_GIT_BASH_PATH` / PortableGit / `Program Files\Git`）を探索し、MSYS 形式パスと
Windows パスを相互変換します。`process_registry` は `winpty`、非 Windows は `ptyprocess` を使い、
`os.setsid` / `fcntl` は Windows では呼びません。

このため 0.12 系で AiDiy が持っていた `*_win.py` / `*_linux.py` の platform selector 層は廃止しました。
`file_operations.py`、`file_tools.py`、`terminal_tool.py`、`process_registry.py` は upstream のまま単一実装です。

Windows では Git for Windows（Git Bash）が必須です。見つからない場合、`terminal` ツールは
インストールを促すエラーを返します。

## Provider 概要

provider は API provider と CLI bridge の両方を扱います。`hermes_cli/providers.py` に 42 の provider
overlay と 89 のエイリアスがあり、`--provider` / config / 環境変数 / `auto` の優先順位で解決します。
これとは別に `cli_main.py` が `_config/AiDiy_key.json` 由来の AiDiy provider 一覧（`/model` ピッカー）
と外部 CLI ディスパッチを持ちます。

詳細な一覧と選択ロジックは `_AIDIY/knowledge/command_hermes,Provider一覧と選択ロジック.md` を参照してください。

## ディレクトリ構成

upstream のレイアウトを次の 3 点だけ読み替えています。

- upstream のリポジトリ直下モジュール → `base/`
- upstream の `agent/` パッケージ → `core/`
- upstream の `cli.py` → `cli_main.py`

読み替えは `cli_main.py` 冒頭の layout shim が行います。`sys.path` に `base/` と本ディレクトリを追加し、
`sys.modules["agent"] = core`、`sys.modules["cli"] = cli_main` を登録するので、upstream 由来のコードは
`from agent...` / `from cli import ...` のまま動きます。**upstream 由来コードの import 文は書き換えないでください。**

| パス | 役割 |
|------|------|
| `cli_main.py` | CLI エントリ、TUI、slash command、AiDiy provider/model ピッカー |
| `hermes_main.py` | `hermes auth` / `hermes model` などの管理サブコマンド入口 |
| `core/` | upstream `agent/`。agent loop、prompt、display、retry、adapter |
| `base/` | upstream ルートモジュール。`utils`、`toolsets`、`run_agent`、`hermes_constants` など |
| `hermes_cli/` | slash command、CLI mixin、設定、認証、TUI 補助 |
| `tools/` | file / terminal / web / media / planning / process / MCP |
| `gateway/`、`tui_gateway/`、`cron/`、`acp_adapter/` | upstream 互換。AiDiy では常駐させない |
| `plugins/`、`providers/` | plugin 拡張、provider 基底 |
| `skills/`、`optional-skills/` | skill 資産 |
| `optional-mcps/` | MCP サーバーカタログ（65 件の manifest、既定は無効）。`hermes_cli/mcp_catalog.py` が実行時に読む |
| `locales/`、`assets/`、`scripts/`、`native/` | i18n カタログ、静的資産、bootstrap スクリプト |
| `temp/` | 一時状態 |

## AiDiy 連携

`aidiy_hermes` は `backend_server/AIコア/AIコード_cli.py` から subprocess で起動されます。
モデル設定は `CODE_AIDIY_HERMES_MODEL` を使い、モデル一覧は `backend_server/conf/conf_model.py` 側で動的生成します。

主な連携箇所:

- `backend_server/AIコア/AIコード_cli.py`
- `backend_server/conf/conf_json.py`
- `backend_server/conf/conf_model.py`
- `frontend_web` / `frontend_avatar` の AI 設定画面

## 変更時の入口

- TUI と slash command は `cli_main.py` と `hermes_cli/commands.py` を起点に確認する。
- tool 追加や toolset 変更は `tools/` と `base/toolsets.py` を確認する。
- AiDiy 本体連携は `backend_server/AIコア/AIコード_cli.py`、`conf_json.py`、`conf_model.py` を確認する。

## upstream 追従時の注意

`hermes-agent` の新版へ差し替えるときは、上記のレイアウト読み替えに加えて次の AiDiy レイヤを再適用します。
手順の全体と落とし穴は [`../_AIDIY/knowledge/command_hermes,upstream移植手順.md`](../_AIDIY/knowledge/command_hermes,upstream移植手順.md)、
移植後の機械的な検証は `python _verify.py --upstream ../hermes-agent-<version>` を使います。

| 対象 | 内容 |
|------|------|
| `cli_main.py` | layout shim / `_AIDIY_*` 設定ブロック / `_aidiy_*` メソッド群 / `chat()` の外部 CLI ディスパッチ / `/model` フック / quiet ワンショットの stderr 進捗 / 長文入力用 `--oneshot-stdin` / `cli_entry` argparse エントリ |
| 自己認識 | `core/prompt_builder.py` の `AIDIY_RUNTIME_IDENTITY` / 既定人格 / 自己機能案内、`core/system_prompt.py` の製品名挿入、`hermes_cli/default_soul.py` と `SOUL.md`、同梱スキル・表示文言 |
| ブランディング | `cli_main.py` の `_AIDIY_RESPONSE_LABEL` / `_AIDIY_WELCOME_TEXT` / `_build_compact_banner()`、`hermes_cli/banner.py` の `HERMES_AGENT_LOGO`（AIDIY-HERMES ワードマーク）と `format_banner_version_label()`、`hermes_cli/_startup_fast.py`、`acp_adapter/server.py` |
| `tools/mcp_tool.py` | `_load_aidiy_mcp_servers()` と `_load_mcp_config()` へのマージ |
| OpenAI サブスク対応 | `cli_main.py` の `openai_oauth` provider（upstream `openai-codex` / ChatGPT OAuth）。`auth_runtime` フラグ、`_openai_oauth_model_ids()`、`_ensure_openai_oauth_auth()` |
| `hermes_cli/auth.py` | `_codex_device_code_login()` でブラウザを自動オープン（`?user_code=` 付き、`HERMES_NO_BROWSER=1` で無効化） |
| `hermes_main.py` | `hermes` サブコマンド（`auth` / `model` / `doctor`）用の入口。AiDiy 独自ファイル |
| `cli_main.py` の `main()` | バンドルスキルの `sync_skills()` と MCP `discover_mcp_tools()` の起動時呼び出し |
| `tools/daemon_pool.py` | Python 3.14 の `ThreadPoolExecutor` 内部変更に対応する `_adjust_thread_count` 分岐 |
| `hermes_cli/main.py` | `_resolve_use_tui()` を常に False（Node/TS TUI は同梱しない） |
| `hermes_cli/_parser.py` | `--tui` / `--dev` のヘルプ文言 |
| `base/hermes_constants.py` | `_INSTALL_ROOT` と `_NODE_BOOTSTRAP_SCRIPT` を `parent.parent` に補正 |
| `pyproject.toml` | upstream の core 依存 + AiDiy 追加分（anthropic / google-genai / fal-client / mcp / windows-curses） |

`ui-tui/`、`web/`、`website/`、`evals/`、`tests/`、`mcp-research-data/`、`datagen-config-examples/`、
`docker/`、`nix/` は upstream から同梱しません（いずれも実行時に参照されません）。AiDiy 固有の `tests/` は別に持ち、標準入力と共用認証ストアの連携を検証します。
upstream ルートの `setup.py` は wheel ビルド用のガードなので `base/` へは置きません。

### バンドル資産の実行時配置

`skills/` は「配布元」で、実体は `HERMES_HOME/skills` へ同期されて初めて認識されます。
upstream はこの同期を `hermes_cli.main` の各エントリで行いますが、AiDiy の入口は `cli_main.py` なので
そこを通りません。`cli_main.py` の `main()` で `tools.skills_sync.sync_skills(quiet=True)` を呼んでいます。
これを外すとスキルが 0 件になります（`optional-mcps/` はリポジトリ内を直接読むので同期不要）。
