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
from list_controls import get_list_limit

MAX_ITEMS = 1000

router = APIRouter(prefix="/apps/T生産", tags=["T生産"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_T生産(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    # ヘッダ行（明細SEQ=0）のみで絞り込み
    query = db.query(models.T生産).filter(models.T生産.明細SEQ == 0)
    if request and request.開始日付:
        query = query.filter(
            or_(
                func.date(models.T生産.生産開始日時) >= request.開始日付,
                func.date(models.T生産.生産終了日時) >= request.開始日付
            )
        )
    if request and request.終了日付:
        query = query.filter(
            or_(
                func.date(models.T生産.生産開始日時) <= request.終了日付,
                func.date(models.T生産.生産終了日時) <= request.終了日付
            )
        )

    total = query.count()
    headers = query.order_by(models.T生産.生産開始日時.desc()).limit(MAX_ITEMS).all()

    items = [crud.build_T生産_data(db, [h]) for h in headers]

    return schemas.ResponseBase(
        status="OK",
        message="生産一覧を取得しました",
        data={"items": items, "total": total, "limit": MAX_ITEMS}
    )


@router.post("/取得", response_model=schemas.ResponseBase)
def get_T生産(
    request: schemas.T生産Get,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    行一覧 = crud.get_T生産(db, request.生産伝票ID)
    if not 行一覧:
        return schemas.ResponseBase(status="NG", message="指定された生産伝票が見つかりません", error={"code": "NOT_FOUND"})

    return schemas.ResponseBase(
        status="OK",
        message="生産情報を取得しました",
        data=crud.build_T生産_data(db, 行一覧)
    )


@router.post("/登録", response_model=schemas.ResponseBase)
def create_T生産(
    request: schemas.T生産Create,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    # 生産伝票IDが指定されていない場合は自動採番
    if not request.生産伝票ID:
        採番 = db.query(models.C採番).filter(models.C採番.採番ID == "T生産").first()
        if not 採番:
            return schemas.ResponseBase(status="NG", message="採番設定が見つかりません", error={"code": "NUMBERING_NOT_FOUND"})

        next_number = 採番.最終採番値 + 1
        生産伝票ID = f"SE{str(next_number).zfill(8)}"

        採番.最終採番値 = next_number
        採番.更新日時 = crud.get_current_datetime()
        採番.更新利用者ID = 現在利用者.利用者ID
        採番.更新利用者名 = 現在利用者.利用者名
        採番.更新端末ID = "localhost"

        request.生産伝票ID = 生産伝票ID

    # 重複チェック（ヘッダ行で確認）
    existing = crud.get_T生産ヘッダ(db, request.生産伝票ID)
    if existing:
        return schemas.ResponseBase(status="NG", message="この生産伝票IDは既に登録されています", error={"code": "DUPLICATE"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    try:
        行一覧 = crud.create_T生産(db, request, 認証情報=認証情報)
    except ValueError as exc:
        db.rollback()
        return schemas.ResponseBase(status="NG", message=str(exc), error={"code": "VALIDATION_ERROR"})
    return schemas.ResponseBase(
        status="OK",
        message=f"生産を作成しました（伝票ID: {request.生産伝票ID}）",
        data=crud.build_T生産_data(db, 行一覧)
    )


@router.post("/変更", response_model=schemas.ResponseBase)
def update_T生産(
    request: schemas.T生産Update,
    生産伝票ID: str,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    header = crud.get_T生産ヘッダ(db, 生産伝票ID)
    if not header:
        return schemas.ResponseBase(status="NG", message="指定された生産伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    try:
        行一覧 = crud.update_T生産(db, 生産伝票ID, request, 認証情報=認証情報)
    except ValueError as exc:
        db.rollback()
        return schemas.ResponseBase(status="NG", message=str(exc), error={"code": "VALIDATION_ERROR"})

    return schemas.ResponseBase(
        status="OK",
        message="生産を更新しました",
        data=crud.build_T生産_data(db, 行一覧)
    )


@router.post("/削除", response_model=schemas.ResponseBase)
def delete_T生産(
    request: schemas.T生産Delete,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    header = crud.get_T生産ヘッダ(db, request.生産伝票ID)
    if not header:
        return schemas.ResponseBase(status="NG", message="指定された生産伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    success = crud.delete_T生産(db, request.生産伝票ID, 認証情報=認証情報)
    if not success:
        return schemas.ResponseBase(status="NG", message="生産の削除に失敗しました", error={"code": "DELETE_FAILED"})

    行一覧 = crud.get_T生産(db, request.生産伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="生産の有効をオフにしました",
        data=crud.build_T生産_data(db, 行一覧)
    )


@router.post("/払出一覧", response_model=schemas.ResponseBase)
def list_T生産払出(
    request: Optional[schemas.T生産払出ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    """生産払出一覧（明細行 SEQ>0）をヘッダJOINで取得"""
    from sqlalchemy import text

    filter_params = {}
    conditions = ["T.明細SEQ > 0"]

    if request and not getattr(request, '無効も表示', False):
        conditions.append("T.有効 = 1")

    if request and request.開始日付:
        conditions.append("date(H.生産開始日時) >= :start_date")
        filter_params["start_date"] = request.開始日付

    if request and request.終了日付:
        conditions.append("date(H.生産開始日時) <= :end_date")
        filter_params["end_date"] = request.終了日付

    if request and request.生産区分ID:
        conditions.append("T.生産区分ID = :生産区分ID")
        filter_params["生産区分ID"] = request.生産区分ID

    if request and request.生産工程ID:
        conditions.append("T.生産工程ID = :生産工程ID")
        filter_params["生産工程ID"] = request.生産工程ID

    if request and request.払出商品ID:
        conditions.append("T.払出商品ID = :払出商品ID")
        filter_params["払出商品ID"] = request.払出商品ID

    where_sql = "WHERE " + " AND ".join(conditions)

    limit_value = get_list_limit(request)
    limit_clause = "LIMIT :limit" if limit_value is not None else ""
    sql = f"""
    SELECT
        T.生産伝票ID,
        T.明細SEQ,
        T.受入商品ID,
        T.最小ロット数量,
        T.生産区分ID,
        T.生産工程ID,
        T.払出商品ID,
        T.計算分子数量,
        T.計算分母数量,
        T.最小ロット構成数量,
        T.払出数量,
        T.所要数量備考,
        T.有効,
        T.更新日時,
        T.更新利用者ID,
        T.更新利用者名,
        H.生産開始日時,
        H.生産終了日時,
        H.受入数量,
        H.生産内容,
        MR.商品名  AS 受入商品名,
        MR.単位    AS 受入単位,
        MP.商品名  AS 払出商品名,
        MP.単位    AS 払出単位,
        M2.生産区分名,
        M1.生産工程名
    FROM T生産 T
    LEFT JOIN T生産 H  ON T.生産伝票ID = H.生産伝票ID AND H.明細SEQ = 0
    LEFT JOIN M商品 MR ON T.受入商品ID = MR.商品ID
    LEFT JOIN M商品 MP ON T.払出商品ID = MP.商品ID
    LEFT JOIN M生産区分 M2 ON T.生産区分ID = M2.生産区分ID
    LEFT JOIN M生産工程 M1 ON T.生産工程ID = M1.生産工程ID
    {where_sql}
    ORDER BY H.生産開始日時 DESC, T.生産伝票ID, T.明細SEQ
    {limit_clause}
    """

    params = {**filter_params}
    if limit_value is not None:
        params["limit"] = limit_value

    result = db.execute(text(sql), params).fetchall()

    count_sql = f"""
    SELECT count(*) FROM T生産 T
    LEFT JOIN T生産 H ON T.生産伝票ID = H.生産伝票ID AND H.明細SEQ = 0
    {where_sql}
    """
    total = db.execute(text(count_sql), filter_params).scalar()

    items = []
    for row in result:
        items.append({
            "生産伝票ID":         row.生産伝票ID,
            "明細SEQ":            row.明細SEQ,
            "生産開始日時":       row.生産開始日時,
            "生産終了日時":       row.生産終了日時,
            "受入商品ID":         row.受入商品ID,
            "受入商品名":         row.受入商品名,
            "受入単位":           row.受入単位,
            "受入数量":           row.受入数量,
            "最小ロット数量":     row.最小ロット数量,
            "生産区分ID":         row.生産区分ID,
            "生産区分名":         row.生産区分名,
            "生産工程ID":         row.生産工程ID,
            "生産工程名":         row.生産工程名,
            "払出商品ID":         row.払出商品ID,
            "払出商品名":         row.払出商品名,
            "払出単位":           row.払出単位,
            "計算分子数量":       row.計算分子数量,
            "計算分母数量":       row.計算分母数量,
            "最小ロット構成数量": row.最小ロット構成数量,
            "払出数量":           row.払出数量,
            "所要数量備考":       row.所要数量備考,
            "有効":               bool(row.有効) if row.有効 is not None else True,
            "生産内容":           row.生産内容,
            "更新日時":           row.更新日時,
            "更新利用者ID":       row.更新利用者ID,
            "更新利用者名":       row.更新利用者名,
        })

    return schemas.ResponseBase(
        status="OK",
        message="生産払出一覧を取得しました",
        data={"items": items, "total": total, "limit": limit_value}
    )
