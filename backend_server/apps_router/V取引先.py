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

router = APIRouter(prefix="/apps/V取引先", tags=["V取引先"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V取引先(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    conditions = []
    append_active_condition(conditions, request, "M.有効")
    limit_sql, limit_value = get_limit_clause(request)
    params = {}
    取引先分類ID = getattr(request, "取引先分類ID", None) if request else None
    if 取引先分類ID:
        conditions.append("M.取引先分類ID = :取引先分類ID")
        params["取引先分類ID"] = 取引先分類ID
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    if limit_value is not None:
        params["limit"] = limit_value

    sql = f"""
    SELECT M.取引先ID, M.取引先名, M.取引先分類ID, C.取引先分類名,
           M.取引先郵便番号, M.取引先住所, M.取引先電話番号, M.取引先メールアドレス, M.取引先備考,
           M.有効,
           M.登録日時, M.登録利用者ID, M.登録利用者名, M.登録端末ID,
           M.更新日時, M.更新利用者ID, M.更新利用者名, M.更新端末ID
    FROM M取引先 M
    LEFT JOIN M取引先分類 C ON M.取引先分類ID = C.取引先分類ID
    {where_sql}
    ORDER BY M.取引先ID
    {limit_sql}
    """

    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "取引先ID": row.取引先ID,
            "取引先名": row.取引先名,
            "取引先分類ID": row.取引先分類ID,
            "取引先分類名": row.取引先分類名,
            "取引先郵便番号": row.取引先郵便番号,
            "取引先住所": row.取引先住所,
            "取引先電話番号": row.取引先電話番号,
            "取引先メールアドレス": row.取引先メールアドレス,
            "取引先備考": row.取引先備考,
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

    count_sql = f'SELECT count(*) FROM M取引先 M {where_sql}'
    total = db.execute(text(count_sql), params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V取引先一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value
        }
    )
