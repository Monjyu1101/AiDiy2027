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

確認: `test_aidiy_model_catalog.py` で候補・キー分離・起動provider識別をオフライン検証し、`aidiy_hermes` の実起動で起動選択・picker保存・次回復元・非対話実行・初期描画を確認します。

AiDiy の `aidiy_hermes` エントリでは、この解決より前に `_load_aidiy_hermes_defaults()` が共通設定を読みます。`CODE_AIDIY_HERMES_MODEL` は `openai_oauth/gpt-6.1-sol` に加えて `xai-oauth/grok-4.6` を受理します。対応する OAuth が認証済みなら指定 provider を使い、非対話の Code AI 起動時に未認証または認証切れなら `freeai/gemini-3.8-flash` へ退避します。`--provider openai_oauth` / `--provider xai-oauth` を明示指定した場合は OAuth 経路を維持します。CLI の `--model` / `--provider` は初期値より優先されます。

Hermes の `/model` は `_AIDIY/aidiy_diag/hermes_models_info.json` を使用します。`aidiy_diag` のモデル一覧取得・保存時に、既存の Chat / Code 合成一覧と一緒に生成されます。AIチャットパネルの `chat_models_info.json` や Code ダイアログの `code_models_info.json` の構成・絞り込みは変更しません。

- `gemini` / `freeai` / `openrt` / `openai_chat` は Chat 一覧のモデルID・表示名・順序を元にします。Hermes独自の50件上限・240日制限・最新主版限定・他社一覧との交差による絞り込みは追加しません。
- `claude_chat` は Diag が Anthropic から取得した完全なAPIモデルIDを使います。外部Claude CLIの `sonnet` / `opus` 等の短縮名を混ぜず、既存の Anthropic Messages API と `claude_key_id` を使います。AIチャット本体のプロバイダを増やす変更ではありません。
- 画像生成、音声出力、Live、埋め込み、バッチ等の非対応モデルは専用一覧から除きます。画像を入力してテキストを返すモデルは対象です。Hermes内の画像生成ツールは、この会話モデル選択とは別です。
- APIキーが未設定のプロバイダは選択肢に出しません。候補ファイル未作成・破損・該当区分なし・空の場合は取得・保存を案内し、未確認の既定モデル1件を候補に捏造しません。直接モデルIDを指定する操作は従来どおりです。
- `/model` ごとにキー設定を、候補を開くたびに一覧ファイルを読み直します。FreeAIとGeminiは同じGoogleエンドポイントでも、`freeai_key_id` / `gemini_key_id` を独立して使います。起動時に内部providerが `custom` へ変換されてもFreeAIの識別を保持し、provider省略のモデル変更でGeminiキーへ切り替わらないようにします。明示キー付きの `custom` 接続では、同じURLの保存済み資格情報でキーを上書きしません。キーを明示しない従来の資格情報プール利用は維持します。
- 表示・保存するAPIプロバイダ名は `openai_chat` / `claude_chat`。以前の `openai` / `anthropic` と `anthropic_chat` は別名として受け付け、一覧には二重表示しません。OpenAIは直接のOpenAI互換経路、ClaudeはAnthropicネイティブ経路です。

`openrt_free` は `openrt_key_id` と同じOpenRouter接続先を使う無料会話専用区分です。`chat_models_info.json` と `hermes_models_info.json` の両方に生成し、設定は通常の `CHAT_OPENRT_MODEL` と分離した `CHAT_OPENRT_FREE_MODEL` を使います。直近の期間は既存OpenRouter一覧と同じ（Google/OpenAI/Anthropic/xAI 240日、Perplexity 365日、その他90日）。`:free` 接尾辞だけで判定せず、取得した全料金項目が明示的にゼロでテキスト出力のみのモデルを採用します。モデルIDを加工しません。

`openrt_free` の無料判定は一覧生成時だけです。選択後は通常のOpenRouterと同じAPI・キー・モデルID・実行処理を使い、価格上限、料金証拠の再検査、プラグイン/検索/フォールバックの無料専用制限は追加しません。料金や提供状態は変わることがあるため、一覧を更新するときはDiagでOpenRouterのモデル取得・保存を行います。

Ollama / Local / xAI OAuth の候補・接続処理は今回変更しません。`_fetch_aidiy_provider_model_labels()` などの旧API取得ヘルパーはこれらの既存経路や互換コードとして残りますが、上記5種類のAPIプロバイダの `/model` 候補には使いません。

`frontend_ide/host/scripts/model-catalog.py` は Hermes の picker メソッドを抽出・実行せず、`_AIDIY/aidiy_diag/chat_models_info.json` / `code_models_info.json` と同スクリプトの `PROVIDERS` 対応表から候補を読みます。CLI 自身の picker と画面側の一覧は取得経路を区別します。画面側の確認は Python で `frontend_ide/host/scripts/model-catalog.py command_hermes/cli_main.py <provider>` を実行します。

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

Hermesの `/model` は `hermes_models_info.json` の各CLI区分から候補・表示名・順序を読みます。Diagは従来の `code_models_info.json` と同じ導入済みCLIの候補・絞り込み結果を専用一覧へ写します。CLIを選んだ後もモデル選択へ進み、先頭は `same (変更なし)`、`auto` は候補に出しません。`same` は外部CLIへの `--model` を省略し、明示モデルだけ `--model <ID>` を渡します。OpenCodeの `openai/` は維持します。旧保存値 `auto` も受け付け、手動選択時は `same` へ正規化します。一覧未作成・破損時のCLI候補はsameだけです。

OpenAI OAuthは専用一覧の `openai_oauth.models` を読みます。生成時にCode一覧の `aidiy_hermes.models` から `openai_oauth/` の候補だけを取り、実行IDから接頭辞を外して従来の表示名を保持します。専用一覧がまだ存在しない旧環境では、CLIとOpenAI OAuthだけ従来のCode一覧へ互換退避します。専用一覧が存在して破損している場合や区分がない場合は、旧候補を復活させません。ファイルは候補を開くたびに読み、実行中に更新された一覧も再表示時に反映します。Diagが生成するHermesのCLI経路も `xx/same` に統一し、バックエンドからHermesを呼ぶ際はモデル引数を省略します。

検証は `models-info.check.mjs` / `hermes-info.check.mjs`（backend_diag/checks）と `test_aidiy_model_catalog.py`（command_hermes/checks）で行います。実キーによる接続、TUI操作、設定保存・次回起動の全体確認は実環境で別途行います。

`antigravity-cli` は本体の `antigravity_cli` と同じ引数規則を使います。初回は `-p <prompt>`、継続時はその後ろに `-c` を付け、`--add-dir <cwd>` と `--print-timeout 20m` を指定します。`CODE_PERMISSIONS` が `none` 以外なら `--dangerously-skip-permissions` も指定します。Windowsでは `%USERPROFILE%\AppData\Local\agy\bin\agy.exe` を優先し、`DETACHED_PROCESS` で親コンソールから切り離します。

## 新しい Provider 追加手順

1. `hermes_cli/providers.py` の `HERMES_OVERLAYS` にエントリ追加
2. 必要に応じて `ALIASES` にエイリアス追加
3. AiDiy picker に出す場合は `cli_main.py` の `_aidiy_provider_slugs()`、provider 定義と認証・モデル候補取得の経路も追加
4. AiDiy 画面にも出す場合は診断のモデル合成処理と `frontend_ide/host/scripts/model-catalog.py` の対応表を確認する。`backend_server/conf/conf_model.py` は合成 JSON の読込専用とし、外部 API 取得を追加しない

## 注意点

- **認証情報の優先順位**: 環境変数 > config.yaml > ハードコード。新規 provider 追加時は env var 名を統一すること
- **Aggregator provider**: `openrouter`, `nous`, `vercel`, `kilo`, `opencode` はマルチモデルルーター。`auto` 検出時はこれらの優先度が高い
- **auto 検出のタイミング**: `_ensure_runtime_credentials()` は初回推論時まで遅延される。起動時には実行されない
