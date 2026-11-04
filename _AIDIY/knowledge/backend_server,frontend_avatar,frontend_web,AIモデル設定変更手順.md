# AIモデル設定変更手順

> 文書: `backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md` | 実装: `_config/AiDiy_key.json`, `backend_server/conf/conf_json.py`, `backend_server/AIコア/AIチャット_openai.py`, `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue`

## このメモを使う場面
- Chat / Live / Prediction / Decision / Code / Task / Team AI のモデルや API キーを変更する
- `AiDiy_key.json` と設定 UI の整合を確認する
- 新しい AI 種別や Code CLI を追加した後、設定として選べるようにする

## 関連ファイル
- `_config/AiDiy_key.json` — APIキーと現在設定の正マスタ
- `backend_server/conf/conf_json.py` — 設定 JSON の読込、デフォルト、auto 補完
- `backend_server/conf/conf_model.py` — 利用可能モデル一覧
- `backend_server/core_router/AIコア.py` — モデル情報取得/更新 API
- `backend_server/AIコア/AIセッション管理.py` — セッション用モデル設定
- `frontend_avatar/src/api/config.ts` — backend 取得前のフォールバック
- `frontend_avatar/src/dialog/AI設定再起動.vue` — Avatar 設定 UI
- `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue` — Web 設定 UI

## AI 種別名のルール

| キー | 末尾ルール | 例 |
|------|-----------|----|
| `CHAT_AI_NAME` | 原則 `_chat`（OAuth は例外） | `gemini_chat`, `openrt_chat`, `openai_chat`, `openai_oauth`, `freeai_chat`, `ollama_chat`, `local_chat` |
| `LIVE_AI_NAME` | `_live` | `gemini_live`, `freeai_live`, `openai_live` |
| `PREDICTION_AI_NAME` | 予測用のChat / CLI方式 | `auto`, `openai_oauth`, `freeai_chat`, `openai_chat`, `gemini_chat`, `codex_cli`, `copilot_cli`, `aidiy_hermes` |
| `DECISION_AI_NAME` | 判断用の方式 | `auto`, `openai_oauth`, `freeai_chat`, `openai_decisions`, `gemini_chat` |
| `CODE_AI1_NAME`〜`CODE_AI6_NAME` | 原則 `_sdk` または `_cli`、例外 `aidiy_hermes` | `claude_sdk`, `claude_cli`, `copilot_cli`, `codex_cli`, `antigravity_cli`, `grok_cli`, `opencode_cli`, `aidiy_hermes` |
| `TASK_AI_NAME` / `TEAM_AI_NAME` | Code AI と同じ候補を使用 | `claude_cli`, `codex_cli`, `aidiy_hermes` |

判定は完全一致を前提にする。`startswith()` などの前方一致へ変えない。

## TASK / TEAM モデルの3種指定

モデルだけは AI 名1つに対して plan / do / check の3種を持つ。

| キー | 使う処理 |
|------|---------|
| `TASK_AI_MODEL_plan` | Aタスクの準備＝明細分解（`task_sub/sub_init.py`）、Aチーム要員選定・経験まとめ、雑談発言 |
| `TASK_AI_MODEL_do` | Aタスクの各ステップ実行（`task_sub/sub_do.py`）、自己作業、要求・明細・依頼レコードの既定値 |
| `TASK_AI_MODEL_check` | 終了時の最終確認（`task_sub/sub_end.py`） |
| `TEAM_AI_MODEL_plan` / `_do` / `_check` | 作業ループの段（S・P=plan / D=do / C・A=check、`team_sub/sub_SPDCA__common.py` の `段フェーズ`） |

判断基準:

- 共通設定（`AiDiy_key.json`）と `Aタスク要求` レコードが3種を持つ。要求側の指定が優先で、
  空なら共通設定のフェーズ別値を使う（`task_sub/sub_init.py` の `入力モデル()`、
  `task_sub/sub_end.py` の `要求モデル()`）。
- `Aタスク明細` は各ステップの実行だけなので `TASK_AI_MODEL_do` 1列。本登録時に要求の `_do` が入る。
- フェーズが1つしかない処理も、キー名でどのフェーズかを明示する。
  会話要求と雑談は `TASK_AI_MODEL_plan`、自己作業は `TASK_AI_MODEL_do`、経験まとめは依頼の `*_AI_MODEL_plan`。
- `Aチーム目標` と `Aチーム依頼` は TEAM・TASK それぞれ3列（計6列）を持ち、
  目標 → 依頼 → Aタスク要求 と3種のまま引き渡す（`sub_SPDCA__common.AI設定を決める()` → `タスク投入()`）。
- TEAM 側3種は作業ループの段（S・P=plan / D=do / C・A=check）、TASK 側3種は投入した Aタスクの
  内部フェーズ（準備 / 各ステップ / 最終確認）に対応する。
- Aタスクを作らず code_agents を直に呼ぶ段（S・P・C・A）は `段のモデル()` が区分に対応する
  フェーズを選び、`auto` なら共通設定のフェーズ別値へ落とす。
- 現行実装ではフェーズ別キーを使う。`conf_json` は旧版の単一キー（`TASK_AI_MODEL` / `TEAM_AI_MODEL`）を
  フェーズ別キーへ自動移行しない。旧キーは未知キーとして JSON に残り得るが、フェーズ別キーの不足分は
  既定値で補完される。旧値を引き継ぐ場合は plan / do / check それぞれへ明示的に設定する。
- API（`/task/タスク要求/AI登録`・`/更新登録`、`/team/目標/保存`・`/team/依頼/登録`・`/変更`）は
  フェーズ別キーだけを受け付ける。未指定の項目は更新最終レコード → 規定値の順で補完される。
- MCP の `aidiy_task_agents.submit` は `ai_model_plan` / `_do` / `_check`、
  `aidiy_team_agents.submit` は `team_ai_model_plan` / `task_ai_model_plan` などでフェーズ別に指定する。

## 設定変更手順

Code CLIの `same（変更無し）` は、CLI起動時に `--model` を渡さない指定。Codex / Claude CLI / Copilot / Antigravity / Grok / OpenCode / AiDiy Hermes / Claude・Codex Ollamaの新規・継続の両方に適用する。Code画面とWeb / AvatarのAI設定画面は共通の `available_models.code_models` を使うため、同じ候補を表示する。候補の追加後はbackend_serverを再起動して画面のモデル一覧を再取得する。

### AI設定・再起動画面のプロバイダ変更

Web / AvatarのCode1〜6、Task / Teamでプロバイダを手動変更したときは、`CODE_<プロバイダ大文字>_MODEL` を選択候補と照合して初期モデルに使う。例えばGrokの規定値が `same` なら、以前のプロバイダの `auto` を引き継がず `same` を選ぶ。規定値がない・候補外なら候補の先頭を使う。

読込時は各枠・各フェーズの保存値を使う。Code1→2〜6、Code4→5・6、Task→Teamの既存連動は利用者の変更イベントで行い、コピーによるプロバイダ変更から規定値選択を再発火させない。未編集の値は `buildNextSettings()` で元の保存値を保持する。

検証は `node --test frontend_avatar/checks/ai-settings-models.test.cjs`。両画面の実SFCスクリプトをVueのリアクティビティで動かし、全Code方式・全枠の切替、初期値保持、連動コピー、Grokのsame、OpenCode / Hermesの接頭辞を含む保存API入力を合成データで確認する。実APIへの保存・再起動は行わない。

### Code CLIのautoによるモデル自動選択

`AIコード_cli.py` は `auto` の場合、`AIコードモデル選択.py` から `aidiy_decisions_check` のHTTP `/config` と `/check` を呼ぶ。常駐toolsの起動チェックに成功した方式を利用し、OAuthが使えれば優先する。履歴と今回CLIへ送るプロンプト全体を判断材料にする。継続CLIでも保持している会話履歴を渡し、新規会話には旧履歴を混ぜない。

| CLI | 自動候補と基準 |
|---|---|
| `codex_cli` / `copilot_cli` / `opencode_cli` / `aidiy_hermes` | 利用可能一覧から各系列の数値バージョンが最新のIDを抽出。ファイル更新・複数ファイル調査・複雑な依頼は `sol`、単発の軽い調査は `terra`、挨拶程度は `luna`。`astra` は明示指定時のみ |
| `claude_cli` | ほぼ全ての依頼は `sonnet`、挨拶程度の会話のみ `haiku` |
| その他のCLI | `same` と同様にモデル指定を省略 |

- Codex/Copilot/OpenCode/Hermes用とClaude用の判断プロンプトを分ける。依頼文に今回使うモデルの明示指定があれば軽重より優先し、そのモデルを返す。`astra` / `fable` も候補に含めるが、ユーザーの明示指定がある場合だけ選ぶ。単なる言及・比較・引用・否定は指定とみなさない。
- 履歴は1ターンにつき1回生成し、送信文の完成後に同じ履歴と送信文を判断へ渡す。判断のための履歴再生成は行わない。
- GPT系のauto候補は `available_models.code_models` と同じ保存済み一覧から実行ごとに読み直す。`gpt-数値バージョン-(sol|terra|luna|astra)` に完全一致するIDだけを対象とし、`900k` 等の派生IDや別系列は含めない。一覧にない系列・バージョンを捏造せず、旧版の判断応答も採用しない。
- OpenCodeは自身の `opencode_cli` 一覧の `openai/gpt-数値バージョン-(sol|terra|luna|astra)` だけをauto候補にし、接頭辞付きIDを判断結果・CLI引数・実行モデル表示まで保持する。`auto` / `same` には接頭辞を付けない。
- Hermesは自身の `aidiy_hermes` 一覧の `openai_oauth/gpt-数値バージョン-(sol|terra|luna|astra)` だけを使う。接頭辞付きIDのまま候補・判断結果・実行引数・失敗時の候補に使用し、Codex一覧からの転用や接頭辞の二重付与は行わない。OAuth候補がなければ `same` へ戻す。
- Decisions未起動・利用不可・タイムアウト・不正応答・回答拒否でもCLIを止めない。GPT系は今回の候補の `sol` → `terra` → `luna` の順、Claudeは `sonnet` へ戻す。GPT系で通常候補がない場合は `same` とし、`astra` へ自動フォールバックしない。判断の待機は最大15秒。
- 選択結果は今回の実行だけに適用し、設定の `auto` は変更しない。選択できた場合は `[選択モデル: モデル名]` をCLIの最初の出力より先に `output_stream` で送る。
- MCP `aidiy_code_agents` の `ai_model: "auto"` もCLIへそのまま渡す。明示モデル・`same` は判断を呼ばない。MCP結果の `selected_model` で使用モデルを確認でき、指定省略時は空文字。
- `claude_sdk` はCLI自動選択の対象外。

### JSON を直接編集する場合

`_config/AiDiy_key.json` を編集し、Chat / Live / Code 6枠のキーを揃える。

```json
{
  "CHAT_AI_NAME": "gemini_chat",
  "LIVE_AI_NAME": "gemini_live",
  "PREDICTION_AI_NAME": "auto",
  "PREDICTION_OPENAI_MODEL": "auto",
  "PREDICTION_OAUTH_MODEL": "auto",
  "PREDICTION_GEMINI_MODEL": "auto",
  "PREDICTION_FREEAI_MODEL": "auto",
  "PREDICTION_CODEX_CLI_MODEL": "gpt-6-luna",
  "PREDICTION_COPILOT_CLI_MODEL": "gpt-6-luna",
  "PREDICTION_AIDIY_HERMES_MODEL": "openai_oauth/gpt-6-luna",
  "DECISION_AI_NAME": "auto",
  "DECISION_OPENAI_MODEL": "auto",
  "DECISION_OAUTH_MODEL": "auto",
  "DECISION_GEMINI_MODEL": "auto",
  "DECISION_FREEAI_MODEL": "auto",
  "CODE_PERMISSIONS": "auto",
  "CODE_AI1_NAME": "codex_cli",
  "CODE_AI1_MODEL": "auto",
  "CODE_AI2_NAME": "claude_sdk",
  "CODE_AI2_MODEL": "auto",
  "CODE_AI3_NAME": "copilot_cli",
  "CODE_AI3_MODEL": "auto",
  "CODE_AI4_NAME": "antigravity_cli",
  "CODE_AI4_MODEL": "auto",
  "CODE_AI5_NAME": "opencode_cli",
  "CODE_AI5_MODEL": "auto",
  "CODE_AI6_NAME": "aidiy_hermes",
  "CODE_AI6_MODEL": "auto",
  "TASK_AI_NAME": "codex_cli",
  "TASK_AI_MODEL_plan": "auto",
  "TASK_AI_MODEL_do": "auto",
  "TASK_AI_MODEL_check": "auto",
  "TEAM_AI_NAME": "codex_cli",
  "TEAM_AI_MODEL_plan": "auto",
  "TEAM_AI_MODEL_do": "auto",
  "TEAM_AI_MODEL_check": "auto"
}
```

変更後は `backend_server/temp/reboot_core.txt` を作成するか、core server を再起動する。

### 設定 UI から変更する場合

現行実装では `POST /core/AIコア/モデル情報/設定` に `セッションID` と `モデル設定` を送る。セッション内の設定更新、JSON 保存、サーバー再起動は次の指定で分かれる。

- `save: true`: `AiDiy_key.json` へ保存する。再起動要求がなければサーバーは再起動しない。
- `再起動要求`: `reboot_core` / `reboot_apps` / `reboot_tools` / `reboot_local` / `reboot_task` / `reboot_team` の指定先だけに再起動を要求する。Task / Team は同じ統合プロセスが対象。
- `リセット: true`: 設定を既定値へ戻して保存する。UI のリセット操作では全バックエンドの再起動も要求する。

Web / Avatar とも「保存(json書換)」は `save: true`、再起動要求なし。「設定/再起動」も `save: true` でJSONを保存してから apps / tools の再起動を要求する。

JSONではLIVEブロックの後に `PREDICTION_AI_NAME` と方式別7モデル（`PREDICTION_OPENAI_MODEL` / `PREDICTION_OAUTH_MODEL` / `PREDICTION_GEMINI_MODEL` / `PREDICTION_FREEAI_MODEL` / `PREDICTION_CODEX_CLI_MODEL` / `PREDICTION_COPILOT_CLI_MODEL` / `PREDICTION_AIDIY_HERMES_MODEL`）を置き、その直後に判断用の `DECISION_AI_NAME` と方式別4モデル（`DECISION_OPENAI_MODEL` / `DECISION_OAUTH_MODEL` / `DECISION_GEMINI_MODEL` / `DECISION_FREEAI_MODEL`）を置く。Predictionの初期値・欠落時は方式とChat系4モデルが `auto`、CLI系3モデルが `gpt-6-luna`（Hermesは `openai_oauth/gpt-6-luna`）で、内部RESTの `aidiy_prediction_llms` が予測実行に使用する。Web / Avatar両方のAI設定再起動画面も CHAT → LIVE → PREDICTION → DECISION → CODE の順に表示する。判断の初期値・欠落時もすべて `auto` で、方式のautoは起動チェック成功のものから OAuth → FreeAI → Decisions API → Gemini の順で選ぶ。

予測は内部REST `POST /internal/prediction_llms`（`aidiy_prediction_llms`、MCP非公開）で実行し、`project_path` が必須。方式は明示引数 → `PREDICTION_AI_NAME`、モデルは明示引数 → 決定した方式のキー（`openai_chat`→`PREDICTION_OPENAI_MODEL`、`openai_oauth`→`PREDICTION_OAUTH_MODEL`、`gemini_chat`→`PREDICTION_GEMINI_MODEL`、`freeai_chat`→`PREDICTION_FREEAI_MODEL`、`codex_cli`→`PREDICTION_CODEX_CLI_MODEL`、`copilot_cli`→`PREDICTION_COPILOT_CLI_MODEL`、`aidiy_hermes`→`PREDICTION_AIDIY_HERMES_MODEL`）の順で決める。方式設定もautoなら、Diagの `prediction_models_info.json` に候補がある `codex_cli` → `copilot_cli` → `aidiy_hermes` → `openai_oauth` → `freeai_chat` → `openai_chat` → `gemini_chat` の順で選ぶ。CLI方式（`codex_cli` / `copilot_cli` / `aidiy_hermes`）はautoで最優先に選ばれ、空の一時フォルダで権限none・継続なしの1回だけ実行する。正常応答の先頭に `[[PREDICTION]]` を付けさせ、目印がない応答は実行エラーとして扱う。CLI自身のセッション履歴はCLI側に残る場合がある。そのモデルもautoなら選んだ方式の先頭候補を使う。予測JSONではOpenAI API区分を `openai_chat` とし、`openai_decisions` は含めない。履歴の読み取り・非保存仕様は [backend_tools 構成](./backend_tools,構成.md#次のユーザー入力予測) を参照する。判断側の候補・選択順は変更しない。

予測の候補は `conf_models.get_prediction_models()` が毎回読む `_AIDIY/aidiy_diag/prediction_models_info.json` を、取得APIの `available_models.prediction_models` へ渡す。実行側と同じ4方式・有効なモデルIDだけを展開し、外部APIへの照会や候補の補完は行わない。方式がautoの場合は実行時と同じ優先順で最初に候補のある1方式のモデルを表示し、OpenAI APIは明示指定時だけ選べる。方式の手動変更時はモデルをautoへ戻す。ファイルが未取得・空・不正でもautoと保存値を保持し、一覧外の保存値は「保持値・Diag一覧外／未確認」と表示する。未編集の値は他項目だけの保存で上書きしない。PredictionはToolsが共通JSONを読むため、取得APIでは保存済みの値をセッションの古い値より優先し、保存後の次回予測から適用する。

判断の候補は `conf_models.get_decisions_models()` が毎回読む `_AIDIY/aidiy_diag/decisions_models_info.json` を、取得APIの `available_models.decision_models` へ渡す。方式がautoなら全方式の取得済み候補を合わせる。外部APIへの照会や、実行時の既定モデルを利用可能候補として補う処理はしない。ファイルが未取得・空・不正でもautoと現在設定を保持する。未掲載のモデルは「保持値・Diag一覧外／未確認」と表示し、旧別名 `openai_jsonchat` はOAuthの候補を使いながら保存値を維持する。

画面はDiag候補・auto・保持中の現在値からモデルを選べる。候補が1件ならその1件を表示し、方式名に基づくモデルIDのハードコードや選択欄の恒久無効化は行わない。Diag書き出し候補が変われば再取得後に新モデルを選択・保存でき、実行側もその指定を使う。候補掲載は利用可否の保証ではなく、Toolsの判断チェックで確認する。

取得時の代替表示は保存値と区別する。判断だけを編集して保存した際に、他項目の未取得候補による空欄や先頭候補で既存設定を書き換えない。

判断はTools側が共通JSONを読むため、取得APIはセッションの古い判断設定より保存済みの値を優先する。保存だけでも次回の判断リクエストは新設定を読み、利用可否の再チェックにはToolsの再起動が必要。明示引数がある実行は引数を優先する。

Electron では settings 専用ウィンドウ、Web では同じコンポーネントのモーダル表示を使う。`AI設定再起動.vue` に `window.desktopApi` 前提の処理を直接入れない。

## available_models の流れ

1. frontend が `POST /core/AIコア/モデル情報/取得` を呼ぶ
2. backend が現在設定と `available_models` を返す
3. 設定 UI が `chat_models` / `live_models` / `prediction_models` / `decision_models` / `code_models` から選択肢を作る
4. 設定時に `POST /core/AIコア/モデル情報/設定` へ送り、保存する場合は `save: true` を指定する
5. モデル情報の再取得で設定を確認し、再起動を要求した場合は再接続後も確認する

新しい AI 種別を追加する場合は、backend が返す `available_models` のキー、frontend の `CHAT_MODEL_KEYS` / `LIVE_MODEL_KEYS` / `LIVE_VOICE_KEYS` / `CODE_MODEL_KEYS`、`conf_json.DEFAULT_CONFIG` を合わせる。

`openai_chat` は `AiDiy_key.json` の `openai_key_id` を使い、`openai_oauth` は Codex CLI と `command_hermes` が共用する OAuth 認証ストアを使う。Codex CLI でログイン済みなら再認証は不要。初回利用前に `command_hermes` からログインする場合は
`.venv/Scripts/python.exe hermes_main.py auth add openai-codex` （Linux / macOS は `.venv/bin/python`）を実行する。OAuth token は
`AiDiy_key.json` には保存せず、`${CODEX_HOME:-~/.codex}/auth.json` から解決する。Hermes でログインや更新をした場合も同じファイルへ書き込む。
`aidiy_hermes` を起動して provider `openai_oauth` を選択する方法でも、同じ OAuth 認証を開始できる。

OpenAI Chat のモデル候補は API / OAuth で共通。API で取得した一覧があれば両方に使い、空の場合のみ OAuth の一覧を取得する。選択モデルも `CHAT_OPENAI_MODEL` を共用する。

`backend_local` が未起動の場合、`/core/AIコア/モデル情報/取得` は `local_chat` を chat / code モデル候補から除外する。`_start.py` の backend_local 起動デフォルトは No のため、local LLM を使うときだけ明示起動する。

Code CLI の権限モードは `CODE_PERMISSIONS` で管理する。設定 UI では `auto` / `full` / `none` を選択でき、保存時は `AiDiy_key.json` へ書き込まれる。`none` の場合、Claude / Antigravity / Copilot / Grok 系の bypass、yolo、自動全ツール許可オプションは付与しない（`grok_cli` は `--always-approve` を省略する）。ただし `codex_cli` はサンドボックス無視を常に有効にするため、`--dangerously-bypass-approvals-and-sandbox` を付与する。CLI 実行時の具体的な反映処理は `AIコード_cli.py` / `AIコード_claude.py` / `command_hermes` 側の実装に合わせて確認する。

## Ollama Chat の local / Cloud 切替

対象:
- `backend_server/AIコア/AIチャット_ollama.py`
- `backend_server/conf/conf_model.py`
- `backend_server/AIコア/AIチャット.py`

判断基準:
- `ollama_key_id` が `<` で始まる場合は local Ollama を使う
- 有効なキーがある場合は Ollama Cloud `https://ollama.com/v1` を使う
- local は `ollama_host + "/v1"`、既定は `http://127.0.0.1:11434/v1`
- Cloud 直叩き時はモデル名から `:cloud` と入力揺れの `:clude` を外して API に渡す

注意:
- `AiDiy_key.json` は正マスタ。読込時の正規化だけを理由に保存し直さない
- `ollama_chat` は local 実行が正常系なので、キーがプレースホルダーでも welcome 事前チェックで無効扱いにしない
- Cloud のモデル一覧は日付表示形式を他の chat model と揃える

## 注意点

- `frontend_avatar/src/api/config.ts` の `defaultModelSettings()` は backend 取得前のフォールバック。`conf_json.py` のデフォルトとずれると初期表示が混乱する
- `CODE_AI<N>_MODEL` はスロットごとの現在モデル、`CODE_CODEX_CLI_MODEL` のようなキーは CLI 種別ごとのデフォルト。混同しない
- `claude_cli` のモデル候補は `scripts/cli_bat/_claude-code.bat` の `MODEL` 値と `auto` に揃える。`_config/AiDiy_code_claude_cli.json` が古い場合は `conf_model.py` の初期化時に候補を同期する
- `copilot_cli` のモデル候補は `backend_server/conf/conf_model.py` で定義し、`scripts/cli_bat/_copilot_cli.bat` の `MODEL` 値と一致させる。`_config/AiDiy_code_copilot_cli.json` が古い場合は候補を同期する
- `codex_cli` のモデル候補は `scripts/cli_bat/_codex_cli.bat` の `MODEL` 値と `auto` に揃える。`_config/AiDiy_code_codex_cli.json` が古い場合は `conf_model.py` の初期化時に候補を同期する
- `grok_cli` のモデル候補も `scripts/cli_bat/_grok_cli.bat` の `MODEL` 値と `auto` に揃える。`_config/AiDiy_code_grok_cli.json` が古い場合は同様に同期する
- `aidiy_hermes` の設定画面候補は `scripts/cli_bat/_hermes_cli.bat` の OpenAI OAuth モデルと `auto` に揃える。候補は `conf_model.py` の `_get_aidiy_hermes_models()` で定義する。候補値は `openai_oauth/<モデルID>` とし、専用の `AiDiy_code_*.json` は使わない
- 設定変更は既存 WebSocket セッションへ即時完全反映される前提にしない。再起動後の再接続で確認する
- Code AI は現行6枠。枠数確認は `backend_server/core_router/AIコア.py` と frontend の `PanelKey` を見る

## 確認方法

- `POST http://127.0.0.1:8091/core/AIコア/モデル情報/取得` に `{"セッションID": "対象セッションID"}` を送り、現在設定と利用可能モデル一覧を確認する。接続前は `{}` を送り、共通設定の既定値と候補を取得できる
- 設定 UI で Chat / Live / Prediction / Decision / Code1〜Code6 / Task / Team の選択肢が出ることを確認する（Task / Team は plan / do / check の3行）
- `node --test scripts/checks/decision-settings.test.cjs` で両実SFCの候補・保存・互換を確認する。任意のブラウザQAは `node scripts/checks/decision-settings-browser.cjs`。既存Chrome/Edgeを一時プロファイルで起動し、合成設定APIだけを使う。`SETTINGS_QA_OUTPUT` でスクリーンショット保存先を指定できる。
- 「保存(json書換)」で `AiDiy_key.json` が更新され、サーバーが再起動しないことを確認する。再起動を要求した場合は、指定したサーバーの再起動と再接続を確認する

設定JSONの生成・不足補完の順序は CHAT → LIVE → PREDICTION → DECISION → CODE → TASK → TEAM。Predictionの方式と方式別7モデルは新規・欠落時だけ `auto` を補完し、既存値を保持する。両設定画面にPredictionの方式・方式別モデルを表示する。判断の新規既定値は方式と4モデルとも `auto`。旧キーの移行・読み替えは行わない。設定取得・保存APIは `/core/AIコア/モデル情報/取得` と `/core/AIコア/モデル情報/設定`。
