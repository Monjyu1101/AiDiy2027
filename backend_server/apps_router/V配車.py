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

router = APIRouter(prefix="/apps/V配車", tags=["V配車"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V配車(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    filter_params = {}
    conditions = []
    append_active_condition(conditions, request, "T.有効")

    if request and request.開始日付:
        conditions.append("""
        (
            date(T.配車開始日時) >= :start_date
            OR date(T.配車終了日時) >= :start_date
        )
        """)
        filter_params["start_date"] = request.開始日付

    if request and request.終了日付:
        conditions.append("""
        (
            date(T.配車開始日時) <= :end_date
            OR date(T.配車終了日時) <= :end_date
        )
        """)
        filter_params["end_date"] = request.終了日付

    where_sql = ""
    if conditions:
        where_sql = "WHERE " + " AND ".join(conditions)

    limit_sql, limit_value = get_limit_clause(request)
    sql = f"""
    SELECT
        T.配車伝票ID,
        T.配車開始日時,
        T.配車終了日時,
        T.配車区分ID,
        T.車両ID,
        T.配車内容,
        T.配車備考,
        T.有効,
        T.登録日時,
        T.登録利用者ID,
        T.登録利用者名,
        T.登録端末ID,
        T.更新日時,
        T.更新利用者ID,
        T.更新利用者名,
        T.更新端末ID,
        M2.配車区分名,
        M2.配車区分備考,
        M2.配色枠,
        M2.配色背景,
        M2.配色前景,
        M1.車両名,
        M1.車両備考
    FROM T配車 T
    LEFT JOIN M車両 M1 ON T.車両ID = M1.車両ID
    LEFT JOIN M配車区分 M2 ON T.配車区分ID = M2.配車区分ID
    {where_sql}
    ORDER BY T.配車開始日時 DESC
    {limit_sql}
    """

    params = {**filter_params}
    if limit_value is not None:
        params["limit"] = limit_value
    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "配車伝票ID": row.配車伝票ID,
            "配車開始日時": row.配車開始日時,
            "配車終了日時": row.配車終了日時,
            "配車区分ID": row.配車区分ID,
            "車両ID": row.車両ID,
            "配車内容": row.配車内容,
            "配車備考": row.配車備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID,
            "配車区分名": row.配車区分名,
            "配車区分備考": row.配車区分備考,
            "配色枠": row.配色枠,
            "配色背景": row.配色背景,
            "配色前景": row.配色前景,
            "車両名": row.車両名,
            "車両備考": row.車両備考
        })

    count_sql = f"""
    SELECT count(*)
    FROM T配車 T
    LEFT JOIN M車両 M1 ON T.車両ID = M1.車両ID
    LEFT JOIN M配車区分 M2 ON T.配車区分ID = M2.配車区分ID
    {where_sql}
    """
    total = db.execute(text(count_sql), filter_params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V配車一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )
