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
import core_schema as schemas, deps, core_models as models, core_crud as crud
MAX_ITEMS = 10000

router = APIRouter(prefix="/core/C採番", tags=["C採番"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_C採番(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.C採番)
    total = query.count()
    items = query.order_by(models.C採番.採番ID).limit(MAX_ITEMS).all()
    return schemas.ResponseBase(
        status="OK",
        message="採番一覧を取得しました",
        data={
            "items": [schemas.C採番.from_orm(item) for item in items],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_C採番(
    request: schemas.C採番Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = db.query(models.C採番).filter(models.C採番.採番ID == request.採番ID).first()
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された採番が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="採番情報を取得しました",
        data=schemas.C採番.from_orm(item)
    )

@router.post("/登録", response_model=schemas.ResponseBase)
def create_C採番(
    request: schemas.C採番Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    existing = db.query(models.C採番).filter(models.C採番.採番ID == request.採番ID).first()
    if existing:
        return schemas.ResponseBase(status="NG", message="この採番IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    登録項目 = crud.create_audit_fields(認証情報)
    item = models.C採番(
        採番ID=request.採番ID,
        最終採番値=request.最終採番値,
        採番備考=request.採番備考,
        **登録項目
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="採番を作成しました",
        data=schemas.C採番.from_orm(item)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_C採番(
    request: schemas.C採番Update,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = db.query(models.C採番).filter(models.C採番.採番ID == request.採番ID).first()
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された採番が見つかりません", error={"code": "NOT_FOUND"})

    if request.最終採番値 is not None:
        item.最終採番値 = request.最終採番値
    if request.採番備考 is not None:
        item.採番備考 = request.採番備考
    if request.有効 is not None:
        item.有効 = request.有効
    item.更新日時 = crud.get_current_datetime()
    item.更新利用者ID = 現在利用者.利用者ID
    item.更新利用者名 = 現在利用者.利用者名
    item.更新端末ID = "localhost"

    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message="採番を更新しました",
        data=schemas.C採番.from_orm(item)
    )

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_C採番(
    request: schemas.C採番Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = db.query(models.C採番).filter(models.C採番.採番ID == request.採番ID).first()
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された採番が見つかりません", error={"code": "NOT_FOUND"})

    item.有効 = False
    item.更新日時 = crud.get_current_datetime()
    item.更新利用者ID = 現在利用者.利用者ID
    item.更新利用者名 = 現在利用者.利用者名
    item.更新端末ID = "localhost"
    db.commit()
    db.refresh(item)
    return schemas.ResponseBase(status="OK", message="採番の有効をオフにしました", data=schemas.C採番.from_orm(item))

@router.post("/採番", response_model=schemas.ResponseBase)
def allocate_number(
    request: schemas.C採番Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    """採番IDから次の番号を発番し、最終採番値を更新"""
    item = db.query(models.C採番).filter(models.C採番.採番ID == request.採番ID).first()
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された採番IDが見つかりません", error={"code": "NOT_FOUND"})

    # 次の番号を計算
    next_number = item.最終採番値 + 1

    # 最終採番値を更新
    item.最終採番値 = next_number
    item.更新日時 = crud.get_current_datetime()
    item.更新利用者ID = 現在利用者.利用者ID
    item.更新利用者名 = 現在利用者.利用者名
    item.更新端末ID = "localhost"

    db.commit()
    db.refresh(item)

    return schemas.ResponseBase(
        status="OK",
        message=f"採番を発番しました: {next_number}",
        data={
            "採番ID": request.採番ID,
            "発番値": next_number,
            "最終採番値": item.最終採番値
        }
    )

