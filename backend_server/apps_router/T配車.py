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
from sqlalchemy import func, or_
from typing import Optional
import apps_schema as schemas, apps_crud as crud, deps, apps_models as models
MAX_ITEMS = 10000

router = APIRouter(prefix="/apps/T配車", tags=["T配車"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_T配車(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    query = db.query(models.T配車)
    if request and request.開始日付:
        query = query.filter(
            or_(
                func.date(models.T配車.配車開始日時) >= request.開始日付,
                func.date(models.T配車.配車終了日時) >= request.開始日付
            )
        )

    if request and request.終了日付:
        query = query.filter(
            or_(
                func.date(models.T配車.配車開始日時) <= request.終了日付,
                func.date(models.T配車.配車終了日時) <= request.終了日付
            )
        )

    total = query.count()
    items = query.order_by(models.T配車.配車開始日時.desc()).limit(MAX_ITEMS).all()

    return schemas.ResponseBase(
        status="OK",
        message="配車一覧を取得しました",
        data={
            "items": [schemas.T配車.from_orm(item) for item in items],
            "total": total,
            "limit": MAX_ITEMS
        }
    )

@router.post("/取得", response_model=schemas.ResponseBase)
def get_T配車(
    request: schemas.T配車Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_T配車(db, request.配車伝票ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車伝票が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="配車情報を取得しました",
        data=schemas.T配車.from_orm(item)
    )

@router.post("/登録", response_model=schemas.ResponseBase)
def create_T配車(
    request: schemas.T配車Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    # 配車伝票IDが指定されていない場合は自動採番
    if not request.配車伝票ID:
        採番 = db.query(models.C採番).filter(models.C採番.採番ID == "T配車").first()
        if not 採番:
            return schemas.ResponseBase(status="NG", message="採番設定が見つかりません", error={"code": "NUMBERING_NOT_FOUND"})

        # 次の番号を発番
        next_number = 採番.最終採番値 + 1
        配車伝票ID = f"HS{str(next_number).zfill(8)}"  # HS00010001形式

        # 最終採番値を更新
        採番.最終採番値 = next_number
        採番.更新日時 = crud.get_current_datetime()
        採番.更新利用者ID = 現在利用者.利用者ID
        採番.更新利用者名 = 現在利用者.利用者名
        採番.更新端末ID = "localhost"

        # requestに採番したIDをセット
        request.配車伝票ID = 配車伝票ID

    # 重複チェック
    existing = crud.get_T配車(db, request.配車伝票ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この配車伝票IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    try:
        item = crud.create_T配車(db, request, 認証情報=認証情報)
    except ValueError as exc:
        db.rollback()
        return schemas.ResponseBase(status="NG", message=str(exc), error={"code": "VALIDATION_ERROR"})
    return schemas.ResponseBase(
        status="OK",
        message=f"配車を作成しました（伝票ID: {request.配車伝票ID}）",
        data=schemas.T配車.from_orm(item)
    )

@router.post("/変更", response_model=schemas.ResponseBase)
def update_T配車(
    request: schemas.T配車Update,
    配車伝票ID: str,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_T配車(db, 配車伝票ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    try:
        updated_item = crud.update_T配車(db, 配車伝票ID, request, 認証情報=認証情報)
    except ValueError as exc:
        db.rollback()
        return schemas.ResponseBase(status="NG", message=str(exc), error={"code": "VALIDATION_ERROR"})

    return schemas.ResponseBase(
        status="OK",
        message="配車を更新しました",
        data=schemas.T配車.from_orm(updated_item)
    )

@router.post("/削除", response_model=schemas.ResponseBase)
def delete_T配車(
    request: schemas.T配車Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    item = crud.get_T配車(db, request.配車伝票ID)
    if not item:
        return schemas.ResponseBase(status="NG", message="指定された配車伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    success = crud.delete_T配車(db, request.配車伝票ID, 認証情報=認証情報)
    if not success:
        return schemas.ResponseBase(status="NG", message="配車の削除に失敗しました", error={"code": "DELETE_FAILED"})

    return schemas.ResponseBase(
        status="OK",
        message="配車の有効をオフにしました",
        data=schemas.T配車.from_orm(crud.get_T配車(db, request.配車伝票ID))
    )
