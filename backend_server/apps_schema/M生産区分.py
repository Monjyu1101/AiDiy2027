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


class M生産区分Base(BaseModel):
    生産区分名: str
    生産区分備考: Optional[str] = None
    配色枠: str
    配色背景: str
    配色前景: str
    有効: bool = True


class M生産区分Create(M生産区分Base):
    生産区分ID: str


class M生産区分Update(BaseModel):
    生産区分ID: str
    生産区分名: Optional[str] = None
    生産区分備考: Optional[str] = None
    配色枠: str
    配色背景: str
    配色前景: str
    有効: Optional[bool] = None


class M生産区分Delete(BaseModel):
    生産区分ID: str


class M生産区分Get(BaseModel):
    生産区分ID: str


class M生産区分(M生産区分Base):
    生産区分ID: str
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
