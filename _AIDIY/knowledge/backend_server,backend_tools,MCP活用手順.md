# MCP 活用手順

> 文書: `backend_server,backend_tools,MCP活用手順.md` | 実装: `_config/AiDiy_mcp.json`, `backend_server/AIコア/AIコード_claude.py`

## このメモを使う場面
- Claude Agent SDK や Code CLI から MCP ツールを使う
- ブラウザ操作、DB 参照、ログ確認、コードチェック、バックアップ確認を MCP で行う
- `AiDiy_mcp.json` に MCP サーバーを追加する

## 関連ファイル
- `_config/AiDiy_mcp.json` — Claude Agent SDK に渡す MCP 接続定義
- `backend_server/AIコア/AIコード_claude.py` — Claude Agent SDK で MCP を使う処理
- `backend_tools/tools_main.py` — Windows は20個、Linux / macOS は19個の MCP サーバー入口
- `backend_tools/mcp_stdio.py` — SSE を stdio client へ中継
- `backend_tools/tools_proc/` — 各 MCP のロジック

## MCP サーバー一覧

`aidiy_code_agents` の `ai_name` が `auto` / `same` の場合は `aidiy_hermes` を選ぶ。`auto/auto` は Hermes でモデルを自動選択し、`auto/same` と `same/same` は Hermes の前回手動選択（provider / モデル）を復元する。Hermes が利用不可ならエラーを返す。`codex_cli` などを明示指定した場合はそのエージェントを使う。起動時の利用可否確認には、Code パネル登録の有無にかかわらず Hermes を含める。

前回値の保存先と指定方法は [`command_hermes,Provider一覧と選択ロジック.md`](./command_hermes,Provider一覧と選択ロジック.md) を参照する。専用の自動テストはないため、Tools を再起動して `aidiy_code_agents` をモデル未指定と明示指定で呼び、実行ログのモデル指定を確認する。

提供サーバーと接続URLの正本は [backend_tools 構成の提供 MCP](./backend_tools,構成.md#提供-mcp)。用途ごとの選択は本書の「ツール選択基準」を参照する。

## IDEのBrowserパネル・単独Browserを操作するとき

Electron版IDEをtoolsへ接続し、「＋ Browser」を開いてから、`aidiy_chrome_devtools` の各操作に `session="aidiy_ide"` を指定します。`list_tabs` でBrowserのIDを取得し、`navigate`、`click`、`type_text`、`eval_js`、`screenshot` へ `tab_id` を渡します。複数IDEを起動した場合はパネルに表示された `aidiy_ide-2` 以降の名前を使います。

このセッションはIDE所有のBrowser専用です。`new_tab` は同じIDEの別Browserパネルを開き、`close_session` はBrowserパネルだけを閉じます。IDE本体やCode・Consoleは閉じません。未起動時に別Chromeを自動起動せず、tools切断中は操作を拒否します。接続先はIDEが `backend_tools/temp/_ide_browser_sessions/` へ自動登録するため、通常のChrome用ポート設定は不要です。Web版のブラウザタブはこの登録の対象外です。

単独 `aidiy_browser` は同じ操作で `session="aidiy_browser"`（複数起動は `aidiy_browser-2` 以降）を使います。通常Chromeの `default` やIDEのセッションとは別です。起動単位の一時プロファイルと専用ページだけのCDPを使い、最後の窓を閉じると登録を削除します。DiagのChromeボタンは従来のシステム起動Webタブ「手動で開く」と同じ `new_page` を使い、Tools / MCPとWebが稼働中のときに固定 `http://localhost:8090/` を開きます。

実装と確認方法は [Vue共通画面変更手順](./frontend_ide,Vue共通画面変更手順.md) のBrowser節を参照してください。

## AiDiy_mcp.json の形式

```json
{
  "mcpServers": {
    "aidiy_chrome_devtools": {
      "type": "sse",
      "url": "http://127.0.0.1:8095/aidiy_chrome_devtools/sse"
    },
    "aidiy_sqlite": {
      "type": "sse",
      "url": "http://127.0.0.1:8095/aidiy_sqlite/sse"
    }
  }
}
```

`type: "sse"` を明示する。環境依存の接続定義は `_config/` 配下で管理し、docs や code_samples へ実キーをコピーしない。

## 作業中の音声案内

Toolsが起動中のときは、作業の経緯や判断理由も要点を短く音声で説明します。完了通知だけに限定せず、何を確認し、何が分かり、次に何をするかを伝えます。

利用者の希望により、Toolsが利用できるときは、作業開始・重要な進捗・完了・利用者の操作が必要な場面を短い日本語の音声でも案内します。`aidiy_notification_sounds.play_notification_sound` に `scene="tts"` と案内文を `notification_type` として渡します。文字での報告も残します。

細かな操作ごとの連続発声は避けます。秘密情報や認証情報は読み上げません。Toolsが未接続、または音声再生が失敗した場合は文字で案内して作業を続けます。ツールの再生成功と、人が実際に聞き取れたことは区別します。

## ツール選択基準

| やりたいこと | 優先 MCP |
|-------------|----------|
| Web 画面の DOM、URL、クリック、スクリーンショット確認 | `aidiy_chrome_devtools` |
| 複数 Chrome でのシステムテスト自動実行・並行実行 | `aidiy_chrome_devtools`（`session` 指定。終了後 `close_session`） |
| Electron やブラウザ外を含む画面確認 | `aidiy_desktop_capture` |
| AiDiy SQLite のテーブル、件数、監査項目確認 | `aidiy_sqlite` |
| 外部 PostgreSQL のスキーマ、件数確認 | `aidiy_postgres` |
| サーバーログや Traceback 確認 | `aidiy_logs` |
| Python 構文、ruff、TypeScript 型チェック | `aidiy_code_check` |
| 差分バックアップ保存 / 確認 | `aidiy_backup` |
| AI 画像生成（プロンプト→ PNG） | `aidiy_image_generation` |
| AI 動画生成（テキスト/画像→ MP4、Gemini Veo） | `aidiy_movie_generation` |
| 音声→テキスト変換（Whisper など） | `aidiy_speech_to_text` |
| テキスト→音声変換（MP3 出力） | `aidiy_text_to_speech` |
| OBS Studio の配信、録画、シーン、ソース、音声制御 | `aidiy_obs_studio_control` |
| ffmpeg / ffprobe による動画合成・字幕焼き込み、ffplay でプレビュー再生 | `aidiy_ffmpeg_control` |
| 長時間処理の開始 / 終了 / 注意をローカル通知音で知らせる | `aidiy_notification_sounds` |
| AI コードエージェント実行（CodeAI CLI 経由） | `aidiy_code_agents` |
| AIチャット の ChatAI をツール／OpenAI 互換 API として呼ぶ | `aidiy_chat_llms` |
| 真偽の確率・候補選択・段階評価を共通形式で取得 | `aidiy_decisions_check`（[AI判断の利用と追加](./backend_server,backend_tools,AI判断追加手順.md)） |
| AIタスクへ依頼を投入して非同期実行させる | `aidiy_task_agents` |
| AIチームの要員へ依頼を投入して非同期実行させる | `aidiy_team_agents` |
| マウス/キーボード操作、ウィンドウ制御、プロセス管理 | `aidiy_windows_control` |

次のユーザー入力予測 `aidiy_prediction_llms` はMCP非公開で、各CLIのMCP設定には追加しない。内部処理から `POST /internal/prediction_llms` を使う。必須引数・接続制限は [backend_tools 構成](./backend_tools,構成.md#次のユーザー入力予測) を参照する。

SQLite / PostgreSQL は既定 read-only。書き込みが必要でも、まずアプリ API や既存初期化処理で再現できないか確認する。

`aidiy_task_agents.submit`の`task_id`は通常は指定不要で、省略時はbackend_taskteamが`TASK.mmdd.hhmmss`形式で自動採番する。呼出元のIDをAタスク要求まで引き継ぐ必要がある場合だけ指定する。

`aidiy_task_agents.submit`の`project_path` / `ai_name` / `ai_model_plan` / `ai_model_do` / `ai_model_check`も通常は指定不要（null）。未指定時はbackend_taskteamがAIタスク_要求編集ダイアログの新規時と同じ条件、つまり利用者IDの更新最終レコードの値を引き継ぎ、レコードが無ければ規定値（`AiDiy_key.json`の`CODE_BASE_PATH` / `TASK_AI_NAME` / フェーズ別の`TASK_AI_MODEL_*`）を使う。特定のプロジェクトやAIを狙う場合だけ明示指定する（`project_path`の空文字は「プロジェクト空欄」の明示指定として扱う）。

`aidiy_team_agents.submit`は`Aチーム依頼`を`状態=準備開始`で追加する。依頼IDはbackend_taskteamが`TR`＋8桁で自動採番するため指定できない。`member_id`（要員ID、既定`admin`）はAチーム要員の要員IDで、候補は`get_member_list`で確認する。`project_path` / `team_ai_name` / `task_ai_name`と、`team_ai_model_plan` / `_do` / `_check`、`task_ai_model_plan` / `_do` / `_check`は通常は指定不要（null）で、未指定時はbackend_taskteamがAIチーム_依頼編集ダイアログの新規時と同じ条件、つまり要員IDの更新最終レコードの値を引き継ぎ、レコードが無ければ規定値（`AiDiy_key.json`の`CODE_BASE_PATH` / `TEAM_AI_*` / `TASK_AI_*`）を使う。登録後はbackend_taskteamの監視ループ（5秒間隔）が`aidiy_task_agents`へ投入するため、AIタスクを直接作る場合は`aidiy_task_agents`を使う。

## MCP トランスポート（3種類）と REST API

接続方式・URL・一覧取得APIは [アクセスインターフェース](./backend_tools,構成.md#アクセスインターフェース) に集約する。CLIへの登録は [Code CLI MCP設定](./command_hermes,backend_tools,CodeCLI_MCP設定.md) を参照する。

## Python から利用する場合

SSE クライアントを使わなくても、`requests` で HTTP POST を直接呼べば MCP ツールと同じロジックを実行できる。
自動化スクリプト（`aidiy_automations/`）やバックエンドサーバーのルーターからも同様に利用できる。

```python
import requests

# SQLite テーブル一覧
res = requests.post("http://127.0.0.1:8095/aidiy_sqlite/list_tables", json={})
print(res.json())

# Python 構文チェック
res = requests.post("http://127.0.0.1:8095/aidiy_code_check/check_python_syntax",
                    json={"file_path": "backend_server/core_main.py", "venv_project": "backend_server"})
print(res.json())

# TTS でテキストを読み上げ（サーバー側ローカル再生）
res = requests.post("http://127.0.0.1:8095/aidiy_text_to_speech/synthesize",
                    json={"speech_text": "処理が完了しました", "play": True})
print(res.json())  # {"save_path": "temp/output/....mp3"}

# Chrome で URL を開く
res = requests.post("http://127.0.0.1:8095/aidiy_chrome_devtools/navigate",
                    json={"url": "http://127.0.0.1:8090"})
print(res.json())
```

ツール一覧は `GET http://127.0.0.1:8095/{mcp_name}/list` で確認できる（例: `http://127.0.0.1:8095/aidiy_sqlite/list`）。

## Claude Agent SDK から使う場合

- MCP 接続定義は `_config/AiDiy_mcp.json` に集約する
- `AIコード_claude.py` 側で `conf.models.mcp_servers` を Claude Agent SDK に渡す
- permission は実装側の方針に合わせる。ツール自動許可が必要な場合は `permission_mode` の設定箇所を確認する

## stdio クライアントから使う場合

stdio 接続を選ぶクライアントは `backend_tools/mcp_stdio.py` を使う。

```powershell
backend_tools\.venv\Scripts\python.exe backend_tools\mcp_stdio.py --sse-url http://127.0.0.1:8095/aidiy_sqlite/sse
```

Codex / Antigravity のセットアップは Streamable HTTP の `/mcp` へ直接接続する設定を生成する（Codex は `url`、Antigravity は `serverUrl`）。詳細は [`Code CLI の MCP 設定`](./command_hermes,backend_tools,CodeCLI_MCP設定.md) を参照する。

## 起動・再起動

Tools（8095）の標準起動は `127.0.0.1` のみに待ち受けます。ルート / 単独 `_start.py`、`tools_main.py` の直接起動、同梱の自動化起動を対象とします。TaskTeam（8093）の待受・認証は変更しません。

これはバックエンドの bind 制限です。独自の `uvicorn --host` 指定や `UVICORN_HOST` を使う手動起動、SSH・Codespaces のポート転送、外向きリバースプロキシによる再公開までは防ぎません。Web の `/mcp` proxy は残ります（標準 Web は `127.0.0.1:8090`）。外部から到達できる転送先・Webへ公開しないでください。管理 API の既存 Bearer 認証は維持し、全 Tools API に認証を追加する変更ではありません。

- `_start.py` 経由なら `backend_tools/temp/reboot_tools.txt` 作成で再起動する
- 手動起動は `cd backend_tools && .venv/Scripts/python.exe -m uvicorn tools_main:app --reload --host 127.0.0.1 --port 8095 --ws-max-size 20971520`
- Docker 構成には `backend_tools` が含まれない。MCP 検証はローカルで別途起動する

## 不調時の切り分け

- 8095 が反応しない場合は `curl http://127.0.0.1:8095/` で本体起動を確認する
- SSE だけ確認する場合は `curl http://127.0.0.1:8095/aidiy_sqlite/sse` を使う
- Grok の handshake は `grok mcp doctor aidiy_sqlite` で確認する（`type=sse` は `/sse` へ initialize を POST する。405 なら `tools_main.py` の POST `/sse` 受け口を疑う）
- Chrome DevTools が不安定な場合は `curl http://127.0.0.1:9222/json` でデバッグポートを確認する
- PostgreSQL MCP だけ失敗する場合は、`psycopg` 未導入、DSN 未設定、外部 DB 接続不可を切り分ける
- `Transport closed` や timeout が続く場合は同じ MCP 呼び出しを繰り返さず、代替確認と未確認範囲を明示する

### Gemini のツール実行後に thought_signature で 400 になる場合

`Function call is missing a thought_signature in functionCall parts` は MCP 個別ツールの失敗ではなく、Gemini のツール呼び出し履歴を次ターンへ戻す際の署名欠落を示す。

- 実装確認先は `backend_server/AIコア/AIチャット_gemini.py` の `_function_call_part_to_tool_call()` と `_messages_to_gemini_contents()`。
- Gemini 応答の `Part.thought_signature` は opaque な `bytes` のため、OpenAI 互換 `tool_calls` へ移すときは Base64 文字列として保持する。
- MCP 実行後に Gemini の `functionCall` Part を再構築するとき、Base64 を `bytes` に戻して同じ Part の `thought_signature` へ設定する。
- `use_tools=False` で回避するのは切り分け用途に限る。恒久対処は署名を改変せず履歴へ保持すること。
- 回帰確認は `backend_server/.venv/Scripts/python.exe -m unittest tests.test_gemini_thought_signature -v` を実行する。

## バックアップ系 MCP の注意

- `backup_run` が長時間化する場合、編集前なら通常のファイル確認で続行してよい
- 編集後はバックアップ再試行だけに固執せず、リンク確認、BOM/依存確認、検索チェック、差分確認などで補完する
- バックアップ保存/確認系 MCP は自己検証の補助。ツール不調時も、対象ファイル、実行コマンド、検索結果で変更範囲を説明できる状態にする

## 確認方法

```powershell
curl http://127.0.0.1:8095/
curl http://127.0.0.1:8095/aidiy_sqlite/sse
curl http://127.0.0.1:9222/json
```

`/sse` が `text/event-stream` を返せば対象 MCP は起動している。

## TaskTeam内部接続で401になる場合

Toolsのteam_agents・task_agentsが接続不可を返す場合、8093のポート開放だけで起動成功とは判断しません。内部認証のHTTP状態とTaskTeamのログを確認します。資格情報の値は出力しません。

TaskTeamの内部許可APIは、FastAPIのOpenAPIに登録された`POST /task/*`・`POST /team/*`・`POST /task_check_okng`から列挙します。`app.routes`の直下だけから`methods`・`path`を読むと、`include_router`が遅延登録されるFastAPIでは業務APIを拾えません。認証失敗を回避するための無条件許可は行わず、登録済みPOSTだけを許可します。回帰確認は`backend_taskteam/checks/test_taskteam_auth.py`のネストしたAPIRouterと、未登録パス・GET拒否の試験を使います。
