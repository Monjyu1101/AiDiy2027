# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy.orm import Session
from apps_crud.M配車区分 import init_M配車区分_data
from apps_crud.M生産区分 import init_M生産区分_data
from apps_crud.M生産工程 import init_M生産工程_data
from apps_crud.M商品分類 import init_M商品分類_data
from apps_crud.M取引先分類 import init_M取引先分類_data
from apps_crud.M取引先 import init_M取引先_data
from apps_crud.M車両 import init_M車両_data
from apps_crud.M商品 import init_M商品_data
from apps_crud.M商品構成 import init_M商品構成_data
from apps_crud.T配車 import init_T配車_data
from apps_crud.T生産 import init_T生産_data
from apps_crud.T商品出庫 import init_T商品出庫_data
from apps_crud.T商品棚卸 import init_T商品棚卸_data
from apps_crud.T商品入庫 import init_T商品入庫_data


def init_db_data(db: Session):
    """現行スキーマの apps 系テーブルへ初期データを投入する。"""
    初期認証情報 = {"利用者ID": "system", "利用者名": "system", "端末ID": "localhost"}

    # 各モジュールの初期データ投入
    init_M配車区分_data(db, 認証情報=初期認証情報)
    init_M生産区分_data(db, 認証情報=初期認証情報)
    init_M生産工程_data(db, 認証情報=初期認証情報)
    init_M商品分類_data(db, 認証情報=初期認証情報)
    init_M取引先分類_data(db, 認証情報=初期認証情報)
    init_M取引先_data(db, 認証情報=初期認証情報)
    init_M車両_data(db, 認証情報=初期認証情報)
    init_M商品_data(db, 認証情報=初期認証情報)
    init_M商品構成_data(db, 認証情報=初期認証情報)
    init_T配車_data(db)
    init_T生産_data(db)
    init_T商品出庫_data(db)
    init_T商品棚卸_data(db)
    init_T商品入庫_data(db)
