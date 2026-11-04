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


class M取引先(Base):
    """M取引先テーブル（取引先マスタ）"""
    __tablename__ = "M取引先"
    __table_args__ = {'extend_existing': True}

    取引先ID = Column(Text, primary_key=True)
    取引先名 = Column(Text, nullable=False)
    取引先分類ID = Column(Text, nullable=False)
    取引先郵便番号 = Column(Text)
    取引先住所 = Column(Text)
    取引先電話番号 = Column(Text)
    取引先メールアドレス = Column(Text)
    取引先備考 = Column(Text)
    有効 = Column(Boolean, nullable=False, default=True)
    登録日時 = Column(Text, nullable=False)
    登録利用者ID = Column(Text, nullable=False)
    登録利用者名 = Column(Text)
    登録端末ID = Column(Text, nullable=False)
    更新日時 = Column(Text, nullable=False)
    更新利用者ID = Column(Text, nullable=False)
    更新利用者名 = Column(Text)
    更新端末ID = Column(Text, nullable=False)
