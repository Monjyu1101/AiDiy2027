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

router = APIRouter(prefix="/core/C利用者", tags=["C利用者"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_C利用者(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.C利用者)
    total = query.count()
    利用者一覧 = query.order_by(models.C利用者.利用者ID).limit(MAX_ITEMS).all()
    
    return schemas.ResponseBase(
        status="OK",
        message="利用者一覧を取得しました",
        data={
            "items": [schemas.C利用者.from_orm(u) for u in 利用者一覧],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_C利用者(
    request: schemas.C利用者Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    利用者 = db.query(models.C利用者).filter(models.C利用者.利用者ID == request.利用者ID).first()
    if not 利用者:
        return schemas.ResponseBase(status="NG", message="指定された利用者が見つかりません", error={"code": "NOT_FOUND"})
    
    return schemas.ResponseBase(
        status="OK",
        message="利用者情報を取得しました",
        data=schemas.C利用者.from_orm(利用者)
    )

@router.post("/登録", response_model=schemas.ResponseBase)
def create_C利用者(
    request: schemas.C利用者Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    既存利用者 = crud.get_C利用者_by_利用者名(db, request.利用者名)
    if 既存利用者:
        return schemas.ResponseBase(status="NG", message="この利用者名は既に使用されています", error={"code": "DUPLICATE_USERNAME"})
    
    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    新規利用者 = crud.create_C利用者(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message="利用者を作成しました",
        data=schemas.C利用者.from_orm(新規利用者)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_C利用者(
    request: schemas.C利用者Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    利用者 = db.query(models.C利用者).filter(models.C利用者.利用者ID == request.利用者ID).first()
    if not 利用者:
        return schemas.ResponseBase(status="NG", message="指定された利用者が見つかりません", error={"code": "NOT_FOUND"})

    if request.利用者名 is not None: 利用者.利用者名 = request.利用者名
    if request.パスワード is not None: 利用者.パスワード = crud.hash_パスワード(request.パスワード)
    if request.権限ID is not None: 利用者.権限ID = request.権限ID
    if request.利用者備考 is not None: 利用者.利用者備考 = request.利用者備考
    if request.有効 is not None: 利用者.有効 = request.有効

    利用者.更新日時 = crud.get_current_datetime()
    利用者.更新利用者ID = 現在利用者.利用者ID
    利用者.更新利用者名 = 現在利用者.利用者名
    利用者.更新端末ID = "localhost"
    db.commit()
    db.refresh(利用者)
    
    return schemas.ResponseBase(
        status="OK",
        message="利用者情報を更新しました",
        data=schemas.C利用者.from_orm(利用者)
    )

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_C利用者(
    request: schemas.C利用者Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    利用者 = db.query(models.C利用者).filter(models.C利用者.利用者ID == request.利用者ID).first()
    if not 利用者:
        return schemas.ResponseBase(status="NG", message="指定された利用者が見つかりません", error={"code": "NOT_FOUND"})
    
    利用者.有効 = False
    利用者.更新日時 = crud.get_current_datetime()
    利用者.更新利用者ID = 現在利用者.利用者ID
    利用者.更新利用者名 = 現在利用者.利用者名
    利用者.更新端末ID = "localhost"
    db.commit()
    db.refresh(利用者)
    return schemas.ResponseBase(status="OK", message="利用者の有効をオフにしました", data=schemas.C利用者.from_orm(利用者))

