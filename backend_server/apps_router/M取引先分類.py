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

router = APIRouter(prefix="/apps/M取引先分類", tags=["M取引先分類"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_M取引先分類(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.M取引先分類)
    total = query.count()
    items = query.order_by(models.M取引先分類.取引先分類ID).limit(MAX_ITEMS).all()

    return schemas.ResponseBase(
        status="OK",
        message="取引先分類一覧を取得しました",
        data={
            "items": [schemas.M取引先分類.from_orm(item) for item in items],
            "total": total,
            "limit": MAX_ITEMS
        }
    )


@router.post("/取得", response_model=schemas.ResponseBase)
def get_M取引先分類(
    request: schemas.M取引先分類Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M取引先分類(db, request.取引先分類ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された取引先分類が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="取引先分類情報を取得しました",
        data=schemas.M取引先分類.from_orm(item)
    )


@router.post("/登録", response_model=schemas.ResponseBase)
def create_M取引先分類(
    request: schemas.M取引先分類Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    existing = crud.get_M取引先分類(db, request.取引先分類ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この取引先分類IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    item = crud.create_M取引先分類(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="取引先分類を作成しました",
        data=schemas.M取引先分類.from_orm(item)
    )


@router.post("/変更", response_model=schemas.ResponseBase)
def update_M取引先分類(
    request: schemas.M取引先分類Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M取引先分類(db, request.取引先分類ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された取引先分類が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    更新項目 = crud.create_audit_fields(認証情報, is_update=True)

    if request.取引先分類名 is not None:
        item.取引先分類名 = request.取引先分類名
    if request.取引先分類備考 is not None:
        item.取引先分類備考 = request.取引先分類備考
    if request.有効 is not None:
        item.有効 = request.有効

    for key, value in 更新項目.items():
        setattr(item, key, value)

    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="取引先分類を更新しました",
        data=schemas.M取引先分類.from_orm(item)
    )


@router.post("/削除", response_model=schemas.ResponseBase)
def delete_M取引先分類(
    request: schemas.M取引先分類Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M取引先分類(db, request.取引先分類ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された取引先分類が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    更新項目 = crud.create_audit_fields(認証情報, is_update=True)
    item.有効 = False
    for key, value in 更新項目.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="取引先分類の有効をオフにしました",
        data=schemas.M取引先分類.from_orm(item)
    )
