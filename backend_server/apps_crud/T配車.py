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
from apps_crud.utils import create_audit_fields, update_audit_fields
from apps_crud.日時検証 import 日時範囲検証
from log_config import get_logger
import datetime
import random

logger = get_logger(__name__)

def get_T配車(db: Session, 配車伝票ID: str):
    """配車伝票IDで配車データを取得"""
    return db.query(models.T配車).filter(models.T配車.配車伝票ID == 配車伝票ID).first()

def get_T配車一覧(db: Session):
    """全配車データを取得"""
    return db.query(models.T配車).order_by(models.T配車.配車開始日時.desc()).all()

def create_T配車(db: Session, 配車: schemas.T配車Create, 認証情報: Optional[Dict] = None):
    """配車データを作成（配車伝票IDは必須、ルーター側で採番済み）"""
    if not 配車.配車伝票ID:
        raise ValueError("配車伝票IDが指定されていません")

    日時範囲検証(配車.配車開始日時, 配車.配車終了日時)

    audit = create_audit_fields(認証情報)

    db_配車 = models.T配車(
        配車伝票ID=配車.配車伝票ID,
        配車開始日時=配車.配車開始日時,
        配車終了日時=配車.配車終了日時,
        配車区分ID=配車.配車区分ID,
        車両ID=配車.車両ID,
        配車内容=配車.配車内容,
        配車備考=配車.配車備考,
        有効=配車.有効,
        **audit
    )
    db.add(db_配車)
    db.commit()
    db.refresh(db_配車)
    return db_配車

def update_T配車(db: Session, 配車伝票ID: str, 配車: schemas.T配車Update, 認証情報: Optional[Dict] = None):
    """配車データを更新"""
    db_配車 = get_T配車(db, 配車伝票ID)
    if not db_配車:
        return None

    update_data = 配車.model_dump(exclude_unset=True)
    日時範囲検証(
        update_data.get("配車開始日時", db_配車.配車開始日時),
        update_data.get("配車終了日時", db_配車.配車終了日時),
    )
    audit = update_audit_fields(認証情報)

    for key, value in update_data.items():
        setattr(db_配車, key, value)

    for key, value in audit.items():
        setattr(db_配車, key, value)

    db.commit()
    db.refresh(db_配車)
    return db_配車

def delete_T配車(db: Session, 配車伝票ID: str, 認証情報: Optional[Dict] = None):
    """配車データを論理削除"""
    db_配車 = get_T配車(db, 配車伝票ID)
    if not db_配車:
        return False

    audit = update_audit_fields(認証情報)
    db_配車.有効 = False
    for key, value in audit.items():
        setattr(db_配車, key, value)
    db.commit()
    return True

def init_T配車_data(db: Session, 認証情報: Optional[Dict] = None):
    """T配車の初期データを作成"""
    if db.query(models.T配車).first():
        return  # 既にデータがある場合はスキップ

    # 初期データ用の日時取得
    audit = create_audit_fields(認証情報)

    now = datetime.datetime.now()
    today = now.date()

    # ランダムな開始日（今日から7日先まで）を8件作成
    start_dates = [today + datetime.timedelta(days=random.randint(0, 7)) for _ in range(8)]

    # 終了日は開始日に3〜7日足した日
    end_dates = [start + datetime.timedelta(days=random.randint(3, 7)) for start in start_dates]

    # 各日付に時刻を追加
    start_datetimes = [datetime.datetime.combine(d, datetime.time(8, 0)) for d in start_dates]
    end_datetimes = [datetime.datetime.combine(d, datetime.time(17, 0)) for d in end_dates]

    # 配車区分IDリスト：'1'〜'8'からランダムに8件
    配車区分IDs = [str(i) for i in range(1, 9)]
    配車区分IDs = random.choices(配車区分IDs, k=8)

    # 車両IDリスト：'1001'〜'1007'と'1099'をランダムシャッフル
    車両IDs = [f"100{i}" for i in range(1, 8)] + ['1099']
    random.shuffle(車両IDs)

    for i in range(8):
        伝票番号 = f"HS{str(i+1).zfill(8)}"  # HS00000001〜HS00000008
        start_dt = start_datetimes[i]
        end_dt = end_datetimes[i]
        category_id = 配車区分IDs[i]
        車両ID = 車両IDs[i]
        content = f"サンプルデータ{i+1}"
        remarks = ""

        # SQLAlchemyモデルでINSERT
        配車データ = models.T配車(
            配車伝票ID=伝票番号,
            配車開始日時=start_dt.isoformat(),
            配車終了日時=end_dt.isoformat(),
            配車区分ID=category_id,
            車両ID=車両ID,
            配車内容=content,
            配車備考=remarks,
            有効=True,
            **audit
        )
        db.add(配車データ)

    db.commit()
    logger.info("Initialized T配車")
