# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy.orm import Session
from core_crud.C権限 import init_C権限_data
from core_crud.C利用者 import init_C利用者_data
from core_crud.C採番 import init_C採番_data

def init_db_data(db: Session):
    """現行スキーマの core 系テーブルへ初期データを投入する。"""
    初期認証情報 = {"利用者ID": "system", "利用者名": "system", "端末ID": "localhost"}

    init_C権限_data(db, 認証情報=初期認証情報)
    init_C利用者_data(db, 認証情報=初期認証情報)
    init_C採番_data(db, 認証情報=初期認証情報)
