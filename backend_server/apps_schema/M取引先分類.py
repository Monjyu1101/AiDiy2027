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


class M取引先分類Base(BaseModel):
    取引先分類名: str
    取引先分類備考: Optional[str] = None
    有効: bool = True


class M取引先分類Create(M取引先分類Base):
    取引先分類ID: str


class M取引先分類Update(BaseModel):
    取引先分類ID: str
    取引先分類名: Optional[str] = None
    取引先分類備考: Optional[str] = None
    有効: Optional[bool] = None


class M取引先分類Delete(BaseModel):
    取引先分類ID: str


class M取引先分類Get(BaseModel):
    取引先分類ID: str


class M取引先分類(M取引先分類Base):
    取引先分類ID: str
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
