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
from apps_crud.seed_data import INITIAL_PRODUCT_IDS
from log_config import get_logger
import datetime
import random

logger = get_logger(__name__)


def get_T商品棚卸(db: Session, 棚卸伝票ID: str):
    """棚卸伝票IDで全行（ヘッダ+明細）を取得"""
    return (
        db.query(models.T商品棚卸)
        .filter(models.T商品棚卸.棚卸伝票ID == 棚卸伝票ID)
        .order_by(models.T商品棚卸.明細SEQ)
        .all()
    )


def get_T商品棚卸ヘッダ(db: Session, 棚卸伝票ID: str):
    """ヘッダ行（明細SEQ=0）のみ取得"""
    return (
        db.query(models.T商品棚卸)
        .filter(models.T商品棚卸.棚卸伝票ID == 棚卸伝票ID, models.T商品棚卸.明細SEQ == 0)
        .first()
    )


def get_T商品棚卸一覧(db: Session):
    """全棚卸伝票のヘッダ行を取得"""
    return (
        db.query(models.T商品棚卸)
        .filter(models.T商品棚卸.明細SEQ == 0)
        .order_by(models.T商品棚卸.棚卸日.desc())
        .all()
    )


def get_T商品棚卸明細一覧(db: Session, 棚卸伝票ID: str):
    """明細行（明細SEQ>0）を取得"""
    return (
        db.query(models.T商品棚卸)
        .filter(models.T商品棚卸.棚卸伝票ID == 棚卸伝票ID, models.T商品棚卸.明細SEQ > 0)
        .order_by(models.T商品棚卸.明細SEQ)
        .all()
    )


def _build_明細一覧(db: Session, 明細行一覧):
    if not 明細行一覧:
        return []

    商品ID一覧 = list({item.商品ID for item in 明細行一覧 if item.商品ID})
    商品マップ = {}
    if 商品ID一覧:
        商品マップ = {
            item.商品ID: item
            for item in db.query(models.M商品).filter(models.M商品.商品ID.in_(商品ID一覧)).all()
        }

    result = []
    for item in 明細行一覧:
        商品 = 商品マップ.get(item.商品ID)
        result.append({
            "明細SEQ": item.明細SEQ,
            "商品ID": item.商品ID,
            "商品名": 商品.商品名 if 商品 else None,
            "単位": 商品.単位 if 商品 else None,
            "実棚数量": int(item.実棚数量 or 0),
            "明細備考": item.棚卸備考,
        })

    return result


def build_T商品棚卸_data(db: Session, 行一覧):
    """レスポンス用の商品棚卸データを組み立てる"""
    if not 行一覧:
        return None

    見出し = next((item for item in 行一覧 if item.明細SEQ == 0), 行一覧[0])
    明細行一覧 = [item for item in 行一覧 if item.明細SEQ > 0]
    明細一覧 = _build_明細一覧(db, 明細行一覧)

    return {
        "棚卸伝票ID": 見出し.棚卸伝票ID,
        "棚卸日": 見出し.棚卸日,
        "棚卸備考": 見出し.棚卸備考,
        "有効": bool(見出し.有効),
        "棚卸商品件数": len(明細一覧),
        "合計実棚数量": sum(item["実棚数量"] for item in 明細一覧),
        "明細一覧": 明細一覧,
        "登録日時": 見出し.登録日時,
        "登録利用者ID": 見出し.登録利用者ID,
        "登録利用者名": 見出し.登録利用者名,
        "登録端末ID": 見出し.登録端末ID,
        "更新日時": 見出し.更新日時,
        "更新利用者ID": 見出し.更新利用者ID,
        "更新利用者名": 見出し.更新利用者名,
        "更新端末ID": 見出し.更新端末ID,
    }


def _create_行一覧(
    db: Session,
    棚卸伝票ID: str,
    棚卸日: str,
    棚卸備考,
    有効: bool,
    明細一覧: list,
    監査項目: Dict,
):
    db.add(models.T商品棚卸(
        棚卸伝票ID=棚卸伝票ID,
        明細SEQ=0,
        棚卸日=棚卸日,
        商品ID=None,
        実棚数量=None,
        棚卸備考=棚卸備考,
        有効=有効,
        **監査項目,
    ))

    for 明細 in 明細一覧:
        db.add(models.T商品棚卸(
            棚卸伝票ID=棚卸伝票ID,
            明細SEQ=明細.明細SEQ,
            棚卸日=棚卸日,
            商品ID=明細.商品ID,
            実棚数量=明細.実棚数量,
            棚卸備考=明細.明細備考,
            有効=有効,
            **監査項目,
        ))


def create_T商品棚卸(db: Session, 商品棚卸: schemas.T商品棚卸Create, 認証情報: Optional[Dict] = None):
    """商品棚卸データを作成（棚卸伝票IDは必須、ルーター側で採番済み）"""
    if not 商品棚卸.棚卸伝票ID:
        raise ValueError("棚卸伝票IDが指定されていません")

    audit = create_audit_fields(認証情報)
    _create_行一覧(
        db,
        商品棚卸.棚卸伝票ID,
        商品棚卸.棚卸日,
        商品棚卸.棚卸備考,
        商品棚卸.有効,
        商品棚卸.明細一覧,
        audit,
    )
    db.commit()
    return get_T商品棚卸(db, 商品棚卸.棚卸伝票ID)


def update_T商品棚卸(db: Session, 棚卸伝票ID: str, 商品棚卸: schemas.T商品棚卸Update, 認証情報: Optional[Dict] = None):
    """商品棚卸データを更新（全行削除・再作成）"""
    既存一覧 = get_T商品棚卸(db, 棚卸伝票ID)
    if not 既存一覧:
        return None

    見出し = next((item for item in 既存一覧 if item.明細SEQ == 0), 既存一覧[0])
    棚卸日 = 商品棚卸.棚卸日 if 商品棚卸.棚卸日 is not None else 見出し.棚卸日
    棚卸備考 = 商品棚卸.棚卸備考 if 商品棚卸.棚卸備考 is not None else 見出し.棚卸備考
    有効 = 商品棚卸.有効 if 商品棚卸.有効 is not None else 見出し.有効
    明細一覧 = 商品棚卸.明細一覧 if 商品棚卸.明細一覧 is not None else [
        schemas.T商品棚卸明細Base(
            明細SEQ=item.明細SEQ,
            商品ID=item.商品ID,
            実棚数量=item.実棚数量,
            明細備考=item.棚卸備考,
        )
        for item in 既存一覧
        if item.明細SEQ > 0 and item.商品ID and item.実棚数量 is not None
    ]

    監査項目 = {
        "登録日時": 見出し.登録日時,
        "登録利用者ID": 見出し.登録利用者ID,
        "登録利用者名": 見出し.登録利用者名,
        "登録端末ID": 見出し.登録端末ID,
        **update_audit_fields(認証情報),
    }

    db.query(models.T商品棚卸).filter(models.T商品棚卸.棚卸伝票ID == 棚卸伝票ID).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()
    _create_行一覧(db, 棚卸伝票ID, 棚卸日, 棚卸備考, 有効, 明細一覧, 監査項目)
    db.commit()
    return get_T商品棚卸(db, 棚卸伝票ID)


def delete_T商品棚卸(db: Session, 棚卸伝票ID: str, 認証情報: Optional[Dict] = None):
    """商品棚卸データを論理削除（全行）"""
    全行 = get_T商品棚卸(db, 棚卸伝票ID)
    if not 全行:
        return False

    audit = update_audit_fields(認証情報)
    for item in 全行:
        item.有効 = False
        for key, value in audit.items():
            setattr(item, key, value)
    db.commit()
    return True


def init_T商品棚卸_data(db: Session, 認証情報: Optional[Dict] = None):
    """T商品棚卸の初期データを明細付きで作成"""
    if db.query(models.T商品棚卸).filter(models.T商品棚卸.明細SEQ == 0).first():
        return

    audit = create_audit_fields(認証情報)
    today = datetime.datetime.now().date()
    rng = random.Random(20260405)

    z商品ID一覧 = [商品ID for 商品ID in INITIAL_PRODUCT_IDS if str(商品ID).startswith("Z")]
    a_to_d商品ID一覧 = [商品ID for 商品ID in ["A001", "B001", "C001", "D001"] if 商品ID in INITIAL_PRODUCT_IDS]

    伝票一覧 = [
        {
            "棚卸伝票ID": "HT00000001",
            "棚卸日": today.isoformat(),
            "棚卸備考": "初回棚卸",
            "商品ID一覧": z商品ID一覧,
            "最小値": 300,
            "最大値": 10000,
        },
        {
            "棚卸伝票ID": "HT00000002",
            "棚卸日": (today + datetime.timedelta(days=1)).isoformat(),
            "棚卸備考": "翌日棚卸",
            "商品ID一覧": a_to_d商品ID一覧,
            "最小値": 1000,
            "最大値": 5000,
        },
    ]

    for 伝票 in 伝票一覧:
        db.add(models.T商品棚卸(
            棚卸伝票ID=伝票["棚卸伝票ID"],
            明細SEQ=0,
            棚卸日=伝票["棚卸日"],
            商品ID=None,
            実棚数量=None,
            棚卸備考=伝票["棚卸備考"],
            有効=True,
            **audit,
        ))

        for 明細SEQ, 商品ID in enumerate(伝票["商品ID一覧"], start=1):
            db.add(models.T商品棚卸(
                棚卸伝票ID=伝票["棚卸伝票ID"],
                明細SEQ=明細SEQ,
                棚卸日=伝票["棚卸日"],
                商品ID=商品ID,
                実棚数量=rng.randint(伝票["最小値"], 伝票["最大値"]),
                棚卸備考=None,
                有効=True,
                **audit,
            ))

    db.commit()
    logger.info("Initialized T商品棚卸 with detail rows")
