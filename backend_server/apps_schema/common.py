# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from pydantic import BaseModel
from typing import Optional, Any

# --- 共通レスポンス ---

class ResponseBase(BaseModel):
    status: str = "OK"
    message: str
    data: Optional[Any] = None
    error: Optional[dict] = None


class ErrorResponse(BaseModel):
    status: str = "NG"
    message: str
    error: Optional[dict] = None

# --- 共通リクエスト ---

class ListRequest(BaseModel):
    件数制限: Optional[bool] = True
    無効も表示: Optional[bool] = False
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None
    商品ID: Optional[str] = None
    商品分類ID: Optional[str] = None
    取引先分類ID: Optional[str] = None
    生産区分ID: Optional[str] = None
