# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import Column, Boolean, Text, Float, Integer
from database import Base


class M商品構成(Base):
    __tablename__ = "M商品構成"

    商品ID = Column(Text, primary_key=True)
    明細SEQ = Column(Integer, primary_key=True)
    最小ロット数量 = Column(Float, nullable=False)
    生産区分ID = Column(Text, nullable=False)
    生産工程ID = Column(Text, nullable=False)
    段取分数 = Column(Integer)
    時間生産数量 = Column(Float)
    商品構成備考 = Column(Text)
    構成商品ID = Column(Text)
    計算分子数量 = Column(Float)
    計算分母数量 = Column(Float)
    最小ロット構成数量 = Column(Float)
    構成商品備考 = Column(Text)
    有効 = Column(Boolean, nullable=False, default=True)
    登録日時 = Column(Text, nullable=False)
    登録利用者ID = Column(Text, nullable=False)
    登録利用者名 = Column(Text)
    登録端末ID = Column(Text, nullable=False)
    更新日時 = Column(Text, nullable=False)
    更新利用者ID = Column(Text, nullable=False)
    更新利用者名 = Column(Text)
    更新端末ID = Column(Text, nullable=False)
