# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
import database
from typing import Optional, Dict
import core_models as models
from core_crud.utils import create_audit_fields, update_audit_fields

def init_C採番_data(db: Session, 認証情報: Optional[Dict] = None):
    """C採番の初期データを投入"""
    from log_config import get_logger
    logger = get_logger(__name__)
    初期データ = [
        ("T配車", 10000, "配車の採番", True),
        ("T日誌作業", 10000, "日誌作業の採番", True),
        ("T生産", 10000, "生産の採番", True),
        ("T商品棚卸", 10000, "商品棚卸の採番", True),
        ("T商品入庫", 10000, "商品入庫の採番", True),
        ("T商品出庫", 10000, "商品出庫の採番", True),
        ("Aタスク要求", 1000, "AIタスク要求の採番（TK）", True),
        ("Aチーム依頼", 1000, "AIチーム依頼の採番（TR）", True),
        ("Aチーム会話", 1000, "AIチーム会話の採番（TC）", True),
        ("Xテスト", 10000, "テスト用の採番", False),
    ]
    登録項目 = create_audit_fields(認証情報)
    for 採番ID, 最終採番値, 採番備考, 有効 in 初期データ:
        db.execute(insert(models.C採番).values(
            採番ID=採番ID,
            最終採番値=最終採番値,
            採番備考=採番備考,
            有効=有効,
            **登録項目
        ).on_conflict_do_nothing(index_elements=[models.C採番.採番ID]))
    db.commit()
    logger.info("Initialized C採番")


def 次の採番値(採番ID: str, 利用者) -> int | None:
    """AppsとのDB境界を越えないよう、Coreで原子的に払い出してから伝票を保存する。"""
    認証情報 = {"利用者ID": 利用者.利用者ID, "利用者名": 利用者.利用者名}
    採番 = models.C採番
    with database.SessionLocal.begin() as db:
        return db.scalar(update(採番).where(
            採番.採番ID == 採番ID, 採番.有効.is_(True),
        ).values(最終採番値=採番.最終採番値 + 1, **update_audit_fields(認証情報)).returning(採番.最終採番値))
