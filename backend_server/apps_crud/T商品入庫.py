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
from datetime import timedelta
import random

logger = get_logger(__name__)


def get_T商品入庫(db: Session, 入庫伝票ID: str):
    """入庫伝票IDで全行（ヘッダ+明細）を取得"""
    return (
        db.query(models.T商品入庫)
        .filter(models.T商品入庫.入庫伝票ID == 入庫伝票ID)
        .order_by(models.T商品入庫.明細SEQ)
        .all()
    )


def get_T商品入庫ヘッダ(db: Session, 入庫伝票ID: str):
    """ヘッダ行（明細SEQ=0）のみ取得"""
    return (
        db.query(models.T商品入庫)
        .filter(models.T商品入庫.入庫伝票ID == 入庫伝票ID, models.T商品入庫.明細SEQ == 0)
        .first()
    )


def get_T商品入庫一覧(db: Session):
    """全入庫伝票のヘッダ行を取得"""
    return (
        db.query(models.T商品入庫)
        .filter(models.T商品入庫.明細SEQ == 0)
        .order_by(models.T商品入庫.入庫日.desc())
        .all()
    )


def get_T商品入庫明細一覧(db: Session, 入庫伝票ID: str):
    """明細行（明細SEQ>0）を取得"""
    return (
        db.query(models.T商品入庫)
        .filter(models.T商品入庫.入庫伝票ID == 入庫伝票ID, models.T商品入庫.明細SEQ > 0)
        .order_by(models.T商品入庫.明細SEQ)
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
            "入庫数量": int(item.入庫数量 or 0),
            "明細備考": item.入庫備考,
        })

    return result


def build_T商品入庫_data(db: Session, 行一覧):
    """レスポンス用の商品入庫データを組み立てる"""
    if not 行一覧:
        return None

    見出し = next((item for item in 行一覧 if item.明細SEQ == 0), 行一覧[0])
    明細行一覧 = [item for item in 行一覧 if item.明細SEQ > 0]
    明細一覧 = _build_明細一覧(db, 明細行一覧)

    return {
        "入庫伝票ID": 見出し.入庫伝票ID,
        "入庫日": 見出し.入庫日,
        "入庫備考": 見出し.入庫備考,
        "有効": bool(見出し.有効),
        "入庫商品件数": len(明細一覧),
        "合計入庫数量": sum(item["入庫数量"] for item in 明細一覧),
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
    入庫伝票ID: str,
    入庫日: str,
    入庫備考,
    有効: bool,
    明細一覧: list,
    監査項目: Dict,
):
    db.add(models.T商品入庫(
        入庫伝票ID=入庫伝票ID,
        明細SEQ=0,
        入庫日=入庫日,
        商品ID=None,
        入庫数量=None,
        入庫備考=入庫備考,
        有効=有効,
        **監査項目,
    ))

    for 明細 in 明細一覧:
        db.add(models.T商品入庫(
            入庫伝票ID=入庫伝票ID,
            明細SEQ=明細.明細SEQ,
            入庫日=入庫日,
            商品ID=明細.商品ID,
            入庫数量=明細.入庫数量,
            入庫備考=明細.明細備考,
            有効=有効,
            **監査項目,
        ))


def create_T商品入庫(db: Session, 商品入庫: schemas.T商品入庫Create, 認証情報: Optional[Dict] = None):
    """商品入庫データを作成（入庫伝票IDは必須、ルーター側で採番済み）"""
    if not 商品入庫.入庫伝票ID:
        raise ValueError("入庫伝票IDが指定されていません")

    audit = create_audit_fields(認証情報)

    _create_行一覧(
        db,
        商品入庫.入庫伝票ID,
        商品入庫.入庫日,
        商品入庫.入庫備考,
        商品入庫.有効,
        商品入庫.明細一覧,
        audit,
    )
    db.commit()
    return get_T商品入庫(db, 商品入庫.入庫伝票ID)


def update_T商品入庫(db: Session, 入庫伝票ID: str, 商品入庫: schemas.T商品入庫Update, 認証情報: Optional[Dict] = None):
    """商品入庫データを更新（全行削除・再作成）"""
    既存一覧 = get_T商品入庫(db, 入庫伝票ID)
    if not 既存一覧:
        return None

    見出し = next((item for item in 既存一覧 if item.明細SEQ == 0), 既存一覧[0])

    入庫日 = 商品入庫.入庫日 if 商品入庫.入庫日 is not None else 見出し.入庫日
    入庫備考 = 商品入庫.入庫備考 if 商品入庫.入庫備考 is not None else 見出し.入庫備考
    有効 = 商品入庫.有効 if 商品入庫.有効 is not None else 見出し.有効
    明細一覧 = 商品入庫.明細一覧 if 商品入庫.明細一覧 is not None else [
        schemas.T商品入庫明細Base(
            明細SEQ=item.明細SEQ,
            商品ID=item.商品ID,
            入庫数量=item.入庫数量,
            明細備考=item.入庫備考,
        )
        for item in 既存一覧
        if item.明細SEQ > 0 and item.商品ID and item.入庫数量 is not None
    ]

    監査項目 = {
        "登録日時": 見出し.登録日時,
        "登録利用者ID": 見出し.登録利用者ID,
        "登録利用者名": 見出し.登録利用者名,
        "登録端末ID": 見出し.登録端末ID,
        **update_audit_fields(認証情報),
    }

    db.query(models.T商品入庫).filter(models.T商品入庫.入庫伝票ID == 入庫伝票ID).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()
    _create_行一覧(db, 入庫伝票ID, 入庫日, 入庫備考, 有効, 明細一覧, 監査項目)
    db.commit()
    return get_T商品入庫(db, 入庫伝票ID)


def delete_T商品入庫(db: Session, 入庫伝票ID: str, 認証情報: Optional[Dict] = None):
    """T商品入庫を論理削除（全行）"""
    全行 = get_T商品入庫(db, 入庫伝票ID)
    if not 全行:
        return False

    audit = update_audit_fields(認証情報)
    for item in 全行:
        item.有効 = False
        for key, value in audit.items():
            setattr(item, key, value)
    db.commit()
    return True


def init_T商品入庫_data(db: Session, 認証情報: Optional[Dict] = None):
    """T商品入庫の初期データを明細付きで作成"""
    if db.query(models.T商品入庫).filter(models.T商品入庫.明細SEQ == 0).first():
        return

    audit = create_audit_fields(認証情報)
    now = datetime.datetime.now()
    today = now.date()

    rng = random.Random(20260403)
    商品ID一覧 = [商品ID for 商品ID in INITIAL_PRODUCT_IDS if str(商品ID).startswith("Z")]
    rng.shuffle(商品ID一覧)

    ticket_groups = [商品ID一覧[i:i + 3] for i in range(0, len(商品ID一覧), 3)]
    ticket_groups = [group for group in ticket_groups if group][:6]
    入庫日一覧 = sorted(today + timedelta(days=rng.randint(2, 5)) for _ in ticket_groups)

    for i, (商品グループ, 入庫日) in enumerate(zip(ticket_groups, 入庫日一覧), start=1):
        伝票番号 = f"HI{str(i).zfill(8)}"
        備考 = f"サンプル入庫{i}" if len(商品グループ) > 1 else ""

        db.add(models.T商品入庫(
            入庫伝票ID=伝票番号,
            明細SEQ=0,
            入庫日=入庫日.isoformat(),
            商品ID=None,
            入庫数量=None,
            入庫備考=備考,
            有効=True,
            **audit,
        ))

        for 明細SEQ, 商品ID in enumerate(商品グループ, start=1):
            db.add(models.T商品入庫(
                入庫伝票ID=伝票番号,
                明細SEQ=明細SEQ,
                入庫日=入庫日.isoformat(),
                商品ID=商品ID,
                入庫数量=rng.choice([100, 200, 300, 400, 500]),
                入庫備考=None,
                有効=True,
                **audit,
            ))

    db.commit()
    logger.info("Initialized T商品入庫 with detail rows")
