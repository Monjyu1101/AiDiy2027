# backend_tools 構成

> 文書: `backend_tools,構成.md` | 実装: `backend_tools/tools_main.py`, `backend_tools/mcp_stdio.py`

## このメモを使う場面
- `backend_tools` の入口、SSE サーバー、stdio bridge の役割を確認する
- MCP サーバーを追加、分割、修正する
- Codex / Antigravity の Streamable HTTP 接続や、stdio クライアントから AiDiy MCP を使う経路を調査する

## 構成方針
- 常駐入口は `backend_tools/tools_main.py`
- Codex / Antigravity は Streamable HTTP の `/mcp` へ直接接続する。stdio 接続を選ぶクライアント向けの SSE 変換入口は `backend_tools/mcp_stdio.py`
- 再利用ロジックは `backend_tools/tools_proc/` に置く
- `tools_main.py` からは `tools_proc.<module>` として import する
- `tools_main.py` は MCP SDK 2.x の `MCPServer` インスタンスを Starlette の `Mount` で合成し、`tools_main:app` として uvicorn に渡す。Windows では 20 本、Linux / macOS では 19 本

## 起動チェックに失敗したMCPの扱い

- 外部クライアントのJSON / TOMLには接続先を登録する。利用不可を理由に接続先を削除しない。
- Decisions、FFmpeg、Chat LLM、Code Agentsは利用可能な実行機能だけを公開する。全機能が利用不可でもMCP接続と診断ツールは維持する。
- MCP接続時の `initialize.instructions` で「現在利用不可」を伝え、`decisions_config` / `ffmpeg_versions` / `chat_llms_config` / `code_agents_config` は `status: "NG"`、`available: false`、`message` と既存の診断情報を返す。
- FFmpegは `ffmpeg` / `ffprobe` / `ffplay` ごとに起動時の `-version` 結果で判定する。一部が動けばその機能を公開し、利用できないバイナリを必要とするHTTP実行要求には503と「現在利用不可」を返す。
- 設定・認証・依存ツールを修正したら `backend_tools` を再起動し、クライアントを再接続してツール一覧を更新する。

## Windowsの長押しドラッグ

長押ししてから移動する操作には、`aidiy_windows_control.mouse_long_press_drag` を使います。通常の `mouse_drag` のAPI・動作は変更しません。

- `x1`, `y1`: 押下位置、`x2`, `y2`: 移動先（整数、同じデスクトップ座標系）。直前の画面と座標系を確認します。
- `button`: `left`（既定）/ `right` / `middle`。
- `hold_duration`: 移動前に押したまま保持する秒数。既定0.8、範囲0〜10。
- `duration`: 保持後に移動する秒数。既定0.2、範囲0〜60。保持時間とは別です。

例: `mouse_long_press_drag(x1=600, y1=30, x2=600, y2=400, hold_duration=0.8, duration=0.6)`。座標は例であり、実画面の対象へ置き換えます。HTTPは `POST /aidiy_windows_control/mouse_long_press_drag` に同じ引数をJSONで渡します。有限の時間とボタン・座標を実入力前に検証し、押下・保持・移動の途中例外でも `finally` で解放を試みます。OS自体の障害・プロセス強制終了時まで解放を保証するものではありません。

検証は `backend_tools/.venv/Scripts/python.exe -m unittest discover -s backend_tools/checks -p test_windows_drag.py -v`。GUIと待機をモックし、ASGIはプロセス内で実行するため、実マウスや稼働サーバーには触れません。Windows専用です。

登録は `tools_main.py` の起動時に行われ、通常起動のuvicornにはコード再読込指定がありません。コード保存だけでは稼働中Toolsへ反映されません。利用者が許可した時点でToolsを通常手順で再起動し、MCPクライアントを再接続してツール一覧・引数を更新します。再起動中は他のMCP利用にも影響するため、実演中に勝手に停止しません。

## 関連ファイル

- `backend_tools/tools_main.py`
- `backend_tools/mcp_stdio.py`
- `backend_tools/tools_proc/chrome_manager.py`
- `backend_tools/tools_proc/chrome_sessions.py`（セッション名 → ポート/プロファイルの辞書管理、`temp/_chrome_sessions.json` に永続化）
- `backend_tools/tools_proc/chrome_devtools.py`
- `backend_tools/tools_proc/desktop_capture.py`
- `backend_tools/tools_proc/sqlite_query.py`
- `backend_tools/tools_proc/postgres_query.py`
- `backend_tools/tools_proc/log_tailer.py`
- `backend_tools/tools_proc/code_checker.py`
- `backend_tools/tools_proc/backup.py`
- `backend_tools/tools_proc/image_generation.py`
- `backend_tools/tools_proc/movie_generation.py`
- `backend_tools/tools_proc/speech_to_text.py`
- `backend_tools/tools_proc/text_to_speech.py`
- `backend_tools/tools_proc/obs_studio_control.py`
- `backend_tools/tools_proc/ffmpeg_control.py`
- `backend_tools/tools_proc/notification_sounds.py`
- `backend_tools/tools_proc/code_agents.py`
- `backend_tools/tools_proc/chat_llm.py`（`tools_proc/tools_chat.py` が MCP 登録と OpenAI 互換 HTTP ルートを持つ）
- `backend_tools/tools_proc/prediction_llm.py` / `backend_tools/tools_proc/tools_prediction.py`（プロジェクト別の次入力予測、履歴・セッション非保存）
- `backend_tools/tools_proc/decisions_check.py` / `backend_tools/tools_proc/tools_decisions.py`（判断ロジックは `backend_server/AIコア/AI判断*.py`）
- `backend_tools/tools_proc/task_agents.py`
- `backend_tools/tools_proc/team_agents.py`
- `backend_tools/tools_proc/windows_control.py`
- `_config/AiDiy_mcp.json`
- `_start.py`

## アクセスインターフェース

各 MCP は **SSE / Streamable HTTP / stdio gateway の3トランスポート**に対応する。サーバー側の接続先は同一ポート（8095）で、ツールと同じ処理を直接呼ぶ REST API も提供する。

| トランスポート | アクセス方法 | 用途 |
|----------------|-------------|------|
| **SSE Transport** | `GET /{mcp_name}/sse` + `POST /{mcp_name}/messages/` | Claude や公式 MCP SSE クライアントが接続 |
| **Streamable HTTP** | `POST\|DELETE /{mcp_name}/sse` および `/{mcp_name}/mcp` | Codex / Antigravity（`/mcp`）、Grok の `type=sse`（initialize を `/sse` へ POST）と Streamable HTTP クライアント。REST の `{method_name}` より先にミドルウェアが受け取る |
| **HTTP POST（REST）** | `POST /{mcp_name}/{method_name}` | Python / curl / 自動化スクリプトが直接呼び出し |
| **stdio gateway** | `mcp_stdio.py --sse-url .../sse` | stdio 接続を選ぶ MCP クライアントが経由 |

MCP一覧: `GET http://127.0.0.1:8095/` — 全 MCP 名を返す。  
ツール一覧: `GET http://127.0.0.1:8095/{mcp_name}/list` — ツール名・説明・引数スキーマを JSON で返す。  
死活確認: `GET http://127.0.0.1:8095/{mcp_name}/ping` — `{"status":"ok"}` を返す。  
初期化: `POST http://127.0.0.1:8095/{mcp_name}/initialize` — capabilities を返す。

HTTP POST は SSE とまったく同じロジックを呼ぶ。AI エージェント経由でなくても Python スクリプトや `backend_tools/aidiy_automations/` から直接利用できる。

```python
import requests
# SQLite のテーブル一覧を取得する例
res = requests.post("http://127.0.0.1:8095/aidiy_sqlite/list_tables", json={})
print(res.json())

# TTS でテキストを読み上げる例（サーバー側ローカル再生）
res = requests.post("http://127.0.0.1:8095/aidiy_text_to_speech/synthesize",
                    json={"speech_text": "処理が完了しました", "play": True})
print(res.json())  # {"save_path": "..."}
```

## 提供 MCP

| MCP | 用途 | SSE URL |
|-----|------|---------|
| `aidiy_chrome_devtools` | Chrome CDP で画面検証（`session` パラメータで複数 Chrome 並行セッション。自動テストの並行実行可。使用後は `close_session` で破棄） | `http://127.0.0.1:8095/aidiy_chrome_devtools/sse` |
| `aidiy_desktop_capture` | デスクトップ/ウィンドウのスクリーンショット | `http://127.0.0.1:8095/aidiy_desktop_capture/sse` |
| `aidiy_sqlite` | AiDiy SQLite DB の確認 | `http://127.0.0.1:8095/aidiy_sqlite/sse` |
| `aidiy_postgres` | 外部 PostgreSQL の確認 | `http://127.0.0.1:8095/aidiy_postgres/sse` |
| `aidiy_logs` | backend_server / backend_tools のログ確認 | `http://127.0.0.1:8095/aidiy_logs/sse` |
| `aidiy_code_check` | Python 構文、ruff、TypeScript 型チェック | `http://127.0.0.1:8095/aidiy_code_check/sse` |
| `aidiy_backup` | 差分バックアップ保存 / 確認。HTTP は `save` / `check` に分岐 | `http://127.0.0.1:8095/aidiy_backup/sse` |
| `aidiy_image_generation` | AI 画像生成（`auto` は codex → antigravity → openai → freeai → gemini の順でフォールバック） | `http://127.0.0.1:8095/aidiy_image_generation/sse` |
| `aidiy_speech_to_text` | 音声認識（speech_recognition / Whisper） | `http://127.0.0.1:8095/aidiy_speech_to_text/sse` |
| `aidiy_text_to_speech` | テキスト音声合成（Edge / OpenAI / Gemini / FreeAI） | `http://127.0.0.1:8095/aidiy_text_to_speech/sse` |
| `aidiy_obs_studio_control` | OBS Studio WebSocket 制御 | `http://127.0.0.1:8095/aidiy_obs_studio_control/sse` |
| `aidiy_ffmpeg_control` | ffmpeg / ffprobe / ffplay 実行（動画合成、字幕焼き込み、プレビュー再生） | `http://127.0.0.1:8095/aidiy_ffmpeg_control/sse` |
| `aidiy_movie_generation` | AI 動画生成（Google Gemini Veo、MP4 保存、base64 返却なし） | `http://127.0.0.1:8095/aidiy_movie_generation/sse` |
| `aidiy_notification_sounds` | 通知音のローカル再生（scene 別の開始 / 終了 / 注意音、`tts` シーンは読み上げ合成） | `http://127.0.0.1:8095/aidiy_notification_sounds/sse` |
| `aidiy_code_agents` | AI コードエージェント実行（CodeAI CLI 経由） | `http://127.0.0.1:8095/aidiy_code_agents/sse` |
| `aidiy_chat_llms` | AIチャット の ChatAI を MCP 化。OpenAI / Ollama 互換の `aidiy_chat_completions`（HTTP のみ）の実体 | `http://127.0.0.1:8095/aidiy_chat_llms/sse` |
| `aidiy_decisions_check` | AI判断（Decisions API / OAuth Responses JSON Schema） | `http://127.0.0.1:8095/aidiy_decisions_check/sse` |
| `aidiy_task_agents` | backend_taskteam の Task API への AIタスク非同期投入、要求/明細状態取得 | `http://127.0.0.1:8095/aidiy_task_agents/sse` |
| `aidiy_team_agents` | backend_taskteam の Team API への AIチーム依頼投入、依頼/要員状態取得 | `http://127.0.0.1:8095/aidiy_team_agents/sse` |
| `aidiy_windows_control` | Windows環境でComputer Use（computer-use）が利用できない場合の代替機能。Windows でのみ公開するデスクトップ操作制御（マウス/キーボード、ウィンドウ、プロセス、クリップボード、UI Automation） | `http://127.0.0.1:8095/aidiy_windows_control/sse` |

Linux / macOS では `aidiy_windows_control` の import、MCP 登録、REST ルート、SSE マウントを行わない。`GET /` の `mcps` は 19 件で、Windows 操作の URL は 404 を返す。`uiautomation` も Windows だけにインストールする。`_config/AiDiy_mcp.json` はローカル生成設定であり、Windows で `_setup.py` の MCP 設定を実行すると Windows 操作 MCP を追加する。非 Windows で設定を実行すると、以前登録した Windows 操作 MCP をプロジェクト設定と各 CLI 設定から削除する。画面のない Linux 環境では `pyautogui` の初期化失敗を `desktop_capture.py` が保持し、キャプチャ呼び出し時にエラーを返す。

## 次のユーザー入力予測

`aidiy_prediction_llms` はMCPに公開しない内部サービスで、`POST /internal/prediction_llms` だけを提供する。Live試行の `/internal/live_model_check` と同じ境界を使い、OpenAPIには掲載しない。公開 `/aidiy_prediction_llms/*`、config/docs経路、SSE/Streamable HTTP/stdio、MCP一覧・各CLIへの登録は追加しない。

- 接続元はloopback IPに限定し、HostはDNS解決せず `127.0.0.1` / `[::1]`（任意ポート）だけを許可する。Hostと `X-AiDiy-Diag` は各1つ、ヘッダー値は `X-AiDiy-Diag: model-trial` が必要。
- `Origin`、`Forwarded`、`X-Forwarded-*`、`X-Real-IP`、`X-Original-Host`、`X-Original-URL`、`X-Rewrite-URL`、クエリ文字列は拒否する。`Content-Type: application/json` と64KiB以下のJSON本文が必要で、受信は3秒まで。
- 呼び出し元の切断時は予測タスクと監視タスクをキャンセルして回収する。これはアプリ側の処理制御であり、外部プロバイダ側の通信終了やデータ保持を保証するものではない。

- JSON本文は `project_path` 必須。任意引数は `ai_name="auto"`、`ai_model="auto"`、`timeout_sec=120`（整数1〜600秒）のみ。空パスや未知の引数は拒否する。
- 正規化したプロジェクト絶対パスが完全一致する、呼び出し時点から直近2時間以内のテキスト会話だけを参照する。DBの保存時刻と同じサーバーローカル時刻・秒精度で一度だけ範囲を確定し、2時間前と呼び出し時刻の両端を含め、未来の行は除外する。2時間より前の古い会話で補充しない。
- 1ターンは同一セッション・チャンネルのユーザー入力と、次の入力までの返答群。明確なCode/ch0ミラーを整理してから、ユーザー入力が新しい順に最大10ターンを選ぶ。最新の未返信入力も含め、期間外入力に対する返答だけではターンを作らない。期間内の別セッション・チャンネルの返答は混ぜない。
- 推論へはユーザー依頼だけを `turn_id` 順に `""" ユーザー依頼01` … の番号付きブロックで渡し、最後に `""" 次のユーザー依頼` / `？？？　⇦　ここを予測して` のブロックを置く。AIの返答は渡さず、本文の `"""` は `”””` に置き換える。予測指示では、ユーザー要求の流れを推察して次の回答（ユーザーの次の入力）を予測させ、入力の流れや繰り返しの対応関係から推定するよう、例（A→B→A′ なら B′、A→B→C→A′ でも B′、A→B に流れがあり C なら D）を示す。CLI方式も毎回新しいセッションで実行し、前回の予測や通常の会話を引き継がない。Chat / CLI の両経路とも共通の `AI実行オプション.単発()`（会話継続・履歴保存・ストリーム送信・出力ファイル保存をすべて無効）を渡す（[共通パラメータ](./backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md)）。DBのセッションIDはモデルに渡さない。本文合計24,000文字・1件4,000文字の安全上限は維持し、超えるときは最新ターンの入力を残して新しい返答から優先する。文字数上限により10ターン未満になることはある。
- 他プロジェクト・所属不明・2時間より古い履歴へフォールバックしない。対象のユーザー入力がなければ `status: "NG"` を返し、モデルは呼ばない。`history_count` は採用したメッセージ数で、ターン数ではない（10ターンが20件以上のメッセージになる場合もある）。
- 通常の Chat 設定ではなく `PREDICTION_AI_NAME` と方式別 `PREDICTION_OPENAI_MODEL` / `PREDICTION_OAUTH_MODEL` / `PREDICTION_GEMINI_MODEL` / `PREDICTION_FREEAI_MODEL` / `PREDICTION_CODEX_CLI_MODEL` / `PREDICTION_COPILOT_CLI_MODEL` / `PREDICTION_AIDIY_HERMES_MODEL`（初期値は方式とChat系が `auto`、CLI系が `gpt-6-luna` / Hermesは `openai_oauth/gpt-6-luna`）を使う。明示引数を優先し、引数がautoのときだけ設定値を使う。方式設定もautoなら、Diagの `prediction_models_info.json` に候補がある `codex_cli` → `copilot_cli` → `aidiy_hermes` → `openai_oauth` → `freeai_chat` → `openai_chat` → `gemini_chat` の順で選ぶ。CLI方式（`codex_cli` / `copilot_cli` / `aidiy_hermes`）はautoで最優先に選ばれ、空の一時フォルダで権限none・継続なしの1回だけ実行する。正常応答の先頭に `[[PREDICTION]]` を付けさせ、目印がない応答は実行エラーとして扱う。CLI自身のセッション履歴はCLI側に残る場合がある。モデルは決定した方式のキーを使い、それもautoなら選んだ方式の先頭候補を使い、候補外モデルには切り替えない。
- Diagは判断用と同じ認証済み低コスト候補から生成し、OpenAI API区分だけ `openai_decisions` から `openai_chat` に置き換える。予測JSONに `openai_decisions` は含めない。判断側の候補区分・選択順・実行処理は変更しない。
- 起動時のモデル実行チェックは行わず、実行時に設定・認証を確認する。DBは読み取り専用で、会話本文・予測文をDB・ログ・セッションへ保存せず、ファイル生成やツール実行も行わない。MCPツールとしては登録しない。設定はWeb / AvatarのAI設定画面で変更し、Diagの明示試行と、利用者がONにしたCode画面の予測（入力欄の「検証」の左のトグル）から内部RESTを呼び出す。
- 戻り値は `status`、`result`（予測文または安全な説明）、`ai_name`、`ai_model`、`project_path`、`history_count`。ラッパー内部の予期しない失敗は `status` / `result` の安全な説明のみを返す。
- 次の入力を合理的に予測できない場合、プロンプトは半角 `!` の直後に短い理由を返すよう指示する。実生成に成功した `!説明`（全角 `！説明` も許容）は `status: "OK"` のまま `result` に保持する。呼び出し側は先頭1文字を除いて説明ダイアログに表示し、下書きへ入れず自動送信もしない。実生成に成功したマーカー単独も非空応答として `OK` にし、Diagの疎通試験は通過できる。ただし呼び出し側は空の説明ダイアログや下書きを表示しない。通信・認証・タイムアウト・ラッパー例外は正常な応答へ昇格せず `NG` とする。通常Chatの `!` エラー規約は変更しない。
- 入力エラーは値を含めない安全な400応答にし、予測本文・履歴・モデル出力・例外詳細をログへ追加しない。内部処理の安全な状態メッセージだけを記録する。
- 検証時は実DBや外部モデルへ接続せず、予測エンジンをmockに置換して、loopback/Host/必須ヘッダー/プロキシ拒否、JSON制限・必須項目、安全なエラー応答、切断時の回収、公開経路・MCP一覧への非掲載を確認する。履歴は固定時計と一時DBで、2時間境界・未来除外・10ターンとメッセージ数の違い・セッション/チャンネル分離・未返信入力・文字数上限・DB不変を確認する。

内部処理からの呼び出し例:

```python
import requests
response = requests.post(
    "http://127.0.0.1:8095/internal/prediction_llms",
    headers={"X-AiDiy-Diag": "model-trial"},
    json={"project_path": "/path/to/project"},
    timeout=130,
)
result = response.json()
```

`result` の `status` が `OK` のとき、同名の `result` フィールドが次のユーザー入力の予測文になる。

## 新規 MCP サーバー追加手順

### コード変更
1. `backend_tools/tools_proc/<サーバー名>.py` に処理を実装する（`<XxxError>` 例外クラスもセットで定義）
2. `backend_tools/tools_main.py` に以下を追加する
   - `from tools_proc.<サーバー名> import ...` の import
   - `MOUNT_<略号> = os.environ.get("MCP_<略号>_MOUNT_PATH", "/aidiy_<name>")`
   - インスタンス生成（例: `xx = ImageGeneration()`）
   - `mcp_<略号> = MCPServer("aidiy_<name>", warn_on_duplicate_tools=False)`
   - `sse_app(sse_path="/sse", message_path="/messages/", host="127.0.0.1")` と `streamable_http_app(streamable_http_path="/mcp", host="127.0.0.1")` を既存の `_mcp_transport_app()` で合成する
   - `@mcp_<略号>.tool()` でツール登録
   - `MCP_MAP` へ登録し、`app.mount(MOUNT_<略号>, _mcp_transport_app(mcp_<略号>))` でマウントする。`sse_path` / `message_path` はマウント先を重ねず `/sse` / `/messages/` とする。HTTPルーターは既存の `tools_proc/tools_*.py` の構成に合わせて登録する
   - 起動ログに `logger.info(f"... SSE : http://127.0.0.1:{MCP_PORT}{MOUNT_<略号>}/sse")` を追加
3. `_config/AiDiy_mcp.json` の `mcpServers` に `"aidiy_<name>": {"type": "sse", "url": "..."}` を追加する
4. stdio クライアントから使う場合は `mcp_stdio.py --sse-url http://127.0.0.1:8095/aidiy_<name>/sse` で中継できることを確認する

### ドキュメント更新

- 一覧・接続URLの正本である本書の「提供 MCP」と関連実装を更新する。
- 利用目的が増える場合は [MCP活用手順](./backend_server,backend_tools,MCP活用手順.md) の「ツール選択基準」を更新する。一覧を別文書へ複製しない。
- `backend_tools/AGENTS.md`、ルート `AGENTS.md` / `README.md`、`frontend_web/public/X自己紹介/index.html` に構成・件数の記載があれば同期する。最小入口の `CLAUDE.md` / `_AIDIY.md` へ一覧を追加しない。
- Windows 限定MCPを含む場合は、WindowsとLinux/macOSの件数・公開範囲を分けて確認する。

### 確認
12. `backend_tools` 再起動後 `curl http://127.0.0.1:8095/aidiy_<name>/sse` が `text/event-stream` を返すか確認
13. `grok mcp doctor aidiy_<name>` が healthy になること（Grok は `/sse` へ initialize を POST する）
14. Hermes / Claude CLI で `mcp list` 相当を実行し、新規サーバーが `ok` 表示になることを確認

## 再起動ウォッチャー

`tools_main.py` の `_setup_reboot_watcher()` が `backend_tools/temp/reboot_tools.txt` を監視する。ファイル検知後に削除して `os._exit(0)` し、`_start.py` が子プロセス終了を検知して再起動する。

手動で再起動したい場合:

```powershell
New-Item -ItemType File backend_tools\temp\reboot_tools.txt -Force
```

## Chrome 自動起動

Chrome DevTools 系ツールは `_ensure_chrome()` で Chrome の起動状態を確認する。未起動なら `ChromeManager.ensure_running()` が `--remote-debugging-port` 付きで起動する。

- Chrome パス上書き: `CHROME_EXECUTABLE`
- デバッグポート: `CHROME_DEBUG_PORT`（既定 `9222`）
- `_start.py` も起動時に Chrome を先行起動する

## PostgreSQL の遅延初期化

`aidiy_postgres` は `psycopg` 未導入や DSN 未設定でも他 MCP の起動を妨げない。起動時の `PgQuery()` 例外を保存し、PostgreSQL ツール呼び出し時にだけ `_get_pg()` でエラー化する。

## stdio bridge の注意点

- Codex の `url = ...` は Streamable HTTP 用で、セットアップは `/mcp` を指定する。stdio 接続を選ぶクライアントは `mcp_stdio.py` で SSE へ中継する
- MCP SDK 2.x の SSE クライアントは `httpx2.AsyncClient` を使う。`httpx.AsyncClient` を factory から返すと `AsyncClient object has no attribute sse` になる
- 低レベル `Server` の中継ハンドラーは `Server(..., on_list_tools=..., on_call_tool=...)` で登録する。1.x の `server.request_handlers[...]` は使わない
- 初期化結果は `server_info`、要求パラメータは `CallToolRequestParams` などの snake_case 属性で参照する
- `ClientSession.call_tool()` へ `params.meta` を中継する場合は `model_dump(by_alias=True, exclude_none=True)` 相当で `dict` に正規化する

## 注意点

- `tools_main.py` は入口として残し、`tools_proc` へ入れない
- MCP SDK は `mcp[cli]>=2,<3` を使い、`MCPServer` を `mcp.server.mcpserver` から import する。MCP 1.x の `mcp.server.fastmcp.FastMCP` へ戻さない
- stdio と SSE の transport 変換は `mcp_stdio.py` に閉じ込める
- SQLite / PostgreSQL は既定 read-only。検証は SELECT / describe / count を優先する
- Chrome DevTools MCP は Python CDP 実装。Node.js 版 `chrome-devtools-mcp` 前提で復旧しない
- `aidiy_backup` の path 問題は、`BackupSave(project_root)` の `root`（対象）と `backend_dir`（AiDiy実装の配置先）、`BackupCheck(project_root).backup_root`（対象直下の `.aidiy_backup/`）を照合する。保存と差分確認は対象の絶対パスをセッション設定で明示する。詳細は [`command_hermes,共通,MCPバックアップ検証手順.md`](./command_hermes,共通,MCPバックアップ検証手順.md) の「保存先とプロジェクトルートの確認」を参照する

## 確認方法

```powershell
cd backend_tools
.venv\Scripts\python.exe -c "import tools_main"
.venv\Scripts\python.exe mcp_stdio.py --help
curl http://127.0.0.1:8095/aidiy_sqlite/sse
curl http://127.0.0.1:9222/json
```

追加/移動後は `rg "chrome_manager|chrome_devtools" backend_tools` で旧 import が残っていないか確認する。
