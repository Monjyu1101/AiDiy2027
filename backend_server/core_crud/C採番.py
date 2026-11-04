# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy.orm import Session
from typing import Optional, Dict
import core_models as models
from core_crud.utils import create_audit_fields

def init_C採番_data(db: Session, 認証情報: Optional[Dict] = None):
    """C採番の初期データを投入"""
    from log_config import get_logger
    if db.query(models.C採番).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ("T配車", 10000, "配車の採番", True),
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
        db.add(models.C採番(
            採番ID=採番ID,
            最終採番値=最終採番値,
            採番備考=採番備考,
            有効=有効,
            **登録項目
        ))
    db.commit()
    logger.info("Initialized C採番")
