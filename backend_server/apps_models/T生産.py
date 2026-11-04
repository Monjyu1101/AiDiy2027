# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import Boolean, Column, Text, Float, Integer
from database import Base

class T生産(Base):
    """T生産テーブル（生産伝票トランザクション、明細付き）
    明細SEQ=0: ヘッダ行（生産スケジュール・商品・ロット情報）
    明細SEQ>0: 明細行（構成明細・所要量明細）
    """
    __tablename__ = "T生産"
    __table_args__ = {'extend_existing': True}

    生産伝票ID = Column(Text, primary_key=True)
    明細SEQ = Column(Integer, primary_key=True)

    # ヘッダ項目（明細SEQ=0 のみ有効）
    生産開始日時 = Column(Text)
    生産終了日時 = Column(Text)
    生産内容 = Column(Text)
    生産備考 = Column(Text)

    # ヘッダ・明細共通（全行に格納）
    受入商品ID = Column(Text)
    最小ロット数量 = Column(Float)
    受入数量 = Column(Float)
    生産区分ID = Column(Text)
    生産工程ID = Column(Text)
    段取分数 = Column(Integer)
    時間生産数量 = Column(Float)
    生産時間 = Column(Float)

    # 明細項目（明細SEQ>0 のみ有効）
    払出商品ID = Column(Text)
    計算分子数量 = Column(Float)
    計算分母数量 = Column(Float)
    最小ロット構成数量 = Column(Float)
    構成商品備考 = Column(Text)
    払出数量 = Column(Float)
    所要数量備考 = Column(Text)

    有効 = Column(Boolean, nullable=False, default=True)
    登録日時 = Column(Text, nullable=False)
    登録利用者ID = Column(Text, nullable=False)
    登録利用者名 = Column(Text)
    登録端末ID = Column(Text, nullable=False)
    更新日時 = Column(Text, nullable=False)
    更新利用者ID = Column(Text, nullable=False)
    更新利用者名 = Column(Text)
    更新端末ID = Column(Text, nullable=False)
