# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""次のユーザー入力予測の内部 REST（MCP 非公開・履歴非保存）。"""

import asyncio
import ipaddress
import json
import re
from typing import Annotated, Literal

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from starlette.requests import ClientDisconnect

from log_config import get_logger
from tools_proc.prediction_privacy import prediction_private_logs

logger = get_logger(__name__)

MAX_BODY_BYTES = 20 * 1024 * 1024  # JSON transport。project_path 等の項目制約は別途維持する。
SERVICE_NAME = "aidiy_prediction_llms"
INTERNAL_PATH = "/internal/prediction_llms"
INPUT_ERROR = "ユーザー入力予測の引数が不正です。project_path と各設定値を確認してください。"
RUN_ERROR = "ユーザー入力予測を実行できませんでした。設定と履歴の状態を確認してください。"

PredictionAIName = Literal["auto", "openai_oauth", "freeai_chat", "openai_chat", "gemini_chat", "codex_cli", "copilot_cli", "aidiy_hermes"]
ProjectPath = Annotated[str, Field(strict=True, min_length=1, max_length=4096)]
PredictionModel = Annotated[str, Field(strict=True, min_length=1, max_length=200)]
TimeoutSeconds = Annotated[int, Field(strict=True, ge=1, le=600)]


class PredictionLLMRequest(BaseModel):
    """予測対象のプロジェクトを必須指定する。会話本文・session・tool 指定は受けない。"""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    project_path: ProjectPath
    ai_name: PredictionAIName = "auto"
    ai_model: PredictionModel = "auto"
    timeout_sec: TimeoutSeconds = 120

    @field_validator("project_path", "ai_model")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError(INPUT_ERROR)
        return value.strip()


async def validate_request(request: Request) -> PredictionLLMRequest:
    """Live内部試行と同じ、直接loopback・固定ヘッダー・制限付きJSONの境界。"""
    headers = request.headers
    try:
        peer = ipaddress.ip_address(request.client.host)
    except (ValueError, AttributeError):
        raise HTTPException(403, "loopback only") from None
    if not peer.is_loopback or not re.fullmatch(r"(127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?", headers.get("host", "")):
        raise HTTPException(403, "loopback only")
    if any(key == "origin" or key == "forwarded" or key.startswith("x-forwarded-") or key in ("x-real-ip", "x-original-host", "x-original-url", "x-rewrite-url") for key in headers):
        raise HTTPException(403, "direct requests only")
    if len(headers.getlist("host")) != 1 or len(headers.getlist("x-aidiy-diag")) != 1 or headers.get("x-aidiy-diag") != "model-trial":
        raise HTTPException(403, "diagnostic header required")
    if request.url.query or headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(400, "valid diagnostic JSON required")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise HTTPException(413, "request too large")
        body.extend(chunk)
    try:
        return PredictionLLMRequest.model_validate(json.loads(body))
    except (ValidationError, ValueError, UnicodeError, RecursionError):
        # Pydantic / JSON のエラー詳細には入力を含むため返さない。
        raise HTTPException(400, INPUT_ERROR) from None


async def _run_prediction(prediction_llm, request: PredictionLLMRequest) -> dict:
    try:
        with prediction_private_logs():
            return await prediction_llm.run_async(**request.model_dump())
    except Exception:
        # 履歴・入力・モデル出力・例外本文はログにもエラー応答にも残さない。
        logger.warning("aidiy_prediction_llms: 予測実行に失敗しました")
        return {"status": "NG", "result": RUN_ERROR}


def register_prediction_llms(app, prediction_llm=None) -> None:
    """内部RESTを1経路だけ登録する。MCP・公開docs/config・起動時試行は持たない。"""
    if prediction_llm is None:
        from tools_proc.prediction_llm import PredictionLLM
        prediction_llm = PredictionLLM()

    @app.post(INTERNAL_PATH, include_in_schema=False)
    async def prediction_llms(request: Request):
        try:
            async with asyncio.timeout(3):
                params = await validate_request(request)
        except TimeoutError:
            raise HTTPException(408, "request timeout") from None
        task = asyncio.create_task(_run_prediction(prediction_llm, params))

        async def disconnected():
            while True:
                message = await request.receive()
                if message["type"] == "http.disconnect":
                    return

        watch = asyncio.create_task(disconnected())
        try:
            done, _ = await asyncio.wait((task, watch), return_when=asyncio.FIRST_COMPLETED)
            if task not in done:
                raise HTTPException(499, "client disconnected")
            try:
                result = task.result()
                if not isinstance(result, dict):
                    raise ValueError()
                return JSONResponse(content=result)
            except (HTTPException, ClientDisconnect):
                raise
            except Exception:
                # 応答の型・JSON変換が不正でもモデル出力をエラーに含めない。
                logger.warning("aidiy_prediction_llms: HTTP 応答を生成できませんでした")
                return JSONResponse(status_code=500, content={"status": "NG", "result": RUN_ERROR})
        finally:
            for pending in (task, watch):
                if not pending.done():
                    pending.cancel()
            await asyncio.gather(task, watch, return_exceptions=True)
