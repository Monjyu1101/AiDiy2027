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


# --- V生産一覧リクエスト ---

class V生産ListRequest(BaseModel):
    件数制限: Optional[bool] = True
    無効も表示: Optional[bool] = False
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None
    生産区分ID: Optional[str] = None
    生産工程ID: Optional[str] = None
    受入商品ID: Optional[str] = None


# --- T生産払出一覧リクエスト ---

class T生産払出ListRequest(BaseModel):
    件数制限: Optional[bool] = True
    無効も表示: Optional[bool] = False
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None
    生産区分ID: Optional[str] = None
    生産工程ID: Optional[str] = None
    払出商品ID: Optional[str] = None


# --- 生産明細 (T生産明細) ---

class T生産明細Base(BaseModel):
    明細SEQ: int
    払出商品ID: str
    計算分子数量: float
    計算分母数量: float
    最小ロット構成数量: Optional[float] = None
    構成商品備考: Optional[str] = None
    払出数量: Optional[float] = None
    所要数量備考: Optional[str] = None


class T生産明細(T生産明細Base):
    払出商品名: Optional[str] = None
    構成単位: Optional[str] = None
    最小ロット構成数量: float = 0.0


# --- 生産 (T生産) ---

class T生産Base(BaseModel):
    受入商品ID: str
    最小ロット数量: float
    受入数量: Optional[float] = None
    生産区分ID: Optional[str] = None
    生産工程ID: str
    段取分数: Optional[int] = None
    時間生産数量: Optional[float] = None
    生産時間: Optional[float] = None
    生産開始日時: str
    生産終了日時: str
    生産内容: Optional[str] = None
    生産備考: Optional[str] = None
    有効: bool = True
    明細一覧: List[T生産明細Base] = Field(default_factory=list)


class T生産Create(T生産Base):
    生産伝票ID: Optional[str] = None  # 自動採番の場合は省略可能


class T生産Update(BaseModel):
    受入商品ID: Optional[str] = None  # 変更時は省略可能
    最小ロット数量: Optional[float] = None  # 変更時は省略可能
    受入数量: Optional[float] = None
    生産区分ID: Optional[str] = None
    生産工程ID: Optional[str] = None
    段取分数: Optional[int] = None
    時間生産数量: Optional[float] = None
    生産時間: Optional[float] = None
    生産開始日時: Optional[str] = None
    生産終了日時: Optional[str] = None
    生産内容: Optional[str] = None
    生産備考: Optional[str] = None
    有効: Optional[bool] = None
    明細一覧: Optional[List[T生産明細Base]] = None


class T生産Delete(BaseModel):
    生産伝票ID: str


class T生産Get(BaseModel):
    生産伝票ID: str


class T生産(T生産Base):
    生産伝票ID: str
    受入商品名: Optional[str] = None
    単位: Optional[str] = None
    生産区分名: Optional[str] = None
    生産工程名: Optional[str] = None
    明細一覧: List[T生産明細] = Field(default_factory=list)
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
