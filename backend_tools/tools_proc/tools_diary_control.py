# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""日誌のMCP / REST。本人のBearerだけをローカルApps APIに中継する。"""
import json
import re
from collections.abc import Mapping

import httpx
from fastapi import APIRouter, HTTPException, Request
from mcp.server.mcpserver import Context
from pydantic import BaseModel, ConfigDict
from starlette.responses import JSONResponse

NAME = "aidiy_dialy_control"
TOKEN_ENV = "AIDIY_DIARY_AUTHORIZATION"
DESCRIPTION = (
    "AiDiy 日誌。通常の利用者ログインのBearer認証が必要。利用者本人の日誌のみ操作する。"
    "変更・削除の直前に日誌日付・作業ID・行番号を確認する。作業IDは固定。明細削除時は後続の行番号が詰まる。"
)
_OPERATIONS = {
    "diary_search": "検索",
    "diary_work_create": "作業登録",
    "diary_work_update": "作業変更",
    "diary_work_delete": "作業削除",
    "diary_content_create": "内容登録",
    "diary_content_update": "内容変更",
    "diary_content_delete": "内容削除",
}
_JWT = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


class 日誌添付(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    ファイル名: str
    base64内容: str


def bearer(headers: Mapping[str, str] | None) -> str:
    if headers is None:
        return ""
    values = headers.getlist("authorization") if hasattr(headers, "getlist") else [headers.get("authorization", "")]
    if len(values) != 1:
        return ""
    scheme, _, token = values[0].partition(" ")
    return f"Bearer {token}" if scheme.lower() == "bearer" and len(token) <= 16384 and _JWT.fullmatch(token) else ""


def _error(code: str, message: str) -> dict:
    return {"status": "NG", "message": message, "error": {"code": code}}


async def _call(method: str, payload: dict, authorization: str) -> tuple[int, dict]:
    if not authorization:
        return 401, _error("AUTH_REQUIRED", "日誌の利用にはAiDiyの通常ログインのBearerトークンが必要です。")
    if method == "diary_work_update" and "自己申告を解除" in payload:
        payload = dict(payload)
        解除 = payload.pop("自己申告を解除")
        if type(解除) is not bool or (解除 and payload.get("新規更新ファイル数") is not None):
            return 422, _error("VALIDATION_ERROR", "自己申告の解除には true／false を指定し、件数と同時に指定しないでください。")
        if 解除:
            payload["新規更新ファイル数"] = None
    if method == "diary_work_update" and "作業時間を解除" in payload:
        payload = dict(payload)
        解除 = payload.pop("作業時間を解除")
        if type(解除) is not bool or (解除 and payload.get("作業時間") is not None):
            return 422, _error("VALIDATION_ERROR", "作業時間の解除には true／false を指定し、作業時間と同時に指定しないでください。")
        if 解除:
            payload["作業時間"] = None
    try:
        async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=30) as client:
            response = await client.post(f"http://127.0.0.1:8098/apps/T日誌/{_OPERATIONS[method]}",
                                         json=payload, headers={"Authorization": authorization})
        if response.status_code in (401, 403):
            return response.status_code, _error("AUTH_REQUIRED", "日誌を操作できません。AiDiyの有効な利用者でログインしてください。")
        if response.status_code == 404:
            return 503, _error("APPS_UNAVAILABLE", "日誌APIが見つかりません。Appsを更新して再起動してください。")
        if response.status_code in (200, 413, 422):
            body = response.json()
            if isinstance(body, dict) and body.get("status") in {"OK", "NG"}:
                return response.status_code, body
    except (httpx.RequestError, ValueError):
        pass
    return 503, _error("APPS_UNAVAILABLE", "Appsの日誌APIに接続できないか、応答を確認できません。登録・変更・削除を再実行する前に検索してください。")


def register_tools(mcp):
    async def run(method: str, ctx: Context, **payload) -> dict:
        _, result = await _call(method, payload, bearer(ctx.headers))
        return result

    @mcp.tool()
    async def diary_search(
        ctx: Context, 開始日付: str | None = None, 終了日付: str | None = None,
        キーワード: str = "", limit: int = 5, offset: int = 0,
    ) -> dict:
        """本人の日誌を日付範囲、プロジェクトのフォルダパス、タイトル、本文、添付名で検索する。日付はYYYY-MM-DD。本文は先頭1000文字。添付データは返さない。"""
        return await run("diary_search", ctx, 開始日付=開始日付, 終了日付=終了日付, キーワード=キーワード,
                         limit=limit, offset=offset)

    @mcp.tool()
    async def diary_work_create(
        ctx: Context, 日誌日付: str, 作業タイトル: str,
        新規更新ファイル数: int | None = None, プロジェクト: str = "", 作業時間: float | None = None,
    ) -> dict:
        """指定日に作業を追加してC採番で発行した固定の作業IDを返す。その日の日誌がなければ同時に1件だけ作る。作業時間は時間単位の0〜99.99。"""
        return await run("diary_work_create", ctx, 日誌日付=日誌日付, 作業タイトル=作業タイトル,
                         作業時間=作業時間, 新規更新ファイル数=新規更新ファイル数, プロジェクト=プロジェクト)

    @mcp.tool()
    async def diary_work_update(
        ctx: Context, 日誌日付: str, 作業ID: int, 作業タイトル: str,
        新規更新ファイル数: int | None = None, 自己申告を解除: bool = False,
        プロジェクト: str | None = None, 作業時間: float | None = None, 作業時間を解除: bool = False,
    ) -> dict:
        """作業タイトルを変更する。プロジェクトは省略で維持、空文字で解除。自己申告件数は省略で維持、自己申告を解除=true で解除。作業時間は省略で維持、作業時間を解除=true で解除。"""
        任意項目 = {"新規更新ファイル数": 新規更新ファイル数} if 新規更新ファイル数 is not None else {}
        if 作業時間 is not None:
            任意項目["作業時間"] = 作業時間
        if プロジェクト is not None:
            任意項目["プロジェクト"] = プロジェクト
        return await run("diary_work_update", ctx, 日誌日付=日誌日付, 作業ID=作業ID, 作業タイトル=作業タイトル,
                         自己申告を解除=自己申告を解除, 作業時間を解除=作業時間を解除, **任意項目)

    @mcp.tool()
    async def diary_work_delete(ctx: Context, 日誌日付: str, 作業ID: int) -> dict:
        """指定した作業と配下の全明細を削除する。最後の作業ならその日の日誌もなくなる。必ず削除対象を確認してから呼び、後続の操作前に再検索する。"""
        return await run("diary_work_delete", ctx, 日誌日付=日誌日付, 作業ID=作業ID)

    @mcp.tool()
    async def diary_content_create(
        ctx: Context, 日誌日付: str, 作業ID: int, 作業内容: str = "",
        添付: list[日誌添付] | None = None,
    ) -> dict:
        """指定した作業に明細を1行追加して行番号を返す。本文または添付が必要。複数ファイルは添付にファイル名・base64内容の組を並べて指定する。"""
        return await run("diary_content_create", ctx, 日誌日付=日誌日付, 作業ID=作業ID,
                         作業内容=作業内容,
                         添付=[file.model_dump() for file in 添付] if 添付 is not None else None)

    @mcp.tool()
    async def diary_content_update(
        ctx: Context, 日誌日付: str, 作業ID: int, 行番号: int, 作業内容: str | None = None,
        添付: list[日誌添付] | None = None,
    ) -> dict:
        """指定した明細1行を変更する。省略した項目は維持し、添付一覧指定で置換し、空配列で全添付を外す。"""
        return await run("diary_content_update", ctx, 日誌日付=日誌日付, 作業ID=作業ID, 行番号=行番号,
                         作業内容=作業内容,
                         添付=[file.model_dump() for file in 添付] if 添付 is not None else None)

    @mcp.tool()
    async def diary_content_delete(ctx: Context, 日誌日付: str, 作業ID: int, 行番号: int) -> dict:
        """指定した明細とその添付だけを削除する。必ず削除対象を確認し、後続の操作前に再検索する。"""
        return await run("diary_content_delete", ctx, 日誌日付=日誌日付, 作業ID=作業ID, 行番号=行番号)


def create_router() -> APIRouter:
    router = APIRouter(prefix=f"/{NAME}", tags=[NAME])

    @router.post("/{method_name}")
    async def diary_rest(method_name: str, request: Request):
        if method_name not in _OPERATIONS:
            raise HTTPException(404)
        authorization = bearer(request.headers)
        if not authorization:
            status, result = await _call(method_name, {}, "")
            return JSONResponse(result, status_code=status)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 21 * 1024 * 1024:
                return JSONResponse(_error("PAYLOAD_TOO_LARGE", "日誌ツールの送信上限（21 MiB）を超えています。"), status_code=413)
            body.extend(chunk)
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, RecursionError):
            return JSONResponse(_error("VALIDATION_ERROR", "JSONオブジェクトを指定してください。"), status_code=422)
        status, result = await _call(method_name, payload, authorization)
        return JSONResponse(result, status_code=status)

    return router
