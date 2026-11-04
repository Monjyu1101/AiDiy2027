# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from pydantic import BaseModel
from typing import Optional

# --- 商品 (M商品) ---

class M商品Base(BaseModel):
    商品名: str
    単位: str
    商品分類ID: str
    商品備考: Optional[str] = None
    有効: bool = True


class M商品Create(M商品Base):
    商品ID: str


class M商品Update(BaseModel):
    商品ID: str
    商品名: Optional[str] = None
    単位: Optional[str] = None
    商品分類ID: Optional[str] = None
    商品備考: Optional[str] = None
    有効: Optional[bool] = None


class M商品Delete(BaseModel):
    商品ID: str


class M商品Get(BaseModel):
    商品ID: str


class M商品(M商品Base):
    商品ID: str
    有効: bool
    登録日時: str
    登録利用者ID: str
    登録利用者名: Optional[str]
    登録端末ID: str
    更新日時: str
    更新利用者ID: str
    更新利用者名: Optional[str]
    更新端末ID: str

    class Config:
        from_attributes = True
