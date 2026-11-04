# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import apps_crud as crud
import apps_models as models
import apps_schema as schemas
import deps

MAX_ITEMS = 10000

router = APIRouter(prefix="/apps/M商品構成", tags=["M商品構成"])


def _validate_request(db: Session, request: schemas.M商品構成Base):
    if request.最小ロット数量 <= 0:
        return "最小ロット数量は0より大きい値を入力してください"
    if not request.生産区分ID:
        return "生産区分IDを入力してください"
    if not request.生産工程ID:
        return "生産工程IDを入力してください"
    if request.段取分数 is not None and request.段取分数 < 0:
        return "段取分数は0以上で入力してください"
    if request.時間生産数量 is not None and request.時間生産数量 <= 0:
        return "時間生産数量は0より大きい値を入力してください"

    if not request.明細一覧:
        return "構成商品を1件以上入力してください"

    明細SEQ一覧 = [明細.明細SEQ for 明細 in request.明細一覧]
    if len(明細SEQ一覧) != len(set(明細SEQ一覧)):
        return "明細SEQが重複しています"

    for 明細 in request.明細一覧:
        if 明細.明細SEQ <= 0:
            return "明細SEQは1以上で入力してください"
        if 明細.計算分子数量 < 0:
            return "計算分子数量は0以上で入力してください"
        if 明細.計算分母数量 <= 0:
            return "計算分母数量は0より大きい値を入力してください"

    return None


def _validate_products_exist(db: Session, 商品ID: str, 明細一覧: list[schemas.M商品構成明細Base]):
    商品ID一覧 = {商品ID}
    商品ID一覧.update(明細.構成商品ID for 明細 in 明細一覧)

    existing_ids = {
        row.商品ID
        for row in db.query(models.M商品.商品ID).filter(models.M商品.商品ID.in_(list(商品ID一覧))).all()
    }
    missing = sorted(商品ID一覧 - existing_ids)
    if missing:
        return f"商品マスタに存在しない商品IDがあります: {', '.join(missing)}"
    return None


def _validate_master_ids_exist(db: Session, 生産区分ID: str, 生産工程ID: str):
    if not db.query(models.M生産区分.生産区分ID).filter(models.M生産区分.生産区分ID == 生産区分ID).first():
        return f"生産区分マスタに存在しない生産区分IDがあります: {生産区分ID}"
    if not db.query(models.M生産工程.生産工程ID).filter(models.M生産工程.生産工程ID == 生産工程ID).first():
        return f"生産工程マスタに存在しない生産工程IDがあります: {生産工程ID}"
    return None


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_M商品構成(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    商品ID一覧 = crud.get_M商品構成一覧(db)
    total = len(商品ID一覧)
    items = [crud.get_M商品構成(db, row.商品ID) for row in 商品ID一覧[:MAX_ITEMS]]

    return schemas.ResponseBase(
        status="OK",
        message="商品構成一覧を取得しました",
        data={
            "items": [crud.build_M商品構成_data(db, item) for item in items],
            "total": total,
            "limit": MAX_ITEMS,
        },
    )


@router.post("/取得", response_model=schemas.ResponseBase)
def get_M商品構成(
    request: schemas.M商品構成Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    item = crud.get_M商品構成(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品構成が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="商品構成情報を取得しました",
        data=crud.build_M商品構成_data(db, item),
    )


@router.post("/登録", response_model=schemas.ResponseBase)
def create_M商品構成(
    request: schemas.M商品構成Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    error_message = _validate_request(db, request)
    if error_message:
        return schemas.ResponseBase(status="NG", message=error_message, error={"code": "VALIDATION_ERROR"})

    product_error = _validate_products_exist(db, request.商品ID, request.明細一覧)
    if product_error:
        return schemas.ResponseBase(status="NG", message=product_error, error={"code": "PRODUCT_NOT_FOUND"})
    master_error = _validate_master_ids_exist(db, request.生産区分ID, request.生産工程ID)
    if master_error:
        return schemas.ResponseBase(status="NG", message=master_error, error={"code": "MASTER_NOT_FOUND"})

    existing = crud.get_M商品構成(db, request.商品ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この商品IDは既に商品構成へ登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    item = crud.create_M商品構成(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="商品構成を作成しました",
        data=crud.build_M商品構成_data(db, item),
    )


@router.post("/変更", response_model=schemas.ResponseBase)
def update_M商品構成(
    request: schemas.M商品構成Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    item = crud.get_M商品構成(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品構成が見つかりません", error={"code": "NOT_FOUND"})

    明細一覧 = request.明細一覧 if request.明細一覧 is not None else crud.get_M商品構成明細一覧(db, request.商品ID)
    validation_target = schemas.M商品構成Base(
        最小ロット数量=request.最小ロット数量 if request.最小ロット数量 is not None else item[0].最小ロット数量,
        生産区分ID=request.生産区分ID if request.生産区分ID is not None else item[0].生産区分ID,
        生産工程ID=request.生産工程ID if request.生産工程ID is not None else item[0].生産工程ID,
        段取分数=request.段取分数 if request.段取分数 is not None else item[0].段取分数,
        時間生産数量=request.時間生産数量 if request.時間生産数量 is not None else item[0].時間生産数量,
        商品構成備考=request.商品構成備考 if request.商品構成備考 is not None else item[0].商品構成備考,
        有効=request.有効 if request.有効 is not None else item[0].有効,
        明細一覧=[
            schemas.M商品構成明細Base(
                明細SEQ=明細.明細SEQ,
                構成商品ID=明細.構成商品ID,
                計算分子数量=明細.計算分子数量,
                計算分母数量=明細.計算分母数量,
                構成商品備考=明細.構成商品備考,
            )
            if hasattr(明細, "構成商品ID") else 明細
            for 明細 in 明細一覧
        ],
    )
    error_message = _validate_request(db, validation_target)
    if error_message:
        return schemas.ResponseBase(status="NG", message=error_message, error={"code": "VALIDATION_ERROR"})

    product_error = _validate_products_exist(db, request.商品ID, validation_target.明細一覧)
    if product_error:
        return schemas.ResponseBase(status="NG", message=product_error, error={"code": "PRODUCT_NOT_FOUND"})
    master_error = _validate_master_ids_exist(db, validation_target.生産区分ID, validation_target.生産工程ID)
    if master_error:
        return schemas.ResponseBase(status="NG", message=master_error, error={"code": "MASTER_NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    updated_item = crud.update_M商品構成(db, request.商品ID, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="商品構成を更新しました",
        data=crud.build_M商品構成_data(db, updated_item),
    )


@router.post("/削除", response_model=schemas.ResponseBase)
def delete_M商品構成(
    request: schemas.M商品構成Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    item = crud.get_M商品構成(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品構成が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    deleted_item = crud.delete_M商品構成(db, request.商品ID, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="商品構成の有効をオフにしました",
        data=crud.build_M商品構成_data(db, deleted_item),
    )
