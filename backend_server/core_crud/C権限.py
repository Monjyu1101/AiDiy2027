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
import core_models as models, core_schema as schemas
from core_crud.utils import create_audit_fields

def init_C権限_data(db: Session, 認証情報: Optional[Dict] = None):
    """C権限の初期データを投入"""
    from log_config import get_logger
    if db.query(models.C権限).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('1', 'システム管理者', '', True),
        ('2', '管理者', '', True),
        ('3', '利用者', '', True),
        ('4', '閲覧者', '', True),
        ('5', '予備', '', False),
        ('9', 'その他', '', True),
    ]
    for 権限ID, 権限名, 権限備考, 有効 in 初期データ:
        create_C権限(
            db,
            schemas.C権限Create(権限ID=権限ID, 権限名=権限名, 権限備考=権限備考, 有効=有効),
            認証情報=認証情報,
        )
    logger.info("Initialized C権限")

def get_C権限(db: Session, 権限ID: str):
    """権限IDで権限を取得"""
    return db.query(models.C権限).filter(models.C権限.権限ID == 権限ID).first()

def get_C権限一覧(db: Session):
    """全権限を取得"""
    return db.query(models.C権限).order_by(models.C権限.権限ID).all()

def create_C権限(db: Session, 権限: schemas.C権限Create, 認証情報: Optional[Dict] = None):
    """権限を作成"""
    audit = create_audit_fields(認証情報)

    db_権限 = models.C権限(
        権限ID=権限.権限ID,
        権限名=権限.権限名,
        権限備考=権限.権限備考,
        有効=権限.有効,
        **audit
    )
    db.add(db_権限)
    db.commit()
    db.refresh(db_権限)
    return db_権限
