# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from typing import Literal
from .フォルダ状態 import フォルダ状態取得
import os
import base64
from internal_auth import is_internal_credential_path
from internal_api_auth import authenticate, Principal
from internal_file_access import resolve_session_file
import core_schema as schemas
import deps
import core_models as models


router = APIRouter(prefix="/core/files", tags=["files"])


class ファイル内容取得Request(BaseModel):
    ファイル名: str
    セッションID: str | None = None


class ファイル内容更新Request(BaseModel):
    ファイル名: str
    セッションID: str | None = None
    内容: str


def _解決ファイルパス(ファイル名: str) -> str:
    if os.path.isabs(ファイル名):
        return os.path.normpath(ファイル名)

    バックエンドディレクトリ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.normpath(os.path.join(バックエンドディレクトリ, ファイル名))


def _ファイル認証(http_request: Request):
    principal, _ = authenticate(http_request, http_request.method, http_request.url.path)
    return principal


def _認証済みファイルパス(request, principal):
    if principal.kind != "internal":
        return _解決ファイルパス(request.ファイル名.strip())
    # 内部資格情報は通常利用者の汎用ファイル権限へ昇格させない。
    from AIコア.AIセッション管理 import AIセッション管理
    return resolve_session_file(AIセッション管理, request.セッションID, principal,
                                request.ファイル名.strip())


@router.post("/内容取得", response_model=schemas.ResponseBase)
def get_ファイル内容(
    request: ファイル内容取得Request,
    現在利用者: Principal = Depends(_ファイル認証),
):
    ファイル名 = (request.ファイル名 or "").strip()
    if not ファイル名:
        return schemas.ResponseBase(
            status="NG",
            message="ファイル名を指定してください",
            error={"code": "INVALID_FILE_NAME"},
        )

    解決パス = _認証済みファイルパス(request, 現在利用者)
    if is_internal_credential_path(解決パス):
        raise HTTPException(status_code=403, detail="内部認証情報にはアクセスできません")
    if not os.path.isfile(解決パス):
        return schemas.ResponseBase(
            status="NG",
            message="指定されたファイルが見つかりません",
            error={"code": "FILE_NOT_FOUND", "file_path": 解決パス},
        )

    try:
        with open(解決パス, "rb") as f:
            バイナリ = f.read()
        base64_data = base64.b64encode(バイナリ).decode("ascii")
    except Exception as e:
        return schemas.ResponseBase(
            status="NG",
            message=f"ファイルの読み込みに失敗しました: {str(e)}",
            error={"code": "FILE_READ_ERROR", "file_path": 解決パス},
        )

    return schemas.ResponseBase(
        status="OK",
        message="ファイル内容を取得しました",
        data={
            "ファイル名": ファイル名,
            "解決ファイルパス": 解決パス,
            "base64_data": base64_data,
        },
    )


@router.post("/内容更新", response_model=schemas.ResponseBase)
def update_ファイル内容(
    request: ファイル内容更新Request,
    現在利用者: Principal = Depends(_ファイル認証),
):
    ファイル名 = (request.ファイル名 or "").strip()
    if not ファイル名:
        return schemas.ResponseBase(
            status="NG",
            message="ファイル名を指定してください",
            error={"code": "INVALID_FILE_NAME"},
        )

    解決パス = _認証済みファイルパス(request, 現在利用者)
    if is_internal_credential_path(解決パス):
        raise HTTPException(status_code=403, detail="内部認証情報にはアクセスできません")
    if not os.path.isfile(解決パス):
        return schemas.ResponseBase(
            status="NG",
            message="指定されたファイルが見つかりません",
            error={"code": "FILE_NOT_FOUND", "file_path": 解決パス},
        )

    ext = os.path.splitext(解決パス)[1].lower()
    if ext in (".bat", ".cmd"):
        encoding = "shift_jis"
        newline = "\r\n"
    else:
        encoding = "utf-8"
        newline = "\n"

    try:
        with open(解決パス, "w", encoding=encoding, newline=newline) as f:
            f.write(request.内容)
    except Exception as e:
        return schemas.ResponseBase(
            status="NG",
            message=f"ファイルの書き込みに失敗しました: {str(e)}",
            error={"code": "FILE_WRITE_ERROR", "file_path": 解決パス},
        )

    return schemas.ResponseBase(
        status="OK",
        message="ファイル内容を更新しました",
        data={"ファイル名": ファイル名, "解決ファイルパス": 解決パス},
    )


class フォルダ状態Request(BaseModel):
    フォルダ: str = ""
    フィルター: Literal["", "backup"] = "backup"


@router.post("/フォルダ状態", response_model=schemas.ResponseBase)
def get_フォルダ状態(request: フォルダ状態Request, http_request: Request,
                 現在利用者: models.C利用者 = Depends(deps.get_現在利用者)):
    # 利用者指定の絶対ルートは受け付けず、サーバーが設定したCode作業ルート内に限定する。
    conf = getattr(http_request.app, "conf", None)
    settings = getattr(conf, "json", None)
    root = _解決ファイルパス(getattr(settings, "CODE_BASE_PATH", "../") or "../")
    try:
        data = フォルダ状態取得(root, request.フォルダ, request.フィルター)
    except BlockingIOError:
        raise HTTPException(status_code=429, detail="フォルダを確認中です", headers={"Retry-After": "2"})
    except (ValueError, OSError):
        raise HTTPException(status_code=404, detail="参照できるフォルダが見つかりません")
    return schemas.ResponseBase(status="OK", message="フォルダ状態を取得しました", data=data)
