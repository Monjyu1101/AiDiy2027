# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from typing import Optional
import apps_schema as schemas, apps_crud as crud, deps, apps_models as models

MAX_ITEMS = 10000

router = APIRouter(prefix="/apps/T商品棚卸", tags=["T商品棚卸"])
明細行 = aliased(models.T商品棚卸)


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_T商品棚卸(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.T商品棚卸).filter(models.T商品棚卸.明細SEQ == 0)
    if request and request.開始日付:
        query = query.filter(func.date(models.T商品棚卸.棚卸日) >= request.開始日付)
    if request and request.終了日付:
        query = query.filter(func.date(models.T商品棚卸.棚卸日) <= request.終了日付)
    if request and request.商品ID:
        query = query.filter(
            db.query(明細行)
            .filter(
                明細行.棚卸伝票ID == models.T商品棚卸.棚卸伝票ID,
                明細行.明細SEQ > 0,
                明細行.商品ID == request.商品ID,
            )
            .exists()
        )

    total = query.count()
    headers = query.order_by(models.T商品棚卸.棚卸日.desc()).limit(MAX_ITEMS).all()
    items = [crud.build_T商品棚卸_data(db, crud.get_T商品棚卸(db, item.棚卸伝票ID)) for item in headers]

    return schemas.ResponseBase(
        status="OK",
        message="商品棚卸一覧を取得しました",
        data={"items": items, "total": total, "limit": MAX_ITEMS}
    )


@router.post("/取得", response_model=schemas.ResponseBase)
def get_T商品棚卸(
    request: schemas.T商品棚卸Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    行一覧 = crud.get_T商品棚卸(db, request.棚卸伝票ID)
    if not 行一覧:
        return schemas.ResponseBase(status="NG", message="指定された棚卸伝票が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="商品棚卸情報を取得しました",
        data=crud.build_T商品棚卸_data(db, 行一覧)
    )


@router.post("/登録", response_model=schemas.ResponseBase)
def create_T商品棚卸(
    request: schemas.T商品棚卸Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    if not request.棚卸伝票ID:
        採番 = db.query(models.C採番).filter(models.C採番.採番ID == "T商品棚卸").first()
        if not 採番:
            return schemas.ResponseBase(status="NG", message="採番設定が見つかりません", error={"code": "NUMBERING_NOT_FOUND"})

        next_number = 採番.最終採番値 + 1
        棚卸伝票ID = f"HT{str(next_number).zfill(8)}"

        採番.最終採番値 = next_number
        採番.更新日時 = crud.get_current_datetime()
        採番.更新利用者ID = 現在利用者.利用者ID
        採番.更新利用者名 = 現在利用者.利用者名
        採番.更新端末ID = "localhost"

        request.棚卸伝票ID = 棚卸伝票ID

    existing = crud.get_T商品棚卸ヘッダ(db, request.棚卸伝票ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この棚卸伝票IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    行一覧 = crud.create_T商品棚卸(db, request, 認証情報=認証情報)
    return schemas.ResponseBase(
        status="OK",
        message=f"商品棚卸を作成しました（伝票ID: {request.棚卸伝票ID}）",
        data=crud.build_T商品棚卸_data(db, 行一覧)
    )


@router.post("/変更", response_model=schemas.ResponseBase)
def update_T商品棚卸(
    request: schemas.T商品棚卸Update,
    棚卸伝票ID: str,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    header = crud.get_T商品棚卸ヘッダ(db, 棚卸伝票ID)
    if not header:
        return schemas.ResponseBase(status="NG", message="指定された棚卸伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    行一覧 = crud.update_T商品棚卸(db, 棚卸伝票ID, request, 認証情報=認証情報)

    return schemas.ResponseBase(
        status="OK",
        message="商品棚卸を更新しました",
        data=crud.build_T商品棚卸_data(db, 行一覧)
    )


@router.post("/削除", response_model=schemas.ResponseBase)
def delete_T商品棚卸(
    request: schemas.T商品棚卸Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    header = crud.get_T商品棚卸ヘッダ(db, request.棚卸伝票ID)
    if not header:
        return schemas.ResponseBase(status="NG", message="指定された棚卸伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    success = crud.delete_T商品棚卸(db, request.棚卸伝票ID, 認証情報=認証情報)
    if not success:
        return schemas.ResponseBase(status="NG", message="商品棚卸の削除に失敗しました", error={"code": "DELETE_FAILED"})

    行一覧 = crud.get_T商品棚卸(db, request.棚卸伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="商品棚卸の有効をオフにしました",
        data=crud.build_T商品棚卸_data(db, 行一覧)
    )
