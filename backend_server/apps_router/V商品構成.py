# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional

import apps_models as models
import apps_schema as schemas
import deps
from list_controls import append_active_condition, get_limit_clause

router = APIRouter(prefix="/apps/V商品構成", tags=["V商品構成"])


@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V商品構成(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者),
):
    conditions = ["C.明細SEQ = 0"]
    append_active_condition(conditions, request, "C.有効")
    params = {}
    if request and request.生産区分ID:
        conditions.append("C.生産区分ID = :生産区分ID")
        params["生産区分ID"] = request.生産区分ID
    where_sql = f"WHERE {' AND '.join(conditions)}"
    limit_sql, limit_value = get_limit_clause(request)
    if limit_value is not None:
        params["limit"] = limit_value

    sql = f"""
    SELECT
        C.商品ID,
        P.商品名,
        P.単位,
        C.最小ロット数量,
        C.生産区分ID,
        S.生産区分名,
        C.生産工程ID,
        K.生産工程名,
        C.段取分数,
        C.時間生産数量,
        C.商品構成備考,
        C.有効,
        (
            SELECT COUNT(*)
            FROM M商品構成 D
            WHERE D.商品ID = C.商品ID AND D.明細SEQ > 0
        ) AS 構成商品件数,
        C.登録日時,
        C.登録利用者ID,
        C.登録利用者名,
        C.登録端末ID,
        C.更新日時,
        C.更新利用者ID,
        C.更新利用者名,
        C.更新端末ID
    FROM M商品構成 C
    LEFT JOIN M商品 P ON C.商品ID = P.商品ID
    LEFT JOIN M生産区分 S ON C.生産区分ID = S.生産区分ID
    LEFT JOIN M生産工程 K ON C.生産工程ID = K.生産工程ID
    {where_sql}
    ORDER BY C.商品ID
    {limit_sql}
    """

    result = db.execute(text(sql), params).fetchall()
    items = []
    for row in result:
        items.append({
            "商品ID": row.商品ID,
            "商品名": row.商品名,
            "単位": row.単位,
            "最小ロット数量": float(row.最小ロット数量) if row.最小ロット数量 is not None else 0,
            "生産区分ID": row.生産区分ID,
            "生産区分名": row.生産区分名,
            "生産工程ID": row.生産工程ID,
            "生産工程名": row.生産工程名,
            "段取分数": int(row.段取分数) if row.段取分数 is not None else None,
            "時間生産数量": float(row.時間生産数量) if row.時間生産数量 is not None else None,
            "商品構成備考": row.商品構成備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "構成商品件数": row.構成商品件数,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID,
        })

    total = db.execute(text(f"SELECT count(*) FROM M商品構成 C {where_sql}"), params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V商品構成一覧を取得しました",
        data={
            "items": items,
            "total": total,
            "limit": limit_value,
        },
    )
