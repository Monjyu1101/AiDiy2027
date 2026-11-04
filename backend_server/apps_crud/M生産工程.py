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


def get_M生産工程(db: Session, 生産工程ID: str):
    """生産工程IDで生産工程を取得"""
    return db.query(models.M生産工程).filter(models.M生産工程.生産工程ID == 生産工程ID).first()


def get_M生産工程一覧(db: Session):
    """全生産工程を取得"""
    return db.query(models.M生産工程).order_by(models.M生産工程.生産工程ID).all()


def create_M生産工程(db: Session, 工程: schemas.M生産工程Create, 認証情報: Optional[Dict] = None):
    """生産工程を作成"""
    audit = create_audit_fields(認証情報)

    db_工程 = models.M生産工程(
        生産工程ID=工程.生産工程ID,
        生産工程名=工程.生産工程名,
        生産工程備考=工程.生産工程備考,
        有効=True,
        **audit
    )
    db.add(db_工程)
    db.commit()
    db.refresh(db_工程)
    return db_工程


def init_M生産工程_data(db: Session, 認証情報: Optional[Dict] = None):
    """M生産工程の初期データを投入"""
    from log_config import get_logger
    if db.query(models.M生産工程).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('L01', 'ライン１', ''),
        ('L02', 'ライン２', ''),
        ('L03', 'ライン３', ''),
        ('L04', 'ライン４', ''),
        ('L05', 'ライン５', ''),
        ('L06', 'ライン６', ''),
        ('L07', 'ライン７', ''),
        ('L99', '未定', ''),
    ]
    for 生産工程ID, 生産工程名, 生産工程備考 in 初期データ:
        create_M生産工程(db, schemas.M生産工程Create(生産工程ID=生産工程ID, 生産工程名=生産工程名, 生産工程備考=生産工程備考), 認証情報=認証情報)
    logger.info("Initialized M生産工程")
