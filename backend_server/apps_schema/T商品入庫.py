# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from pydantic import BaseModel, Field
from typing import Optional, List

# --- 商品入庫 (T商品入庫) ---

class T商品入庫明細Base(BaseModel):
    明細SEQ: int
    商品ID: str
    入庫数量: int
    明細備考: Optional[str] = None


class T商品入庫明細(T商品入庫明細Base):
    商品名: Optional[str] = None
    単位: Optional[str] = None


class T商品入庫Base(BaseModel):
    入庫日: str
    入庫備考: Optional[str] = None
    有効: bool = True
    明細一覧: List[T商品入庫明細Base] = Field(default_factory=list)


class T商品入庫Create(T商品入庫Base):
    入庫伝票ID: Optional[str] = None  # 自動採番の場合は省略可能


class T商品入庫Update(BaseModel):
    入庫日: Optional[str] = None
    入庫備考: Optional[str] = None
    有効: Optional[bool] = None
    明細一覧: Optional[List[T商品入庫明細Base]] = None


class T商品入庫Delete(BaseModel):
    入庫伝票ID: str


class T商品入庫Get(BaseModel):
    入庫伝票ID: str


class T商品入庫(T商品入庫Base):
    入庫伝票ID: str
    入庫商品件数: int = 0
    合計入庫数量: int = 0
    明細一覧: List[T商品入庫明細] = Field(default_factory=list)
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
