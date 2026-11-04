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

# --- 車両 (M車両) ---

class M車両Base(BaseModel):
    車両名: str
    車両備考: Optional[str] = None
    有効: bool = True


class M車両Create(M車両Base):
    車両ID: str


class M車両Update(BaseModel):
    車両ID: str
    車両名: Optional[str] = None
    車両備考: Optional[str] = None
    有効: Optional[bool] = None


class M車両Delete(BaseModel):
    車両ID: str


class M車両Get(BaseModel):
    車両ID: str


class M車両(M車両Base):
    車両ID: str
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
