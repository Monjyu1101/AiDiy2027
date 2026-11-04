# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from typing import Optional, Dict

from sqlalchemy.orm import Session

import apps_models as models
import apps_schema as schemas
from apps_crud.utils import create_audit_fields, update_audit_fields


def get_M商品構成(db: Session, 商品ID: str):
    """商品IDで商品構成を取得"""
    return (
        db.query(models.M商品構成)
        .filter(models.M商品構成.商品ID == 商品ID)
        .order_by(models.M商品構成.明細SEQ)
        .all()
    )


def get_M商品構成一覧(db: Session):
    """全商品構成を取得"""
    return (
        db.query(models.M商品構成.商品ID)
        .distinct()
        .order_by(models.M商品構成.商品ID)
        .all()
    )


def get_M商品構成明細一覧(db: Session, 商品ID: str):
    """指定商品の構成明細を取得"""
    return (
        db.query(models.M商品構成)
        .filter(models.M商品構成.商品ID == 商品ID, models.M商品構成.明細SEQ > 0)
        .order_by(models.M商品構成.明細SEQ)
        .all()
    )


def _build_明細一覧(db: Session, 明細一覧):
    明細行一覧 = [item for item in 明細一覧 if item.明細SEQ > 0]
    if not 明細行一覧:
        return []

    構成商品ID一覧 = list({item.構成商品ID for item in 明細行一覧 if item.構成商品ID})
    商品マップ = {
        item.商品ID: item
        for item in db.query(models.M商品).filter(models.M商品.商品ID.in_(構成商品ID一覧)).all()
    }

    result = []
    for item in 明細行一覧:
        構成商品 = 商品マップ.get(item.構成商品ID)
        result.append({
            "明細SEQ": item.明細SEQ,
            "構成商品ID": item.構成商品ID,
            "構成商品名": 構成商品.商品名 if 構成商品 else None,
            "計算分子数量": float(item.計算分子数量),
            "計算分母数量": float(item.計算分母数量),
            "最小ロット構成数量": float(item.最小ロット構成数量) if item.最小ロット構成数量 is not None else None,
            "構成単位": 構成商品.単位 if 構成商品 else None,
            "構成商品備考": item.構成商品備考,
        })

    return result


def build_M商品構成_data(db: Session, 商品構成一覧):
    """レスポンス用の商品構成データを組み立てる"""
    if not 商品構成一覧:
        return None

    見出し = next((item for item in 商品構成一覧 if item.明細SEQ == 0), 商品構成一覧[0])
    商品 = db.query(models.M商品).filter(models.M商品.商品ID == 見出し.商品ID).first()
    生産区分 = db.query(models.M生産区分).filter(models.M生産区分.生産区分ID == 見出し.生産区分ID).first()
    工程 = db.query(models.M生産工程).filter(models.M生産工程.生産工程ID == 見出し.生産工程ID).first()

    return {
        "商品ID": 見出し.商品ID,
        "商品名": 商品.商品名 if 商品 else None,
        "単位": 商品.単位 if 商品 else None,
        "最小ロット数量": float(見出し.最小ロット数量),
        "生産区分ID": 見出し.生産区分ID,
        "生産区分名": 生産区分.生産区分名 if 生産区分 else None,
        "生産工程ID": 見出し.生産工程ID,
        "生産工程名": 工程.生産工程名 if 工程 else None,
        "段取分数": int(見出し.段取分数) if 見出し.段取分数 is not None else None,
        "時間生産数量": float(見出し.時間生産数量) if 見出し.時間生産数量 is not None else None,
        "商品構成備考": 見出し.商品構成備考,
        "有効": bool(見出し.有効),
        "明細一覧": _build_明細一覧(db, 商品構成一覧),
        "登録日時": 見出し.登録日時,
        "登録利用者ID": 見出し.登録利用者ID,
        "登録利用者名": 見出し.登録利用者名,
        "登録端末ID": 見出し.登録端末ID,
        "更新日時": 見出し.更新日時,
        "更新利用者ID": 見出し.更新利用者ID,
        "更新利用者名": 見出し.更新利用者名,
        "更新端末ID": 見出し.更新端末ID,
    }


def _create_レコード一覧(
    db: Session,
    商品ID: str,
    最小ロット数量: float,
    生産区分ID: str,
    生産工程ID: str,
    段取分数: Optional[int],
    時間生産数量: Optional[float],
    商品構成備考: Optional[str],
    有効: bool,
    明細一覧: list[schemas.M商品構成明細Base],
    監査項目: Dict,
):
    db.add(
        models.M商品構成(
            商品ID=商品ID,
            明細SEQ=0,
            最小ロット数量=最小ロット数量,
            生産区分ID=生産区分ID,
            生産工程ID=生産工程ID,
            段取分数=段取分数,
            時間生産数量=時間生産数量,
            商品構成備考=商品構成備考,
            構成商品ID=None,
            計算分子数量=None,
            計算分母数量=None,
            最小ロット構成数量=None,
            構成商品備考=None,
            有効=有効,
            **監査項目,
        )
    )

    for 明細 in 明細一覧:
        db.add(
            models.M商品構成(
                商品ID=商品ID,
                明細SEQ=明細.明細SEQ,
                最小ロット数量=最小ロット数量,
                生産区分ID=生産区分ID,
                生産工程ID=生産工程ID,
                段取分数=段取分数,
                時間生産数量=時間生産数量,
                商品構成備考=商品構成備考,
                構成商品ID=明細.構成商品ID,
                計算分子数量=明細.計算分子数量,
                計算分母数量=明細.計算分母数量,
                最小ロット構成数量=明細.最小ロット構成数量,
                構成商品備考=明細.構成商品備考,
                有効=有効,
                **監査項目,
            )
        )


def create_M商品構成(
    db: Session,
    商品構成: schemas.M商品構成Create,
    認証情報: Optional[Dict] = None,
):
    """商品構成を作成"""
    audit = create_audit_fields(認証情報)
    _create_レコード一覧(
        db,
        商品構成.商品ID,
        商品構成.最小ロット数量,
        商品構成.生産区分ID,
        商品構成.生産工程ID,
        商品構成.段取分数,
        商品構成.時間生産数量,
        商品構成.商品構成備考,
        商品構成.有効,
        商品構成.明細一覧,
        audit,
    )
    db.commit()
    return get_M商品構成(db, 商品構成.商品ID)


def update_M商品構成(
    db: Session,
    商品ID: str,
    商品構成: schemas.M商品構成Update,
    認証情報: Optional[Dict] = None,
):
    """商品構成を更新"""
    既存一覧 = get_M商品構成(db, 商品ID)
    if not 既存一覧:
        return None

    見出し = next((item for item in 既存一覧 if item.明細SEQ == 0), 既存一覧[0])
    更新項目集合 = getattr(商品構成, "model_fields_set", getattr(商品構成, "__fields_set__", set()))
    最小ロット数量 = 商品構成.最小ロット数量 if 商品構成.最小ロット数量 is not None else 見出し.最小ロット数量
    生産区分ID = 商品構成.生産区分ID if 商品構成.生産区分ID is not None else 見出し.生産区分ID
    生産工程ID = 商品構成.生産工程ID if 商品構成.生産工程ID is not None else 見出し.生産工程ID
    段取分数 = 商品構成.段取分数 if "段取分数" in 更新項目集合 else 見出し.段取分数
    時間生産数量 = 商品構成.時間生産数量 if "時間生産数量" in 更新項目集合 else 見出し.時間生産数量
    商品構成備考 = 商品構成.商品構成備考 if "商品構成備考" in 更新項目集合 else 見出し.商品構成備考
    有効 = 商品構成.有効 if 商品構成.有効 is not None else 見出し.有効
    明細一覧 = 商品構成.明細一覧 if 商品構成.明細一覧 is not None else [
        schemas.M商品構成明細Base(
            明細SEQ=item.明細SEQ,
            構成商品ID=item.構成商品ID,
            計算分子数量=item.計算分子数量,
            計算分母数量=item.計算分母数量,
            構成商品備考=item.構成商品備考,
        )
        for item in 既存一覧
        if item.明細SEQ > 0
    ]

    監査項目 = {
        "登録日時": 見出し.登録日時,
        "登録利用者ID": 見出し.登録利用者ID,
        "登録利用者名": 見出し.登録利用者名,
        "登録端末ID": 見出し.登録端末ID,
        **update_audit_fields(認証情報),
    }

    db.query(models.M商品構成).filter(models.M商品構成.商品ID == 商品ID).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()
    _create_レコード一覧(
        db,
        商品ID,
        最小ロット数量,
        生産区分ID,
        生産工程ID,
        段取分数,
        時間生産数量,
        商品構成備考,
        有効,
        明細一覧,
        監査項目,
    )
    db.commit()
    return get_M商品構成(db, 商品ID)


def delete_M商品構成(db: Session, 商品ID: str, 認証情報: Optional[Dict] = None):
    """商品構成を無効化"""
    db_商品構成一覧 = get_M商品構成(db, 商品ID)
    if not db_商品構成一覧:
        return None

    audit = update_audit_fields(認証情報)
    for item in db_商品構成一覧:
        item.有効 = False
        for key, value in audit.items():
            setattr(item, key, value)

    db.commit()
    return get_M商品構成(db, 商品ID)


def init_M商品構成_data(db: Session, 認証情報: Optional[Dict] = None):
    """M商品構成の初期データを投入"""
    from log_config import get_logger
    from apps_crud.seed_data import INITIAL_PRODUCT_COMPOSITIONS
    if db.query(models.M商品構成).first():
        return
    logger = get_logger(__name__)
    for item in INITIAL_PRODUCT_COMPOSITIONS:
        create_M商品構成(db, schemas.M商品構成Create(
            商品ID=item["商品ID"],
            最小ロット数量=item["最小ロット数量"],
            生産区分ID=item["商品ID"][:1],
            生産工程ID="L99",
            段取分数=item.get("段取分数", 30),
            時間生産数量=item.get("時間生産数量", 500),
            商品構成備考=item.get("商品構成備考", ""),
            有効=True,
            明細一覧=[schemas.M商品構成明細Base(**明細) for 明細 in item["明細一覧"]],
        ), 認証情報=認証情報)
    logger.info("Initialized M商品構成")
