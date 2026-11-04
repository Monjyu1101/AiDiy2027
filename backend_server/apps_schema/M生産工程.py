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


class M生産工程Base(BaseModel):
    生産工程名: str
    生産工程備考: Optional[str] = None
    有効: bool = True


class M生産工程Create(M生産工程Base):
    生産工程ID: str


class M生産工程Update(BaseModel):
    生産工程ID: str
    生産工程名: Optional[str] = None
    生産工程備考: Optional[str] = None
    有効: Optional[bool] = None


class M生産工程Delete(BaseModel):
    生産工程ID: str


class M生産工程Get(BaseModel):
    生産工程ID: str


class M生産工程(M生産工程Base):
    生産工程ID: str
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
