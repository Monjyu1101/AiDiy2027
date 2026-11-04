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
import core_schema as schemas, deps, core_models as models
from list_controls import append_active_condition, get_limit_clause

router = APIRouter(prefix="/core/V採番", tags=["V採番"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V採番(
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
    SELECT 採番ID, 最終採番値, 採番備考,
           有効,
           登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
           更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
    FROM C採番
    {where_sql}
    {limit_sql}
    """

    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "採番ID": row.採番ID,
            "最終採番値": row.最終採番値,
            "採番備考": row.採番備考,
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

    count_sql = f"SELECT count(*) FROM C採番 {where_sql}"
    total = db.execute(text(count_sql), params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V採番一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )

