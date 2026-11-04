# upstream hermes-agent 移植手順

> 文書: `command_hermes,upstream移植手順.md` | 実装: `command_hermes/_verify.py`, `command_hermes/cli_main.py`, `command_hermes/hermes_main.py`, `command_hermes/AGENTS.md`, `command_hermes/base/hermes_constants.py`, `command_hermes/tools/mcp_tool.py`, `command_hermes/tools/daemon_pool.py`, `command_hermes/hermes_cli/auth.py`, `command_hermes/hermes_cli/banner.py`

## このメモを使う場面

- upstream [`hermes-agent`](https://github.com/nousresearch/hermes-agent) の新版（0.3x など）を `command_hermes` へ取り込むとき
- 取り込み後に `aidiy_hermes` が起動しない / スキルや MCP が 0 件になったとき
- AiDiy 独自改変がどこに何件あるかを確認したいとき

現行ベースは `command_hermes/pyproject.toml` と `base/hermes_constants.py` で確認します。旧版のファイル分類表ではなく、現行の AiDiy レイヤと `_verify.py` を同期元にします。

## 基本方針: 差分マージではなく「全面再取り込み + AiDiy レイヤ再適用」

upstream は minor バージョン間でもディレクトリ構成と関数分割が大きく変わります。
0.12 → 0.21 では `cli.py` が 12,275 → 22,426 行になり、その一部が `hermes_cli/cli_*_mixin.py` へ切り出されました。
**差分マージは破綻します。** 次の順で進めてください。

1. upstream を丸ごとコピーする（レイアウト読み替え 3 点のみ適用）
2. AiDiy レイヤを再適用する（下記チェックリスト）
3. `_verify.py` で機械的に検証する

「upstream から機能を削って小さくする」方針は取りません。0.12 の抽出はそれをやっていましたが、
削った箇所を新版で再現するコストが移植のたびに発生します。全部入れて AiDiy レイヤだけ重ねる方が安全です。

## レイアウト読み替え（3 点のみ）

| upstream | command_hermes |
|----------|----------------|
| リポジトリ直下の `*.py` | `base/` |
| `agent/` パッケージ | `core/` |
| `cli.py` | `cli_main.py` |

読み替えは `cli_main.py` 冒頭の **layout shim** が担います。`sys.path` に `base/` と `command_hermes/` を追加し、
`sys.modules["agent"] = core` と `sys.modules["cli"] = cli_main` を登録します。

**upstream 由来コードの import 文は書き換えないでください。**
`from agent.xxx import` / `from hermes_constants import` / `from cli import` はそのまま動きます。
`from base.xxx import` / `from core.xxx import` と書くと同じモジュールが二重ロードされ、モジュールレベル状態が分裂します。

## 手順

### Step 1. 作業状態と復元点を確認する

`git status --short` と `git diff -- command_hermes` で既存編集を確認し、取り込み前のコミットを記録します。
他の作業者の未コミット変更を上書きしません。旧版フォルダや `_old.md` は作らず、過去の実装は Git の履歴から参照します。
ユーザー設定・認証情報・会話履歴は移植対象に含めません。

### Step 2. 現行の AiDiy レイヤを控える

```powershell
cd command_hermes
findstr /S /N /C:"AiDiy" /C:"aidiy" *.py
```

表示名・スキル説明も AiDiy Hermes に揃えているため、該当ファイルは広範囲にあります。
実装上の主要な再適用箇所は `_verify.py` の `AIDIY_LAYER` 定数、表記統一は下記「製品名と自己認識」で確認します。

### Step 3. upstream を丸ごと展開

`.venv` と AiDiy 専用ファイル（下表）だけ残し、それ以外を削除してから upstream をコピーします。

**残すもの**: `.venv`、`_setup.py`、`_start.py`、`_cleanup.py`、`_verify.py`、`hermes_main.py`、`aidiy_hermes_exec.bat`、
`aidiy_hermes_logo.txt`、`AGENTS.md`、`NOTICE.md`、`pyproject.toml`、`uv.lock`、`temp`、AiDiy 固有の `checks/`

**コピーするもの**: `agent/`→`core/`、ルート `*.py`→`base/`（`cli.py`・`setup.py` を除く）、`cli.py`→`cli_main.py`、
`tools/`、`hermes_cli/`、`gateway/`、`plugins/`、`cron/`、`acp_adapter/`、`tui_gateway/`、`providers/`、
`skills/`、`optional-skills/`、`optional-mcps/`、`locales/`、`native/`、`assets/`、`scripts/`

**upstream からコピーしないもの**（実行時に参照されないことを確認済み）: `ui-tui/`、`web/`、`website/`、`evals/`、`tests/`、
`tests-js/`、`docker/`、`nix/`、`docs/`、`contributors/`、`mcp-research-data/`、`datagen-config-examples/`、`apps/`

upstream ルートの `setup.py` は wheel ビルド用ガードです。`base/` に置くと `import setup` を汚すので除外します。

### Step 4. AiDiy レイヤを再適用

下の「AiDiy レイヤ一覧」を上から順に当てます。取り込み前コミットの該当ブロックを参照して、
新版の対応する場所へ差し込むのが基本です。

### Step 5. 依存関係

`pyproject.toml` を upstream の `[project].dependencies`（core のみ、extras は不要）+ AiDiy 追加分
（`anthropic` / `google-genai` / `fal-client` / `mcp>=2,<3` / `windows-curses`）へ更新し、`uv sync --upgrade`。

Python 条件は現行 `requires-python`（`>=3.13`）、依存条件は `pyproject.toml` を基準にします。AiDiy には `mcp>=2,<3` や `urllib3>=2.7.0,<3` などの制約もあるため、「すべて版指定なし」として上書きしません。OS 条件付き依存も保持します。

### Step 6. 検証

```powershell
cd command_hermes
.venv\Scripts\python.exe _verify.py --upstream ..\hermes-agent-0.31
.venv\Scripts\python.exe _verify.py --full     # LLM 疎通まで
```

`_verify.py` が見るもの:

1. upstream との**網羅性**（ディレクトリごとのファイル差分、upstream 側の新規トップレベルディレクトリ検知）
2. **AiDiy レイヤ**の再適用漏れ（ファイルごとの目印文字列）
3. `core/` `tools/` `hermes_cli/` `base/` の**全モジュール import**
4. **ランタイム資産**（スキル件数、MCP カタログ件数、AiDiy MCP 件数、シェル検出、terminal / read_file 疎通）
5. **CLI スモーク**（`--version` / `--list-tools` / `-Q -z`）

新しく AiDiy 改変を足したら `_verify.py` の `AIDIY_LAYER` に目印を追記してください。次回の移植漏れ検知に効きます。

### Step 7. TUI の実操作確認

`_verify.py` は非対話部分しか見ません。`aidiy_hermes_exec.bat` を cmd から実行して、
起動バナー、`/model` ピッカー（provider 選択・モデル選択・type-to-filter）、`/help`、応答ボックスを目視してください。
Git Bash などの非コンソール環境では `NoConsoleScreenBufferError` になり TUI は起動しません。

## AiDiy レイヤ一覧（再適用チェックリスト）

| ファイル | 内容 |
|----------|------|
| `cli_main.py` | **layout shim**（`sys.path` + `sys.modules["agent"]` + `sys.modules["cli"]`） |
| `cli_main.py` | `_AIDIY_*` 設定ブロック（`AiDiy_key.json` 参照、外部 CLI provider 定義、`_OPENAI_OAUTH_*`） |
| `cli_main.py` | `_aidiy_*` メソッド群（provider 一覧、`/model` ピッカー、モデル一覧取得、外部 CLI サブプロセス実行） |
| `cli_main.py` | `HermesCLI.__init__` の `_aidiy_config` / `_aidiy_provider_slug` |
| `cli_main.py` | `chat()` 冒頭の外部 CLI ディスパッチ |
| `cli_main.py` | `_handle_model_switch()` の `_handle_aidiy_model_command()` フック |
| `cli_main.py` | `_handle_model_picker_selection()` / `_get_model_picker_display()` の `source == "aidiy"` 分岐 |
| `cli_main.py` | ステータスバーの CLI provider 名表示 |
| `cli_main.py` | ブランディング（`_AIDIY_RESPONSE_LABEL` / `_AIDIY_WELCOME_TEXT` / `_build_compact_banner()`） |
| `cli_main.py` | `main()` 冒頭の `sync_skills()` と `discover_mcp_tools()` |
| `cli_main.py` | `_OneShotStderrProgress` と quiet 分岐（途中経過は stderr、最終回答だけ stdout） |
| `cli_main.py` | `cli_entry()` argparse エントリ（`-Q` / `-z` / 長文入力用 `--oneshot-stdin` / `--provider` / `--model` ほか）と `text_main()` |
| `hermes_main.py` | `hermes` サブコマンド入口（AiDiy 専用ファイル。upstream には無い） |
| `base/hermes_constants.py` | `_INSTALL_ROOT` と `_NODE_BOOTSTRAP_SCRIPT` を `parent.parent` へ補正 |
| `tools/mcp_tool.py` | `_load_aidiy_mcp_servers()` と `_load_mcp_config()` へのマージ |
| `tools/daemon_pool.py` | Python 3.14 の `ThreadPoolExecutor` 内部変更対応 |
| `hermes_cli/main.py` | `_resolve_use_tui()` を常に False |
| `hermes_cli/_parser.py` | `--tui` / `--dev` のヘルプ文言 |
| `hermes_cli/auth.py` | Codex デバイスコードログインでブラウザ自動オープン |
| `hermes_cli/banner.py` | AIDIY-HERMES ロゴ、`format_banner_version_label()` |
| `hermes_cli/_startup_fast.py`、`acp_adapter/server.py` | バージョン表記 |
| `pyproject.toml` | 依存（Step 5） |

## 落とし穴（0.21 移植で実際に踏んだもの）

### 1. `from cli import ...` が解決できない

0.21 は `cli.py` の一部を `hermes_cli/cli_*_mixin.py` へ切り出し、そこから `cli` を**逆参照**します（91 箇所）。
`cli_main.py` にリネームしただけでは `ModuleNotFoundError: No module named 'cli'` になります。
layout shim で `sys.modules.setdefault("cli", sys.modules[__name__])` を登録します。
モジュール本体の実行前に登録しても、属性は本体の実行に従って埋まるので問題ありません。

### 2. スキルが 0 件になる

**hermes は `skills/` を直接読みません。** `HERMES_HOME/skills`（AiDiy の既定は `~/.hermes/skills`）へ
同期されたものだけを見ます。同期は upstream では `hermes_cli/main.py` の各エントリが `sync_skills()` を呼んで行いますが、
AiDiy の入口は `cli_main.py` なのでそこを通りません。`main()` で明示的に呼びます。

同種の「ファイルは置いたが `HERMES_HOME` 側の初期化が要る」パターンに注意してください。
`optional-mcps/` はリポジトリ内を直接読むので同期不要、という具合に資産ごとに違います。

### 3. `optional-mcps/` のコピー漏れ

MCP サーバーカタログ（65 件）。`hermes_cli/mcp_catalog.py` が
`Path(__file__).parent.parent / "optional-mcps"` を読むので、無いとカタログが 0 件になります。
エラーにならず静かに空になるため気付きにくい箇所です。

### 4. Python 3.14 で `daemon_pool` が壊れる

upstream は `requires-python = ">=3.11,<3.14"`。AiDiy は 3.14 の venv で動かしています。
3.14 は `ThreadPoolExecutor` の worker 引数が `(ref, ctx, work_queue)` へ変わり、`_initializer` / `_initargs`
属性が消えました。`tools/daemon_pool.py` がそれを前提に `_adjust_thread_count()` を再実装しているため、
**ツール実行が全滅**します（`'DaemonThreadPoolExecutor' object has no attribute '_initializer'`）。
`_create_worker_context` の有無で分岐させます。3.14 固有の不具合を見たら、まず「upstream が 3.14 未対応なだけ」を疑ってください。

### 5. `/model` ピッカーがタプルで落ちる

upstream はモデル一覧を**文字列のリスト**、AiDiy は `(表示ラベル, model_id)` の**タプル**で持ちます。
0.21 で追加された type-to-filter がタプルをそのまま文字列連結して
`can only concatenate str (not "tuple") to str` になりました。
`_model_picker_entry_label()` でラベル化し、フィルタ判定にも同じ関数を使います。
さらに**選択 index は絞り込み後の並びを指す**ので、`state["_filtered_pairs"]` 経由で元 entry に戻す必要があります
（ここを直さないと、文字を打って絞り込んだとき別のモデルが選ばれます）。

### 6. Windows の platform selector は 0.21 で不要になった

0.12 では `file_operations` / `file_tools` / `terminal_tool` / `process_registry` を
`*_win.py` / `*_linux.py` に分割していましたが、0.21 は upstream 本体が Windows ネイティブ対応
（Git Bash 探索、MSYS パス変換、winpty、`setsid`/`fcntl` 回避）を持ちます。**分割層は廃止しました。**
再導入しないでください。詳細は [`command_hermes,Windows対応規則.md`](./command_hermes,Windows対応規則.md)。

### 7. ブランディングの移植漏れ

`hermes_cli/banner.py` の `HERMES_AGENT_LOGO` は upstream ロゴで上書きされます。
ロゴ・枠タイトル・Welcome 行・コンパクトバナー・バージョン行の 5 箇所すべてを確認してください。
`_verify.py` の `AIDIY_LAYER` がこれらを見ています。

### 8. HERMES_HOME の既定が変わった（0.21）

Windows の既定が `~/.hermes` から `%LOCALAPPDATA%\hermes` へ変更されました。
**セッション・メモリ・skills・auth.json・config.yaml がまるごと別の場所になり、エラーも出ずに空から始まります。**
`cli_main.py` / `hermes_main.py` の layout shim で `HERMES_HOME` を `~/.hermes` に固定しています。
新版を取り込むときは `hermes_constants._get_platform_default_hermes_home()` の実装を必ず確認してください。

### 9. 「config.yaml しか見ない」新ガードで AiDiy MCP が消える

0.21 は AiDiy MCP（`AiDiy_mcp.json` 由来）を落とす箇所を **3 つ**足しました。いずれもエラーにならず静かに消えます。

| 箇所 | 症状 | 対処 |
|------|------|------|
| `hermes_cli/tools_config.py::enabled_mcp_server_names()` | `config.yaml` の `mcp_servers` だけを見るため、`mcp-aidiy_*` toolset が有効にならず AiDiy のツールがモデルへ届かない | `_load_aidiy_mcp_servers()` を合流させる |
| `hermes_cli/banner.py` の cheap probe | 起動バナーの「MCP Servers」セクションが丸ごと消える | probe に AiDiy 分の判定を足す |
| `tools/mcp_tool.py` の接続・表示 | `type` と `transport` の判定差で表示と実通信が食い違う | [MCP 接続の切り分け](./command_hermes,backend_tools,MCP_SSE接続.md)に従い、接続側と表示側を両方確認する |

**共通の教訓**: upstream が `config.yaml` を参照する新しい分岐を足したら、AiDiy の情報源（`AiDiy_key.json` / `AiDiy_mcp.json`）が無視されていないか確認する。
`_setup.py` 側に書き込み先を増やすのではなく、hermes 側を合流させて情報源を 1 つに保ちます。

### 10. Tool Search 階層（0.21 新規）

0.21 は MCP / plugin ツールを `tool_search` / `tool_describe` / `tool_call` の裏へ遅延させる階層を追加しました。
既定 (`auto`) では対象の MCP ツールが名前カタログだけになり、モデルは探索経由でしか呼べません（動きますが遅く、失敗もします）。
`~/.hermes/config.yaml` の `tools.tool_search.enabled: off` で直接渡しへ切り替えられます。毎ターンの入力トークンが増えるため、現行のツール件数で影響を確認します。
中間として `enabled: auto` + `listing_max_tokens: 16000` にすると、説明付きカタログが埋め込まれ発見性が上がります。

### 11. 移植直後は「ファイルがある = 動く」ではない

0.21 移植では網羅性チェックが全て OK でもスキル 0 件・MCP カタログ 0 件でした。
**必ず `_verify.py` のランタイム資産チェック（件数が 0 でないこと）まで確認してください。**

## 移植後の文書確認と復元

- `AGENTS.md`、本書、Provider・TUI・Windows・MCP の関連ナレッジ、`NOTICE.md` と依存宣言を現行実装に合わせます。
- 復元が必要なら、記録したコミットと現在の差分を比較し、今回の移植差分だけを戻します。他の編集・ユーザー設定を一括で巻き戻しません。
- `.venv` は旧版コピーから戻すのではなく、復元した依存宣言と lock に基づいて再同期します。

## 関連

| 目的 | 参照 |
|------|------|
| 実装構成・ディレクトリ役割 | `command_hermes/AGENTS.md` |
| TUI・slash command の調整 | [`command_hermes,TUI調整手順.md`](./command_hermes,TUI調整手順.md) |
| Windows 対応の規則 | [`command_hermes,Windows対応規則.md`](./command_hermes,Windows対応規則.md) |
| provider 一覧と選択ロジック | [`command_hermes,Provider一覧と選択ロジック.md`](./command_hermes,Provider一覧と選択ロジック.md) |
| 起動・運用確認 | [`command_hermes,backend_server,運用手順.md`](./command_hermes,backend_server,運用手順.md) |


## 製品名と自己認識

- 表示名・自己紹介は `AiDiy Hermes` または `AiDiy_hermes`、実行コマンドは `aidiy_hermes` とする。
- `core/prompt_builder.py` の既定人格、`hermes_cli/default_soul.py` の初期人格、配布元 `SOUL.md` を同じ文面に保つ。`scripts/install.sh` / `install.ps1` の初期人格も追従する。
- `core/system_prompt.py` は `AIDIY_RUNTIME_IDENTITY` を人格の後に必ず追加する。利用者の人格・古い記憶を保持しつつ、実行中の製品名を明記する。
- 既存 `HERMES_HOME/SOUL.md` は、既知の未編集テンプレートと完全一致した場合だけ起動時に更新する。独自の追記・人格設定や会話履歴を一括置換しない。
- 自己機能の説明は `command_hermes/AGENTS.md`、AiDiyのナレッジ、現行コードを優先する。`skills/autonomous-ai-agents/hermes-agent/SKILL.md` の冒頭にもこの区別を残す。
- `hermes-agent` のスキルID、Python import、`HERMES_*`、上流URL、パッケージ名は互換性のため維持する。著作者・ライセンス・NOTICE、旧形式の検出文字列も表記統一の対象外。これらの残存を自己紹介への注入と混同しない。
- 上流再取り込み後は `rg -n -i "hermes agent" command_hermes` でソース・同梱スキル・表示資産を確認する。仮想環境、実行記録、バックアップは編集しない。置換時は `.lower()` との比較、旧設定の検出、外部サービスの既存互換処理を確認する。
- 既存会話は古いシステムプロンプトを保持する場合がある。反映確認にはプロセスを再起動して新しい会話を開始する。

確認対象は、既定人格の一致、旧SOUL移行、独自人格の保持、実プロンプトへの製品名挿入、スキルIDと著者表記の互換性です。現行 `checks/` には専用 identity テストがないため、存在しない `tests.test_aidiy_identity` を実行手順にしません。`_verify.py` の静的確認と、新しい会話での実操作確認を分けて記録します。
