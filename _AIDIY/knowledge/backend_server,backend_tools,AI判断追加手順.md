# AI判断の利用とプロバイダ追加

> 文書: `backend_server,backend_tools,AI判断追加手順.md` | 実装: `backend_server/AIコア/AI判断.py`, `backend_server/AIコア/AI判断共通.py`, `backend_server/AIコア/AI判断_openai_decisions.py`, `backend_server/AIコア/AI判断_openai_jsonchat.py`, `backend_tools/tools_proc/tools_decisions.py`

## このメモを使う場面

- 真偽の確率・選択・段階評価をMCPまたはHTTPから取得する。
- Decisions APIとOAuth Responsesの接続・応答形式を確認する。
- 判断用プロバイダやモデルを追加する。

## 構成と切り替え

判断ロジックと入力・応答検証は `backend_server/AIコア/AI判断*.py` に置く。`backend_tools/tools_proc/decisions_check.py` はインポートの接続、`tools_decisions.py` はMCP / HTTPの公開だけを担当する。会話履歴やツール呼び出しは持たない。

| model指定 | 実装 | 通信・認証 |
|---|---|---|
| `openai_decisions/gpt-6-luna` | `AI判断_openai_decisions.py` | `https://api.openai.com/v1/decisions`、`openai_key_id` |
| `openai_oauth/gpt-6-luna` | `AI判断_openai_jsonchat.py` | `https://chatgpt.com/backend-api/codex/responses`、Codex OAuth |
| `freeai_chat/gemini-3.5-flash-lite` | `AI判断_freeai_jsonchat.py` | Google generateContent JSON、`freeai_key_id`優先 |
| `gemini_chat/gemini-3.5-flash-lite` | `AI判断_gemini_jsonchat.py` | Google generateContent JSON、`gemini_key_id`優先 |

`openai_jsonchat` は `openai_oauth` の別名として受け付ける。`ai_name` / `ai_model` での個別指定も可能。結合形式との矛盾や未知のプロバイダはエラーにする。明示指定した方式から別方式へ自動フォールバックしない。

プロバイダ未指定（空欄 / `auto`）では `DECISION_AI_NAME` を使う。設定も空欄 / `auto` なら、起動チェックに成功した `openai_oauth` を優先し、利用不可なら成功した `freeai_chat` → `openai_decisions` → `gemini_chat` の順で使う。利用可否未確認の直接利用時は `openai_oauth` を使う。引数や設定で指定した方式からの自動変更、実行中の通信エラーによる再送は行わない。

実行モデルは、明示 `model` / `ai_model` → 方式別 `DECISION_*_MODEL` → 低コスト既定値の順で解決する。既存の設定値は保持し、各アダプターも渡されたモデルを使う。未指定の既定値はOpenAI両方式 `gpt-6-luna`、FreeAI/Gemini `gemini-3.5-flash-lite`。通常Chat/Live/Codeには適用しない。

`AiDiy_key.json` の設定は `conf/conf_json.py` の既定値と同期し、LIVE設定ブロックの直後に保存する。不足したNAME / MODELキーは `auto` で補完する。設定管理を経由せず旧ファイルを直接読んだ場合も、不足キーを `auto` と扱う。既存の値や方式別モデル設定は上書きしない。

| キー | 既定値 |
|---|---|
| `DECISION_AI_NAME` | `auto` |
| `DECISION_OPENAI_MODEL` | `auto` |
| `DECISION_OAUTH_MODEL` | `auto` |
| `DECISION_FREEAI_MODEL` | `auto` |
| `DECISION_GEMINI_MODEL` | `auto` |

`DECISION_AI_NAME` には `auto` / `openai_oauth` / `openai_decisions` / `freeai_chat` / `gemini_chat`、方式別モデルキーには `auto` またはモデル名だけ（例: `gpt-6-luna`）を指定する。`provider/model` の結合形式は呼出し引数 `model` 用。既存の旧共通キーは削除せず、不足する方式別キーへだけ移行する。既存の方式別値はautoも含めて保持する。

OAuthは既存の `AIチャット_openai._oauth_access_token` を呼び、Hermes / Codex共有ストアの更新処理・排他制御を共用する。トークンを独自保存しない。backend_server / backend_tools の環境には `httpx` と、Hermes設定読込用の `PyYAML` が必要。

## 起動時の利用可否チェック

`backend_tools/tools_main.py` のFastAPI lifespanで `Decision.check_availability()` を1回実行する。モジュールimport時やbackend_serverの起動時には重複実行しない。

- 各プロバイダの設定から解決したモデルに「おはよう」を渡し、`choice` で「挨拶 / その他」へ分類する。共通の応答検証を通過し「挨拶」が返れば利用可能とする。
- APIキーが空欄・空白・`<`始まりのひな形・空引用符（`""` / `“”`等）の場合は、通信せず利用不可にする。OAuthはキーの有無で判定せず実行確認する。
- 方式ごとに最大15秒、並行してチェックする。認証・課金・通信・JSON形式の失敗、回答拒否、期待結果の不一致は利用不可。失敗しても他MCPの起動を止めない。
- 起動ログに方式・モデル・利用可能/不可・理由を出す。`decisions_config` とHTTP `/config` の `availability` に `ok/model/reason/answer/checked_at/elapsed_ms`、`available_models` に成功したモデルを返す。未実行時は `availability_checked=false`。
- モジュールimport時にはAI判断のMCPツールを登録せず、lifespanで実行チェックを完了してから登録し、その後にMCPセッション管理とHTTP受付を開始する。1方式以上が成功すればINFOで「実行ツールを公開しました」、全方式が失敗した場合だけWARNINGで「実行ツールは非公開」と表示する。OAuthログインの可否だけでなく、判断用の既定モデルで実行できるかを確認する。最終状態は `GET /aidiy_decisions_check/config` の `data.availability_checked` / `data.availability` / `data.available` で確認する。
- 結果は起動チェック時点のモデルについてのスナップショット。認証情報を返したり保存したりしない。設定変更後は再起動で再確認する。
- 1方式以上が成功した場合だけMCP実行ツール `decisions_check` を公開する。全方式が利用不可（または未確認）の場合は実行ツールを非公開とし、`decisions_config` だけを残す。設定JSON・MCP接続先は維持し、接続初期化の `instructions` と設定取得の `status=NG` / `available=false` / `message` で「現在利用不可」を返す。理由は `availability` で確認できる。
- 全方式が利用不可の場合、HTTP `/check` も503と `status=NG` を返し、判断APIを呼ばない。HTTP `/config` は200で診断結果を返す。再起動チェックで1方式以上が成功すると実行ツールを再公開する。

## Diagで明示指定だけ成功する場合

- `auto / auto` は単純にOAuth固定ではなく、`DECISION_AI_NAME`、方式別モデル設定、Tools起動時の `availability` に従う。明示指定と同じ方式・モデルが選ばれているか、`decisions_config` の `default_model` / `configured_defaults` / `availability` で確認する。キー値やトークンの共有は不要。
- `openai_oauth` はCodex OAuth、`openai_decisions` はOpenAI APIキー、FreeAI/GeminiはGoogle APIキーを使う。OAuth成功だけでは他の認証経路の成功は保証されない。判断アダプターはHTTP実装で、Decisions SDKのimportは不要。
- DiagはMCPエラーのうち既知のHTTP状態・認証未設定・起動チェック・応答形式のカテゴリを固定メッセージで表示する。外部APIの生レスポンスや未知の詳細は表示しない。失敗時はこの説明文と指定方式・モデルを確認し、`401/403/429/400` 等の実結果なしに原因を認証・利用枠・モデルへ断定しない。
- 起動時の15秒チェックはスナップショットであり、後の明示指定成功だけでは自動選択の可用性表を書き換えない。起動時の一時失敗や既定モデル変更が疑われる場合は、Tools再起動後のチェック結果で確認する。

## 呼び出し方

- MCPサーバー: `aidiy_decisions_check`
- MCPツール: `decisions_check` / `decisions_config`
- HTTP実行: `POST /aidiy_decisions_check/check`
- 設定: `GET` または `POST /aidiy_decisions_check/config`
- 引数仕様: `GET /aidiy_decisions_check/docs` / `GET /aidiy_decisions_check/list`
- MCP接続: `/aidiy_decisions_check/sse` と `/aidiy_decisions_check/mcp`。stdioは既存の `mcp_stdio.py` を使用。

```python
import requests

response = requests.post(
    "http://127.0.0.1:8095/aidiy_decisions_check/check",
    json={
        "model": "openai_oauth/gpt-6-luna",
        "input": "商品の外箱が破損しています。",
        "questions": [
            {"type": "predicate", "name": "damage", "instructions": "破損の報告ですか？"}
        ],
        "timeout_sec": 60,
    },
    timeout=70,
)
response.raise_for_status()
answers = response.json()["data"]["answers"]
```

`model` を `openai_decisions/gpt-6-luna` に替えるだけでDecisions APIへ切り替わる。backend_server内では `from AIコア.AI判断 import Decision` として `await Decision().実行({...})` を呼ぶ。

## 共通契約

質問には一意の `name` と `instructions` を指定する。

| type | 追加の質問項目 | 回答 |
|---|---|---|
| `predicate` | なし | `probability`（0～1） |
| `choice` | `choices: [{value, description}]`（2件以上） | `choice`, `probabilities: [{value, probability}]`, `confidence` |
| `score` | `levels: [{label, description}]`（2件以上、低→高） | `score`, `probabilities: [{value, label, probability}]`, `confidence` |

`score` の `value` は0始まりの段階番号、`score` は確率加重平均。拒否は `type: refusal` として返す。`input` はテキスト、または `role: user` のメッセージ配列。画像は `input_image.image_url` にインラインbase64のdata URLを指定し、外部URL・ファイルIDは受け付けない。

成功レスポンスは `status/message/data`、`data` に `ai_name`, `ai_model`, `model`, `method`, `answers`, `usage`, `elapsed_ms` を持つ。`answers` は質問順へ整列する。

OAuth側は Responses の `text.format.type=json_schema`, `strict=true` を使う。全経路とも回答名・型・候補の一致、確率の範囲と合計、段階評価の加重平均を検証する。JSON不正・途中切断・タイムアウト・未完了は成功として返さない。HTTP入力不正は422、処理エラーは400と `status=NG`。MCPではToolErrorを返す。

互換なのは入出力形式である。OAuth側の確率・confidenceは生成モデルの推定値で、Decisions APIと同じ校正値や実測頻度を保証しない。方式別に閾値を評価する。`method` は `decisions_api` または `responses_json_schema`。

## プロバイダ・モデル追加

1. `AI判断_<方式>.py` に `DecisionAI` クラスを実装する。`method` と非同期 `実行(request, model, config, client)` を持ち、`answers` 配列を返す。
2. `AI判断.py` の `PROVIDERS` にモジュール、モデル設定キー、既定モデル、認証方式、必要な別名を追加する。APIキー方式は `api_key_field` に設定キー名を指定すると、起動時の未設定判定を共用できる。
3. 判断系の追加方式は低コストの既定値を設定し、Diag書き出し候補を調整する。実行側は明示モデルや設定値を尊重し、候補追加だけで画面へ反映できるようにする。
4. 共通応答のテストと、方式固有の認証・通信・異常終了のテストを追加する。MCP / HTTP入口への方式別分岐追加は不要。

## 確認方法

```powershell
backend_tools/.venv/Scripts/python.exe -X utf8 -m unittest discover -s scripts/checks -p test_decision_provider_routes.py -v
```

合成HTTPで各方式の実アダプターを検証する（キー・外部AIへは接続しない）。MCP 登録の自動テストはないため、方式を追加したら Tools を再起動して `aidiy_decisions_check` のツール一覧と応答を確認する。

実接続では同一入力と3種の質問を両方式に送り、名前・型・候補が一致することを確認する。数値の完全一致は要件にしない。APIキー・OAuthトークンを出力に残さず、認証エラーと入力不正を区別して確認する。

参考: [Decisions API](https://developers.openai.com/api/docs/guides/decisions)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

## Gemini / FreeAI のJSON判断

両方式は `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` にJSON Schemaと質問を渡す。優先キーが未設定（空欄・ひな形・空引用符）の場合だけ他方のキーを代用し、認証失敗時に別キーで再試行しない。モデルはChat用画像モデルから流用せず判断用の設定を使う。共有httpx clientの環境proxy・TLS・timeoutを利用する。

`generationConfig.responseMimeType=application/json` と `responseJsonSchema` を指定し、完了理由 `STOP` の1候補だけを受け付ける。思考部分を除いた本文をJSONとして読み、共通の回答検証を通す。拒否・打切り・JSONコードフェンス・欠落・型不一致は成功扱いしない。確率とconfidenceはOAuthと同じく生成モデルの推定値で、Decisions APIと同じ校正値ではない。仕様は [Google structured output](https://ai.google.dev/gemini-api/docs/structured-output) と [generateContent](https://ai.google.dev/api/generate-content) を参照。

## Diagの判断モデル情報

`_AIDIY/aidiy_diag/decisions_models_info.json` を `conf_models.get_decisions_models()` で読む。形式は `{方式名: {models: {モデルID: 表示名}}}`。4方式のうち認証付き取得候補があるものだけを保存する。詳細は [Diag運用](./backend_diag,環境診断運用.md) を参照。

候補のない方式は省略、全体が空なら `{}`。ファイル未作成・不正も読込口では空一覧として扱う。設定値や方式別既定モデルは変更せず、明示引数 > 共通設定 > 方式別設定 > 方式既定値の順と既存の生成起動チェックを維持する。Diagの候補と `decisions_config.available_models`（生成確認済み）は別の意味を持つ。

Web/Avatarの設定画面は4方式とautoを扱い、Diagの判断一覧を候補として読む。詳細は `backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md` を参照。取得済み候補と保持中の設定値を区別し、候補未取得でも既存設定は失わない。

### 判断系の候補管理

書き出す候補の絞り込みは [Diag運用の判断用モデル一覧](./backend_diag,環境診断運用.md#判断用モデル一覧) に集約する。実行側へ固定許可リストを追加せず、起動チェックの利用可能方式・明示引数・設定値を区別する。
