# command_hermes 運用手順

> 文書: `command_hermes,backend_server,運用手順.md` | 実装: `command_hermes/cli_main.py`, `backend_server/AIコア/AIコード_cli.py`

## このメモを使う場面

- `aidiy_hermes` を単体 CLI として起動する。
- AiDiy の Code AI から `aidiy_hermes` を呼ぶ経路を確認する。
- provider / model / slash command / TUI の変更後に確認する。

## 関連ファイル

- `command_hermes/cli_main.py`
- `command_hermes/base/run_agent.py`
- `command_hermes/base/toolsets.py`
- `command_hermes/tools/registry.py`
- `command_hermes/hermes_cli/commands.py`
- `backend_server/AIコア/AIコード_cli.py`
- `backend_server/conf/conf_json.py`
- `backend_server/conf/conf_model.py`

## 位置づけ

- `command_hermes` は常駐 HTTP サーバーではない。
- 実行名は `aidiy_hermes`。
- `_start.py` の常駐起動対象ではない。
- `_setup.py` と `_cleanup.py` の対象。
- AIコードパネルでは `CODE_AI*_NAME = "aidiy_hermes"` として使う。

## セットアップ

通常はプロジェクトルートで `_setup.py` を使う。

```powershell
python _setup.py
```

`_setup.py` の Hermes セットアップは、`command_hermes/pyproject.toml` を `uv sync --upgrade` で同期したうえで `~/.local/bin/aidiy_hermes.cmd` を生成する。
`uv tool install` は使わない（セキュリティ警告の原因になるため）。

アプリ用 Python の条件は `command_hermes/pyproject.toml` の `requires-python`（現在 `>=3.13`）で管理する。セットアップはこの条件を表示して `uv` に Python 選択を委ね、`command_hermes/_start.py` は既存の仮想環境を使う場合に実際の Python の版を確認する。旧版や版数・条件の判定不能は警告して続行し、新たな版数停止条件にしない。実行ファイルの起動失敗・非0終了・確認タイムアウトや、実際の依存解決 / import / CLI 実行エラーは引き続き失敗として扱う。

AiDiy Hermes の Python CLI は `npm install` を前提にしない。同梱 `package.json` の Node.js 条件は upstream の Node/workspace ツール向けで、Python CLI や cleanup の必須条件へ転用しない。Node/TypeScript TUI は同梱しない。

生成される `.cmd` の内容（UTF-8・CRLF）:

```bat
@echo off
chcp 65001 >nul
setlocal
set "PY=<repo>\command_hermes\.venv\Scripts\python.exe"
set "CLI=<repo>\command_hermes\cli_main.py"
"%PY%" "%CLI%" %*
```

`C:\Users\admin\.local\bin` が `PATH` に入っていれば `aidiy_hermes` としてそのまま呼べる。

手動で確認する場合:

```powershell
Set-Location command_hermes
uv sync --upgrade
# .cmd の手動生成は _setup.py に任せる
python ..\_setup.py
aidiy_hermes --version
```

provider SDK を追加したときは `command_hermes/pyproject.toml` の dependencies を確認してから `_setup.py` を再実行する。

## クリーンアップ

```powershell
python _cleanup.py
```

`_cleanup.py` は `~/.local/bin/aidiy_hermes.cmd` を削除する。

POSIX の `~/.local/bin/aidiy_hermes` と共通 PATH 登録も解除する。アプリ用 Python / uv / Node.js の版確認や依存導入は行わず、選択した環境・temp・キャッシュ等の削除失敗は失敗として返す。実際の削除範囲と停止方針は[共通の運用手順](./共通,開発環境運用手順.md#クリーンアップ)を確認する。

主な provider 依存:

| 用途 | dependency |
|------|--------------|
| OpenAI / OpenAI互換 | `openai` |
| Claude | `anthropic` |
| Google Gemini / Google系 | `google-genai` |

## 実行例

```powershell
# 対話モード
aidiy_hermes

# 1ショット
aidiy_hermes -Q -z "このフォルダの構成を要約して"

# provider / model 指定
aidiy_hermes --provider openai -m gpt-5.2 -Q -z "TODO を整理して"
aidiy_hermes --provider ollama -m deepseek-v4-flash:cloud -Q -z "ファイル一覧を確認して"
```

手動実行の 1 ショットは `-Q -z "本文"` を使う。`-Q`（quiet）は真偽フラグ、`-z`（oneshot）は `nargs="?"` で本文を値に取るため、本文は `-z` の直後へ置く。

AiDiy の Code AI 連携では、Windows のコマンドライン長制限を避けるため `-Q --oneshot-stdin` を使い、完全プロンプトを UTF-8 標準入力で渡す。短い本文も同じ経路に統一する。

ワンショット / quiet 実行の出力契約:

- stdout: 正式回答だけ。
- stderr: thinking、step、tool 進捗、警告、`session_id` などの処理ログ。
- ワンショットの stderr では spinner のフレームを連続出力しない。待機中は `[wait] AI応答待機` や `[wait] <tool/command>待機` のような静的1行にする。
- AiDiy 側で正式回答を取り込む場合は stdout を採用し、stderr はログ表示やデバッグ用に扱う。

## 主な CLI オプション

| オプション | 内容 |
|------------|------|
| `-z`, `--oneshot` | 1ショット実行 |
| `--oneshot-stdin` | UTF-8 標準入力を本文にする quiet 1ショット実行 |
| `-Q`, `--quiet` | 余計な表示を抑制 |
| `-m`, `--model` | モデル指定 |
| `--provider` | provider 指定 |
| `--list-tools` | 利用可能ツール一覧 |
| `--version` | バージョン表示 |
| `--no-tools` | ツール無効化 |

## YOLO とファイル削除

- `aidiy_hermes --yolo`、または対話中の `/yolo` で YOLO を有効にすると、通常のファイル削除を含むコマンドの承認確認を省略する。削除専用の追加許可設定は不要。
- 引数を省略した起動は通常モードのまま。`/yolo` を OFF にすると通常の確認へ戻る。起動時の `--yolo` はプロセス全体に固定されるため、解除はフラグなしで再起動する。
- `!` シェル実行も現在のセッションの YOLO を使う。Codex app-server を選んだ場合も、再利用中のセッションで各承認要求に最新の状態を反映する。
- YOLO は OS 権限や Codex の sandbox を変更しない。システム全体の破壊操作、明示した deny、認証情報・設定・エージェント指示ファイルの保護は別途維持される。拒否時は対象パス、エラー文、provider/runtime を確認し、別経路で保護を迂回しない。

一時ファイルだけで ON / OFF / 既定値、通常確認、セッション分離を検証する（外部 LLM / Codex 起動なし）:

```powershell
command_hermes\.venv\Scripts\python.exe -m unittest discover -s command_hermes/checks -p test_yolo_deletion.py -v
```

Linux / macOS は `command_hermes/.venv/bin/python` を使う。

## 対応 provider

- API provider: `ollama`, `openai`, `openrt`, `gemini`, `freeai`, `anthropic`, `openai_oauth`, `xai-oauth`
- CLI bridge: `claude-code`, `codex-cli`, `antigravity-cli`, `copilot-cli`, `opencode`, `grok-cli`（Hermes の provider slug。本体の Code AI 識別子とは区別する）

選択優先順位・候補生成の正本は [Provider 一覧と選択ロジック](./command_hermes,Provider一覧と選択ロジック.md)。

AiDiy の既定設定は `openai_oauth / gpt-6.1-sol`。OAuth 認証済みなら OpenAI を使い、別 PC の初回起動や認証切れでは `freeai / gemini-3.8-flash` へ自動退避する。OpenAI OAuth のトークンは Codex CLI と共通の `${CODEX_HOME:-~/.codex}/auth.json` に保存する。Hermes のログインと更新も同じファイルへ書き込む。`--provider openai_oauth` を明示した場合は自動退避せず OAuth 認証を開始できる。

旧 Hermes 認証ストアにだけ OpenAI OAuth トークンがある場合、初回利用時に Codex の認証ファイルへ移し、Hermes 側のコピーを削除する。`hermes auth remove openai-codex` または `hermes logout openai-codex` は共有トークンを消すため、Codex CLI もサインアウト状態になる。Codex CLI が OS キーリングだけを使い、`auth.json` を保存していない環境では、ファイル保存に切り替えるか Hermes からログインする。

OAuth を手動でやり直す場合は、認証ファイルを削除せず次を実行する。成功した新しいトークンで旧状態が更新される。

```powershell
Set-Location command_hermes
.venv\Scripts\python.exe hermes_main.py auth add openai-codex
```

Linux / macOS は `.venv/bin/python hermes_main.py auth add openai-codex` を使う。

xAI OAuth を使う場合は、次で認証してから `xai-oauth / grok-4.6` を選ぶ。

```powershell
Set-Location command_hermes
.venv\Scripts\python.exe hermes_main.py auth add xai-oauth
```

Linux / macOS は `.venv/bin/python hermes_main.py auth add xai-oauth` を使う。

## AiDiy 連携

設定例:

```json
{
  "CODE_AI1_NAME": "aidiy_hermes",
  "CODE_AIDIY_HERMES_MODEL": "xai-oauth/grok-4.6"
}
```

連携箇所:

- `AIコード_cli.py`: 実行ファイル探索、`--version`、`aidiy_hermes -Q --oneshot-stdin` のコマンド構築。
- `AIコード_cli.py`: モデル指定時は `aidiy_hermes -Q --model <model> --oneshot-stdin` を構築し、本文は UTF-8 標準入力で送信。
- `conf_json.py`: `CODE_AIDIY_HERMES_MODEL`。
- `conf_model.py`: `get_code_models()["aidiy_hermes"]`。
- frontend の AI 設定画面: code AI 選択肢。

`aidiy_hermes` は専用の `AiDiy_code_*.json` を持たない。設定画面の候補は `conf_model.py` の `_get_aidiy_hermes_models()` が、`scripts/cli_bat/_hermes_cli.bat` にある OpenAI OAuth モデルと `auto` に合わせて返す。候補値には `openai_oauth/` を付け、Hermes 側が OAuth provider とモデルを解決できるようにする。

## 変更時の確認

```powershell
Set-Location command_hermes
.venv\Scripts\python.exe -m py_compile cli_main.py
.venv\Scripts\python.exe cli_main.py --version
.venv\Scripts\python.exe cli_main.py --help
.venv\Scripts\python.exe cli_main.py --list-tools
python ..\_setup.py          # .cmd を再生成
aidiy_hermes -Q -z "おはよう"
aidiy_hermes --provider ollama --model "deepseek-v4-flash:cloud" -Q -z "おはよう"
.venv\Scripts\python.exe -c "import openai; import anthropic; import google.genai; print('provider sdks ok')"
```

TUI / slash command の詳細調整は `command_hermes,TUI調整手順.md` を使う。
Code CLI としての追加・表示・ANSI 対策は `backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md`、`backend_server,CodeCLIプロンプト整形.md`、`backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md` を使う。

## 任意Gateway・proxyの通信サイズ

Hermes本体は引き続きon-demand CLIです。利用者が任意で起動するGateway / webhook / Photon・WhatsApp bridge / proxy、およびそれらのHTTP応答・WebSocket中継では、20 MiB未満だった転送上限の既定を **20 × 1024 × 1024 = 20,971,520 bytes** に揃えます。HTTP本文、応答本文、WebSocketメッセージごとの上限であり、トークン数や一度に送れる業務メッセージ長の保証ではありません。control socketはJSON行の受信bufferと応答上限も同期します。

利用者が`max_body_bytes`等で明示した値は、20 MiB未満も含めて保持します。既存の大きい上限（例：Desktop/TUIのWebSocket 384 MiB、CDP 50 MiB）や無制限の経路は引き下げません。HTTP header、URL、prompt、エラー表示用抜粋、ストレージのイベント蓄積予算、メディア形式ごとの制約、読み取りchunk幅は別の目的なので変更しません。認証・署名・許可送信者・接続先検証はそのまま維持します。上限が大きくなる分、同時処理時のメモリ使用量には注意してください。

ソケット・外部APIを使わない回帰確認（リポジトリ直下）:

```powershell
node --test command_hermes/checks/node-body-limits.test.mjs
backend_tools/.venv/Scripts/python.exe -B -m unittest discover -s command_hermes/checks -p test_transport_body_limits.py
```

Python試験はASTで設定・全入口を照合し、純readerと模擬request/responseで20 MiB直前・ちょうど・1 byte超を検査します。aiohttpがないPythonではその実reader試験だけskipするため、導入済みの`backend_tools/.venv`を使います。WhatsApp Node bridgeは`express.json`へ渡す設定値の確認であり、Express実parserや実サービス接続の試験ではありません。
