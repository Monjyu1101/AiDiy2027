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


def get_M取引先(db: Session, 取引先ID: str):
    """取引先IDで取引先を取得"""
    return db.query(models.M取引先).filter(models.M取引先.取引先ID == 取引先ID).first()


def get_M取引先一覧(db: Session):
    """全取引先を取得"""
    return db.query(models.M取引先).order_by(models.M取引先.取引先ID).all()


def create_M取引先(db: Session, 取引先: schemas.M取引先Create, 認証情報: Optional[Dict] = None):
    """取引先を作成"""
    audit = create_audit_fields(認証情報)

    db_取引先 = models.M取引先(
        取引先ID=取引先.取引先ID,
        取引先名=取引先.取引先名,
        取引先分類ID=取引先.取引先分類ID,
        取引先郵便番号=取引先.取引先郵便番号,
        取引先住所=取引先.取引先住所,
        取引先電話番号=取引先.取引先電話番号,
        取引先メールアドレス=取引先.取引先メールアドレス,
        取引先備考=取引先.取引先備考,
        有効=True,
        **audit
    )
    db.add(db_取引先)
    db.commit()
    db.refresh(db_取引先)
    return db_取引先


def init_M取引先_data(db: Session, 認証情報: Optional[Dict] = None):
    """M取引先の初期データを投入"""
    from log_config import get_logger
    if db.query(models.M取引先).first():
        return
    logger = get_logger(__name__)
    初期データ = [
        ('T101', 'サンプル得意先', '1', '673-0492', '兵庫県三木市上の丸町10番30号', '0794-82-2000', '', ''),
        ('T301', 'サンプル委託先', '3', '675-8501', '兵庫県加古川市加古川町北在家2000', '079-421-2000', '', ''),
        ('T501', 'サンプル仕入先', '5', '675-1380', '兵庫県小野市中島町531', '0794-63-1000', '', ''),
        ('T901', 'サンプル運送', '9', '650-8570', '兵庫県神戸市中央区加納町6丁目5番1号', '078-331-8181', '', ''),
    ]

    for 取引先ID, 取引先名, 取引先分類ID, 郵便番号, 住所, 電話番号, メールアドレス, 取引先備考 in 初期データ:
        create_M取引先(
            db,
            schemas.M取引先Create(
                取引先ID=取引先ID,
                取引先名=取引先名,
                取引先分類ID=取引先分類ID,
                取引先郵便番号=郵便番号,
                取引先住所=住所,
                取引先電話番号=電話番号,
                取引先メールアドレス=メールアドレス,
                取引先備考=取引先備考
            ),
            認証情報=認証情報
        )
    logger.info("Initialized M取引先")
