# Provider 一覧と選択ロジック

> 文書: `command_hermes,Provider一覧と選択ロジック.md` | 実装: `command_hermes/cli_main.py`, `command_hermes/hermes_cli/providers.py`

## このメモを使う場面

- 新しい AI provider を追加するとき
- provider 選択の優先順位や自動検出ロジックを変更するとき
- `/model` コマンドの interactive picker を調整するとき
- 認証情報（API Key/OAuth）の解決方法を確認するとき

## Provider 解決優先順位

`cli_main.py` では以下の優先順位で provider を決定します。

```
1. --provider CLI フラグ
2. config.yaml の model.provider
3. HERMES_INFERENCE_PROVIDER 環境変数
4. "auto"（runtime 自動検出）
```

`auto` の場合、`_ensure_runtime_credentials()` が環境変数や設定ファイルから認証情報を検出し、利用可能な provider を自動選択します。

`aidiy_hermes --provider same --model same`（または `--model same/same`）は、前回手動で選んだ provider とモデルを復元します。対話起動の明示選択と `/model` の AiDiy picker 選択は `HERMES_HOME/aidiy_model.json`（既定 `~/.hermes/aidiy_model.json`）に保存します。API キーは保存せず、起動時の共通設定と認証ストアから読み直します。保存値がない・壊れている場合は Hermes の通常設定へ戻り、`same` を API provider / モデル名として送信しません。`--ignore-user-config` はこの保存値も無視します。

引数なしの対話起動（`aidiy_hermes`）は `same/same` として前回選択を復元します。`--compact` などの表示設定を付けても同じです。セッション再開（`--resume`）や接続先・キーの明示指定時は、その指定を優先して通常の解決を使います。`--provider auto --model auto`（または `--model auto/auto`）を明示した場合と、非対話実行のモデル未指定も従来の自動解決を使います。AI検索や Code の非対話実行（`-Q` / ワンショット）は手動選択を上書きしません。外部 CLI の `<provider>/same` は従来どおり、その CLI へのモデル指定を省略する意味です。

確認: 専用の自動テストはないため、`aidiy_hermes` を起動して起動選択・picker 保存・次回復元・キー再読込・非対話実行・初期描画を確認します。

AiDiy の `aidiy_hermes` エントリでは、この解決より前に `_load_aidiy_hermes_defaults()` が共通設定を読みます。`CODE_AIDIY_HERMES_MODEL` は `openai_oauth/gpt-6.1-sol` に加えて `xai-oauth/grok-4.6` を受理します。対応する OAuth が認証済みなら指定 provider を使い、非対話の Code AI 起動時に未認証または認証切れなら `freeai/gemini-3.8-flash` へ退避します。`--provider openai_oauth` / `--provider xai-oauth` を明示指定した場合は OAuth 経路を維持します。CLI の `--model` / `--provider` は初期値より優先されます。

AiDiy の選択画面（aidiy_code / Discord のコードモデル候補も `frontend_ide/host/scripts/model-catalog.py` 経由で同じ）で `anthropic` を選んだときのモデル候補は、`cli_main.py` の `_fetch_aidiy_claude_model_labels` が `hermes_cli/models.py` の `_PROVIDER_MODELS["anthropic"]`（厳選した現行モデル：Fable 5.1 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5）だけを返します。`provider_model_ids("anthropic")` は Anthropic API の一覧（旧世代を含む）を後ろに足すため使いません。新しいモデルが出たら `_PROVIDER_MODELS["anthropic"]` を更新します。`CHAT_CLAUDE_MODEL` 未設定時の既定モデル（`_aidiy_provider_default_model` と `anthropic` の接続設定）も同じ現行モデル（`claude-sonnet-5-5`）に揃えます。

API キーのプロバイダ（`openai` / `ollama` / `openrt` / `gemini` / `freeai`）の候補は `_fetch_aidiy_provider_model_labels` が各 API の `/models` から取得します。`cli_main.py` はモジュール先頭で `urllib` を読み込まないため、同関数内で `import urllib.request` します。これが無いと `NameError` を `except` が握りつぶし、候補が既定モデル1件（`yyyy/mm/dd - 既定モデル`）になります。どのプロバイダも「作成から240日以内の対話モデル」に揃えます。`_AIDIY_NON_CHAT_MODEL` で画像・音声・動画（veo）・音楽（lyria）・埋め込み・リアルタイム・文字起こし・検索・deep-research・antigravity・バッチ専用（`:batch`）などの対話以外のモデルを名前で除き、作成日を返す API（OpenAI / OpenRouter / Ollama）は240日以内だけを新しい順に出します（最大50件、240日以内なら旧世代も残る）。作成日を返さない API（Gemini / FreeAI。OpenAI 互換・ネイティブとも日付なし）は240日で絞れないため、`_aidiy_newest_generation_only` で gemini / gemma の系列ごとに最大の主版（例：最新が 3.8 なら 3.x）だけを残し、版の無い別名（`gemini-flash-latest` など）は残します。OpenRouter のキー（`openrt_key_id`）が使えるときは、`openai` / `gemini` / `freeai` の候補を OpenRouter の `/models` と照合して絞り込みます（`_fetch_aidiy_openrouter_model_meta`、OpenRouter の `openai/` / `google/` の名前を `:free` / `:batch` などの付記を除いて照合）。OpenRouter に無いモデルと、出力がテキストだけではないモデル（`architecture.output_modalities`）を除き、作成日の無い Gemini にも OpenRouter の作成日を使って240日の判定をします。キーが無い・取得できないときは上の従来の判定に戻ります。`frontend_ide/host/scripts/model-catalog.py` は `cli_main.py` の picker メソッドを名前で拾うため、`_fetch_aidiy_*` を追加したら同スクリプトの `Picker` にも加えます。`openai_oauth` は `_fetch_aidiy_codex_model_labels` で `_AIDIY_OPENAI_OAUTH_CURRENT_MODEL`（gpt-6 系）だけに絞り、該当が無いときは取得した一覧をそのまま使います。確認は `command_hermes/.venv` の Python で `frontend_ide/host/scripts/model-catalog.py command_hermes/cli_main.py <provider>` を実行して候補を見ます。

## Anthropic の API キー専用運用

AiDiy の Anthropic 接続は `claude_key_id`、明示した `--api-key`、`ANTHROPIC_API_KEY` を使います。
直接の Hermes 管理コマンドで明示登録した API キーも対象ですが、選択したキーはリクエスト前や 401 / 429 の再試行で別の認証情報へ差し替えません。
API キーが無い場合は設定を案内して停止し、`ANTHROPIC_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`、Claude Code の保存済み OAuth を借用しません。
既存の OAuth ファイルやセッション履歴は削除・移行しません。Anthropic の setup / auth add は API キー方式のみで、外部 `claude-code` CLI bridge、OpenAI / xAI など他 provider の認証方式は別扱いです。

実装入口は `core/anthropic_credentials.py`、`core/credential_pool.py`、`hermes_cli/runtime_provider.py`、`base/run_agent.py`。
オフラインの自動テストはありません。偽キーでの初期化・認証失敗と、実キーでの通常要求・モデル切替・直接 CLI の設定経路を手動で確認します。

## Provider Overlay 一覧

`hermes_cli/providers.py` の `HERMES_OVERLAYS` が transport・認証方式・環境変数の補足を定義し、models.dev のカタログとユーザー定義 provider を合流します。AiDiy の picker は `cli_main.py` の別レイヤです。全 provider 一覧を手書きで複製すると追加・廃止がずれるため、変更時は現行辞書を直接確認します。

外部接続せず登録名を読む例（リポジトリ直下）:

```python
import ast
from pathlib import Path

tree = ast.parse(Path("command_hermes/hermes_cli/providers.py").read_text(encoding="utf-8"))
providers = next(node.value for node in tree.body
                 if isinstance(node, ast.AnnAssign)
                 and isinstance(node.target, ast.Name)
                 and node.target.id == "HERMES_OVERLAYS")
print([ast.literal_eval(key) for key in providers.keys])
```

## Alias 解決

エイリアスは `ALIASES` 辞書で canonical ID へマッピングします。xAI の OAuth provider は `xai-oauth` を正式名とし、`grok-oauth` / `xai-grok-oauth` の別名は使いません。

## Interactive Picker（/model コマンド）

`/model` を引数なしで実行すると、AiDiy の `_handle_aidiy_model_command()` → `_open_aidiy_model_picker()` で provider → model の2段階選択を開きます。非TUIでは `_show_aidiy_model_picker_fallback()` が案内します。候補は AiDiy の設定・OAuth・外部 CLI 定義に基づき、upstream の `list_authenticated_providers()` と混同しません。

AiDiy 独自の `/model` picker には `xai-oauth` を常時表示し、`grok-4.6` を既定・先頭モデルとします。未認証で選択した場合は xAI の OAuth device-code ログインを開始します。

`openai_oauth` は Codex CLI と同じ `${CODEX_HOME:-~/.codex}/auth.json` を使います。Hermes のログイン、認証確認、トークン更新もこのファイルを参照します。

`xai-oauth` は Grok Build CLI と同じ `${GROK_HOME:-~/.grok}/auth.json` を使います。Grok でログイン済みなら Hermes からそのまま選択でき、Hermes のログインとトークン更新も Grok のストアへ保存します。旧 Hermes `auth.json` の xAI OAuth トークンは初回読込時に移し、旧コピーを削除します。`hermes auth remove xai-oauth` / `hermes logout xai-oauth` は Grok 側の共有ログインも解除します。

## 外部 CLI Bridge

AiDiy の `/model` picker と `--provider` では、API provider に加えて次の外部 CLI を直接起動できます。

| Provider slug | 実行コマンド |
|---------------|--------------|
| `claude-code` | `claude` |
| `antigravity-cli` | `agy` |
| `codex-cli` | `codex` |
| `copilot-cli` | `copilot` |
| `opencode` | `opencode` |
| `grok-cli` | `grok` |

Hermesの `/model` は `_AIDIY/aidiy_diag/code_models_info.json` の各CLI区分から候補・表示名・順序を読みます。CLIを選んだ後もモデル選択へ進み、先頭は `same (変更なし)`、`auto` は候補に出しません。`same` は外部CLIへの `--model` を省略し、明示モデルだけ `--model <ID>` を渡します。OpenCodeの `openai/` は維持します。旧保存値 `auto` も受け付け、手動選択時は `same` へ正規化します。一覧未作成・破損時のCLI候補はsameだけです。

OpenAI OAuthは同じファイルの `aidiy_hermes.models` から `openai_oauth/` の候補だけを読み、Hermes内部へ渡す際はその接頭辞を外します。他のAPI providerは既存の取得経路を使います。ファイルは候補を開くたびに読み、実行中に更新された一覧も再表示時に反映します。Diagが生成するHermesのCLI経路も `xx/same` に統一し、バックエンドからHermesを呼ぶ際はモデル引数を省略します。

検証は `models-info.check.mjs`（backend_diag/checks）で行います。Hermes 側のモデル候補・標準入力・設定保存には専用の自動テストがないため、`aidiy_hermes` の実起動で確認します。

`antigravity-cli` は本体の `antigravity_cli` と同じ引数規則を使います。初回は `-p <prompt>`、継続時はその後ろに `-c` を付け、`--add-dir <cwd>` と `--print-timeout 20m` を指定します。`CODE_PERMISSIONS` が `none` 以外なら `--dangerously-skip-permissions` も指定します。Windowsでは `%USERPROFILE%\AppData\Local\agy\bin\agy.exe` を優先し、`DETACHED_PROCESS` で親コンソールから切り離します。

## 新しい Provider 追加手順

1. `hermes_cli/providers.py` の `HERMES_OVERLAYS` にエントリ追加
2. 必要に応じて `ALIASES` にエイリアス追加
3. AiDiy picker に出す場合は `cli_main.py` の `_aidiy_provider_slugs()`、provider 定義と認証・モデル候補取得の経路も追加
4. `backend_server/conf/conf_model.py` でモデル一覧取得が必要なら追記

## 注意点

- **認証情報の優先順位**: 環境変数 > config.yaml > ハードコード。新規 provider 追加時は env var 名を統一すること
- **Aggregator provider**: `openrouter`, `nous`, `vercel`, `kilo`, `opencode` はマルチモデルルーター。`auto` 検出時はこれらの優先度が高い
- **auto 検出のタイミング**: `_ensure_runtime_credentials()` は初回推論時まで遅延される。起動時には実行されない
