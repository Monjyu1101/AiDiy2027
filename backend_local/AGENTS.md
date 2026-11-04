# backend_local 実装概要

## 本書の目的

このファイルは `backend_local` の構成、提供 API、実装入口を示す概要ドキュメントです。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。
コアシステム機能調整は `../_AIDIY/knowledge/_index.md` を入口にします。

## 概要

`backend_local` はポート `8096` 上で HuggingFace の **Gemma** モデルを推論し、
**OpenAI / ChatGPT 互換** の Chat Completions API として提供するローカル LLM サーバーです。
外部 API に依存せず、ローカルマシン上で Gemma を動かしたい場合に使用します。

- **Backend**: FastAPI + uvicorn（Python 3.13+、uv 管理。起動は `uvicorn local_main:app` を直接実行）
- **推論**: `transformers` + `torch`。text 専用 Gemma（gemma-2-\*, gemma-3-1b）と
  マルチモーダル Gemma（gemma-3-4b 系、gemma-4 系、テキスト入力のみ利用）の両方に対応。
- **モデルロード**: 遅延ロード方式（初回リクエスト時にロード）。起動時の先読みロードは行わない。

## 提供 API（OpenAI 互換）

OpenAI SDK / 各種クライアントの `base_url` に `http://127.0.0.1:8096/v1` を指定して利用できます。

| エンドポイント | 役割 |
|----------------|------|
| `POST /v1/chat/completions` | チャット補完（OpenAI 標準。`stream` / `tools` 対応） |
| `GET /v1/models` | 利用可能モデル一覧 |
| `GET /` | 稼働状況（モデル / デバイス / ロード状態） |
| `GET /health` | ヘルスチェック |

### function calling（tools）

`tools` / `tool_choice` を受け付け、Gemma のネイティブ function calling を使う。
モデルが出力する `<|tool_call>call:NAME{...}<tool_call|>` 形式（`gemma_tools.py`）を
OpenAI 互換の `tool_calls`（`finish_reason="tool_calls"`）へ変換して返す。
これにより `AIチャット_local`（`local_chat`）から MCP 群を使う自己ループが機能する。
※ tool 選択の精度・速度はモデル規模（E2B など）と CPU 性能に依存する。

## ファイル構成

| パス | 役割 |
|------|------|
| `local_main.py` | FastAPI エントリポイント。エンジン生成 + ルーター登録 + 起動 |
| `local_proc/gemma_engine.py` | Gemma モデルのロードと生成（OpenAI messages → 応答テキスト） |
| `local_proc/openai_api.py` | OpenAI 互換 `/v1/chat/completions` `/v1/models` ルーター |
| `log_config.py` | 共通ログ設定（全サーバー共通） |
| `download_model.py` | モデルを `temp/models/<safe_name>` へ事前ダウンロードする CLI |
| `local_proc/model_paths.py` | ローカルモデル配置パス解決（`temp/models`、safe_name） |
| `pyproject.toml` | uv 依存定義（fastapi / transformers / torch ほか） |

## モデルのローカル配置（temp/models）

モデルは HuggingFace 既定キャッシュではなく、`backend_local/temp/models/<safe_name>` に
**モデルごとのフォルダ**で配置する。`safe_name` は repo_id の `/` を `__` に置換した名前。

| repo_id | 配置フォルダ |
|---------|-------------|
| `google/gemma-4-E4B-it` | `temp/models/google__gemma-4-E4B-it/` |

起動時、エンジンは以下の優先順で **ロード元を自動解決** する。

1. `CHAT_LOCAL_MODEL` が既存ディレクトリ（`config.json` あり）→ そのパスをオフラインロード
2. `temp/models/<safe_name>/config.json` が存在 → そのフォルダをオフラインロード
3. いずれも無ければ repo_id でハブからダウンロード（`temp/models` をキャッシュ先に使用）

## HowTo参照先

モデルの取得、起動、確認、cleanupは [モデル準備と起動](../_AIDIY/knowledge/backend_local,モデル準備と起動.md) を参照してください。

## 設定（AiDiy_key.json）

設定はプロジェクトルートの `_config/AiDiy_key.json` から読み込む。**環境変数は使わない**。
値の優先順位は **AiDiy_key.json > 組み込みデフォルト**。
`< ... >` 形式のプレースホルダ値は「未設定」として扱い、デフォルトにフォールバックする。

| 設定 | AiDiy_key.json キー | 既定 |
|------|---------------------|------|
| 待受ポート | `PORT_LOCAL` | `8096` |
| モデル ID / ローカルパス | `CHAT_LOCAL_MODEL` | `google/gemma-4-E2B-it` |
| HF トークン（読み取り） | `huggingface_key_read` | （なし） |
| デバイス | `CHAT_LOCAL_DEVICE` | `auto` |
| dtype | `CHAT_LOCAL_DTYPE` | `auto` |
| 最大生成トークン | `CHAT_LOCAL_MAX_TOKENS` | `128000` |
| モデル配置先 | `CHAT_LOCAL_MODELS_DIR` | `temp/models` |
| オフライン強制 | `CHAT_LOCAL_OFFLINE` | `0` |

`PORT_LOCAL` と `CHAT_LOCAL_MODEL` は `conf_json.DEFAULT_CONFIG` に登録済みのため、
AiDiy_key.json に無くても起動時に補完される。その他の `CHAT_LOCAL_*` は任意キー
（無ければ上表の既定値を使用。チューニングしたいときだけ追加する）。

## モデルのロードタイミング

- モデルファイルの取得: `_setup.py` の「事前ロード（ダウンロード）」で `temp/models` へ取得（既定 yes）。
  しなかった場合は使用時に自動ダウンロードする。
- メモリへのロード: **遅延ロード**（最初の `/v1/chat/completions` リクエスト時）。
  起動時の先読みロードは行わない。

## ポート

| ポート | サービス |
|--------|----------|
| 8096 | Backend Local (`local_main.py`) — OpenAI 互換 Gemma サーバー |
