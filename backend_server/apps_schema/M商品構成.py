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


class M商品構成明細Base(BaseModel):
    明細SEQ: int
    構成商品ID: str
    計算分子数量: float
    計算分母数量: float
    最小ロット構成数量: Optional[float] = None
    構成商品備考: Optional[str] = None


class M商品構成明細(M商品構成明細Base):
    構成商品名: Optional[str] = None
    構成単位: Optional[str] = None
    最小ロット構成数量: float = 0


class M商品構成Base(BaseModel):
    最小ロット数量: float
    生産区分ID: str
    生産工程ID: str
    段取分数: Optional[int] = None
    時間生産数量: Optional[float] = None
    商品構成備考: Optional[str] = None
    有効: bool = True
    明細一覧: List[M商品構成明細Base] = Field(default_factory=list)


class M商品構成Create(M商品構成Base):
    商品ID: str


class M商品構成Update(BaseModel):
    商品ID: str
    最小ロット数量: Optional[float] = None
    生産区分ID: Optional[str] = None
    生産工程ID: Optional[str] = None
    段取分数: Optional[int] = None
    時間生産数量: Optional[float] = None
    商品構成備考: Optional[str] = None
    有効: Optional[bool] = None
    明細一覧: Optional[List[M商品構成明細Base]] = None


class M商品構成Delete(BaseModel):
    商品ID: str


class M商品構成Get(BaseModel):
    商品ID: str


class M商品構成(M商品構成Base):
    商品ID: str
    商品名: Optional[str] = None
    単位: Optional[str] = None
    生産区分名: Optional[str] = None
    生産工程名: Optional[str] = None
    明細一覧: List[M商品構成明細] = Field(default_factory=list)
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
