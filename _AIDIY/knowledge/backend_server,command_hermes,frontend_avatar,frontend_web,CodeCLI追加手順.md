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
- `backend_diag/diag/モデル情報/` と `_AIDIY/aidiy_diag/code_models_info.json`（モデル候補の生成元と合成結果）

### frontend
- `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue`
- `frontend_avatar/src/dialog/AI設定再起動.vue`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_avatar/src/components/AIコード.vue`

## 追加手順

1. `AIコード_cli.py` の `_コマンドパス取得()` に CLI 名を追加する
2. `バージョン確認()` に確認コマンドと timeout を追加する
3. `_コマンド構築()` に初回会話と継続会話のコマンド生成を追加する
   - `auto` は対応方式では送信前の自動モデル判断へ渡す。判断後に残る `auto` / 空値は原則引数を省略し、OpenCodeの保存済みモデル、Hermesのsameなど方式別の例外は現行分岐を確認する。`--model auto` を実モデルとして渡さない
4. OS 依存の起動条件やパス変換が必要なら同ファイル内で分岐する
5. `AIコード.py` の welcome 文言、候補一覧、未インストール案内を更新する
6. `backend_diag/diag/モデル情報/` に候補の取得・固定定義と合成ロジックを追加する。`conf_model.py` は合成JSONを読むだけにする
7. `code_models_info.json` へ候補が出ることを確認する。`auto` / `same` は `get_code_models()` が付加し、合成JSONへ入れない
8. `conf_json.DEFAULT_CONFIG` と `AiDiy_key.json` に必要な `CODE_<CLI名>_MODEL` を追加する
9. frontend の `CODE_MODEL_KEYS` に CLI 名と保存キーの対応を追加する
10. 設定 UI で `availableModels.code_models` から新CLIが選べることを確認する
11. `AIセッション管理.py` のセッション設定と `core_router/AIコア.py` の設定保存キー一覧へ `CODE_<CLI名>_MODEL` を追加する
12. `core_router/AIコア.py` の `/モデル情報/TASK選択肢` フォールバック一覧に CLI 名を追加する
13. Task / Teamの現行画面は `frontend_ide`。そのモデル取得・候補フォールバックと設定画面を確認する（旧Web / Avatar内の画面は使わない）
14. 手動起動が要る場合は `scripts/cli_bat/_<CLI名>.bat` と `__install_cli.bat` / `__uninstall_cli.bat` を追加する

11〜13 は API 失敗時やセッション未確立時のフォールバック経路で、通常操作では気づけない。追加漏れの実績があるため、既存 CLI 名（`codex_cli` など）で全文検索して対応箇所を突き合わせる。

## Hermes 統合時の判断基準

- 公開名は frontend / backend / 設定 JSON で完全一致させる。現行値は `aidiy_hermes`
- 旧 `AiDiy_code_*.json` は作成せず、Diagの合成モデル一覧を使う
- `_setup.py` / `_cleanup.py` に統合しても、常駐起動が不要な CLI は `_start.py` に追加しない
- `aidiy_hermes --version` は cold start や `code1`〜`code6` 同時接続で遅くなることがある。未インストール誤判定を避けるため、長めの timeout と結果キャッシュを検討する
- `command_hermes` を新実装へ差し替えた後も公開コマンド名は `aidiy_hermes` のままにする。旧実装を残す場合は `command_hermes_old` のように別名へ退避し、AiDiy 本体からは参照しない
- `command_hermes/pyproject.toml` の dependencies で CLI 依存を管理する
- `_setup.py` では `uv sync --upgrade` 後に `~/.local/bin/aidiy_hermes.cmd` を生成し、既存登録済みでもランチャを再生成する

## 注意点

- 自動モデル判定が失敗した場合、GPT系は自身の利用可能候補の `sol` → `terra` → `luna`、候補がなければ `same` へ戻す。Claude CLI / SDKは `sonnet`。設定の `auto` は維持する。
- `claude_sdk` の `auto` は `claude_cli` と同じ `AIコードモデル選択.select_model` を使い、毎回の送信文と会話履歴からモデルを選ぶ。選択結果は `ClaudeAgentOptions.model` と選択モデル通知に反映し、設定値の `auto` は維持する。明示モデルはそのままSDKへ渡し、判断不可時はストリーム先頭へ「モデル選択失敗」と表示して `sonnet` を指定する。`resume=False` ではSDKセッションと判断用の旧履歴をリセットする。専用の既存自動テストはないため、SDK呼び出しをmockにした検証を追加する場合はモデル・継続・新規・停止を確認する。
- backend の `available_models.code_models` に出ない限り、frontend に項目を足しても選択できない
- frontend の設定 option は backend 返却値から生成し、CLI 名を固定直書きしない
- `code1`〜`code6` は WebSocket チャンネル/パネル名。CLI 名をチャンネル名として増やさない
- Windows で WSL 経由実行が必要な CLI は、作業ディレクトリとパス形式の差異を吸収する
- 設定変更は起動中サーバーへ自動反映されない。必要に応じて core server を再起動する
- `aidiy_hermes` の Code AI 呼び出しでは `-Q --oneshot-stdin` を使い、完全プロンプトを UTF-8 標準入力で渡す。本文の長短で argv / stdin を切り替えない。手動実行の `-Q -z "本文"` は互換性のため維持する
- Hermesの `auto` は自身の一覧の `openai_oauth/` 付き候補から選ぶ。Codexの候補を転用しない。判断失敗時は同じ一覧の `sol` → `terra` → `luna`、候補がなければ `same`。`same` は `--provider same --model same` を明示する。確認はauto・same・明示値・判断サービス停止を分ける。
- `aidiy_hermes` のワンショットでは、stdout は正式回答専用、stderr は thinking / step / tool 進捗 / 警告 / `session_id` 用に分ける
- `opencode_cli` / `antigravity_cli` は stdout を正式回答専用、stderr を `output_stream` 専用とする。stdout を途中表示にも送ると最終回答と二重表示になるため、追加時は `AIコード_cli.py` の `_STDERR_STREAM_STDOUT_FINAL_AI` を確認する
- `copilot_cli` は初回・継続とも `--output-format json --stream on` を付け、stdout の JSONL を `_CopilotJSON出力` で解析する。通常テキストではツール進捗も stdout に流れ、stderr は終了時の利用量などに限られるため、stderr だけの監視では途中経過を表示できない
- Copilot の `assistant.reasoning_delta` / `assistant.reasoning` とツール開始・進捗・完了は `output_stream` に振り分ける。思考断片は改行または160文字ごとにまとめ、完成版との重複を避ける。思考イベントの有無はモデルによって異なる
- Copilot の回答断片は `messageId` ごとに保持し、最後の親エージェントの回答本文だけを正式回答にする。ツール要求つきメッセージ、commentary / thinking、子エージェントの回答、入力や利用量、暗号化された思考を正式回答へ混ぜない。未知のJSONイベントは無視し、stdoutの生JSONは画面へ送らない
- Code CLI の実行待機は既定で900秒。stdout / stderr のどちらかで1チャンクでも受信したら、その時点から900秒を数え直す。画面へのストリーム表示は引き続き行単位にする
- Windows の監視ラッパー `backend_tools/tools_proc/process_lifetime.py` では、子の `subprocess.Popen` に `stdin=sys.stdin`、`stdout=sys.stdout`、`stderr=sys.stderr` を明示する。`CREATE_NO_WINDOW` と標準ハンドルの省略を組み合わせると、CLIが動いても出力が届かず「応答なし」になる。この出力経路の専用テストは現行にないため、mockした子プロセスとWindows実機で標準入出力の受け渡しを別途確認する。
- `antigravity_cli` は CLI 固有の `--print-timeout` に固定の時間を渡すと、受信が続いていても先に終了する。`0` を渡して固定上限を無効にし、バックエンド側の無受信監視に任せる
- Hermesの明示モデルは通常 `--model` へ渡す。外部CLIの `provider/model` は対応する `--provider` とモデルへ分離し、`local_chat` は `lmstudio` とローカルAPI URLを使う。Ollama固定ではない。
- TUI の `/model` では `AiDiy_key.json` を使い、`ollama` / `openai` / `openrt_chat` / `openrt_free` / `gemini` / `freeai` / `anthropic` を選べるようにする。Code AI 経由のモデル指定とは役割を分ける
- OpenAI / Claude / Google 系 provider を有効にする場合、`command_hermes/pyproject.toml` に `openai` / `anthropic` / `google-genai` を明示する

## 確認方法

- `AiDiy_key.json` に新CLI用の設定キーがある
- Diagの `code_models_info.json` に新CLI候補がある（旧 `_config/AiDiy_code_*.json` は作成しない）
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
