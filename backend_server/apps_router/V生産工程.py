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

router = APIRouter(prefix="/apps/V生産工程", tags=["V生産工程"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V生産工程(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    conditions = []
    append_active_condition(conditions, request, "有効")
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    limit_sql, limit_value = get_limit_clause(request)
    params = {}
    if limit_value is not None:
        params["limit"] = limit_value

    sql = f"""
    SELECT 生産工程ID, 生産工程名, 生産工程備考,
           有効,
           登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
           更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
    FROM M生産工程
    {where_sql}
    ORDER BY 生産工程ID
    {limit_sql}
    """

    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "生産工程ID": row.生産工程ID,
            "生産工程名": row.生産工程名,
            "生産工程備考": row.生産工程備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID
        })

    count_sql = f"SELECT count(*) FROM M生産工程 {where_sql}"
    total = db.execute(text(count_sql), params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V生産工程一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )
