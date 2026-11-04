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


def get_M商品分類(db: Session, 商品分類ID: str):
    """商品分類IDで商品分類を取得"""
    return db.query(models.M商品分類).filter(models.M商品分類.商品分類ID == 商品分類ID).first()


def get_M商品分類一覧(db: Session):
    """全商品分類を取得"""
    return db.query(models.M商品分類).order_by(models.M商品分類.商品分類ID).all()


def create_M商品分類(db: Session, 商品分類: schemas.M商品分類Create, 認証情報: Optional[Dict] = None):
    """商品分類を作成"""
    audit = create_audit_fields(認証情報)

    db_商品分類 = models.M商品分類(
        商品分類ID=商品分類.商品分類ID,
        商品分類名=商品分類.商品分類名,
        商品分類備考=商品分類.商品分類備考,
        有効=True,
        **audit
    )
    db.add(db_商品分類)
    db.commit()
    db.refresh(db_商品分類)
    return db_商品分類


def init_M商品分類_data(db: Session, 認証情報: Optional[Dict] = None):
    """M商品分類の初期データを投入"""
    from log_config import get_logger
    if db.query(models.M商品分類).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('A', '牛飼料系', ''),
        ('B', '豚飼料系', ''),
        ('C', '鶏飼料系', ''),
        ('D', '魚飼料系', ''),
        ('G', 'その他系', ''),
        ('Z', '原材料他', ''),
    ]
    for 商品分類ID, 商品分類名, 商品分類備考 in 初期データ:
        create_M商品分類(
            db,
            schemas.M商品分類Create(
                商品分類ID=商品分類ID,
                商品分類名=商品分類名,
                商品分類備考=商品分類備考
            ),
            認証情報=認証情報
        )
    logger.info("Initialized M商品分類")
