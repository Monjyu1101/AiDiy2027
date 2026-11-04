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

router = APIRouter(prefix="/core/V利用者", tags=["V利用者"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V利用者(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    conditions = []
    append_active_condition(conditions, request, 'u."有効"')
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    limit_sql, limit_value = get_limit_clause(request)
    params = {}
    if limit_value is not None:
        params["limit"] = limit_value

    sql = f"""
    SELECT
        u."利用者ID",
        u."利用者名",
        u."権限ID",
        COALESCE(u."利用者備考", '') AS "利用者備考",
        u."有効",
        u."登録日時",
        u."登録利用者ID",
        COALESCE(u."登録利用者名", '') AS "登録利用者名",
        u."登録端末ID",
        u."更新日時",
        u."更新利用者ID",
        COALESCE(u."更新利用者名", '') AS "更新利用者名",
        u."更新端末ID",
        COALESCE(p."権限名", '') AS "権限名",
        COALESCE(p."権限備考", '') AS "権限備考"
    FROM "C利用者" u
    LEFT JOIN "C権限" p ON u."権限ID" = p."権限ID"
    {where_sql}
    {limit_sql}
    """
    
    result = db.execute(text(sql), params).fetchall()
    
    # 辞書リストに変換
    items = []
    for row in result:
        # rowはタプルまたはRowオブジェクト。カラム名でアクセス可能。
        item = {
            "利用者ID": row.利用者ID,
            "利用者名": row.利用者名,
            "権限ID": row.権限ID,
            "利用者備考": row.利用者備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID,
            "権限名": row.権限名,
            "権限備考": row.権限備考
        }
        items.append(item)
        
    # トータル件数
    count_sql = f"""
    SELECT count(*)
    FROM "C利用者" u
    LEFT JOIN "C権限" p ON u."権限ID" = p."権限ID"
    {where_sql}
    """
    total = db.execute(text(count_sql), params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V利用者一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )


