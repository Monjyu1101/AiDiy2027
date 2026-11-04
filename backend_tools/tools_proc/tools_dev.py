# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_logs / aidiy_code_check MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.log_tailer import LogTailError
from tools_proc.code_checker import CodeCheckError

logger = get_logger(__name__)


class LogsRequest(BaseModel):
    server: str = "server"
    lines: int = 100
    grep: Optional[str] = None


class CodeCheckRequest(BaseModel):
    file_path: Optional[str] = None
    path: str = "backend_server"
    venv_project: str = "backend_server"
    project: str = "frontend_web"


# ================================================================== #
# aidiy_logs ツール
# ================================================================== #

def register_logs_tools(mcp_lg, log_t):
    """aidiy_logs MCP ツールを mcp_lg インスタンスに登録する"""

    @mcp_lg.tool()
    async def logs_list() -> str:
        """監視対象のログファイル一覧を返す（server / mcp）"""
        try:
            items = await asyncio.to_thread(log_t.list_logs)
        except LogTailError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"logs": items}, ensure_ascii=False)

    @mcp_lg.tool()
    async def logs_tail(
        server: str = "server",
        lines: int = 100,
        grep: Optional[str] = None,
    ) -> str:
        """
        指定サーバーのログ末尾を返す。

        Args:
            server: 'server'（core/apps 共通）/ 'mcp' / 'core' / 'apps'
            lines:  末尾 N 行（最大 2000）
            grep:   指定時は正規表現で抽出
        """
        try:
            result = await asyncio.to_thread(log_t.tail, server, lines, grep)
        except LogTailError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_lg.tool()
    async def logs_recent_errors(server: str = "server", lines: int = 500) -> str:
        """直近ログから ERROR/Traceback を抽出し、前後 2 行の文脈付きで返す"""
        try:
            result = await asyncio.to_thread(log_t.recent_errors, server, lines)
        except LogTailError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)


# ================================================================== #
# aidiy_code_check ツール
# ================================================================== #

def register_code_check_tools(mcp_cc, checker):
    """aidiy_code_check MCP ツールを mcp_cc インスタンスに登録する"""

    @mcp_cc.tool()
    async def check_list_targets() -> str:
        """チェック対象（Python venv / TS プロジェクト）の存在確認"""
        try:
            info = await asyncio.to_thread(checker.list_targets)
        except CodeCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_cc.tool()
    async def check_python_syntax(
        file_path: str,
        venv_project: str = "backend_server",
    ) -> str:
        """Python ファイル 1 つを py_compile で構文チェック（相対パスはプロジェクトルート基準）"""
        try:
            result = await asyncio.to_thread(checker.python_syntax, file_path, venv_project)
        except CodeCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_cc.tool()
    async def check_python_ruff(
        path: str = "backend_server",
        venv_project: str = "backend_server",
    ) -> str:
        """Python プロジェクトを ruff check で lint（未インストール時はエラーを返す）"""
        try:
            result = await asyncio.to_thread(checker.python_ruff, path, venv_project)
        except CodeCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_cc.tool()
    async def check_typescript(project: str = "frontend_web") -> str:
        """npm run type-check を実行（project: 'frontend_web' / 'frontend_avatar'）"""
        try:
            result = await asyncio.to_thread(checker.typescript_check, project)
        except CodeCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_logs_router(log_t) -> APIRouter:
    """aidiy_logs HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_logs"])

    @router.get("/aidiy_logs/docs", summary="aidiy_logs ドキュメント")
    async def http_logs_docs() -> dict:
        return {
            "service": "aidiy_logs",
            "description": "backend_server（core / apps）と backend_tools のサーバーログを参照する。ログ末尾取得・正規表現フィルタ・ERROR/Traceback 抽出を提供する。",
            "endpoint": "POST /aidiy_logs/{method_name}",
            "content_type": "application/json",
            "server_values": {
                "server": "core と apps を合成した共通ログ（デフォルト）",
                "mcp": "backend_tools のログ",
                "core": "backend_server core_main.py のログ",
                "apps": "backend_server apps_main.py のログ",
            },
            "methods": {
                "list": {
                    "summary": "監視対象ログファイル一覧取得",
                    "description": "監視対象のログファイルパスと最終更新日時を返す。どのログが利用可能か確認するための第一歩。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"logs": "配列 [{server, path, exists, size_bytes, last_modified}, ...]"},
                },
                "tail": {
                    "summary": "ログ末尾 N 行取得",
                    "description": "指定サーバーのログ末尾 N 行を返す。grep を指定すると正規表現にマッチする行だけ抽出する（前後文脈なし）。直近の動作確認・リクエストログ確認に使う。",
                    "parameters": {
                        "server": {"type": "string", "required": False, "default": "server", "values": ["server", "mcp", "core", "apps"], "description": "ログ種別"},
                        "lines": {"type": "integer", "required": False, "default": 100, "description": "末尾から取得する行数（最大 2000）"},
                        "grep": {"type": "string", "required": False, "description": "正規表現フィルタ。例: 'ERROR' / 'POST /apps' / '配車'"},
                    },
                    "example_request": {"server": "server", "lines": 200, "grep": "ERROR"},
                    "response_fields": {"lines": "取得した行の配列", "matched": "grep 適用後の行数", "server": "対象サーバー"},
                },
                "recent_errors": {
                    "summary": "直近エラー・Traceback 抽出",
                    "description": "ログ末尾 N 行から ERROR・WARNING・Traceback を抽出し、前後 2 行の文脈付きで返す。障害調査の第一歩として使う。",
                    "parameters": {
                        "server": {"type": "string", "required": False, "default": "server", "values": ["server", "mcp", "core", "apps"]},
                        "lines": {"type": "integer", "required": False, "default": 500, "description": "解析対象の末尾行数"},
                    },
                    "example_request": {"server": "server", "lines": 500},
                    "response_fields": {"errors": "エラーブロックの配列（前後文脈付き）", "error_count": "検出エラー数"},
                },
            },
        }

    @router.post("/aidiy_logs/{method_name}", summary="ログ参照")
    async def http_logs(method_name: str, req: LogsRequest = LogsRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | list | ログファイル一覧 |
        | tail | ログ末尾取得 |
        | recent_errors | 直近エラー抽出 |
        """
        try:
            if method_name == "list":
                result = await asyncio.to_thread(log_t.list_logs)
                return {"logs": result}
            elif method_name == "tail":
                result = await asyncio.to_thread(log_t.tail, req.server, req.lines, req.grep)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "recent_errors":
                result = await asyncio.to_thread(log_t.recent_errors, req.server, req.lines)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except LogTailError as e:
            logger.warning(f"http_logs [{method_name}] error: {e}")
            return {"error": str(e)}

    return router


def create_code_check_router(checker) -> APIRouter:
    """aidiy_code_check HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_code_check"])

    @router.get("/aidiy_code_check/docs", summary="aidiy_code_check ドキュメント")
    async def http_code_check_docs() -> dict:
        return {
            "service": "aidiy_code_check",
            "description": "Python 構文チェック（py_compile）・ruff lint・TypeScript 型チェック（vue-tsc）を実行する。コード編集後の即時検証に使う。",
            "endpoint": "POST /aidiy_code_check/{method_name}",
            "content_type": "application/json",
            "venv_project_values": {
                "backend_server": "backend_server/.venv を使用（デフォルト）",
                "backend_tools": "backend_tools/.venv を使用",
                "command_hermes": "command_hermes/.venv を使用",
            },
            "methods": {
                "list_targets": {
                    "summary": "チェック対象一覧取得",
                    "description": "利用可能な Python venv プロジェクトと TypeScript プロジェクトの一覧を返す。各プロジェクトの存在フラグも含む。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"python_projects": "配列 [{name, venv_path, exists}, ...]", "ts_projects": "配列 [{name, path, exists}, ...]"},
                },
                "python_syntax": {
                    "summary": "Python ファイル構文チェック",
                    "description": "py_compile を使って指定 Python ファイルの構文エラーを検出する。相対パスはプロジェクトルート基準で解釈される。ファイル保存直後の即時チェックに最適。",
                    "parameters": {
                        "file_path": {"type": "string", "required": True, "description": "チェック対象ファイルパス（絶対パスまたはプロジェクトルート相対パス）。例: 'backend_server/core_main.py'"},
                        "venv_project": {"type": "string", "required": False, "default": "backend_server", "values": ["backend_server", "backend_tools", "command_hermes"], "description": "使用する Python venv のプロジェクト名"},
                    },
                    "example_request": {"file_path": "backend_server/core_main.py", "venv_project": "backend_server"},
                    "response_fields": {"ok": "True=構文エラーなし", "file_path": "チェックしたパス", "error": "エラー内容（ok=False 時）"},
                },
                "python_ruff": {
                    "summary": "Python ruff lint",
                    "description": "ruff check を実行して lint エラーを検出する。ディレクトリを指定するとその配下を再帰的にチェックする。ruff が未インストールの venv ではエラーを返す。",
                    "parameters": {
                        "path": {"type": "string", "required": False, "default": "backend_server", "description": "チェック対象パス（ファイルまたはディレクトリ）。例: 'backend_server' / 'backend_server/core_main.py'"},
                        "venv_project": {"type": "string", "required": False, "default": "backend_server", "values": ["backend_server", "backend_tools", "command_hermes"]},
                    },
                    "example_request": {"path": "backend_server", "venv_project": "backend_server"},
                    "response_fields": {"ok": "True=lint エラーなし", "violations": "違反一覧", "count": "違反件数"},
                },
                "typescript": {
                    "summary": "TypeScript 型チェック",
                    "description": "npm run type-check（vue-tsc --noEmit）を実行して型エラーを検出する。frontend_web / frontend_avatar のどちらかを指定する。",
                    "parameters": {
                        "project": {"type": "string", "required": False, "default": "frontend_web", "values": ["frontend_web", "frontend_avatar"], "description": "チェック対象の frontend プロジェクト"},
                    },
                    "example_request": {"project": "frontend_web"},
                    "response_fields": {"ok": "True=型エラーなし", "errors": "エラー一覧", "count": "エラー件数"},
                },
            },
        }

    @router.post("/aidiy_code_check/{method_name}", summary="コードチェック")
    async def http_code_check(method_name: str, req: CodeCheckRequest = CodeCheckRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | list_targets | チェック対象確認 |
        | python_syntax | Python 構文チェック |
        | python_ruff | ruff lint |
        | typescript | TypeScript 型チェック |
        """
        try:
            if method_name == "list_targets":
                result = await asyncio.to_thread(checker.list_targets)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "python_syntax":
                if not req.file_path:
                    return {"error": "file_path は必須です"}
                result = await asyncio.to_thread(checker.python_syntax, req.file_path, req.venv_project)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "python_ruff":
                result = await asyncio.to_thread(checker.python_ruff, req.path, req.venv_project)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "typescript":
                result = await asyncio.to_thread(checker.typescript_check, req.project)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except CodeCheckError as e:
            logger.warning(f"http_code_check [{method_name}] error: {e}")
            return {"error": str(e)}

    return router

