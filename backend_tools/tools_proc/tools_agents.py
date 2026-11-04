# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_code_agents MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.code_agents import CodeAgentsError
from tools_proc.conversation_history import run_with_history
from tools_proc.tool_availability import availability_status
from tools_proc.request_lifetime import ClientDisconnected, run_until_disconnect

logger = get_logger(__name__)


# ------------------------------------------------------------------ #
# HTTP リクエストモデル
# ------------------------------------------------------------------ #

class AgentsRequest(BaseModel):
    prompt: str = ""
    project_path: Optional[str] = None
    ai_name: str = "auto"
    ai_model: str = "auto"
    max_turns: int = 999
    code_plan: str = "auto"
    code_verify: str = "auto"
    code_permissions: str = "auto"
    system_instruction: Optional[str] = None
    resume: bool = True
    timeout_sec: int = 1800
    self_check_loop: int = 0


_AGENTS_METHODS = [
    {
        "name": "config",
        "description": "Code Agents の設定情報（解決済みプロジェクトパス・key.json の CODE_* 設定）を返す",
        "parameters": {
            "project_path": {"type": "string", "required": False, "description": "作業ディレクトリ（省略時は AiDiy_key.json の CODE_BASE_PATH）"},
        },
    },
    {
        "name": "run",
        "description": "AI コードエージェントを実行する",
        "parameters": {
            "prompt": {"type": "string", "required": True, "description": "エージェントへの指示"},
            "project_path": {"type": "string", "required": False, "description": "作業ディレクトリの絶対パス"},
            "ai_name": {"type": "string", "required": False, "default": "auto", "description": "auto / same は aidiy_hermes。claude_sdk / claude_cli / copilot_cli / codex_cli なども明示指定可"},
            "ai_model": {"type": "string", "required": False, "default": "auto"},
            "max_turns": {"type": "integer", "required": False, "default": 999},
            "code_plan": {"type": "string", "required": False, "default": "auto"},
            "code_verify": {"type": "string", "required": False, "default": "auto"},
            "code_permissions": {"type": "string", "required": False, "default": "auto"},
            "system_instruction": {"type": "string", "required": False},
            "resume": {"type": "boolean", "required": False, "default": True},
            "timeout_sec": {"type": "integer", "required": False, "default": 1800},
            "self_check_loop": {"type": "integer", "required": False, "default": 0, "description": "バックアップ＋自己検証ループの最大回数（0=実行のみ）"},
        },
    },
]


# ================================================================== #
# MCP ツール登録
# ================================================================== #

def register_tools(mcp_ca, code_agents):
    """aidiy_code_agents MCP ツールを mcp_ca インスタンスに登録する。
    利用可能な AI 一覧を返す。"""
    mcp_ca._lowlevel_server.instructions = availability_status("Code Agents", code_agents.version_info)["message"]

    @mcp_ca.tool()
    async def code_agents_config(project_path: Optional[str] = None) -> str:
        """
        Code Agents の設定情報（解決済みプロジェクトパス・key.json の CODE_* 設定）を返す。

        Args:
            project_path: 作業ディレクトリの絶対パス。
                          省略時は AiDiy_key.json の CODE_BASE_PATH を使用。
        """
        try:
            info = await asyncio.to_thread(code_agents.get_config, project_path)
            info = {**info, **availability_status("Code Agents", code_agents.version_info)}
        except CodeAgentsError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    _ca_available = [k for k, v in code_agents.version_info.items() if v.get("ok")]

    if _ca_available:
        @mcp_ca.tool()
        async def code_agents_run(
            prompt: str,
            project_path: Optional[str] = None,
            ai_name: str = "auto",
            ai_model: str = "auto",
            max_turns: int = 999,
            code_plan: str = "auto",
            code_verify: str = "auto",
            code_permissions: str = "auto",
            system_instruction: Optional[str] = None,
            resume: bool = True,
            timeout_sec: int = 1800,
            self_check_loop: int = 0,
        ) -> str:
            """AIコード.py の CodeAgent を実行する（起動時に description が動的更新される）"""
            try:
                result = await run_with_history(
                    code_agents.run_async, "code",
                    prompt=prompt,
                    project_path=project_path,
                    ai_name=ai_name,
                    ai_model=ai_model,
                    max_turns=max_turns,
                    code_plan=code_plan,
                    code_verify=code_verify,
                    code_permissions=code_permissions,
                    system_instruction=system_instruction,
                    resume=resume,
                    timeout_sec=timeout_sec,
                    self_check_loop=self_check_loop,
                )
            except CodeAgentsError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    # description 動的生成
    if _ca_available and "code_agents_run" in mcp_ca._tool_manager._tools:
        mcp_ca._tool_manager._tools["code_agents_run"].description = code_agents.get_description() + "\n入力と最終応答を共通DBへ保存します。履歴の所属には絶対project_pathを指定してください。history_saved=trueは正常応答の保存完了です。保存失敗時のexecution_status=OKはAI実行済みを示すため、自動再実行しないでください。"

    _ca_skipped = [k for k, v in code_agents.version_info.items() if not v.get("ok")]
    logger.info(f"aidiy_code_agents 利用可能: {_ca_available}")
    if _ca_skipped:
        logger.warning(
            f"aidiy_code_agents 利用不可: {_ca_skipped} — "
            f"対象ツールをインストールしてください"
        )
    if not _ca_available:
        logger.warning(
            "aidiy_code_agents: 全ての AI が利用不可のため code_agents_run を非公開にしました"
        )

    return _ca_available


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(code_agents) -> APIRouter:
    """aidiy_code_agents HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_code_agents"])

    @router.get("/aidiy_code_agents/docs", summary="aidiy_code_agents ドキュメント")
    async def http_agents_docs() -> dict:
        """aidiy_code_agents の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_code_agents",
            "description": "AI コードエージェント（Claude SDK / CLI など）を MCP 経由で起動し、指定プロジェクトへの実装作業を委譲する。",
            "endpoint": "POST /aidiy_code_agents/{method_name}",
            "content_type": "application/json",
            "methods": {
                "config": {
                    "summary": "設定情報取得",
                    "description": "解決済みプロジェクトパスと AiDiy_key.json の CODE_* 設定値、利用可能な AI バージョン情報を返す。エージェント実行前の ai_name / project_path 確認に使う。",
                    "parameters": {
                        "project_path": {"type": "string", "required": False, "description": "作業ディレクトリの絶対パス。省略時は AiDiy_key.json の CODE_BASE_PATH を使用"},
                    },
                    "example_request": {},
                    "response_fields": {
                        "project_path": "解決済み作業ディレクトリの絶対パス",
                        "ai_versions": "利用可能な AI エージェントのバージョン情報 {claude_sdk: {ok, version}, ...}",
                        "settings": "CODE_* 設定値（ai_name / ai_model / code_plan / code_verify / code_permissions）",
                    },
                },
                "run": {
                    "summary": "AI コードエージェント実行",
                    "description": "指定プロンプトを AI コードエージェントに渡して実行する。完了まで数分〜数十分かかることがある（timeout_sec で制御）。事前に config でプロジェクトパスと AI の利用可能状態を確認すること。",
                    "parameters": {
                        "prompt": {"type": "string", "required": True, "description": "エージェントへの指示（日本語可）。実装内容・対象ファイル・制約を具体的に記述する"},
                        "project_path": {"type": "string", "required": False, "description": "プロジェクト絶対パス。実行先は省略時 CODE_BASE_PATH、DB履歴の所属は未指定ならNULL"},
                        "ai_name": {"type": "string", "required": False, "default": "auto", "values": ["auto", "same", "aidiy_hermes", "claude_sdk", "claude_cli", "copilot_cli", "codex_cli"], "description": "使用する AI エージェント。auto / same は aidiy_hermes を選択"},
                        "ai_model": {"type": "string", "required": False, "default": "auto", "description": "モデル名。autoはHermes/Codex/Claude/Copilotで履歴から自動選択。Hermesのsameは前回のprovider/モデルを復元、他CLIのsameは指定省略"},
                        "max_turns": {"type": "integer", "required": False, "default": 999, "description": "エージェントの最大ターン数"},
                        "code_plan": {"type": "string", "required": False, "default": "auto", "description": "計画フェーズの有無（auto / on / off）"},
                        "code_verify": {"type": "string", "required": False, "default": "auto", "description": "検証フェーズの有無（auto / on / off）"},
                        "code_permissions": {"type": "string", "required": False, "default": "auto", "description": "実行権限レベル（auto / all / limited）"},
                        "system_instruction": {"type": "string", "required": False, "description": "システムプロンプトへの追記テキスト"},
                        "resume": {"type": "boolean", "required": False, "default": True, "description": "True で前回セッションを継続する"},
                        "timeout_sec": {"type": "integer", "required": False, "default": 1800, "description": "タイムアウト秒（デフォルト 30 分）"},
                        "self_check_loop": {"type": "integer", "required": False, "default": 0, "description": "バックアップ＋自己検証ループの最大回数。0=実行のみ（バックアップなし）。1以上でその回数までバックアップ＋AI検証修正を実行"},
                    },
                    "example_request": {
                        "prompt": "backend_server/apps_router/M商品.py に商品検索エンドポイントを追加してください",
                        "ai_name": "auto",
                        "timeout_sec": 1800,
                    },
                    "response_fields": {
                        "status": "OK / NG",
                        "result": "エージェントの最終出力テキスト",
                        "ai_name": "実際に使用した AI エージェント",
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

    @router.post("/aidiy_code_agents/{method_name}", summary="コードエージェント実行")
    async def http_agents(method_name: str, request: Request, req: AgentsRequest = AgentsRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | config | Code Agents の設定情報を返す |
        | run | AI コードエージェントを実行する |
        """
        try:
            if method_name == "config":
                info = await asyncio.to_thread(code_agents.get_config, req.project_path)
                info = {**info, **availability_status("Code Agents", code_agents.version_info)}
                return info if isinstance(info, dict) else {"result": info}
            elif method_name == "run":
                result = await run_until_disconnect(request, run_with_history(
                    code_agents.run_async, "code",
                    prompt=req.prompt,
                    project_path=req.project_path,
                    ai_name=req.ai_name,
                    ai_model=req.ai_model,
                    max_turns=req.max_turns,
                    code_plan=req.code_plan,
                    code_verify=req.code_verify,
                    code_permissions=req.code_permissions,
                    system_instruction=req.system_instruction,
                    resume=req.resume,
                    timeout_sec=req.timeout_sec,
                    self_check_loop=req.self_check_loop,
                ))
                return result
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except ClientDisconnected:
            logger.info("http_agents: 呼び出し元の切断により実行を中止しました")
            return JSONResponse(status_code=499, content={"status": "NG", "result": "実行がキャンセルされました。"})
        except Exception as e:
            logger.warning(f"http_agents [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
