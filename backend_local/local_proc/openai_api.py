# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
OpenAI / ChatGPT 互換 Chat Completions API ルーター

GemmaEngine をバックエンドに、以下の標準エンドポイントを提供する。
- POST /v1/chat/completions  （OpenAI 標準パス）
- GET  /v1/models            （利用可能モデル一覧）

OpenAI SDK / 各種クライアントの base_url に
http://127.0.0.1:8096/v1 を指定して利用できる。
"""

import asyncio
import json
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from log_config import get_logger
from local_proc.gemma_engine import GemmaEngine, GemmaEngineError

logger = get_logger(__name__)


# ================================================================== #
# リクエストモデル（OpenAI 互換）
# ================================================================== #

class ChatMessage(BaseModel):
    # OpenAI 追加フィールド（name 等）も許容する
    model_config = ConfigDict(extra="allow")
    role: str = "user"
    content: Any = ""


class ChatCompletionsRequest(BaseModel):
    """OpenAI 互換 chat completions リクエスト"""
    model: Optional[str] = None
    messages: list[ChatMessage] = []
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = False
    # function calling（OpenAI 互換）。Gemma の tool_call フォーマットへ内部変換する。
    tools: Optional[list] = None
    tool_choice: Any = None


# ================================================================== #
# レスポンス整形
# ================================================================== #

def _build_completion_response(result: dict, model_label: str) -> dict:
    """GemmaEngine.generate の結果を OpenAI ChatCompletion 形式へ整形する。"""
    content = result.get("content", "")
    tool_calls = result.get("tool_calls")
    prompt_tokens = int(result.get("prompt_tokens", 0) or 0)
    completion_tokens = int(result.get("completion_tokens", 0) or 0)

    message: dict = {"role": "assistant", "content": content or None}
    if tool_calls:
        message["tool_calls"] = tool_calls
        finish_reason = "tool_calls"
    else:
        finish_reason = "stop"

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_label,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


# ================================================================== #
# ルーター
# ================================================================== #

def create_router(engine: GemmaEngine) -> APIRouter:
    """OpenAI 互換 API の APIRouter を作成して返す。"""
    router = APIRouter(tags=["openai"])

    @router.get("/v1/models", summary="モデル一覧（OpenAI 互換）")
    async def list_models() -> dict:
        return {
            "object": "list",
            "data": [
                {
                    "id": engine.model_id,
                    "object": "model",
                    "created": 0,
                    "owned_by": "google",
                }
            ],
        }

    async def _run_generate(req: ChatCompletionsRequest) -> dict:
        messages = [m.model_dump() for m in req.messages]
        # 生成は一度に1件のみ。既に生成中なら待たせず即 503 を返す
        # （クライアントのタイムアウト放棄でロックが保持され、後続が詰まる連鎖を防ぐ）。
        if not engine.try_acquire_slot():
            raise HTTPException(
                status_code=503,
                detail="モデルが別の生成を実行中です。しばらく待って再試行してください。",
            )
        # ブロッキングな推論をスレッドへ逃がしてイベントループを止めない
        try:
            return await asyncio.to_thread(
                engine.generate,
                messages=messages,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
                top_p=req.top_p,
                tools=req.tools,
            )
        except GemmaEngineError as e:
            raise HTTPException(status_code=500, detail=f"推論エラー: {e}") from e
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("生成中に予期しないエラー")
            raise HTTPException(status_code=500, detail=str(e)) from e
        finally:
            engine.release_slot()

    @router.post("/v1/chat/completions", summary="チャット補完（OpenAI 標準）")
    async def chat_completions(req: ChatCompletionsRequest):
        if not req.messages:
            raise HTTPException(status_code=400, detail="messages は必須です。")
        model_label = req.model or engine.model_id

        result = await _run_generate(req)
        response = _build_completion_response(result, model_label)

        if not req.stream:
            return response

        # stream=True: OpenAI 互換 SSE（全文を 1 チャンクで送出 + [DONE]）
        tool_calls = result.get("tool_calls")
        finish_reason = response["choices"][0]["finish_reason"]

        def _sse():
            delta: dict = {"role": "assistant", "content": result.get("content", "") or None}
            if tool_calls:
                delta["tool_calls"] = [{**tc, "index": i} for i, tc in enumerate(tool_calls)]
            chunk = {
                "id": response["id"],
                "object": "chat.completion.chunk",
                "created": response["created"],
                "model": model_label,
                "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            done = {
                "id": response["id"],
                "object": "chat.completion.chunk",
                "created": response["created"],
                "model": model_label,
                "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
            }
            yield f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(_sse(), media_type="text/event-stream")

    return router
