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

router = APIRouter(prefix="/apps/V生産払出", tags=["V生産払出"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def list_V生産払出(
    request: Optional[schemas.ListRequest] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    filter_params = {}
    conditions = ["T.明細SEQ > 0"]  # 明細行のみ
    append_active_condition(conditions, request, "T.有効")

    # 生産開始日（ヘッダ行の生産開始日時）を基準に日付絞り込み
    if request and request.開始日付:
        conditions.append("date(H.生産開始日時) >= :start_date")
        filter_params["start_date"] = request.開始日付

    if request and request.終了日付:
        conditions.append("date(H.生産開始日時) <= :end_date")
        filter_params["end_date"] = request.終了日付

    where_sql = "WHERE " + " AND ".join(conditions)

    limit_sql, limit_value = get_limit_clause(request)
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
        T.登録日時,
        T.登録利用者ID,
        T.登録利用者名,
        T.登録端末ID,
        T.更新日時,
        T.更新利用者ID,
        T.更新利用者名,
        T.更新端末ID,
        H.生産開始日時,
        H.生産終了日時,
        H.受入数量,
        H.生産内容,
        H.生産備考,
        MR.商品名  AS 受入商品名,
        MR.単位    AS 受入単位,
        MP.商品名  AS 払出商品名,
        MP.単位    AS 払出単位,
        M2.生産区分名,
        M1.生産工程名
    FROM T生産 T
    LEFT JOIN T生産 H
        ON T.生産伝票ID = H.生産伝票ID AND H.明細SEQ = 0
    LEFT JOIN M商品 MR ON T.受入商品ID = MR.商品ID
    LEFT JOIN M商品 MP ON T.払出商品ID = MP.商品ID
    LEFT JOIN M生産区分 M2 ON T.生産区分ID = M2.生産区分ID
    LEFT JOIN M生産工程 M1 ON T.生産工程ID = M1.生産工程ID
    {where_sql}
    ORDER BY H.生産開始日時 DESC, T.生産伝票ID, T.明細SEQ
    {limit_sql}
    """

    params = {**filter_params}
    if limit_value is not None:
        params["limit"] = limit_value
    result = db.execute(text(sql), params).fetchall()

    items = []
    for row in result:
        items.append({
            "生産伝票ID":       row.生産伝票ID,
            "明細SEQ":          row.明細SEQ,
            "生産開始日時":     row.生産開始日時,
            "生産終了日時":     row.生産終了日時,
            "受入商品ID":       row.受入商品ID,
            "受入商品名":       row.受入商品名,
            "受入単位":         row.受入単位,
            "最小ロット数量":   row.最小ロット数量,
            "受入数量":         row.受入数量,
            "生産区分ID":       row.生産区分ID,
            "生産区分名":       row.生産区分名,
            "生産工程ID":       row.生産工程ID,
            "生産工程名":       row.生産工程名,
            "払出商品ID":       row.払出商品ID,
            "払出商品名":       row.払出商品名,
            "払出単位":         row.払出単位,
            "計算分子数量":     row.計算分子数量,
            "計算分母数量":     row.計算分母数量,
            "最小ロット構成数量": row.最小ロット構成数量,
            "払出数量":         row.払出数量,
            "所要数量備考":     row.所要数量備考,
            "有効":             bool(row.有効) if row.有効 is not None else True,
            "生産内容":         row.生産内容,
            "生産備考":         row.生産備考,
            "登録日時":         row.登録日時,
            "登録利用者ID":     row.登録利用者ID,
            "登録利用者名":     row.登録利用者名,
            "登録端末ID":       row.登録端末ID,
            "更新日時":         row.更新日時,
            "更新利用者ID":     row.更新利用者ID,
            "更新利用者名":     row.更新利用者名,
            "更新端末ID":       row.更新端末ID,
        })

    count_sql = f"""
    SELECT count(*)
    FROM T生産 T
    LEFT JOIN T生産 H
        ON T.生産伝票ID = H.生産伝票ID AND H.明細SEQ = 0
    {where_sql}
    """
    total = db.execute(text(count_sql), filter_params).scalar()

    return schemas.ResponseBase(
        status="OK",
        message="V生産払出一覧を取得しました",
        data={"items": items, "total": total, "limit": limit_value}
    )
