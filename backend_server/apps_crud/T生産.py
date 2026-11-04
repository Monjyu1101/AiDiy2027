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


def get_T生産(db: Session, 生産伝票ID: str):
    """生産伝票IDで全行（ヘッダ+明細）を取得"""
    return (
        db.query(models.T生産)
        .filter(models.T生産.生産伝票ID == 生産伝票ID)
        .order_by(models.T生産.明細SEQ)
        .all()
    )


def get_T生産ヘッダ(db: Session, 生産伝票ID: str):
    """ヘッダ行（明細SEQ=0）のみ取得"""
    return (
        db.query(models.T生産)
        .filter(models.T生産.生産伝票ID == 生産伝票ID, models.T生産.明細SEQ == 0)
        .first()
    )


def get_T生産一覧(db: Session):
    """全生産伝票のヘッダ行を取得"""
    return (
        db.query(models.T生産)
        .filter(models.T生産.明細SEQ == 0)
        .order_by(models.T生産.生産開始日時.desc())
        .all()
    )


def get_T生産明細一覧(db: Session, 生産伝票ID: str):
    """明細行（明細SEQ>0）を取得"""
    return (
        db.query(models.T生産)
        .filter(models.T生産.生産伝票ID == 生産伝票ID, models.T生産.明細SEQ > 0)
        .order_by(models.T生産.明細SEQ)
        .all()
    )


def _build_明細一覧(db: Session, 明細行一覧):
    if not 明細行一覧:
        return []

    払出商品ID一覧 = list({item.払出商品ID for item in 明細行一覧 if item.払出商品ID})
    商品マップ = {}
    if 払出商品ID一覧:
        商品マップ = {
            item.商品ID: item
            for item in db.query(models.M商品).filter(models.M商品.商品ID.in_(払出商品ID一覧)).all()
        }

    result = []
    for item in 明細行一覧:
        構成商品 = 商品マップ.get(item.払出商品ID)
        result.append({
            "明細SEQ": item.明細SEQ,
            "払出商品ID": item.払出商品ID,
            "払出商品名": 構成商品.商品名 if 構成商品 else None,
            "構成単位": 構成商品.単位 if 構成商品 else None,
            "計算分子数量": float(item.計算分子数量 or 0),
            "計算分母数量": float(item.計算分母数量 or 1),
            "最小ロット構成数量": float(item.最小ロット構成数量) if item.最小ロット構成数量 is not None else None,
            "構成商品備考": item.構成商品備考,
            "払出数量": float(item.払出数量) if item.払出数量 is not None else None,
            "所要数量備考": item.所要数量備考,
        })

    return result


def build_T生産_data(db: Session, 行一覧):
    """レスポンス用の生産データを組み立てる"""
    if not 行一覧:
        return None

    見出し = next((item for item in 行一覧 if item.明細SEQ == 0), 行一覧[0])
    明細行一覧 = [item for item in 行一覧 if item.明細SEQ > 0]

    商品 = db.query(models.M商品).filter(models.M商品.商品ID == 見出し.受入商品ID).first() if 見出し.受入商品ID else None
    生産区分 = db.query(models.M生産区分).filter(models.M生産区分.生産区分ID == 見出し.生産区分ID).first() if 見出し.生産区分ID else None
    工程 = db.query(models.M生産工程).filter(models.M生産工程.生産工程ID == 見出し.生産工程ID).first() if 見出し.生産工程ID else None

    return {
        "生産伝票ID": 見出し.生産伝票ID,
        "受入商品ID": 見出し.受入商品ID,
        "受入商品名": 商品.商品名 if 商品 else None,
        "単位": 商品.単位 if 商品 else None,
        "最小ロット数量": float(見出し.最小ロット数量) if 見出し.最小ロット数量 is not None else None,
        "受入数量": float(見出し.受入数量) if 見出し.受入数量 is not None else None,
        "生産区分ID": 見出し.生産区分ID,
        "生産区分名": 生産区分.生産区分名 if 生産区分 else None,
        "生産工程ID": 見出し.生産工程ID,
        "生産工程名": 工程.生産工程名 if 工程 else None,
        "段取分数": int(見出し.段取分数) if 見出し.段取分数 is not None else None,
        "時間生産数量": float(見出し.時間生産数量) if 見出し.時間生産数量 is not None else None,
        "生産時間": float(見出し.生産時間) if 見出し.生産時間 is not None else None,
        "生産開始日時": 見出し.生産開始日時,
        "生産終了日時": 見出し.生産終了日時,
        "生産内容": 見出し.生産内容,
        "生産備考": 見出し.生産備考,
        "有効": bool(見出し.有効),
        "明細一覧": _build_明細一覧(db, 明細行一覧),
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
    生産伝票ID: str,
    受入商品ID,
    最小ロット数量,
    受入数量,
    生産区分ID,
    生産工程ID,
    段取分数,
    時間生産数量,
    生産時間,
    生産開始日時: str,
    生産終了日時: str,
    生産内容,
    生産備考,
    有効: bool,
    明細一覧: list,
    監査項目: Dict,
):
    # ヘッダ行（明細SEQ=0）
    db.add(models.T生産(
        生産伝票ID=生産伝票ID,
        明細SEQ=0,
        受入商品ID=受入商品ID,
        最小ロット数量=最小ロット数量,
        受入数量=受入数量,
        生産区分ID=生産区分ID,
        生産工程ID=生産工程ID,
        段取分数=段取分数,
        時間生産数量=時間生産数量,
        生産時間=生産時間,
        生産開始日時=生産開始日時,
        生産終了日時=生産終了日時,
        生産内容=生産内容,
        生産備考=生産備考,
        払出商品ID=None,
        計算分子数量=None,
        計算分母数量=None,
        最小ロット構成数量=None,
        構成商品備考=None,
        払出数量=None,
        所要数量備考=None,
        有効=有効,
        **監査項目,
    ))

    # 明細行（明細SEQ>0）
    for 明細 in 明細一覧:
        db.add(models.T生産(
            生産伝票ID=生産伝票ID,
            明細SEQ=明細.明細SEQ,
            受入商品ID=受入商品ID,
            最小ロット数量=最小ロット数量,
            受入数量=None,
            生産区分ID=生産区分ID,
            生産工程ID=生産工程ID,
            段取分数=段取分数,
            時間生産数量=時間生産数量,
            生産時間=生産時間,
            生産開始日時=None,
            生産終了日時=None,
            生産内容=None,
            生産備考=None,
            払出商品ID=明細.払出商品ID,
            計算分子数量=明細.計算分子数量,
            計算分母数量=明細.計算分母数量,
            最小ロット構成数量=明細.最小ロット構成数量,
            構成商品備考=明細.構成商品備考,
            払出数量=明細.払出数量,
            所要数量備考=明細.所要数量備考,
            有効=有効,
            **監査項目,
        ))


def create_T生産(db: Session, 生産: schemas.T生産Create, 認証情報: Optional[Dict] = None):
    """生産データを作成（生産伝票IDは必須、ルーター側で採番済み）"""
    if not 生産.生産伝票ID:
        raise ValueError("生産伝票IDが指定されていません")

    日時範囲検証(生産.生産開始日時, 生産.生産終了日時)

    audit = create_audit_fields(認証情報)

    _create_行一覧(
        db,
        生産.生産伝票ID,
        生産.受入商品ID,
        生産.最小ロット数量,
        生産.受入数量,
        生産.生産区分ID,
        生産.生産工程ID,
        生産.段取分数,
        生産.時間生産数量,
        生産.生産時間,
        生産.生産開始日時,
        生産.生産終了日時,
        生産.生産内容,
        生産.生産備考,
        生産.有効,
        生産.明細一覧,
        audit,
    )
    db.commit()
    return get_T生産(db, 生産.生産伝票ID)


def update_T生産(db: Session, 生産伝票ID: str, 生産: schemas.T生産Update, 認証情報: Optional[Dict] = None):
    """生産データを更新（全行削除・再作成）"""
    既存一覧 = get_T生産(db, 生産伝票ID)
    if not 既存一覧:
        return None

    見出し = next((item for item in 既存一覧 if item.明細SEQ == 0), 既存一覧[0])

    受入商品ID = 生産.受入商品ID if 生産.受入商品ID is not None else 見出し.受入商品ID
    最小ロット数量 = 生産.最小ロット数量 if 生産.最小ロット数量 is not None else 見出し.最小ロット数量
    受入数量 = 生産.受入数量 if 生産.受入数量 is not None else 見出し.受入数量
    生産区分ID = 生産.生産区分ID if 生産.生産区分ID is not None else 見出し.生産区分ID
    生産工程ID = 生産.生産工程ID if 生産.生産工程ID is not None else 見出し.生産工程ID
    段取分数 = 生産.段取分数 if 生産.段取分数 is not None else 見出し.段取分数
    時間生産数量 = 生産.時間生産数量 if 生産.時間生産数量 is not None else 見出し.時間生産数量
    生産時間 = 生産.生産時間 if 生産.生産時間 is not None else 見出し.生産時間
    生産開始日時 = 生産.生産開始日時 if 生産.生産開始日時 is not None else 見出し.生産開始日時
    生産終了日時 = 生産.生産終了日時 if 生産.生産終了日時 is not None else 見出し.生産終了日時
    日時範囲検証(生産開始日時, 生産終了日時)
    生産内容 = 生産.生産内容 if 生産.生産内容 is not None else 見出し.生産内容
    生産備考 = 生産.生産備考 if 生産.生産備考 is not None else 見出し.生産備考
    有効 = 生産.有効 if 生産.有効 is not None else 見出し.有効
    明細一覧 = 生産.明細一覧 if 生産.明細一覧 is not None else [
        schemas.T生産明細Base(
            明細SEQ=item.明細SEQ,
            払出商品ID=item.払出商品ID,
            計算分子数量=item.計算分子数量,
            計算分母数量=item.計算分母数量,
            最小ロット構成数量=item.最小ロット構成数量,
            払出数量=item.払出数量,
            所要数量備考=item.所要数量備考,
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

    db.query(models.T生産).filter(models.T生産.生産伝票ID == 生産伝票ID).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()
    _create_行一覧(
        db,
        生産伝票ID,
        受入商品ID,
        最小ロット数量,
        受入数量,
        生産区分ID,
        生産工程ID,
        段取分数,
        時間生産数量,
        生産時間,
        生産開始日時,
        生産終了日時,
        生産内容,
        生産備考,
        有効,
        明細一覧,
        監査項目,
    )
    db.commit()
    return get_T生産(db, 生産伝票ID)


def delete_T生産(db: Session, 生産伝票ID: str, 認証情報: Optional[Dict] = None):
    """生産データを論理削除（全行）"""
    全行 = get_T生産(db, 生産伝票ID)
    if not 全行:
        return False

    audit = update_audit_fields(認証情報)
    for item in 全行:
        item.有効 = False
        for key, value in audit.items():
            setattr(item, key, value)
    db.commit()
    return True


def init_T生産_data(db: Session, 認証情報: Optional[Dict] = None):
    """T生産の初期データをM商品構成からランダムにコピーして作成"""
    if db.query(models.T生産).first():
        return  # 既にデータがある場合はスキップ

    # --- DB クエリをすべてループ前にまとめて取得（autoflush による二重INSERTを防止）---

    構成ヘッダ一覧 = (
        db.query(models.M商品構成)
        .filter(models.M商品構成.明細SEQ == 0, models.M商品構成.有効 == True)
        .all()
    )
    if not 構成ヘッダ一覧:
        return  # M商品構成が未登録の場合はスキップ

    ランダム工程候補一覧 = [
        item.生産工程ID
        for item in db.query(models.M生産工程)
        .filter(models.M生産工程.生産工程ID.in_([f"L{str(i).zfill(2)}" for i in range(1, 8)]))
        .all()
    ]
    if not ランダム工程候補一覧:
        ランダム工程候補一覧 = [f"L{str(i).zfill(2)}" for i in range(1, 8)]

    # 全商品の明細行を一括取得してマップ化
    全明細マップ: dict = {}
    for ヘッダ in 構成ヘッダ一覧:
        全明細マップ[ヘッダ.商品ID] = (
            db.query(models.M商品構成)
            .filter(models.M商品構成.商品ID == ヘッダ.商品ID, models.M商品構成.明細SEQ > 0)
            .order_by(models.M商品構成.明細SEQ)
            .all()
        )

    # --- ここ以降は db.query() を呼ばず、db.add() と db.commit() のみ ---

    audit = create_audit_fields(認証情報)
    today = datetime.datetime.now().date()
    ソート済み構成ヘッダ一覧 = sorted(構成ヘッダ一覧, key=lambda item: item.商品ID)
    record_index = 0

    for header_index, 構成ヘッダ in enumerate(ソート済み構成ヘッダ一覧):
        for repeat_index in range(2):
            day_offset = 2 + ((header_index * 2 + repeat_index) % 4)
            生産日 = today + datetime.timedelta(days=day_offset)
            生産開始日時 = datetime.datetime.combine(生産日, datetime.time(8, 0)).isoformat()
            生産終了日時 = datetime.datetime.combine(生産日, datetime.time(17, 0)).isoformat()
            record_index += 1
            受入商品ID = 構成ヘッダ.商品ID
            最小ロット数量 = float(構成ヘッダ.最小ロット数量) if 構成ヘッダ.最小ロット数量 else 1.0
            段取分数 = int(構成ヘッダ.段取分数) if getattr(構成ヘッダ, "段取分数", None) is not None else None
            時間生産数量 = float(構成ヘッダ.時間生産数量) if getattr(構成ヘッダ, "時間生産数量", None) is not None else None
            生産時間 = round(最小ロット数量 / 時間生産数量, 2) if 時間生産数量 else None
            明細行一覧 = 全明細マップ.get(受入商品ID, [])
            伝票番号 = f"SE{str(record_index).zfill(8)}"
            生産工程ID = random.choice(ランダム工程候補一覧)

            # ヘッダ行（明細SEQ=0）
            db.add(models.T生産(
                生産伝票ID=伝票番号,
                明細SEQ=0,
                受入商品ID=受入商品ID,
                最小ロット数量=最小ロット数量,
                受入数量=最小ロット数量,
                生産区分ID=構成ヘッダ.生産区分ID,
                生産工程ID=生産工程ID,
                段取分数=段取分数,
                時間生産数量=時間生産数量,
                生産時間=生産時間,
                生産開始日時=生産開始日時,
                生産終了日時=生産終了日時,
                生産内容=f"サンプル生産{record_index}",
                生産備考=構成ヘッダ.商品構成備考,
                払出商品ID=None,
                計算分子数量=None,
                計算分母数量=None,
                構成商品備考=None,
                最小ロット構成数量=None,
                払出数量=None,
                所要数量備考=None,
                有効=True,
                **audit
            ))

            # 明細行（M商品構成の明細をコピー）
            for 明細 in 明細行一覧:
                db.add(models.T生産(
                    生産伝票ID=伝票番号,
                    明細SEQ=明細.明細SEQ,
                    受入商品ID=受入商品ID,
                    最小ロット数量=最小ロット数量,
                    受入数量=None,
                    生産区分ID=構成ヘッダ.生産区分ID,
                    生産工程ID=生産工程ID,
                    段取分数=段取分数,
                    時間生産数量=時間生産数量,
                    生産時間=生産時間,
                    生産開始日時=None,
                    生産終了日時=None,
                    生産内容=None,
                    生産備考=None,
                    払出商品ID=明細.構成商品ID,
                    計算分子数量=明細.計算分子数量,
                    計算分母数量=明細.計算分母数量,
                    構成商品備考=None,
                    最小ロット構成数量=float(明細.最小ロット構成数量) if 明細.最小ロット構成数量 is not None else None,
                    払出数量=float(明細.最小ロット構成数量) if 明細.最小ロット構成数量 is not None else None,
                    所要数量備考=明細.構成商品備考 or None,
                    有効=True,
                    **audit
                ))

    db.commit()
    logger.info("Initialized T生産 from M商品構成")
