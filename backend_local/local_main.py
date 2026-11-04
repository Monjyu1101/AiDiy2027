# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AiDiy Local LLM サーバー エントリポイント

HuggingFace Gemma モデルを OpenAI / ChatGPT 互換 API として
1 ポート (8096) で提供する。

主要エンドポイント:
- POST /v1/chat/completions  OpenAI 標準チャット補完
- GET  /v1/models            モデル一覧
- GET  /                     稼働状況（モデル/デバイス/ロード状態）
- GET  /health               ヘルスチェック

設定は _config/AiDiy_key.json から読み込む（環境変数は一切使わない）。
値の優先順位: AiDiy_key.json > 組み込みデフォルト。

| 設定 | AiDiy_key.json キー | 既定 |
|------|---------------------|------|
| 待受ポート | PORT_LOCAL | 8096 |
| モデル ID | CHAT_LOCAL_MODEL | google/gemma-4-E2B-it |
| HF トークン | huggingface_key_read | （なし） |
| デバイス | CHAT_LOCAL_DEVICE | auto |
| dtype | CHAT_LOCAL_DTYPE | auto |
| 最大生成トークン | CHAT_LOCAL_MAX_TOKENS | 128000 |
| モデル配置先 | CHAT_LOCAL_MODELS_DIR | temp/models |
| オフライン強制 | CHAT_LOCAL_OFFLINE | 0 |

モデルは使用時（最初のリクエスト）に遅延ロードする（起動時の先読みはしない）。
モデルファイルは temp/models/<safe_name> にあればそこからオフラインでロードする。
事前取得は `uv run python download_model.py` を使う。
"""

import os
import sys
import threading
import time

# UTF-8出力を強制（Windows文字化け対策）
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ログ設定は local_proc 配下の get_logger より先に初期化し、
# ログファイルの接頭辞を local_main に固定する。
from log_config import setup_logging, get_logger

setup_logging("local_main")
logger = get_logger(__name__)

from local_proc.gemma_engine import GemmaEngine
from local_proc.openai_api import create_router
from local_proc.aidiy_config import AiDiyConfig

# ------------------------------------------------------------------ #
# 設定（AiDiy_key.json から読み込み。環境変数は任意の上書き手段）
# ------------------------------------------------------------------ #

_cfg = AiDiyConfig()
logger.info("設定ソース: %s (%s)", _cfg.path, "読込OK" if _cfg.loaded else "見つからず→デフォルト使用")

PORT_LOCAL = _cfg.get_int("PORT_LOCAL", 8096)
LOCAL_MODEL = _cfg.get_str("CHAT_LOCAL_MODEL", "google/gemma-4-E2B-it")
LOCAL_DEVICE = _cfg.get_str("CHAT_LOCAL_DEVICE", "auto")
LOCAL_DTYPE = _cfg.get_str("CHAT_LOCAL_DTYPE", "auto")
LOCAL_MAX_TOKENS = _cfg.get_int("CHAT_LOCAL_MAX_TOKENS", 128000)
LOCAL_MODELS_DIR = _cfg.get_str("CHAT_LOCAL_MODELS_DIR", None)
LOCAL_OFFLINE = _cfg.get_bool("CHAT_LOCAL_OFFLINE", False)
# HF トークン（読み取り用）。AiDiy_key.json の huggingface_key_read のみ参照
HF_TOKEN = _cfg.get_str("huggingface_key_read", None)

# ------------------------------------------------------------------ #
# 推論エンジン
# ------------------------------------------------------------------ #

engine = GemmaEngine(
    model_id=LOCAL_MODEL,
    device=LOCAL_DEVICE,
    dtype=LOCAL_DTYPE,
    hf_token=HF_TOKEN,
    max_new_tokens=LOCAL_MAX_TOKENS,
    models_dir=LOCAL_MODELS_DIR,
    offline=LOCAL_OFFLINE,
)

# ------------------------------------------------------------------ #
# FastAPI アプリ
# ------------------------------------------------------------------ #
# モデルは使用時（最初の /v1/chat/completions リクエスト）に遅延ロードする。
# 起動時の先読みロードは行わない。

app = FastAPI(
    title="AiDiy Local LLM Server",
    description=(
        "HuggingFace Gemma モデルを OpenAI / ChatGPT 互換 API で提供するローカル推論サーバー。\n\n"
        f"OpenAI SDK の `base_url` に `http://127.0.0.1:{PORT_LOCAL}/v1` を指定して利用できます。\n\n"
        "- `POST /v1/chat/completions` — チャット補完（OpenAI 標準）\n"
        "- `GET /v1/models` — モデル一覧"
    ),
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(create_router(engine))


def _setup_reboot_watcher() -> None:
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    reboot_path = os.path.join(temp_dir, "reboot_local.txt")

    if os.path.isfile(reboot_path):
        try:
            os.remove(reboot_path)
        except Exception:
            pass
        raise SystemExit("reboot_local.txt detected")

    def watcher() -> None:
        while True:
            try:
                if os.path.isfile(reboot_path):
                    try:
                        os.remove(reboot_path)
                    except Exception:
                        pass
                    os._exit(0)
            except Exception:
                pass
            time.sleep(1)

    threading.Thread(target=watcher, daemon=True).start()


_setup_reboot_watcher()


@app.get("/", summary="稼働状況")
async def root() -> dict:
    return {
        "service": "aidiy_local_llm",
        "model": engine.model_id,
        "device": engine.device,
        "loaded": engine.is_loaded,
        "load_error": engine.load_error,
        "source": engine.resolve_source()[0],
        "offline": engine.offline,
        "endpoints": {
            "POST /v1/chat/completions": "チャット補完（OpenAI 標準）",
            "GET /v1/models": "モデル一覧",
        },
    }


@app.get("/health", summary="ヘルスチェック")
async def health() -> dict:
    return {"status": "ok", "loaded": engine.is_loaded}


# ------------------------------------------------------------------ #
# エントリポイント
# ------------------------------------------------------------------ #

if __name__ == "__main__":
    base = f"http://127.0.0.1:{PORT_LOCAL}"
    source, local_only = engine.resolve_source()
    logger.info("AiDiy Local LLM Server")
    logger.info(f"Model            : {LOCAL_MODEL}")
    logger.info(f"Source           : {source}")
    logger.info(f"LoadMode         : {'ローカル(オフライン)' if local_only else 'ハブからダウンロード'}")
    logger.info(f"ModelsDir        : {engine.models_dir}")
    logger.info(f"Device           : {engine.device}")
    logger.info(f"HF_TOKEN         : {'設定済み' if HF_TOKEN else '未設定（ゲートモデルは 401 になる可能性）'}")
    logger.info(f"Index            : {base}/")
    logger.info(f"ChatCompletions  : {base}/v1/chat/completions [OpenAI 互換]")
    logger.info(f"Models           : {base}/v1/models")
    if not local_only and not HF_TOKEN:
        logger.warning("モデルが未ダウンロードかつ HF_TOKEN 未設定です。Gemma はゲートモデルのため、")
        logger.warning("  HuggingFace でライセンス同意のうえ HF_TOKEN を設定し、")
        logger.warning("  事前に `uv run python download_model.py` を実行することを推奨します。")
    uvicorn.run(app, host="127.0.0.1", port=PORT_LOCAL, log_level="warning", ws_max_size=int(os.environ.get("UVICORN_WS_MAX_SIZE", "20971520")))
