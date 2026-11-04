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

def get_M配車区分(db: Session, 配車区分ID: str):
    """配車区分IDで配車区分を取得"""
    return db.query(models.M配車区分).filter(models.M配車区分.配車区分ID == 配車区分ID).first()

def get_M配車区分一覧(db: Session):
    """全配車区分を取得"""
    return db.query(models.M配車区分).order_by(models.M配車区分.配車区分ID).all()

def create_M配車区分(db: Session, 配車区分: schemas.M配車区分Create, 認証情報: Optional[Dict] = None):
    """配車区分を作成"""
    audit = create_audit_fields(認証情報)

    db_配車区分 = models.M配車区分(
        配車区分ID=配車区分.配車区分ID,
        配車区分名=配車区分.配車区分名,
        配車区分備考=配車区分.配車区分備考,
        配色枠=配車区分.配色枠,
        配色背景=配車区分.配色背景,
        配色前景=配車区分.配色前景,
        有効=True,
        **audit
    )
    db.add(db_配車区分)
    db.commit()
    db.refresh(db_配車区分)
    return db_配車区分


def init_M配車区分_data(db: Session, 認証情報: Optional[Dict] = None):
    """M配車区分の初期データを投入"""
    from log_config import get_logger
    if db.query(models.M配車区分).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('1', '通常', '青', '#001f3f', '#cce6ff', '#000000'),
        ('2', '定期', '緑', '#003300', '#ccffcc', '#000000'),
        ('3', '予備', '黄', '#4d3300', '#ffffcc', '#000000'),
        ('4', '緊急', '赤', '#660000', '#ffcccc', '#000000'),
        ('5', '特別', '紫', '#330044', '#e6ccff', '#000000'),
        ('6', '巡回', '水', '#004444', '#ccffff', '#000000'),
        ('7', '回送', '黒', '#000000', '#e6e6e6', '#000000'),
        ('8', '予備', '灰', '#1a1a1a', '#f0f0f0', '#000000'),
    ]
    for 配車区分ID, 配車区分名, 配車区分備考, 配色枠, 配色背景, 配色前景 in 初期データ:
        create_M配車区分(db, schemas.M配車区分Create(
            配車区分ID=配車区分ID, 配車区分名=配車区分名, 配車区分備考=配車区分備考,
            配色枠=配色枠, 配色背景=配色背景, 配色前景=配色前景,
        ), 認証情報=認証情報)
    logger.info("Initialized M配車区分")
