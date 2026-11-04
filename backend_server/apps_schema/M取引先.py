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


# --- 取引先 (M取引先) ---

class M取引先Base(BaseModel):
    取引先名: str
    取引先分類ID: str
    取引先郵便番号: Optional[str] = None
    取引先住所: Optional[str] = None
    取引先電話番号: Optional[str] = None
    取引先メールアドレス: Optional[str] = None
    取引先備考: Optional[str] = None
    有効: bool = True


class M取引先Create(M取引先Base):
    取引先ID: str


class M取引先Update(BaseModel):
    取引先ID: str
    取引先名: Optional[str] = None
    取引先分類ID: Optional[str] = None
    取引先郵便番号: Optional[str] = None
    取引先住所: Optional[str] = None
    取引先電話番号: Optional[str] = None
    取引先メールアドレス: Optional[str] = None
    取引先備考: Optional[str] = None
    有効: Optional[bool] = None


class M取引先Delete(BaseModel):
    取引先ID: str


class M取引先Get(BaseModel):
    取引先ID: str


class M取引先(M取引先Base):
    取引先ID: str
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
