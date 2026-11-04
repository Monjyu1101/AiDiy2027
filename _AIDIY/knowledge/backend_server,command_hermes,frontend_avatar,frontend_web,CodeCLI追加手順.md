# Code CLI 追加手順

> 文書: `backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md` | 実装: `backend_server/AIコア/`, `frontend_avatar/src/components/AIコード.vue`, `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue`

## このメモを使う場面
- `codex_cli` や `aidiy_hermes` のような Code CLI を追加する
- backend には追加したが設定 UI に出ない問題を避ける
- CLI 名、モデルキー、Code AI 6枠の関係を確認する

## 基本方針
- 新しい CLI は backend 実行処理、モデル定義、設定 JSON、frontend 設定 UI を一式で揃える
- `CODE_AI1_NAME`〜`CODE_AI6_NAME` は「どのスロットでどの CLI 種別を使うか」を表す
- `CODE_AI1_MODEL`〜`CODE_AI6_MODEL` は「そのスロットで使うモデル」を表す
- `CODE_<CLI名>_MODEL` のようなキーは CLI 種別ごとのデフォルトや候補管理に使う。スロットキーと混同しない
- Code AI パネルは現行 `code1`〜`code6`。新CLI追加だけならパネル数は増やさない

## 関連ファイル

### backend_server
- `backend_server/AIコア/AIコード_cli.py`
- `backend_server/AIコア/AIコード.py`
- `backend_server/conf/conf_model.py`
- `backend_server/conf/conf_json.py`
- `_config/AiDiy_key.json`
- `_config/AiDiy_code_<cli名>.json`（固定モデル一覧を持つ場合）

### frontend
- `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue`
- `frontend_avatar/src/dialog/AI設定再起動.vue`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_avatar/src/components/AIコード.vue`

## 追加手順

1. `AIコード_cli.py` の `_コマンドパス取得()` に CLI 名を追加する
2. `バージョン確認()` に確認コマンドと timeout を追加する
3. `_コマンド構築()` に初回会話と継続会話のコマンド生成を追加する
   - モデルが `auto`（大文字小文字問わず）や空のときは `--model` 相当の引数を付けず、CLI 側の既定モデルに任せる。`--model auto` を渡すと不明なモデル名として CLI が失敗する
4. OS 依存の起動条件やパス変換が必要なら同ファイル内で分岐する
5. `AIコード.py` の welcome 文言、候補一覧、未インストール案内を更新する
6. `conf_model.py` に `CODE_<CLI名>_MODELS` または動的生成ロジックを追加し、`get_code_models()` の返却対象へ入れる
7. 固定モデル一覧を持つ場合は `_config/AiDiy_code_<cli名>.json` を作り、最低でも `auto` を定義する
8. `conf_json.DEFAULT_CONFIG` と `AiDiy_key.json` に必要な `CODE_<CLI名>_MODEL` を追加する
9. frontend の `CODE_MODEL_KEYS` に CLI 名と保存キーの対応を追加する
10. 設定 UI で `availableModels.code_models` から新CLIが選べることを確認する
11. `AIセッション管理.py` のセッション設定と `core_router/AIコア.py` の設定保存キー一覧へ `CODE_<CLI名>_MODEL` を追加する
12. `core_router/AIコア.py` の `/モデル情報/TASK選択肢` フォールバック一覧に CLI 名を追加する
13. 両フロントの `AIタスク_要求編集.vue` / `AIタスク_明細編集.vue` の `TASK_CODE_MODELS既定` に CLI 名を追加する
14. 手動起動が要る場合は `scripts/cli_bat/_<CLI名>.bat` と `__install_cli.bat` / `__uninstall_cli.bat` を追加する

11〜13 は API 失敗時やセッション未確立時のフォールバック経路で、通常操作では気づけない。追加漏れの実績があるため、既存 CLI 名（`codex_cli` など）で全文検索して対応箇所を突き合わせる。

## Hermes 統合時の判断基準

- 公開名は frontend / backend / 設定 JSON で完全一致させる。現行値は `aidiy_hermes`
- CLI ごとに専用 `AiDiy_code_*.json` が必須とは限らない。`aidiy_hermes` のように既存モデル一覧を流用してもよい
- `_setup.py` / `_cleanup.py` に統合しても、常駐起動が不要な CLI は `_start.py` に追加しない
- `aidiy_hermes --version` は cold start や `code1`〜`code6` 同時接続で遅くなることがある。未インストール誤判定を避けるため、長めの timeout と結果キャッシュを検討する
- `command_hermes` を新実装へ差し替えた後も公開コマンド名は `aidiy_hermes` のままにする。旧実装を残す場合は `command_hermes_old` のように別名へ退避し、AiDiy 本体からは参照しない
- `command_hermes/pyproject.toml` の dependencies で CLI 依存を管理する
- `_setup.py` では `uv sync --upgrade` 後に `~/.local/bin/aidiy_hermes.cmd` を生成し、既存登録済みでもランチャを再生成する

## 注意点

- 自動モデル判定が失敗・タイムアウト・利用不可の場合、Codex / Copilot は `gpt-6.1-sol`、Claude CLI / SDK は `sonnet` を使用する。CLI / SDK の出力開始前に `output_stream` で `[モデル選択失敗: <モデル> を使用します]` を送り、次回も判定できるよう設定の `auto` は維持する。
- `claude_sdk` の `auto` は `claude_cli` と同じ `AIコードモデル選択.select_model` を使い、毎回の送信文と会話履歴からモデルを選ぶ。選択結果は `ClaudeAgentOptions.model` と選択モデル通知に反映し、設定値の `auto` は維持する。明示モデルはそのままSDKへ渡し、判断不可時はストリーム先頭へ「モデル選択失敗」と表示して `sonnet` を指定する。`resume=False` ではSDKセッションと判断用の旧履歴をリセットする。`tests/test_claude_sdk_auto_model.py` でSDK呼び出しを模擬し、モデル・継続・新規・停止を確認する。
- backend の `available_models.code_models` に出ない限り、frontend に項目を足しても選択できない
- frontend の設定 option は backend 返却値から生成し、CLI 名を固定直書きしない
- `code1`〜`code6` は WebSocket チャンネル/パネル名。CLI 名をチャンネル名として増やさない
- Windows で WSL 経由実行が必要な CLI は、作業ディレクトリとパス形式の差異を吸収する
- 設定変更は起動中サーバーへ自動反映されない。必要に応じて core server を再起動する
- `aidiy_hermes` の Code AI 呼び出しでは `-Q --oneshot-stdin` を使い、完全プロンプトを UTF-8 標準入力で渡す。本文の長短で argv / stdin を切り替えない。手動実行の `-Q -z "本文"` は互換性のため維持する
- AIコードパネルから `aidiy_hermes` をモデル `auto` で呼ぶときは、毎回 `codex_cli` と同じ候補・判断処理に会話履歴と送信内容を渡し、選択結果に `openai_oauth/` を付けて `--model` に指定する（例: `openai_oauth/gpt-6.1-sol`）。設定値は `auto` のまま維持する。判断サービスが利用できない場合はストリーム先頭へ「モデル選択失敗」と表示して `openai_oauth/gpt-6.1-sol` を指定する。`same`（変更なし）の場合はモデル引数を省略し、明示モデルの場合は判断を行わず指定値を使う。専用の自動テストはないため、`auto`・`same`・明示モデル・判断サービス停止時の4通りを実行ログの `--model` 指定で確認する
- `aidiy_hermes` のワンショットでは、stdout は正式回答専用、stderr は thinking / step / tool 進捗 / 警告 / `session_id` 用に分ける
- `opencode_cli` / `antigravity_cli` は stdout を正式回答専用、stderr を `output_stream` 専用とする。stdout を途中表示にも送ると最終回答と二重表示になるため、追加時は `AIコード_cli.py` の `_STDERR_STREAM_STDOUT_FINAL_AI` を確認する
- `copilot_cli` は初回・継続とも `--output-format json --stream on` を付け、stdout の JSONL を `_CopilotJSON出力` で解析する。通常テキストではツール進捗も stdout に流れ、stderr は終了時の利用量などに限られるため、stderr だけの監視では途中経過を表示できない
- Copilot の `assistant.reasoning_delta` / `assistant.reasoning` とツール開始・進捗・完了は `output_stream` に振り分ける。思考断片は改行または160文字ごとにまとめ、完成版との重複を避ける。思考イベントの有無はモデルによって異なる
- Copilot の回答断片は `messageId` ごとに保持し、最後の親エージェントの回答本文だけを正式回答にする。ツール要求つきメッセージ、commentary / thinking、子エージェントの回答、入力や利用量、暗号化された思考を正式回答へ混ぜない。未知のJSONイベントは無視し、stdoutの生JSONは画面へ送らない
- Code CLI の実行待機は既定で900秒。stdout / stderr のどちらかで1チャンクでも受信したら、その時点から900秒を数え直す。画面へのストリーム表示は引き続き行単位にする
- Windows の監視ラッパー `backend_tools/tools_proc/process_lifetime.py` では、子の `subprocess.Popen` に `stdin=sys.stdin`、`stdout=sys.stdout`、`stderr=sys.stderr` を明示する。`CREATE_NO_WINDOW` と標準ハンドルの省略を組み合わせると、CLIが動いても出力が届かず「応答なし」になる。確認は backend の仮想環境で `test_code_cli_output_routing.py` と `test_aidiy_hermes_stdin.py` を実行する。
- `antigravity_cli` は CLI 固有の `--print-timeout` に固定の時間を渡すと、受信が続いていても先に終了する。`0` を渡して固定上限を無効にし、バックエンド側の無受信監視に任せる
- `CODE_AIDIY_HERMES_MODEL` が `auto` 以外のときは、`--provider ollama --model <model>` を渡す。AiDiy の設定画面で扱う `aidiy_hermes` モデル候補は Ollama 系を前提にする
- TUI の `/model` では `AiDiy_key.json` を使い、`ollama` / `openai` / `openrt` / `gemini` / `freeai` / `anthropic` を選べるようにする。Code AI 経由のモデル指定とは役割を分ける
- OpenAI / Claude / Google 系 provider を有効にする場合、`command_hermes/pyproject.toml` に `openai` / `anthropic` / `google-genai` を明示する

## 確認方法

- `AiDiy_key.json` に新CLI用の設定キーがある
- 固定モデル方式なら `_config/AiDiy_code_<cli名>.json` がある
- `/core/AIコア/モデル情報/取得` の `available_models.code_models` に新CLIが出る
- Web / Avatar の設定ダイアログで新CLIを選択できる
- バージョン確認、新規会話、継続会話のコマンドが組める
- `code1`〜`code6` のどのスロットに割り当てても WebSocket チャンネルは `code1`〜`code6` のまま動く
- `aidiy_hermes -Q -z "おはよう"` がバナーなしで応答する
- `aidiy_hermes -Q --provider ollama --model "<Ollamaモデル>" -z "おはよう"` が応答する
- `uv tool run --from aidiy-hermes python -c "import openai; import anthropic; import google.genai"` が通る

```powershell
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\AIコア\AIコード_cli.py
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\conf\conf_model.py
cd command_hermes
uv sync --upgrade
python ..\_setup.py
aidiy_hermes --version
aidiy_hermes -Q -z "おはよう"
cd frontend_avatar
npm run type-check
cd ..\frontend_web
npm run type-check
```
