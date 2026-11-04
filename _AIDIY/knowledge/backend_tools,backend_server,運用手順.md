# backend_tools 運用手順

> 文書: `backend_tools,backend_server,運用手順.md` | 実装: `backend_tools/tools_main.py`, `backend_tools/mcp_stdio.py`, `backend_server/AIコア/AIコード_cli.py`, `command_hermes/cli_main.py`, `backend_tools/tools_proc/process_lifetime.py`

## このメモを使う場面

- `backend_tools` を起動する。
- MCP SSE エンドポイント、stdio bridge、環境変数を確認する。
- SQLite / PostgreSQL / Logs / Code Check / Backup 系 MCP の使い分けを確認する。

## 利用範囲とパスワード

ローカル環境での実行を基本とする。外部へ公開する場合、公開範囲・認証・接続設定などの判断と運用は利用者自身の責任で行う。

AiDiy のログインパスワードは、管理画面の「C管理 → C利用者」で対象の利用者IDまたは利用者名を選び、パスワード欄に新しい値を入力して「更新」すると変更できる。空欄なら現在のパスワードを維持する。
これは OBS WebSocket の接続パスワードとは別であり、変更しても backend_tools の公開範囲や認証は変わらない。

## 関連ファイル

- `backend_tools/tools_main.py`
- `backend_tools/mcp_stdio.py`
- `backend_tools/tools_proc/`
- `_config/AiDiy_mcp.json`
- `backend_server/conf/conf_model.py`
- `backend_server/AIコア/AIコード_claude.py`

## 起動

通常は `_start.py` から backend_tools を選択する。

```powershell
python _start.py
```

手動起動:

```powershell
Set-Location backend_tools
.venv/Scripts/python.exe -m uvicorn tools_main:app --host 127.0.0.1 --port 8095
```

uv 経由:

```powershell
Set-Location backend_tools
uv run uvicorn tools_main:app --host 127.0.0.1 --port 8095
```

stdio 接続を選ぶクライアントから使う場合:

```powershell
Set-Location backend_tools
.venv/Scripts/python.exe mcp_stdio.py --sse-url http://127.0.0.1:8095/aidiy_chrome_devtools/sse
```

## 依存関係

```powershell
Set-Location backend_tools
uv sync --upgrade
```

`backend_tools/pyproject.toml` は MCP SDK の最新メジャー系列を `mcp[cli]>=2,<3` で指定する。
MCP 2.x では `FastMCP` が `MCPServer` へ変更されているため、`mcp.server.fastmcp` を復活させる目的で 1.x へ固定しない。
依存更新後に起動時 import error が出た場合は、まず次を確認する。

```powershell
.venv/Scripts/python.exe -c "from importlib.metadata import version; print(version('mcp'))"
.venv/Scripts/python.exe -c "import tools_main; print(len(tools_main.MCP_MAP))"
```

Node.js / `package.json` / `node_modules` は不要。

別 OS で作成した `.venv` が残る環境では、`uv` が仮想環境を無効と判定する。`backend_tools/_setup.py` はその場合に `.venv` をクリアし、現在の OS 用に同じパスで再作成する。手動で再作成する場合:

```sh
cd backend_tools
uv venv --clear .venv
uv sync --locked --no-install-project
```

## MCP トランスポート（3種類）と REST API

接続方式とURLは [アクセスインターフェース](./backend_tools,構成.md#アクセスインターフェース) を参照する。引数仕様は `GET /{mcp_name}/list`、Swagger UI は `http://127.0.0.1:8095/docs`。個別の `/{mcp_name}/docs` で HTTP 利用例を返すサービスもある。

### Python から利用する例

```python
import requests

# コードチェック
res = requests.post("http://127.0.0.1:8095/aidiy_code_check/check_python_ruff",
                    json={"file_path": "backend_server/core_main.py", "venv_project": "backend_server"})
print(res.json())

# バックアップ実行
res = requests.post("http://127.0.0.1:8095/aidiy_backup/save/run", json={})
print(res.json())
```

## SSE エンドポイント

全サーバーのURLは [提供 MCP](./backend_tools,構成.md#提供-mcp) に集約する。

通常の Tools 起動は `127.0.0.1` のみに待ち受けます。これは bind 制限であり、独自の host 指定やポート転送・リバースプロキシによる再公開までは防ぎません。管理 API の既存認証は維持します。

## 内部RESTの予測処理

`aidiy_prediction_llms` はMCP非公開で、`POST /internal/prediction_llms` のみを提供する。`/aidiy_prediction_llms/*` の公開経路やMCP/CLI登録はない。Live試行と同じく接続元IPとHostがloopbackで、`X-AiDiy-Diag: model-trial` と `Content-Type: application/json` が必要。Origin・プロキシ転送ヘッダー・クエリは拒否する。JSON本文は64KiB以下・受信3秒以内で、`project_path` が必須。詳細と利用例は [backend_tools 構成](./backend_tools,構成.md#次のユーザー入力予測) を参照する。

## 次入力予測の接続スコープ

Codeの予測は、接続中Coreセッションのモデル情報で確定した `CODE_BASE_PATH` を履歴取得とCLIの作業フォルダに使用する。起動フォルダ・画面表示・共通設定にはフォールバックしない。セッションのパスが未取得、切断、プロジェクトが存在しない場合は予測しない。要求中のセッション・プロジェクト切替は取り消し、古い結果を下書きに適用しない。

履歴は同じプロジェクトの直近2時間・最大10ターンのユーザー入力を先に24,000文字の予算へ割り当て、残りの予算で、選択された依頼に対応する最新の有効なAI最終応答1件だけを追加する（各本文は最大4,000文字）。古いAI応答でユーザー入力を押し出さない。返答がない場合や残り予算がない場合はユーザー入力だけを使う。セッション・チャンネル内の依頼との対応と受信順を保持し、他の依頼に完了報告を結び付けない。遅延したコード応答ミラーやツール・進捗は最終応答として扱わず、同じ依頼に後から利用不能な最終応答が届いた場合は以前の完了報告を残さない。通常の履歴読取は従来のままで、予測だけが `read_prediction_history(user_only=True, include_latest_reply=True)` を指定する。

Chat・CLI共通の予測指示は、最新の完了・未完了情報を参考に、検証済みの作業を繰り返さず次の有意味な一歩を考える。会話にない作業・承認を作ったり実行したりせず、編集可能な入力候補だけを返す。次を合理的に予測できない場合の `!` 応答は維持する。

### CLI予測の読取専用境界

予測専用の `AI実行オプション.読取専用予測()` を使用する。通常のCode実行や `code_permissions=none` の意味は変更しない。指示文だけでは読取専用を保証しない。

- Codex: 読取専用sandboxと承認禁止、`--ephemeral`、`--ignore-rules` を指定し、予測には不要な追加機能を無効にする。Windowsは `features.prefer_mxc=true` も指定し、対応環境ではMXCを優先する。非対応環境のsandbox選択はCodexに従い、読取専用制約を解除しない。有効MCP一覧を取得し、各サーバーを明示的に無効化した一覧を再検証してから推論する。`mcp_servers={}` は継承設定を消さないため使用しない。検証と推論は同じ設定階層を使用する。Windowsの専用フォルダではread-onlyで既存ファイルの読取成功・既存ファイル変更と新規ファイル作成の拒否を確認した。MXC非対応環境の動作は別途確認する。
- Copilot: `--available-tools=view,grep,glob` の許可一覧でモデルのツールを参照だけに絞り、write/shellを拒否する。通常の全ツール許可や既存セッション継続は使用しない。
- Hermes: bundled環境の専用 `prediction_main.py` から、API方式のモデルだけを使用する。safe modeをimport前に設定し、`read_file` / `search_files` だけのtoolsetと実行時許可一覧の二重検査を行う。通常CLI・カスタム実行ファイルにはフォールバックしない。外部CLI委譲モデル、ACP、Codex App Server等の別ランタイムはこの制限を通らないため、予測では未対応として停止する。予測adapterはHermesの会話DB・JSON snapshot・trajectory保存とAPI失敗時の全文dumpも抑止する。読取りはローカルのテキストを対象にし、PDF・Office変換、外部OCR、依存パッケージの自動追加は行わない。検索のoption注入を避けるため、先頭が `-` の検索pattern/pathは拒否する（文字としては `[-]`、ファイル名は `./-name` を使用する）。
- 対応していないオプション・検証不能な設定ではNGで終了する。制約を外した再試行や別プロジェクトへの切替は行わない。実インストール版の互換性は利用環境での確認が必要。
- 非保存指定はAiDiyの会話DB・画面送信・生成ファイルを対象にする。Codexのephemeralはrollout保存も抑止するが、CLI自身の認証更新・キャッシュ・運用ログや管理者が強制する起動処理まで禁止するOS全体の隔離ではない。Copilot等の独自セッション保存とAiDiyの会話履歴保存は別扱い。

公式仕様の確認先: [Codex CLI](https://developers.openai.com/codex/cli/reference)、[Codex設定](https://developers.openai.com/codex/config-reference)、[Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)、[Hermes CLI](https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-chat)、[Hermes toolsets](https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference)。CLI更新で必要な制約が使えなくなった場合は、弱い設定に戻さず対応を確認する。

## 環境変数

| 変数名 | 既定 | 用途 |
|--------|------|------|
| `CHROME_DEBUG_PORT` | `9222` | Chrome デバッグポート |
| `PORT_TOOLS` / `MCP_PORT` | `8095` | `tools_main.py` を直接起動するときのポート。`PORT_TOOLS` を優先。通常の `_start.py` 起動ではランチャーの `PORT_TOOLS`（8095）を `uvicorn --port` に渡す |
| `CHROME_EXECUTABLE` | 未設定 | Chrome 実行ファイルの明示指定 |
| `AIDIY_PG_DSN` | 未設定 | PostgreSQL DSN |
| `AIDIY_PG_HOST` など | 未設定 | PostgreSQL 個別接続情報 |

mount path 系の環境変数を使う場合は `tools_main.py` の現行実装を確認する。

## OBS Studio 接続設定

`aidiy_obs_studio_control` の接続情報は `_config/mcp_obs_studio_control.json` で管理する。
ファイルが無ければ初回起動時にデフォルトの接続設定（`host=localhost`, `port=4455`, `password=********`, `timeout=10`）が自動書き込まれる。
ここで `********` はパスワードを伏せた表示であり、設定ファイルに書き込まれる値ではない。実際の値はローカルの設定ファイルで確認し、公開資料には記載しない。
OBS Studio 側の `ツール → WebSocketサーバー設定` と一致させる。

## ffmpeg / ffprobe / ffplay 実行設定

`aidiy_ffmpeg_control` の実行ファイルパスと既定タイムアウトは `_config/mcp_ffmpeg_control.json` で管理する。
ファイルが無ければ初回起動時にデフォルト値（PATH 上の `ffmpeg` / `ffprobe` / `ffplay`、タイムアウト 600 秒）が自動書き込まれる。
PATH 上にない環境ではフルパスへ書き換える。MCP ツールは args_str 一本で各サブコマンドの引数を直接渡す薄いランナーで、ffplay 利用時は `-autoexit` と `-t <秒>` を付けて自然終了させること。

## Reboot

`backend_tools/temp/reboot_tools.txt` を作成すると `tools_main.py` が自身を終了し、`_start.py` 起動中なら自動再起動される。
ただし MCP クライアント（Code CLI 等）側の接続が不調な場合、この再起動では直らない（後述の HTTP フォールバックで切り分ける）。

## CLI / stdio MCP の子プロセス終了

- `backend_server/AIコア/AIコード_cli.py` は `backend_tools/tools_proc/process_lifetime.py` を介して CLI を起動する。MCP の `aidiy_code_agents` と Task / Team も、この共通 CLI 実行処理を使う場合は同じ寿命管理になる。
- 親終了を監視するスレッドは `daemon=True`。通常終了、停止、タイムアウト、キャンセル、起動元の異常終了時に、その実行で起動した子・孫を破棄する。起動元の終了検知は約0.5秒間隔で行う。
- Windows は起動前に監視プロセス自身を Job Object に入れ、子孫にも継承する。最後の Job ハンドルが閉じると子孫が終了するため、監視プロセスの強制終了にも対応する。Job の関連付けが失敗した場合は、保護なしで処理を続けず起動を失敗させる。
- Windows の仮想環境で中継用の `python.exe` が挟まる場合は、同じコマンドラインの中継プロセスを越えて実際の起動元を監視する。終了確認には仮想環境の Python を使い、中継プロセスが残って監視を妨げないことも確認する。
- Linux は子孫の PID と起動時刻、および実行単位の環境変数 `AIDIY_PROCESS_OWNER_TOKEN` で追跡する。CLI が先に終了した子や別セッションへ移った孫も識別子で回収し、subreaper で終了済みの子孫を回収する。環境変数を消して別ユーザーで動く処理などは追跡の対象外になることがある。
- `mcp_stdio.py` と単独起動の `aidiy_hermes` も親終了を監視する。stdio が開いたままでも、起動元が終了したらブリッジを終了する。
- 監視ラッパーは CLI 実行中に1プロセス追加される。登録した stdio MCP ごとのプロセスや並行セッションによる増加は通常動作であり、終了後に残るかで判断する。共有の `tools_main.py` は個々のクライアント終了では停止しない。

依存更新と反映（プロジェクトルートから実行）:

```sh
uv sync --project backend_server --locked
uv sync --project backend_tools --locked --no-install-project
```

更新後はバックエンドと、MCP を起動する Code CLI / VS Code / Discord を再起動する。既に残っている旧プロセスには新しい監視処理は付かない。

子孫の終了と別セッションの独立性を確認する専用の自動テストは現在ない。Code CLI / VS Code / Discord を終了した後に、監視ラッパーと stdio MCP のプロセスが残らないこと、並行する別セッションが止まらないことをプロセス一覧で確認する。

## MCP ツールが応答しない場合の切り分け（HTTP フォールバック）

MCP 経由のツール呼び出しが `Invalid request parameters` 等で全般的に失敗する場合がある。原因は主に3層に分かれる。

1. `backend_tools`（ポート8095）本体 — `curl http://127.0.0.1:8095/` で疎通確認。
2. Chrome / 対象アプリ自体 — Chrome DevTools の場合 `curl http://127.0.0.1:9222/json/version` で疎通確認。
3. MCP クライアント側（Code CLI・Claude Code 等）の stdio/SSE ブリッジ — 上記1・2が正常なのに MCP 経由の呼び出しだけ失敗するなら、この層が不調。

1・2 が正常なら、上記の「HTTP POST（FastAPI）」で直接呼び出すことで作業を継続できる。

```bash
# 例: Chrome DevTools の navigate / screenshot を HTTP で直接叩く
curl -s -X POST http://127.0.0.1:8095/aidiy_chrome_devtools/navigate \
     -H "Content-Type: application/json; charset=utf-8" \
     -d '{"url": "http://127.0.0.1:8090/..."}'

curl -s -X POST http://127.0.0.1:8095/aidiy_chrome_devtools/screenshot \
     -H "Content-Type: application/json" \
     -d '{"save_path": "C:/path/to/out.png"}'
```

注意点:

- 日本語などの非ASCIIを含む URL/パスは `curl -d` の直書きだと文字化け・パース失敗（`There was an error parsing the body`）することがある。UTF-8 で JSON ファイルへ書き出し、`--data-binary @file.json` で送る方が安全。
- MCP 層が不調な間は `backend_tools/temp/reboot_tools.txt` によるサーバー再起動を試しても直らない（サーバー自体は正常なため）。MCP クライアント側の再接続（例: Code CLI の `/mcp` コマンド）や、クライアントの再起動が必要になる。
- 各 MCP の引数仕様は `GET http://127.0.0.1:8095/{mcp_name}/list` で確認できる。

## ログ

- `backend_tools/temp/logs/yyyymmdd.hh0000.mcp_main.log`
- console 出力は UTF-8 固定。
- ログ確認自体は `aidiy_logs` MCP でも行える。

### Chrome DevTools / MCP 接続のログ判定

- `クライアントが要求送信中に切断しました（正常終了扱い）` は、Code CLI やブラウザなどの MCP クライアントが要求送信中に終了・キャンセルした記録であり、サーバー障害ではない。INFO の1行だけを記録する。
- `JS 実行エラー` は `eval_js` に渡した JavaScript 内の例外、`CDP コマンド ... がタイムアウトしました` は Chrome 操作の応答待ち超過であり、いずれも既知のツール失敗として INFO で記録し、呼び出し側へ具体的理由を返す。
- スクリーンショット取得だけは、Chrome の一時的な描画遅延に対して接続を張り直し1回再試行する。再試行後も失敗した場合は上記のタイムアウトとして返す。
- `Tool '...' raised an unexpected exception` や `Exception in ASGI application` の traceback が残る場合は、上記以外の実装不具合として調査する。

## 注意点

- Chrome は最初のツール呼び出し時に `_ensure_chrome()` が起動確認する。
- Chrome プロセスは `ChromeManager` が単一インスタンスで管理する。
- SQLite は `_data/AiDiy/database.db` を対象にする。
- PostgreSQL は `psycopg[binary]` 未導入でもサーバー起動は継続し、PostgreSQL ツール呼び出し時にエラーを返す。
- Code Check は副作用なしの検査系のみを実行する。build や dev server 起動はしない。
- `permission_mode="bypassPermissions"` は backend_server 側の AIコードエージェント設定であり、MCP サーバー自身は localhost 制限で守る。
- Grok の `type=sse` 接続は `grok mcp doctor <name>` で handshake を確認する。405 なら `tools_main.py` の POST `/sse`（Streamable HTTP）受け口を疑う。

## 使い分け

MCP の選択基準は `backend_server,backend_tools,MCP活用手順.md` を使う。
サーバー構成や新規 MCP 追加は `backend_tools,構成.md` を使う。

## auto 時の既定設定（AiDiy_tools.json）

`backend_tools` の起動時（FastAPI lifespan）に、プロジェクトルートの
`_config/AiDiy_tools.json` が無ければ次を初期生成する。起動ディレクトリには依存しない。
APIキーは書かず、従来の `AiDiy_key.json` を利用する。

```json
{
  "text_to_speech": {"auto_provider": "edge", "auto_voice": "female"},
  "speech_to_text": {"auto_provider": "google"},
  "image_generation": {"auto_provider": "codex"},
  "movie_generation": {
    "auto_provider": "freeai",
    "auto_model": "veo-3.1-generate-preview",
    "auto_aspect_ratio": "16:9",
    "auto_resolution": "auto"
  }
}
```

編集後は **backend_tools を再起動**する。既存ファイルへの追記・上書きはしない。
不足項目は初期値、空文字/null/未知値/型違いは警告して当該項目の初期値を使用する。
不正JSONや読込・生成失敗でも起動を続け、初期値を使用する。ログには設定値や秘密を出さない。
同時起動は完成した一時JSONを排他的に公開するため、既存設定を上書きしない。
ハードリンク非対応のファイルシステム等で生成できない場合は、上記JSONを手動作成する。

| 項目 | 設定可能値・挙動 |
|------|----------------|
| TTS auto_provider | edge / openai / gemini / freeai。選んだproviderの既存フォールバック順を使用。初期値はedge→freeai |
| TTS auto_voice | female / male。実際のproviderと言語に応じた音声名へ解決。明示voiceは優先 |
| STT auto_provider | google / openai。初期値googleはGoogle Web Speech。openaiはWhisper（既存の無音事前チェックあり） |
| 画像 auto_provider | codex / antigravity / openai / freeai / gemini / grok。既存のprovider別フォールバック順を使用 |
| 動画 auto_provider | freeai / gemini |
| 動画 auto_model | veo-3.1-generate-preview / veo-2.0-generate-001 / veo-2.0-generate-exp |
| 動画 auto_aspect_ratio | 16:9 / 9:16 |
| 動画 auto_resolution | auto（モデル任せ、従来動作） / 720p / 1080p。モデル側の制約は従来どおり適用 |

**各引数が `auto` の場合だけ**設定を適用し、明示引数は従来どおり優先する。
TTSのREST APIは互換のためprovider省略時はedgeのままなので、設定を使う場合は
`{"speech_text":"こんにちは", "provider":"auto", "voice":"auto"}` のように指定する（RESTのvoice省略時も従来のfemaleを維持）。MCPは省略時auto。
STTはproviderにgoogleを明示すれば、設定がopenaiでもGoogle側を選択できる。

画像のmodelは従来どおりproviderがauto/CLIならCLI側・各provider側の既定へ委譲する
（この場合はmodel明示も従来から無視）。provider別にモデル体系が異なるため共通auto_modelは設けない。
chatのautoは既存 `AiDiy_key.json`、CodeAIのautoはHermes/履歴へ委譲し、設定を重複させない。
APIを使うproviderへの変更やフォールバックには利用料金が発生しうる。

ネットワーク・有料APIを使わない回帰試験:

```sh
backend_tools/.venv/bin/python -m unittest discover -s backend_tools/checks -v
```

Windowsでは実行ファイルを `backend_tools/.venv/Scripts/python.exe` に置き換える。

### Diag Tools 管理（認証付き・管理APIは2つ）

DiagのToolsパネルはConfigと同じCore利用者ログインを使う。Diag起動認証に加え、
管理要求ごとにCoreの現在利用者APIでJWTを再検証する。Coreに接続できない場合も拒否する。
APIキー・JWT秘密・OBS接続秘密は管理応答に含めない。

| Diag（同一origin） | Tools側 | 用途 |
|---|---|---|
| `POST /api/Tools/enabled` | `POST /management/enabled` | enabled状態取得・切替 |
| `POST /api/Tools/defaults` | `POST /management/defaults` | 既定値・選択肢取得・変更 |

Diagには `{ "token": "Core JWT", "data": {...} }` を送る。
Tools側は `Authorization: Bearer <Core JWT>` とdata本体を受ける。
各APIで `{}` は読取のみ。`write`省略/falseで値を指定すると**現在のToolsプロセスへ即時適用**し、
ファイルは変更しない。`write:true`で値を指定した場合だけ保存し、成功後に実行時設定へ反映する。
失敗時は実行時設定も変えない。保存対象を指定しない`write:true`は書き込まない。

```json
{"enabled":{"aidiy_text_to_speech":false},"write":true}
```

```json
{"defaults":{"text_to_speech":{"auto_provider":"edge","auto_voice":"male"}},"write":true}
```

既存 `_config/AiDiy_tools.json` の4媒体既定値に加え、`enabled` objectへツールID別booleanを保存する。
未指定enabledはtrue。falseは明示的に優先する。既存の未知項目は保存時にも維持する。
保存は同じディレクトリの一時ファイルから置換し、`.json.lock`ディレクトリでプロセス間を排他する。
競合は409で再試行を促す。異常終了でlockが残った場合は、保存処理が動いていないことを確認してから
`_config/AiDiy_tools.json.lock`空ディレクトリを削除する（自動的に他プロセスのlockを奪わない）。
複数Toolsプロセスを個別に動かす場合、実行時設定は要求を受けたプロセスだけへ適用される。
保存後に他プロセスへ反映するには再起動する。

`enabled`（利用者の選択）と`available`（依存の利用可否）は別に返す。
Chrome実行体、ffmpeg起動結果、PostgreSQL初期化、デスクトップ表示環境を確認する。
OBSを含むその他は登録済みクライアント・組込み機能として表示するため、API認証・接続・個別CLI等の全機能が正常とは限らない。OBSの起動時未接続は未導入と区別し、後起動・明示host/port指定を妨げない。実際のOBS疎通・認証は既存の機能呼出し時に判定する。
未導入/利用不可の行は有効化・テスト不可。OBS接続設定自体の変更や他プログラム導入後はToolsを再起動して設定・起動チェックを更新する。

offでもMCP定義・list/ping・transport sessionは削除しない。呼出しは実処理に進まず、
HTTP 200/MCP非エラーのJSONとして `status:"NG", available:false, service_status:"out_of_service"`
と案内messageを返す。既に開始された処理は切替では取り消さない。
Chat Completions互換HTTPもchat_llmsのenabledに従う。

代表テストは別の管理設定を作らず、既存Chrome DevTools `open_session` / `close_session`を
Diagの固定allowlist bridge `POST /api/Tools/representative`から呼ぶ。
`data:{operation:"open",headless:false}` または `{operation:"close"}` のみ許可する。
セッション名は `diag-tools-test` 固定、任意URL/パス/コマンドは受けない。利用者ログインを毎回確認し、
enabled/availableを確認してから実行する。起動時・一覧表示時に自動テストはしない。
初版の代表テストはChromeのみ。他のツールは未対応理由を表示する。

隔離試験（ブラウザ/有料API実行なし）:

```sh
backend_tools/.venv/bin/python -m unittest discover -s backend_tools/checks -v
node --test backend_diag/checks/tools-settings-api.check.mjs
```
