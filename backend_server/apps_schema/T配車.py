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

# --- 配車 (T配車) ---

class T配車Base(BaseModel):
    配車開始日時: str
    配車終了日時: str
    配車区分ID: Optional[str] = None
    車両ID: str
    配車内容: Optional[str] = None
    配車備考: Optional[str] = None
    有効: bool = True


class T配車Create(T配車Base):
    配車伝票ID: Optional[str] = None  # 自動採番の場合は省略可能


class T配車Update(BaseModel):
    配車開始日時: Optional[str] = None
    配車終了日時: Optional[str] = None
    配車区分ID: Optional[str] = None
    車両ID: Optional[str] = None
    配車内容: Optional[str] = None
    配車備考: Optional[str] = None
    有効: Optional[bool] = None


class T配車Delete(BaseModel):
    配車伝票ID: str


class T配車Get(BaseModel):
    配車伝票ID: str


class T配車(T配車Base):
    配車伝票ID: str
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
