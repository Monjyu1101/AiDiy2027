# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import Column, Boolean, Text
from database import Base


class M生産工程(Base):
    """M生産工程テーブル（生産工程マスタ）"""
    __tablename__ = "M生産工程"
    __table_args__ = {'extend_existing': True}

    生産工程ID = Column(Text, primary_key=True)
    生産工程名 = Column(Text, nullable=False)
    生産工程備考 = Column(Text)
    有効 = Column(Boolean, nullable=False, default=True)
    登録日時 = Column(Text, nullable=False)
    登録利用者ID = Column(Text, nullable=False)
    登録利用者名 = Column(Text)
    登録端末ID = Column(Text, nullable=False)
    更新日時 = Column(Text, nullable=False)
    更新利用者ID = Column(Text, nullable=False)
    更新利用者名 = Column(Text)
    更新端末ID = Column(Text, nullable=False)
