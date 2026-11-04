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

# --- 商品出庫 (T商品出庫) ---

class T商品出庫明細Base(BaseModel):
    明細SEQ: int
    商品ID: str
    出庫数量: int
    明細備考: Optional[str] = None


class T商品出庫明細(T商品出庫明細Base):
    商品名: Optional[str] = None
    単位: Optional[str] = None


class T商品出庫Base(BaseModel):
    出庫日: str
    出庫備考: Optional[str] = None
    有効: bool = True
    明細一覧: List[T商品出庫明細Base] = Field(default_factory=list)


class T商品出庫Create(T商品出庫Base):
    出庫伝票ID: Optional[str] = None  # 自動採番の場合は省略可能


class T商品出庫Update(BaseModel):
    出庫日: Optional[str] = None
    出庫備考: Optional[str] = None
    有効: Optional[bool] = None
    明細一覧: Optional[List[T商品出庫明細Base]] = None


class T商品出庫Delete(BaseModel):
    出庫伝票ID: str


class T商品出庫Get(BaseModel):
    出庫伝票ID: str


class T商品出庫(T商品出庫Base):
    出庫伝票ID: str
    出庫商品件数: int = 0
    合計出庫数量: int = 0
    明細一覧: List[T商品出庫明細] = Field(default_factory=list)
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
