# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

import bcrypt
from sqlalchemy.orm import Session
from typing import Optional, Dict
import core_models as models, core_schema as schemas
from core_crud.utils import create_audit_fields


def _is_bcrypt_hash(value: str) -> bool:
    return isinstance(value, str) and value.startswith("$2")


def hash_パスワード(パスワード: str) -> str:
    return bcrypt.hashpw(パスワード.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_パスワード(入力パスワード: str, 保存パスワード: str) -> bool:
    if 保存パスワード == 入力パスワード:
        return True
    if _is_bcrypt_hash(保存パスワード):
        try:
            return bcrypt.checkpw(入力パスワード.encode("utf-8"), 保存パスワード.encode("utf-8"))
        except ValueError:
            return False
    return False

def init_C利用者_data(db: Session, 認証情報: Optional[Dict] = None):
    """C利用者の初期データを投入"""
    from log_config import get_logger
    if get_C利用者_by_利用者ID(db, "admin"):
        return
    logger = get_logger(__name__)
    初期データ = [
        ('admin', 'Administrator', '********', '1', 'システム管理者', True),
        ('leader', '管理者', 'secret', '2', '管理者', True),
        ('user', '利用者', 'user', '3', '利用者', True),
        ('guest', '閲覧者', 'guest', '4', '閲覧者', True),
        ('other', 'その他', 'other', '9', 'その他', True),
        ('test', 'テスト', 'test', '3', 'テスト用', False),
    ]
    for 利用者ID, 利用者名, パスワード, 権限ID, 利用者備考, 有効 in 初期データ:
        create_C利用者(
            db,
            schemas.C利用者Create(
                利用者ID=利用者ID, 利用者名=利用者名, パスワード=パスワード,
                権限ID=権限ID, 利用者備考=利用者備考, 有効=有効,
            ),
            認証情報=認証情報,
            hash_password=False,
        )
    logger.info("Initialized C利用者")

def get_C利用者_by_利用者ID(db: Session, 利用者ID: str):
    """利用者IDで利用者を取得"""
    return db.query(models.C利用者).filter(models.C利用者.利用者ID == 利用者ID).first()

def get_C利用者_by_利用者名(db: Session, 利用者名: str):
    """利用者名で利用者を取得"""
    return db.query(models.C利用者).filter(models.C利用者.利用者名 == 利用者名).first()

def create_C利用者(
    db: Session,
    利用者情報: schemas.C利用者Create,
    認証情報: Optional[Dict] = None,
    hash_password: bool = True,
):
    """利用者を作成"""
    audit = create_audit_fields(認証情報)
    保存パスワード = hash_パスワード(利用者情報.パスワード) if hash_password else 利用者情報.パスワード

    db_利用者 = models.C利用者(
        利用者ID=利用者情報.利用者ID,
        利用者名=利用者情報.利用者名,
        パスワード=保存パスワード,
        権限ID=利用者情報.権限ID,
        利用者備考=利用者情報.利用者備考,
        有効=利用者情報.有効,
        **audit
    )
    db.add(db_利用者)
    db.commit()
    db.refresh(db_利用者)
    return db_利用者

def authenticate_C利用者(db: Session, 利用者ID: str, パスワード: str):
    """利用者認証"""
    利用者 = get_C利用者_by_利用者ID(db, 利用者ID)
    if not 利用者:
        return None
    if not verify_パスワード(パスワード, 利用者.パスワード):
        return None
    return 利用者
