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
import apps_schema as schemas, apps_crud as crud, deps, apps_models as models
MAX_ITEMS = 10000

router = APIRouter(prefix="/apps/M商品", tags=["M商品"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_M商品(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.M商品)
    total = query.count()
    items = query.order_by(models.M商品.商品ID).limit(MAX_ITEMS).all()

    return schemas.ResponseBase(
        status="OK",
        message="商品一覧を取得しました",
        data={
            "items": [schemas.M商品.from_orm(item) for item in items],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_M商品(
    request: schemas.M商品Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M商品(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="商品情報を取得しました",
        data=schemas.M商品.from_orm(item)
    )

@router.post("/登録", response_model=schemas.ResponseBase)
def create_M商品(
    request: schemas.M商品Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    existing = crud.get_M商品(db, request.商品ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この商品IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    item = crud.create_M商品(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="商品を作成しました",
        data=schemas.M商品.from_orm(item)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_M商品(
    request: schemas.M商品Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M商品(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    更新項目 = crud.create_audit_fields(認証情報, is_update=True)

    if request.商品名 is not None:
        item.商品名 = request.商品名
    if request.単位 is not None:
        item.単位 = request.単位
    if request.商品分類ID is not None:
        item.商品分類ID = request.商品分類ID
    if request.商品備考 is not None:
        item.商品備考 = request.商品備考
    if request.有効 is not None:
        item.有効 = request.有効

    for key, value in 更新項目.items():
        setattr(item, key, value)

    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="商品を更新しました",
        data=schemas.M商品.from_orm(item)
    )

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_M商品(
    request: schemas.M商品Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M商品(db, request.商品ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された商品が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    更新項目 = crud.create_audit_fields(認証情報, is_update=True)
    item.有効 = False
    for key, value in 更新項目.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="商品の有効をオフにしました",
        data=schemas.M商品.from_orm(item)
    )
