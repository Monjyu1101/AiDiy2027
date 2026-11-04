# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_chat_llms MCP ツール登録 + HTTP ルート（2 系統）

  1. /aidiy_chat_llms/{method}        … aidiy_code_agents 互換の独自インターフェース
  2. /aidiy_chat_completions/...      … OpenAI / Ollama 互換の標準チャットインターフェース
"""

import json
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from log_config import get_logger
from tools_proc.chat_llm import ChatLLMError
from tools_proc.conversation_history import run_with_history
from tools_proc.tool_availability import availability_status

logger = get_logger(__name__)


# ================================================================== #
# HTTP リクエストモデル
# ================================================================== #

class ChatLLMRequest(BaseModel):
    """aidiy_chat_llms（独自インターフェース）リクエスト"""
    prompt: str = ""
    project_path: Optional[str] = None
    ai_name: str = "auto"
    ai_model: str = "auto"
    system_instruction: Optional[str] = None
    session_id: str = "mcp_default"
    resume: bool = True
    temperature: Optional[float] = None
    timeout_sec: int = 120
    file_path: Optional[str] = None
    # 自前 MCP 群をツールとして渡し、tool_calls をサーバー側で自律実行する
    use_tools: bool = True
    max_turns: int = 8


class ChatMessage(BaseModel):
    # tool_calls / tool_call_id / name など OpenAI 追加フィールドを保持する
    model_config = ConfigDict(extra="allow")
    role: str = "user"
    content: Any = ""


class ChatCompletionsRequest(BaseModel):
    """OpenAI / Ollama 互換 chat completions リクエスト"""
    model: Optional[str] = None
    messages: list[ChatMessage] = []
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = False
    # function calling（OpenAI 互換）
    tools: Optional[list] = None
    tool_choice: Any = None
    # AiDiy 拡張（任意）
    ai_name: str = "auto"
    project_path: Optional[str] = None
    timeout_sec: int = 120


# ================================================================== #
# MCP ツール登録
# ================================================================== #

def register_tools(mcp_cl, chat_llm):
    """aidiy_chat_llms MCP ツールを mcp_cl インスタンスに登録する。
    利用可能な AI 一覧を返す。"""
    mcp_cl._lowlevel_server.instructions = availability_status("Chat LLM", chat_llm.version_info)["message"]

    @mcp_cl.tool()
    async def chat_llms_config(project_path: Optional[str] = None) -> str:
        """
        Chat LLM の設定情報（解決済みパス・key.json の CHAT_* 設定・利用可能 AI）を返す。

        Args:
            project_path: 出力ファイル保存先の絶対パス。
                          省略時は AiDiy_key.json の CODE_BASE_PATH を使用。
        """
        try:
            info = chat_llm.get_config(project_path)
            info = {**info, **availability_status("Chat LLM", chat_llm.version_info)}
        except ChatLLMError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    _cl_available = [k for k, v in chat_llm.version_info.items() if v.get("ok")]

    if _cl_available:
        @mcp_cl.tool()
        async def chat_llms_run(
            prompt: str,
            project_path: Optional[str] = None,
            ai_name: str = "auto",
            ai_model: str = "auto",
            system_instruction: Optional[str] = None,
            session_id: str = "mcp_default",
            resume: bool = True,
            temperature: Optional[float] = None,
            timeout_sec: int = 120,
            file_path: Optional[str] = None,
            use_tools: bool = True,
            max_turns: int = 8,
        ) -> str:
            """AIチャット.py 系の ChatAI を実行する（起動時に description が動的更新される）。

            use_tools=True のときは自前 MCP 群をツールとして LLM に渡し、tool_calls を
            サーバー側で実行しながら応答が確定するまで最大 max_turns 回ループする。"""
            try:
                result = await run_with_history(
                    chat_llm.run_async, "chat",
                    prompt=prompt, project_path=project_path,
                    ai_name=ai_name, ai_model=ai_model,
                    system_instruction=system_instruction, session_id=session_id,
                    resume=resume, temperature=temperature, timeout_sec=timeout_sec,
                    file_path=file_path, use_tools=use_tools, max_turns=max_turns,
                )
            except ChatLLMError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    # description 動的生成
    if _cl_available and "chat_llms_run" in mcp_cl._tool_manager._tools:
        mcp_cl._tool_manager._tools["chat_llms_run"].description = chat_llm.get_description() + "\n入力と最終応答を共通DBへ保存します。履歴の所属には絶対project_pathを指定してください。history_saved=trueは正常応答の保存完了です。保存失敗時のexecution_status=OKはAI実行済みを示すため、自動再実行しないでください。"

    _cl_skipped = [k for k, v in chat_llm.version_info.items() if not v.get("ok")]
    logger.info(f"aidiy_chat_llms 利用可能: {_cl_available}")
    if _cl_skipped:
        logger.warning(
            f"aidiy_chat_llms 利用不可: {_cl_skipped} — API キーの設定を確認してください"
        )
    if not _cl_available:
        logger.warning(
            "aidiy_chat_llms: 全ての AI が利用不可のため chat_llms_run を非公開にしました"
        )

    return _cl_available


# ================================================================== #
# HTTP ルート (1) aidiy_chat_llms — 独自インターフェース
# ================================================================== #

def create_router(chat_llm) -> APIRouter:
    """aidiy_chat_llms HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_chat_llms"])

    @router.get("/aidiy_chat_llms/docs", summary="aidiy_chat_llms ドキュメント")
    async def http_chat_llm_docs() -> dict:
        """aidiy_chat_llms の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_chat_llms",
            "description": "AIチャット.py 系の ChatAI（OpenRouter / Gemini / FreeAI / Ollama）を MCP 経由で起動し、テキスト応答を生成する。use_tools=True で自前 MCP 群をツールとして渡し tool_calls をサーバー側で自律実行（エージェント駆動）する。tool_calls を返すだけのローレベル／OpenAI・Ollama 互換の標準インターフェースは aidiy_chat_completions を参照。",
            "endpoint": "POST /aidiy_chat_llms/{method_name}",
            "content_type": "application/json",
            "methods": {
                "config": {
                    "summary": "設定情報取得",
                    "description": "解決済みパスと AiDiy_key.json の CHAT_* 設定値、利用可能な AI 情報を返す。",
                    "parameters": {
                        "project_path": {"type": "string", "required": False, "description": "出力ファイル保存先。省略時は CODE_BASE_PATH"},
                    },
                    "example_request": {},
                },
                "run": {
                    "summary": "AIチャット実行（ツール自律実行対応）",
                    "description": "指定プロンプトを ChatAI に渡してテキスト応答を生成する。use_tools=True のときは自前 MCP 群（aidiy_sqlite / aidiy_logs / aidiy_code_check 等）をツールとして LLM に渡し、LLM が返した tool_calls をサーバー側で self-call 実行し、結果を戻して応答が確定するまで最大 max_turns 回ループする（aidiy_chat_llms / aidiy_code_agents 自身はツールから除外）。tool_calls を返すだけのローレベル動作が必要なら aidiy_chat_completions を使う。",
                    "parameters": {
                        "prompt": {"type": "string", "required": True, "description": "AI への入力テキスト（日本語可）"},
                        "project_path": {"type": "string", "required": False, "description": "プロジェクト絶対パス。実行先は省略時 CODE_BASE_PATH、DB履歴の所属は未指定ならNULL"},
                        "ai_name": {"type": "string", "required": False, "default": "auto", "values": ["auto", "openrt_chat", "gemini_chat", "freeai_chat", "ollama_chat"], "description": "使用する AI。auto で CHAT_AI_NAME を優先選択"},
                        "ai_model": {"type": "string", "required": False, "default": "auto", "description": "モデル名。auto で ai_name の既定モデルを使用"},
                        "system_instruction": {"type": "string", "required": False, "description": "システム指示"},
                        "session_id": {"type": "string", "required": False, "default": "mcp_default", "description": "モデル文脈の継続キー（resume=True）。DBの呼出し単位history_session_idとは別"},
                        "resume": {"type": "boolean", "required": False, "default": True, "description": "True で session_id の会話履歴を継続"},
                        "temperature": {"type": "number", "required": False, "description": "生成温度"},
                        "timeout_sec": {"type": "integer", "required": False, "default": 120, "description": "タイムアウト秒（ツール 1 回あたりにも適用）"},
                        "file_path": {"type": "string", "required": False, "description": "添付画像ファイルの絶対パス（vision 対応モデルのみ）"},
                        "use_tools": {"type": "boolean", "required": False, "default": True, "description": "True で自前 MCP 群をツールとして渡し tool_calls を自律実行する。False で従来の 1 回素応答"},
                        "max_turns": {"type": "integer", "required": False, "default": 8, "description": "ツール実行ループの最大ターン数"},
                    },
                    "example_request": {
                        "prompt": "DBの C利用者 テーブルの件数を調べて",
                        "ai_name": "auto",
                    },
                    "response_fields": {
                        "status": "OK / NG",
                        "result": "生成された応答テキスト",
                        "ai_name": "実際に使用した AI",
                        "ai_model": "実際に使用したモデル",
                        "output_files": "生成された出力ファイル（画像生成モデルの場合）",
                        "tool_trace": "実行したツールの履歴 [{mcp, method, arguments, ok}, ...]",
                        "turns": "実行したループのターン数",
                        "tool_stopped": "True=max_turns 到達で打ち切り",
                        "history_saved": "入力と正常な最終応答のDB保存完了。falseでも入力やerror行は保存済みの場合がある",
                        "history_input_saved": "入力行のDB保存完了",
                        "history_session_id": "呼出し単位のDBセッションID",
                        "history_project_path": "履歴へ保存した正規化済みプロジェクト絶対パス、未指定はnull",
                        "history_error": "履歴保存失敗時のみ。DBパスや例外詳細は含めない",
                        "execution_status": "保存失敗時のみ。NOT_STARTED=AI未開始、OK/NG=AI自体の結果。OKなら自動再実行しない",
                    },
                },
            },
        }

    @router.post("/aidiy_chat_llms/{method_name}", summary="AIチャット実行")
    async def http_chat_llm(method_name: str, req: ChatLLMRequest = ChatLLMRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | config | Chat LLM の設定情報を返す |
        | run | AIチャットを実行する |
        """
        try:
            if method_name == "config":
                return {**chat_llm.get_config(req.project_path), **availability_status("Chat LLM", chat_llm.version_info)}
            elif method_name == "run":
                return await run_with_history(
                    chat_llm.run_async, "chat",
                    prompt=req.prompt,
                    project_path=req.project_path,
                    ai_name=req.ai_name,
                    ai_model=req.ai_model,
                    system_instruction=req.system_instruction,
                    session_id=req.session_id,
                    resume=req.resume,
                    temperature=req.temperature,
                    timeout_sec=req.timeout_sec,
                    file_path=req.file_path,
                    use_tools=req.use_tools,
                    max_turns=req.max_turns,
                )
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except Exception as e:
            logger.warning(f"http_chat_llm [{method_name}] error: {e}")
            return {"error": str(e)}

    return router


# ================================================================== #
# HTTP ルート (2) aidiy_chat_completions — OpenAI / Ollama 互換
# ================================================================== #

def _build_completion_response(result: dict, model_label: str) -> dict:
    """ChatLLM.complete_async の結果を OpenAI ChatCompletion 形式に整形する"""
    content = result.get("content", "")
    tool_calls = result.get("tool_calls")
    if result.get("status") != "OK":
        finish_reason = "error"
    elif tool_calls:
        finish_reason = "tool_calls"
    else:
        finish_reason = "stop"
    prompt_tokens = int(result.get("prompt_tokens", 0) or 0)
    completion_tokens = int(result.get("completion_tokens", 0) or 0)

    message: dict = {"role": "assistant", "content": content or None}
    if tool_calls:
        message["tool_calls"] = tool_calls

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


def create_completions_router(chat_llm) -> APIRouter:
    """aidiy_chat_completions（OpenAI / Ollama 互換）HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_chat_completions"])

    @router.get("/aidiy_chat_completions/docs", summary="aidiy_chat_completions ドキュメント")
    async def http_completions_docs() -> dict:
        """OpenAI / Ollama 互換チャットインターフェースのドキュメント"""
        return {
            "service": "aidiy_chat_completions",
            "description": "OpenAI Chat Completions / Ollama 互換の標準チャットインターフェース。AIチャット.py 系の ChatAI をバックエンドに使用する。OpenAI SDK / Ollama クライアントの base_url に http://127.0.0.1:8095/aidiy_chat_completions/v1 を指定して利用できる。",
            "endpoints": {
                "POST /aidiy_chat_completions/v1/chat/completions": "チャット補完（OpenAI 標準パス）",
                "GET /aidiy_chat_completions/v1/models": "利用可能モデル（ai_name）一覧",
            },
            "request_fields": {
                "model": "ai_name（openrt_chat 等）/ 'ai_name/モデル名' / 具体モデル名 のいずれか",
                "messages": "[{role: system|user|assistant, content: str | [parts]}] 形式の会話履歴",
                "temperature": "生成温度（任意）",
                "stream": "true で SSE ストリーミング（text/event-stream、全文 1 チャンク + [DONE]）",
            },
            "vision": "対応。最後の user メッセージの content に image_url パート（data: URL / http(s) URL）を含めると、vision 対応モデルへ画像を添付する（単一画像）。",
            "tool_calling": "対応（openrt_chat / ollama_chat / gemini_chat / freeai_chat）。tools / tool_choice を渡すと function calling を行い、tool_calls と finish_reason='tool_calls' を返す。gemini 系は OpenAI tools を Gemini function calling に内部変換する。",
            "openai_sdk_example": {
                "base_url": "http://127.0.0.1:8095/aidiy_chat_completions/v1",
                "api_key": "（任意・未使用）",
                "model": "ollama_chat",
            },
        }

    @router.get("/aidiy_chat_completions/v1/models", summary="モデル一覧（OpenAI 互換）")
    async def http_models() -> dict:
        """OpenAI 互換 /v1/models — 利用可能な ai_name をモデルとして返す"""
        return {"object": "list", "data": chat_llm.available_models()}

    async def _handle_completions(req: ChatCompletionsRequest):
        # tool_calls / tool_call_id / name などの追加フィールドも保持して渡す
        messages = [m.model_dump() for m in req.messages]
        model_label = req.model or req.ai_name or "auto"

        result = await chat_llm.complete_async(
            messages=messages,
            model=req.model,
            ai_name=req.ai_name,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            timeout_sec=req.timeout_sec,
            project_path=req.project_path,
            tools=req.tools,
            tool_choice=req.tool_choice,
        )
        response = _build_completion_response(result, model_label)

        if not req.stream:
            return response

        # stream=True: OpenAI 互換 SSE（全文を 1 チャンクで送出 + [DONE]）
        tool_calls = result.get("tool_calls")
        finish_reason = response["choices"][0]["finish_reason"]

        def _sse():
            delta: dict = {"role": "assistant", "content": result.get("content", "") or None}
            if tool_calls:
                # OpenAI ストリーミング形式では tool_calls に index を付与する
                delta["tool_calls"] = [
                    {**tc, "index": i} for i, tc in enumerate(tool_calls)
                ]
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

    @router.post("/aidiy_chat_completions/v1/chat/completions", summary="チャット補完（OpenAI 標準）")
    async def http_completions_v1(req: ChatCompletionsRequest):
        return await _handle_completions(req)

    return router
