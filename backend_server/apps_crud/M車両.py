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

def get_M車両(db: Session, 車両ID: str):
    """車両IDで車両を取得"""
    return db.query(models.M車両).filter(models.M車両.車両ID == 車両ID).first()

def get_M車両一覧(db: Session):
    """全車両を取得"""
    return db.query(models.M車両).order_by(models.M車両.車両ID).all()

def create_M車両(db: Session, 車両: schemas.M車両Create, 認証情報: Optional[Dict] = None):
    """車両を作成"""
    audit = create_audit_fields(認証情報)

    db_車両 = models.M車両(
        車両ID=車両.車両ID,
        車両名=車両.車両名,
        車両備考=車両.車両備考,
        有効=True,
        **audit
    )
    db.add(db_車両)
    db.commit()
    db.refresh(db_車両)
    return db_車両


def init_M車両_data(db: Session, 認証情報: Optional[Dict] = None):
    """M車両の初期データを投入"""
    from log_config import get_logger
    if db.query(models.M車両).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('1001', '１号車', '近藤'),
        ('1002', '２号車', '藤原'),
        ('1003', '３号車', '津村'),
        ('1004', '４号車', '鈴木'),
        ('1005', '５号車', '高松'),
        ('1006', '６号車', '藤井'),
        ('1007', '７号車', '山田'),
        ('1099', '未定', ''),
    ]
    for 車両ID, 車両名, 車両備考 in 初期データ:
        create_M車両(db, schemas.M車両Create(車両ID=車両ID, 車両名=車両名, 車両備考=車両備考), 認証情報=認証情報)
    logger.info("Initialized M車両")
