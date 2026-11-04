# ローカルモデルの準備と起動

> 文書: `backend_local,モデル準備と起動.md` | 実装: `backend_local/_setup.py`, `backend_local/local_main.py`, `backend_local/download_model.py`

## このメモを使う場面

- ローカルモデルを取得して起動・疎通確認するとき。

## セットアップ・起動

```bash
# 1. 依存インストール（uv）
cd backend_local
uv sync

# 2. モデルを temp/models へ事前ダウンロード（トークンは AiDiy_key.json の huggingface_key_read）
#    既定 CHAT_LOCAL_MODEL、または引数でモデル指定
uv run python download_model.py
uv run python download_model.py google/gemma-4-E2B-it

# 3. 起動（ポート 8096）。temp/models にあればオフラインでロードされる
uv run uvicorn local_main:app --reload --host 127.0.0.1 --port 8096 --ws-max-size 20971520
# または
uv run python local_main.py
```

`_setup.py` の「バックエンド(local)」セットアップでは 依存関係の同期 に加え、
任意でモデルの事前ダウンロードも実行できる（トークンは AiDiy_key.json から読む）。

Local は `127.0.0.1` のみで待ち受け、同一 PC 内のクライアントから利用します。LAN の別 PC からの直接接続は受け付けません。ルートの `_start.py` も `backend_local/_start.py` に委譲し、venv / uv のどちらでも同じ待受になります。Core / Apps / TaskTeam の待受は変更しません。

## モデル取得の準備

Gemma は HuggingFace 上のゲート付きモデルです。利用前に以下が必要です。

1. HuggingFace アカウントで対象モデル（例: `google/gemma-4-E2B-it`）の
   ライセンスに同意する。
2. 取得したアクセストークンを AiDiy_key.json の `huggingface_key_read` に設定する。

トークン未設定の場合、モデルダウンロード時に 401 / 403 となります。

## 確認とcleanup

`GET http://127.0.0.1:8096/health` で稼働状態を確認します。モデルは最初の推論要求時にメモリへロードされるため、health成功だけでは推論成功を意味しません。必要メモリと速度はモデル・dtype・入力長・デバイスによって異なります。

全体cleanupで `backend_local/temp/models` も削除されます。次の利用前にモデルの再取得が必要です。設定・対応APIは [実装概要](../../backend_local/AGENTS.md)、整理方法は [cleanup後の確認](./共通,クリーンアップ手順.md) を参照してください。
