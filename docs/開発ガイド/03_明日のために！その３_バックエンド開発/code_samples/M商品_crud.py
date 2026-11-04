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
import apps_models as models, apps_schema as schemas
from apps_crud.utils import create_audit_fields

def get_M商品(db: Session, 商品ID: str):
    """商品IDで商品を取得"""
    return db.query(models.M商品).filter(models.M商品.商品ID == 商品ID).first()

def get_M商品一覧(db: Session):
    """全商品を取得"""
    return db.query(models.M商品).order_by(models.M商品.商品ID).all()

def create_M商品(db: Session, 商品: schemas.M商品Create, 認証情報: Optional[Dict] = None):
    """商品を作成"""
    audit = create_audit_fields(認証情報)

    db_商品 = models.M商品(
        商品ID=商品.商品ID,
        商品名=商品.商品名,
        単位=商品.単位,
        商品分類ID=商品.商品分類ID,
        商品備考=商品.商品備考,
        有効=True,
        **audit
    )
    db.add(db_商品)
    db.commit()
    db.refresh(db_商品)
    return db_商品


def init_M商品_data(db: Session, 認証情報: Optional[Dict] = None):
    """M商品の初期データを投入"""
    from log_config import get_logger
    from apps_crud.seed_data import INITIAL_PRODUCTS
    if db.query(models.M商品).first():
        return
    logger = get_logger(__name__)
    for 商品ID, 商品名, 単位, 商品備考 in INITIAL_PRODUCTS:
        create_M商品(
            db,
            schemas.M商品Create(
                商品ID=商品ID,
                商品名=商品名,
                単位=単位,
                商品分類ID=商品ID[:1],
                商品備考=商品備考
            ),
            認証情報=認証情報
        )
    logger.info("Initialized M商品")
