# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_backup MCP ツール登録 + HTTP ルート（save / check を統合）"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, StrictBool

from log_config import get_logger
from tools_proc.backup import BackupCheckError, BackupSave, BackupSaveError

logger = get_logger(__name__)


class BackupSaveRequest(BaseModel):
    project_root: Optional[str] = None
    batch: StrictBool = False


class BackupCheckRequest(BaseModel):
    path: Optional[str] = None
    base_ts: Optional[str] = None
    from_ts: Optional[str] = None
    to_ts: Optional[str] = None


# ================================================================== #
# MCP ツール登録
# ================================================================== #

def register_tools(mcp_bk, bsave, bchk):
    """aidiy_backup MCP ツールを mcp_bk インスタンスに登録する（save + check 統合）"""

    # ---- save ツール ------------------------------------------------

    @mcp_bk.tool()
    async def backup_run(batch: StrictBool = False) -> str:
        """
        対象プロジェクト直下の .aidiy_backup/ に AiDiy ネイティブの差分バックアップを保存する。
        初回は全件スナップショット（HHMMSS.all）、以降は差分のみ（HHMMSS）を保存。
        batch=false（既定）は完了を待つ。trueは実コピーだけを別スレッドにし、
        予定件数・保存先とbatch=trueを返す。okは受付成功でありコピー完了ではない。
        """
        try:
            info = await asyncio.to_thread(bsave.run, batch=batch)
        except BackupSaveError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_bk.tool()
    async def backup_diff_scan() -> str:
        """
        バックアップを作成せず、現時点で差分対象となるファイル一覧のみ返す（dry-run）。
        """
        try:
            info = await asyncio.to_thread(bsave.diff_scan)
        except BackupSaveError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    # ---- check ツール -----------------------------------------------

    @mcp_bk.tool()
    async def backup_info() -> str:
        """バックアップルートの絶対パスと存在フラグを返す"""
        try:
            info = await asyncio.to_thread(bchk.backup_root_path)
        except BackupCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_bk.tool()
    async def backup_get_before_after(
        path: str,
        base_ts: Optional[str] = None,
    ) -> str:
        """
        指定ソースの現行版（after）と、直前のバックアップ版（before）を同時に返す。

        Args:
            path: プロジェクトルート相対のファイルパス（例: 'backend_server/core_main.py'）
            base_ts: 'YYYYMMDD_HHMMSS' 形式。指定時はこの日時より前のバックアップから before を探す
        """
        try:
            info = await asyncio.to_thread(bchk.get_before_after, path, base_ts)
        except BackupCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_bk.tool()
    async def backup_list_versions(path: str) -> str:
        """指定ファイルがバックアップに出現する全日時を新しい順で返す"""
        try:
            info = await asyncio.to_thread(bchk.list_versions, path)
        except BackupCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_bk.tool()
    async def backup_find_changed(
        from_ts: str,
        to_ts: Optional[str] = None,
    ) -> str:
        """
        指定期間のバックアップに含まれる相対パス一覧を返す（= 変更のあったファイル）。

        Args:
            from_ts: 'YYYYMMDD_HHMMSS' 形式の開始日時（必須）
            to_ts:   終了日時（任意）
        """
        try:
            info = await asyncio.to_thread(bchk.find_changed, from_ts, to_ts)
        except BackupCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_bk.tool()
    async def backup_diff_stats(
        path: str,
        base_ts: Optional[str] = None,
    ) -> str:
        """指定ファイルの before/after の追加・削除行数を軽量サマリで返す"""
        try:
            info = await asyncio.to_thread(bchk.diff_stats, path, base_ts)
        except BackupCheckError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(bsave, bchk) -> APIRouter:
    """aidiy_backup HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_backup"])

    @router.get("/aidiy_backup/docs", summary="aidiy_backup ドキュメント")
    async def http_backup_docs() -> dict:
        """aidiy_backup の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_backup",
            "description": "AiDiy ソースコードの差分バックアップを管理する。save でバックアップ実行、check でバックアップ内容を参照する。コード変更前の save/scan で差分確認、作業後の save/run でスナップショット保存が基本フロー。",
            "content_type": "application/json",
            "endpoints": {
                "save": "POST /aidiy_backup/save/{method_name}  （JSON body は任意）",
                "check": "POST /aidiy_backup/check/{method_name}  （JSON body で引数を渡す）",
            },
            "save_methods": {
                "scan": {
                    "summary": "差分スキャン（dry-run）",
                    "description": "バックアップを作成せず、現時点で差分対象となるファイル一覧のみ返す。バックアップ前の確認や差分件数チェックに使う。",
                    "parameters": {
                        "project_root": {"type": "string", "required": False, "description": "対象プロジェクトルートの絶対パス（省略時は AiDiy 自身）"},
                    },
                    "example": "POST /aidiy_backup/save/scan",
                    "response_fields": {"count": "差分ファイル数", "files": "差分ファイルパスの配列"},
                },
                "run": {
                    "summary": "差分バックアップ実行",
                    "description": "変更ファイルを対象プロジェクト直下の .aidiy_backup/ ディレクトリへコピーする。初回は全件スナップショット（HHMMSS.all）、以降は差分のみ（HHMMSS）保存。コード作業の区切りや本番前の安全確認として定期実行を推奨。",
                    "parameters": {
                        "batch": {"type": "boolean", "required": False, "default": False, "description": "falseは完了待ち。trueはコピー受付を返す（件数・保存先は予定値、完了/失敗はログ）。"},
                        "project_root": {"type": "string", "required": False, "description": "対象プロジェクトルートの絶対パス（省略時は AiDiy 自身）"},
                    },
                    "example": "POST /aidiy_backup/save/run",
                    "response_fields": {"ok": "falseは失敗。batch=trueのtrueは受付成功", "batch": "指定値（省略時false）", "全件数": "対象ファイル数", "バックアップ件数": "同期は保存件数、batch=trueは予定件数", "バックアップ先": "同期は保存先、batch=trueは予定保存先", "最終時刻": "従来の基準時刻", "全件フラグ": "初回全件保存か", "差分なし": "保存対象なし"},
                },
            },
            "check_methods": {
                "info": {
                    "summary": "バックアップルート情報",
                    "description": "バックアップルートの絶対パスと存在フラグを返す。バックアップが設定・実行されているかの確認に使う。",
                    "parameters": {},
                    "example": "POST /aidiy_backup/check/info",
                    "response_fields": {"backup_root": "バックアップルートの絶対パス", "exists": "True=ディレクトリが存在する"},
                },
                "before_after": {
                    "summary": "ファイルの before/after 取得",
                    "description": "指定ソースファイルの現行版（after）と直前のバックアップ版（before）を同時に返す。コードレビューや変更内容の確認に使う。base_ts を指定すると特定時点以前のバックアップと比較できる。",
                    "parameters": {
                        "path": {"type": "string", "required": True, "description": "プロジェクトルート相対パス（例: 'backend_server/core_main.py'）"},
                        "base_ts": {"type": "string", "required": False, "description": "'YYYYMMDD_HHMMSS' 形式。指定時はこの日時より前のバックアップから before を探す"},
                    },
                    "example_request": {"path": "backend_server/core_main.py"},
                    "response_fields": {
                        "before": {"path": "バックアップ版ファイルパス", "content": "バックアップ時の内容", "ts": "バックアップ日時"},
                        "after": {"path": "現行版ファイルパス", "content": "現在の内容"},
                    },
                },
                "versions": {
                    "summary": "ファイルのバックアップ日時一覧",
                    "description": "指定ファイルがバックアップに出現する全日時を新しい順で返す。どの時点にバックアップが存在するか確認し、before_after の base_ts に使う。",
                    "parameters": {
                        "path": {"type": "string", "required": True, "description": "プロジェクトルート相対パス"},
                    },
                    "example_request": {"path": "backend_server/core_main.py"},
                    "response_fields": {"path": "対象ファイルパス", "versions": "バックアップ日時の配列（新しい順）", "count": "バックアップ件数"},
                },
                "changed": {
                    "summary": "期間内の変更ファイル一覧",
                    "description": "指定期間のバックアップに含まれる相対パス一覧を返す（= その期間に変更されたファイル）。作業セッションで変更したファイルの一覧を把握するのに使う。",
                    "parameters": {
                        "from_ts": {"type": "string", "required": True, "description": "'YYYYMMDD_HHMMSS' 形式の開始日時"},
                        "to_ts": {"type": "string", "required": False, "description": "'YYYYMMDD_HHMMSS' 形式の終了日時（省略時は現在）"},
                    },
                    "example_request": {"from_ts": "20260501_000000"},
                    "response_fields": {"from_ts": "開始日時", "to_ts": "終了日時", "files": "変更ファイルの相対パス配列", "count": "件数"},
                },
                "diff_stats": {
                    "summary": "ファイルの差分行数サマリ",
                    "description": "指定ファイルの before/after の追加・削除行数を軽量サマリで返す。変更規模の把握に使う。詳細な diff 内容は before_after で取得すること。",
                    "parameters": {
                        "path": {"type": "string", "required": True, "description": "プロジェクトルート相対パス"},
                        "base_ts": {"type": "string", "required": False, "description": "'YYYYMMDD_HHMMSS' 形式の基準日時"},
                    },
                    "example_request": {"path": "backend_server/core_main.py"},
                    "response_fields": {"path": "対象ファイルパス", "added": "追加行数", "deleted": "削除行数", "before_ts": "比較元バックアップ日時"},
                },
            },
        }

    @router.post("/aidiy_backup/save/{method_name}", summary="差分バックアップ実行")
    async def http_backup_save(
        method_name: str,
        req: Optional[BackupSaveRequest] = None,
    ) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | scan | 差分スキャンのみ（コピーなし） |
        | run | 差分バックアップ実行 |

        JSON body（任意）: {"project_root": "対象プロジェクトルート"} 省略時は AiDiy 自身。
        run の batch（真偽値、省略時 false）は返却にも付ける。true の件数・保存先は予定値。
        """
        req = req or BackupSaveRequest()
        saver = BackupSave(req.project_root) if req.project_root else bsave
        try:
            if method_name == "scan":
                result = await asyncio.to_thread(saver.diff_scan)
                logger.info(f"http_backup save/scan: count={result.get('count', result.get('バックアップ件数', 0))}")
                return result
            elif method_name == "run":
                result = await asyncio.to_thread(saver.run, batch=req.batch)
                logger.info(f"http_backup save/run: batch={req.batch}, count={result.get('count', result.get('バックアップ件数', 0))}")
                return result
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except BackupSaveError as e:
            logger.warning(f"http_backup save/{method_name} error: {e}")
            return {"error": str(e), **({"batch": req.batch} if method_name == "run" else {})}

    @router.post("/aidiy_backup/check/{method_name}", summary="バックアップ参照")
    async def http_backup_check(
        method_name: str,
        req: Optional[BackupCheckRequest] = None,
    ) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | info | バックアップルート情報 |
        | before_after | 現行版と直前バックアップ版を返す |
        | versions | ファイルのバックアップ日時一覧 |
        | changed | 期間内の変更ファイル一覧 |
        | diff_stats | before/after の差分行数サマリ |
        """
        req = req or BackupCheckRequest()
        try:
            if method_name == "info":
                result = await asyncio.to_thread(bchk.backup_root_path)
            elif method_name == "before_after":
                if not req.path:
                    return {"error": "path は必須です"}
                result = await asyncio.to_thread(bchk.get_before_after, req.path, req.base_ts)
            elif method_name == "versions":
                if not req.path:
                    return {"error": "path は必須です"}
                result = await asyncio.to_thread(bchk.list_versions, req.path)
            elif method_name == "changed":
                if not req.from_ts:
                    return {"error": "from_ts は必須です"}
                result = await asyncio.to_thread(bchk.find_changed, req.from_ts, req.to_ts)
            elif method_name == "diff_stats":
                if not req.path:
                    return {"error": "path は必須です"}
                result = await asyncio.to_thread(bchk.diff_stats, req.path, req.base_ts)
            else:
                return {"error": f"未知のメソッド: {method_name}"}
            return result if isinstance(result, dict) else {"result": result}
        except BackupCheckError as e:
            logger.warning(f"http_backup check/{method_name} error: {e}")
            return {"error": str(e)}

    return router
