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

router = APIRouter(prefix="/apps/M配車区分", tags=["M配車区分"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_M配車区分(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.M配車区分)
    total = query.count()
    items = query.order_by(models.M配車区分.配車区分ID).limit(MAX_ITEMS).all()

    return schemas.ResponseBase(
        status="OK",
        message="配車区分一覧を取得しました",
        data={
            "items": [schemas.M配車区分.from_orm(item) for item in items],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_M配車区分(
    request: schemas.M配車区分Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M配車区分(db, request.配車区分ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車区分が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="配車区分情報を取得しました",
        data=schemas.M配車区分.from_orm(item)
    )

@router.post("/登録", response_model=schemas.ResponseBase)
def create_M配車区分(
    request: schemas.M配車区分Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    existing = crud.get_M配車区分(db, request.配車区分ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この配車区分IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    item = crud.create_M配車区分(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="配車区分を作成しました",
        data=schemas.M配車区分.from_orm(item)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_M配車区分(
    request: schemas.M配車区分Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M配車区分(db, request.配車区分ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車区分が見つかりません", error={"code": "NOT_FOUND"})

    if request.配車区分名 is not None: item.配車区分名 = request.配車区分名
    if request.配車区分備考 is not None: item.配車区分備考 = request.配車区分備考
    if request.配色枠 is not None: item.配色枠 = request.配色枠
    if request.配色背景 is not None: item.配色背景 = request.配色背景
    if request.配色前景 is not None: item.配色前景 = request.配色前景
    if request.有効 is not None: item.有効 = request.有効

    item.更新日時 = crud.get_current_datetime()
    item.更新利用者ID = 現在利用者.利用者ID
    item.更新利用者名 = 現在利用者.利用者名
    item.更新端末ID = "localhost"
    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="配車区分を更新しました",
        data=schemas.M配車区分.from_orm(item)
    )

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_M配車区分(
    request: schemas.M配車区分Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_M配車区分(db, request.配車区分ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車区分が見つかりません", error={"code": "NOT_FOUND"})

    item.有効 = False
    item.更新日時 = crud.get_current_datetime()
    item.更新利用者ID = 現在利用者.利用者ID
    item.更新利用者名 = 現在利用者.利用者名
    item.更新端末ID = "localhost"
    db.commit()
    db.refresh(item)
    return schemas.ResponseBase(status="OK", message="配車区分の有効をオフにしました", data=schemas.M配車区分.from_orm(item))

