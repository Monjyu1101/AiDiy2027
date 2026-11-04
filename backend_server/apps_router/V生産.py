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

router = APIRouter(prefix="/apps/V生産", tags=["V生産"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V生産(
    request: Optional[schemas.V生産ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    filter_params = {}
    conditions = ["T.明細SEQ = 0"]  # ヘッダ行のみ
    append_active_condition(conditions, request, "T.有効")

    if request and request.開始日付:
        conditions.append("""
        (
            date(T.生産開始日時) >= :start_date
            OR date(T.生産終了日時) >= :start_date
        )
        """)
        filter_params["start_date"] = request.開始日付

    if request and request.終了日付:
        conditions.append("""
        (
            date(T.生産開始日時) <= :end_date
            OR date(T.生産終了日時) <= :end_date
        )
        """)
        filter_params["end_date"] = request.終了日付

    if request and request.生産区分ID:
        conditions.append("T.生産区分ID = :生産区分ID")
        filter_params["生産区分ID"] = request.生産区分ID

    if request and request.生産工程ID:
        conditions.append("T.生産工程ID = :生産工程ID")
        filter_params["生産工程ID"] = request.生産工程ID

    if request and request.受入商品ID:
        conditions.append("T.受入商品ID = :受入商品ID")
        filter_params["受入商品ID"] = request.受入商品ID

    where_sql = "WHERE " + " AND ".join(conditions)

    limit_sql, limit_value = get_limit_clause(request)
    sql = f"""
    SELECT
        T.生産伝票ID,
        T.受入商品ID,
        T.最小ロット数量,
        T.受入数量,
        T.生産開始日時,
        T.生産終了日時,
        T.生産区分ID,
        T.生産工程ID,
        T.段取分数,
        T.時間生産数量,
        T.生産時間,
        T.生産内容,
        T.生産備考,
        T.有効,
        T.登録日時,
        T.登録利用者ID,
        T.登録利用者名,
        T.登録端末ID,
        T.更新日時,
        T.更新利用者ID,
        T.更新利用者名,
        T.更新端末ID,
        M3.商品名 AS 受入商品名,
        M3.単位,
        M2.生産区分名,
        M2.生産区分備考,
        M2.配色枠,
        M2.配色背景,
        M2.配色前景,
        M1.生産工程名,
        M1.生産工程備考
    FROM T生産 T
    LEFT JOIN M生産工程 M1 ON T.生産工程ID = M1.生産工程ID
    LEFT JOIN M生産区分 M2 ON T.生産区分ID = M2.生産区分ID
    LEFT JOIN M商品 M3 ON T.受入商品ID = M3.商品ID
    {where_sql}
    ORDER BY T.生産開始日時 DESC
    {limit_sql}
    """

    params = {**filter_params}
    if limit_value is not None:
        params["limit"] = limit_value
    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "生産伝票ID": row.生産伝票ID,
            "受入商品ID": row.受入商品ID,
            "最小ロット数量": row.最小ロット数量,
            "受入数量": row.受入数量,
            "生産開始日時": row.生産開始日時,
            "生産終了日時": row.生産終了日時,
            "生産区分ID": row.生産区分ID,
            "生産工程ID": row.生産工程ID,
            "段取分数": row.段取分数,
            "時間生産数量": row.時間生産数量,
            "生産時間": row.生産時間,
            "生産内容": row.生産内容,
            "生産備考": row.生産備考,
            "有効": bool(row.有効) if row.有効 is not None else True,
            "登録日時": row.登録日時,
            "登録利用者ID": row.登録利用者ID,
            "登録利用者名": row.登録利用者名,
            "登録端末ID": row.登録端末ID,
            "更新日時": row.更新日時,
            "更新利用者ID": row.更新利用者ID,
            "更新利用者名": row.更新利用者名,
            "更新端末ID": row.更新端末ID,
            "受入商品名": row.受入商品名,
            "単位": row.単位,
            "生産区分名": row.生産区分名,
            "生産区分備考": row.生産区分備考,
            "配色枠": row.配色枠,
            "配色背景": row.配色背景,
            "配色前景": row.配色前景,
            "生産工程名": row.生産工程名,
            "生産工程備考": row.生産工程備考
        })

    count_sql = f"""
    SELECT count(*)
    FROM T生産 T
    LEFT JOIN M生産工程 M1 ON T.生産工程ID = M1.生産工程ID
    LEFT JOIN M生産区分 M2 ON T.生産区分ID = M2.生産区分ID
    LEFT JOIN M商品 M3 ON T.受入商品ID = M3.商品ID
    {where_sql}
    """
    total = db.execute(text(count_sql), filter_params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V生産一覧を取得しました",
        data={"items": items, "total": total, "limit": limit_value}
    )
