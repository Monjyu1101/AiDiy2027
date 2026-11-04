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

# --- 権限 (C権限) ---

class C権限Base(BaseModel):
    権限名: str
    権限備考: Optional[str] = None
    有効: bool = True


class C権限Create(C権限Base):
    権限ID: str


class C権限Update(BaseModel):
    権限ID: str
    権限名: Optional[str] = None
    権限備考: Optional[str] = None
    有効: Optional[bool] = None


class C権限Delete(BaseModel):
    権限ID: str


class C権限(C権限Base):
    権限ID: str
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
