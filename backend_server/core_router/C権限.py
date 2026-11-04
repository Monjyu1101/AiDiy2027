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
import core_schema as schemas, core_crud as crud, deps, core_models as models
MAX_ITEMS = 10000

router = APIRouter(prefix="/core/C権限", tags=["C権限"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_C権限(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.C権限)
    total = query.count()
    権限一覧 = query.order_by(models.C権限.権限ID).limit(MAX_ITEMS).all()
    return schemas.ResponseBase(
        status="OK",
        message="権限一覧を取得しました",
        data={
            "items": [schemas.C権限.from_orm(r) for r in 権限一覧],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_C権限(
    request: dict, # {"権限ID": int}
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    権限ID = request.get("権限ID")
    権限 = crud.get_C権限(db, 権限ID)
    if not 権限:
        return schemas.ResponseBase(status="NG", message="指定された権限が見つかりません", error={"code": "NOT_FOUND"})
    return schemas.ResponseBase(status="OK", message="権限情報を取得しました", data=schemas.C権限.from_orm(権限))

@router.post("/登録", response_model=schemas.ResponseBase)
def create_C権限(
    request: schemas.C権限Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    新規権限 = crud.create_C権限(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="権限を作成しました",
        data=schemas.C権限.from_orm(新規権限)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_C権限(
    request: schemas.C権限Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    権限 = crud.get_C権限(db, request.権限ID)
    if not 権限: return schemas.ResponseBase(status="NG", message="権限なし", error={"code": "NOT_FOUND"})
    
    if request.権限名 is not None: 権限.権限名 = request.権限名
    if request.権限備考 is not None: 権限.権限備考 = request.権限備考
    if request.有効 is not None: 権限.有効 = request.有効
    権限.更新日時 = crud.get_current_datetime()
    権限.更新利用者ID = 現在利用者.利用者ID
    権限.更新利用者名 = 現在利用者.利用者名
    権限.更新端末ID = "localhost"
    
    db.commit()
    db.refresh(権限)
    return schemas.ResponseBase(status="OK", message="更新しました", data=schemas.C権限.from_orm(権限))

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_C権限(
    request: schemas.C権限Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    権限 = crud.get_C権限(db, request.権限ID)
    if not 権限: return schemas.ResponseBase(status="NG", message="権限なし", error={"code": "NOT_FOUND"})
    権限.有効 = False
    権限.更新日時 = crud.get_current_datetime()
    権限.更新利用者ID = 現在利用者.利用者ID
    権限.更新利用者名 = 現在利用者.利用者名
    権限.更新端末ID = "localhost"
    db.commit()
    db.refresh(権限)
    return schemas.ResponseBase(status="OK", message="有効をオフにしました", data=schemas.C権限.from_orm(権限))

