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
from sqlalchemy import text
from typing import Optional
import apps_schema as schemas, deps, apps_models as models
from list_controls import append_active_condition, get_limit_clause

router = APIRouter(prefix="/apps/V商品出庫", tags=["V商品出庫"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V商品出庫(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    filter_params = {}
    conditions = ["D.明細SEQ > 0"]
    append_active_condition(conditions, request, "D.有効")

    if request and request.開始日付:
        conditions.append("date(H.出庫日) >= :start_date")
        filter_params["start_date"] = request.開始日付

    if request and request.終了日付:
        conditions.append("date(H.出庫日) <= :end_date")
        filter_params["end_date"] = request.終了日付

    if request and request.商品ID:
        conditions.append("D.商品ID = :商品ID")
        filter_params["商品ID"] = request.商品ID

    where_sql = ""
    if conditions:
        where_sql = "WHERE " + " AND ".join(conditions)

    limit_sql, limit_value = get_limit_clause(request)
    sql = f"""
    SELECT
        (D.出庫伝票ID || '-' || D.明細SEQ) AS 一覧行ID,
        D.出庫伝票ID,
        D.明細SEQ,
        H.出庫日,
        D.商品ID,
        D.出庫数量,
        COALESCE(D.出庫備考, H.出庫備考) AS 出庫備考,
        D.有効,
        H.登録日時,
        H.登録利用者ID,
        H.登録利用者名,
        H.登録端末ID,
        D.更新日時,
        D.更新利用者ID,
        D.更新利用者名,
        D.更新端末ID,
        M.商品名,
        M.単位,
        M.商品備考
    FROM T商品出庫 D
    LEFT JOIN T商品出庫 H ON D.出庫伝票ID = H.出庫伝票ID AND H.明細SEQ = 0
    LEFT JOIN M商品 M ON D.商品ID = M.商品ID
    {where_sql}
    ORDER BY H.出庫日 DESC, D.出庫伝票ID DESC, D.明細SEQ
    {limit_sql}
    """

    params = {**filter_params}
    if limit_value is not None:
        params["limit"] = limit_value
    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "一覧行ID": row.一覧行ID,
            "出庫伝票ID": row.出庫伝票ID,
            "明細SEQ": row.明細SEQ,
            "出庫日": row.出庫日,
            "商品ID": row.商品ID,
            "出庫数量": row.出庫数量,
            "出庫備考": row.出庫備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID,
            "商品名": row.商品名,
            "単位": row.単位,
            "商品備考": row.商品備考
        })

    count_sql = f"""
    SELECT count(*)
    FROM T商品出庫 D
    LEFT JOIN T商品出庫 H ON D.出庫伝票ID = H.出庫伝票ID AND H.明細SEQ = 0
    LEFT JOIN M商品 M ON D.商品ID = M.商品ID
    {where_sql}
    """
    total = db.execute(text(count_sql), filter_params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V商品出庫一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )
