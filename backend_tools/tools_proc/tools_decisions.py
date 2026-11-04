# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""aidiy_decisions_check のMCP / HTTPインターフェース。"""
import json
from copy import deepcopy

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import ValidationError

from log_config import get_logger
from tools_proc.decisions_check import DecisionError, DecisionRequest

logger = get_logger(__name__)


async def check_startup(decisions):
    """FastAPI lifespanから1回呼ぶ。結果は設定取得APIと起動ログで確認できる。"""
    logger.info("AI判断 起動チェック: おはよう → 挨拶（各方式の既定モデル、最大15秒）")
    results = await decisions.check_availability(timeout_sec=15)
    for name, info in results.items():
        log = logger.info if info["ok"] else logger.warning
        log("AI判断 %s/%s: %s — %s", name, info["model"],
            "利用可能" if info["ok"] else "利用不可", info["reason"])
    return results


def register_tools(mcp, decisions):
    # lifespanで実行チェック後に登録する。再登録時も接続と診断は残す。
    for name in ("decisions_config", "decisions_check"):
        if name in mcp._tool_manager._tools:
            mcp.remove_tool(name)
    status = decisions.get_availability_status()
    mcp._lowlevel_server.instructions = status["message"]

    @mcp.tool()
    async def decisions_config() -> dict:
        """AI判断のプロバイダ・既定モデル・起動時の実行確認結果を取得（認証情報は返さない）。"""
        return config_result(decisions)

    if not status["available"]:
        if not decisions.availability:
            logger.info("aidiy_decisions_check: 起動チェック待ちです。完了後に実行ツールの公開可否を更新します。")
        else:
            logger.warning("aidiy_decisions_check: %s 実行ツールは非公開です。", status["message"])
        return

    @mcp.tool()
    async def decisions_check(
        input: str | list[dict], questions: list[dict], model: str = "auto",
        ai_name: str = "auto", ai_model: str = "auto", timeout_sec: float = 60,
    ) -> dict:
        """テキスト・画像をAIで判断する。会話履歴やツール実行は持たない。

        model: openai_decisions/gpt-6-luna（APIキー）または
        openai_oauth/gpt-6-luna（Codex OAuthのResponses JSON Schema）。
        freeai_chat/gemini-3.5-flash-lite / gemini_chat/gemini-3.5-flash-liteもJSON判断に対応。
        方式は明示引数を優先し、省略・autoはAiDiy_key.jsonのDECISION_AI_NAMEを参照する。
        NAME設定もautoなら起動チェック成功のopenai_oauthを優先し、
        次にfreeai_chat、openai_decisions、gemini_chatの順。明示プロバイダは変更しない。
        モデルは明示model/ai_model → 方式別MODEL設定 → 既定値。
        低コスト既定値はOpenAI両方式gpt-6-luna、FreeAI/Geminiはgemini-3.5-flash-lite。
        Diagの書き出し候補で絞るが、モデル指定を実行側で固定・上書きしない。通常Chat等には適用しない。
        questions: type・name・instructionsを持つ配列。
        type=predicate は真の確率、choice はchoices=[{value,description}]、
        score はlevels=[{label,description}]を指定する。nameは一意。
        input: テキスト、またはuserメッセージ配列（input_text / input_image）。
        画像はdata:image/...;base64,...のみ。URLやファイルIDは不可。
        戻り値はstatus/message/data。data.answersは共通形式。
        OAuth / FreeAI / Geminiの確率は生成モデルの推定で、Decisions APIと同じ校正値ではない。
        """
        if not decisions.get_availability_status()["available"]:
            raise ToolError(decisions.get_availability_status()["message"])
        try:
            return await decisions.実行(DecisionRequest(input=input, questions=questions, model=model, ai_name=ai_name, ai_model=ai_model, timeout_sec=timeout_sec))
        except ValidationError as exc:
            errors = exc.errors(include_input=False, include_context=False, include_url=False)
            raise ToolError("AI判断の入力が不正です: " + json.dumps(errors, ensure_ascii=False)) from None
        except DecisionError as exc:
            raise ToolError(str(exc)) from None

    available_models = [f"{name}/{info['model']}" for name, info in decisions.availability.items() if info.get("ok")]
    logger.info("aidiy_decisions_check: 実行ツールを公開しました。利用可能: %s", ", ".join(available_models))

def config_result(decisions) -> dict:
    try:
        return decisions.get_config()
    except DecisionError as exc:
        # 設定ファイル自体が壊れていても「現在利用不可」と起動失敗理由を返す。
        return {
            **decisions.get_availability_status(),
            "availability": deepcopy(decisions.availability),
            "config_error": str(exc),
        }


def create_router(decisions) -> APIRouter:
    router = APIRouter(prefix="/aidiy_decisions_check", tags=["aidiy_decisions_check"])

    @router.get("/docs")
    async def docs():
        return {"service": "aidiy_decisions_check", "endpoint": "POST /aidiy_decisions_check/check", "request_schema": DecisionRequest.model_json_schema(), "example_request": {"model": "openai_oauth/gpt-6-luna", "input": "商品の外箱が破損しています。", "questions": [{"type": "predicate", "name": "damage", "instructions": "破損の報告ですか？"}]}, "config": config_result(decisions)}

    @router.get("/config")
    @router.post("/config")
    async def config():
        info = config_result(decisions)
        return {"status": info["status"], "message": info["message"], "data": info}

    @router.post("/check")
    async def check(request: DecisionRequest):
        status = decisions.get_availability_status()
        if not status["available"]:
            return JSONResponse(status_code=503, content={
                "status": "NG", "message": status["message"],
                "data": {"availability": deepcopy(decisions.availability)},
            })
        try:
            return await decisions.実行(request)
        except DecisionError as exc:
            return JSONResponse(status_code=400, content={"status": "NG", "message": str(exc), "data": None})

    return router
