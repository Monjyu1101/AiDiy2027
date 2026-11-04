# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import Boolean, Column, Integer, Text
from database import Base

class T商品入庫(Base):
    """T商品入庫テーブル（商品入庫伝票トランザクション、明細付き）
    明細SEQ=0: ヘッダ行（伝票日付・伝票備考）
    明細SEQ>0: 明細行（商品・数量）
    """
    __tablename__ = "T商品入庫"
    __table_args__ = {'extend_existing': True}

    入庫伝票ID = Column(Text, primary_key=True)
    明細SEQ = Column(Integer, primary_key=True)
    入庫日 = Column(Text, nullable=False)
    商品ID = Column(Text)
    入庫数量 = Column(Integer)
    入庫備考 = Column(Text)
    有効 = Column(Boolean, nullable=False, default=True)
    登録日時 = Column(Text, nullable=False)
    登録利用者ID = Column(Text, nullable=False)
    登録利用者名 = Column(Text)
    登録端末ID = Column(Text, nullable=False)
    更新日時 = Column(Text, nullable=False)
    更新利用者ID = Column(Text, nullable=False)
    更新利用者名 = Column(Text)
    更新端末ID = Column(Text, nullable=False)
