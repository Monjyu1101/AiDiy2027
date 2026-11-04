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
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

import apps_schema as schemas
import deps
import apps_models as models
from log_config import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/apps/V商品推移表", tags=["V商品推移表"])

# ==================================================
# Pydantic Schemas for this router
# ==================================================

class TransitionRequest(BaseModel):
    開始日付: str  # YYYY-MM-DD
    終了日付: str  # YYYY-MM-DD
    商品分類ID: Optional[str] = None


class 日付範囲Request(BaseModel):
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None

class DayData(BaseModel):
    日付: str
    入庫数量: int = 0
    出庫数量: int = 0
    棚卸数量: Optional[int] = None
    生産受入数量: int = 0
    生産払出数量: int = 0
    推定在庫: int = 0
    入庫最終更新日時: Optional[str] = None
    出庫最終更新日時: Optional[str] = None
    棚卸最終更新日時: Optional[str] = None
    生産受入最終更新日時: Optional[str] = None
    生産払出最終更新日時: Optional[str] = None

class ProductTransitionData(BaseModel):
    商品ID: str
    商品名: str
    日別データ: List[DayData]

class TransitionResponse(schemas.ResponseBase):
    data: Dict[str, Any]

# ==================================================
# Endpoints
# ==================================================

@router.post("/一覧", response_model=TransitionResponse)
def list_transition(
    request: TransitionRequest,
    db: Session = Depends(deps.get_db),
    current_user: models.C利用者 = Depends(deps.get_現在利用者)
):
    try:
        start_date_str = request.開始日付
        end_date_str = request.終了日付
        
        # 1. 全商品取得（商品分類IDで絞り込み）
        product_query = db.query(models.M商品).filter(models.M商品.有効 == True)
        if request.商品分類ID:
            product_query = product_query.filter(models.M商品.商品分類ID == request.商品分類ID)
        products = product_query.all()
        # 商品ID順にソート
        products.sort(key=lambda x: x.商品ID)
        product_map = {p.商品ID: p.商品名 for p in products}
        
        # 2. 全トランザクション取得（効率のため全件取得してからメモリで処理）
        # ※データ量が膨大になった場合はSQLで期間絞り込みと集計を行うべきですが、
        #   在庫推移計算のためには期間前のデータも必要なため、今回は全件取得方式を採用
        inbounds = db.query(models.T商品入庫).filter(
            models.T商品入庫.明細SEQ > 0, models.T商品入庫.有効 == True
        ).all()
        outbounds = db.query(models.T商品出庫).filter(
            models.T商品出庫.明細SEQ > 0, models.T商品出庫.有効 == True
        ).all()
        inventories = db.query(models.T商品棚卸).filter(
            models.T商品棚卸.明細SEQ > 0, models.T商品棚卸.有効 == True
        ).all()

        # T生産: ヘッダ行（生産受入）と明細行（生産払出）を取得
        prod_headers = db.query(models.T生産).filter(
            models.T生産.明細SEQ == 0, models.T生産.有効 == True
        ).all()
        prod_details = db.query(models.T生産).filter(
            models.T生産.明細SEQ > 0, models.T生産.有効 == True
        ).all()
        # ヘッダの生産開始日時マップ（払出日付参照用）
        header_start_map = {
            h.生産伝票ID: h.生産開始日時[:10] if h.生産開始日時 else None
            for h in prod_headers
        }
        
        # 3. 日付リスト生成
        date_list = []
        curr = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end = datetime.strptime(end_date_str, "%Y-%m-%d").date()
        
        while curr <= end:
            date_list.append(curr.strftime("%Y-%m-%d"))
            curr += timedelta(days=1)
            
        # 4. 商品ごとに集計
        result_data = []
        
        for pid, pname in product_map.items():
            # この商品のトランザクションを抽出
            p_inbounds = [x for x in inbounds if x.商品ID == pid]
            p_outbounds = [x for x in outbounds if x.商品ID == pid]
            p_inventories = [x for x in inventories if x.商品ID == pid]
            # 生産受入: ヘッダ行の受入商品ID=pid、日付=生産終了日
            p_prod_in = [
                x for x in prod_headers
                if x.受入商品ID == pid and x.生産終了日時 and x.受入数量
            ]
            # 生産払出: 明細行の払出商品ID=pid、日付=ヘッダの生産開始日
            p_prod_out = [
                x for x in prod_details
                if x.払出商品ID == pid and header_start_map.get(x.生産伝票ID) and x.払出数量
            ]

            # 全イベントをフラットな辞書リストに変換
            # type: in/out/inv/prod_in/prod_out
            events = []
            for x in p_inbounds:
                events.append({"date": x.入庫日, "type": "in", "qty": int(x.入庫数量 or 0), "updated": x.更新日時})
            for x in p_outbounds:
                events.append({"date": x.出庫日, "type": "out", "qty": int(x.出庫数量 or 0), "updated": x.更新日時})
            for x in p_inventories:
                events.append({"date": x.棚卸日, "type": "inv", "qty": int(x.実棚数量 or 0), "updated": x.更新日時})
            for x in p_prod_in:
                events.append({"date": x.生産終了日時[:10], "type": "prod_in", "qty": int(x.受入数量 or 0), "updated": x.更新日時})
            for x in p_prod_out:
                start_date = header_start_map.get(x.生産伝票ID)
                events.append({"date": start_date, "type": "prod_out", "qty": int(x.払出数量 or 0), "updated": x.更新日時})

            # 日付順、同日優先度: prod_out(1) -> in(2) -> prod_in(3) -> out(4) -> inv(5)
            type_order = {"prod_out": 1, "in": 2, "prod_in": 3, "out": 4, "inv": 5}
            events.sort(key=lambda x: (x["date"], type_order.get(x["type"], 9)))
            
            # 初期在庫計算（開始日より前のイベントを処理）
            current_stock = 0

            for ev in events:
                if ev["date"] < start_date_str:
                    if ev["type"] in ("in", "prod_in"):
                        current_stock += ev["qty"]
                    elif ev["type"] in ("out", "prod_out"):
                        current_stock -= ev["qty"]
                    elif ev["type"] == "inv":
                        current_stock = ev["qty"]

            # 期間内の日別データ作成
            product_daily_data = []

            for d_str in date_list:
                days_events = [e for e in events if e["date"] == d_str]

                in_qty      = sum(e["qty"] for e in days_events if e["type"] == "in")
                out_qty     = sum(e["qty"] for e in days_events if e["type"] == "out")
                prod_in_qty = sum(e["qty"] for e in days_events if e["type"] == "prod_in")
                prod_out_qty= sum(e["qty"] for e in days_events if e["type"] == "prod_out")
                inv_event   = next((e for e in reversed(days_events) if e["type"] == "inv"), None)

                in_updated       = max([e["updated"] for e in days_events if e["type"] == "in"],       default=None)
                out_updated      = max([e["updated"] for e in days_events if e["type"] == "out"],      default=None)
                prod_in_updated  = max([e["updated"] for e in days_events if e["type"] == "prod_in"],  default=None)
                prod_out_updated = max([e["updated"] for e in days_events if e["type"] == "prod_out"], default=None)
                inv_updated      = inv_event["updated"] if inv_event else None

                # 在庫推移計算（同日優先度に従い処理）
                current_stock -= prod_out_qty   # 払出（生産開始日）
                current_stock += in_qty         # 仕入入庫
                current_stock += prod_in_qty    # 生産受入（生産終了日）
                current_stock -= out_qty        # 仕入出庫

                inv_qty = None
                if inv_event:
                    current_stock = inv_event["qty"]
                    inv_qty = inv_event["qty"]

                product_daily_data.append(DayData(
                    日付=d_str,
                    入庫数量=in_qty,
                    出庫数量=out_qty,
                    棚卸数量=inv_qty,
                    生産受入数量=prod_in_qty,
                    生産払出数量=prod_out_qty,
                    推定在庫=current_stock,
                    入庫最終更新日時=in_updated,
                    出庫最終更新日時=out_updated,
                    棚卸最終更新日時=inv_updated,
                    生産受入最終更新日時=prod_in_updated,
                    生産払出最終更新日時=prod_out_updated,
                ))
            
            result_data.append(ProductTransitionData(
                商品ID=pid,
                商品名=pname,
                日別データ=product_daily_data
            ))
            
        return TransitionResponse(
            status="OK",
            message=f"商品推移データを取得しました（期間: {start_date_str}〜{end_date_str}）",
            data={
                "日付リスト": date_list,
                "商品推移データ": result_data
            }
        )
        
    except Exception as e:
        logger.exception("V商品推移表 取得エラー: %s", e)
        return TransitionResponse(
            status="NG",
            message=f"データ取得中にエラーが発生しました: {str(e)}",
            data={}
        )


@router.post("/最終更新日時", response_model=schemas.ResponseBase)
def get_transition_last_modified(
    request: 日付範囲Request,
    db: Session = Depends(deps.get_db),
    current_user: models.C利用者 = Depends(deps.get_現在利用者)
):
    if not request.開始日付 or not request.終了日付:
        return schemas.ResponseBase(
            status="NG",
            message="開始日付と終了日付を指定してください",
            error={"code": "MISSING_PARAMS"}
        )

    入庫最終更新日時 = db.query(func.max(models.T商品入庫.更新日時)).filter(
        models.T商品入庫.明細SEQ > 0,
        models.T商品入庫.有効 == True,
        func.date(models.T商品入庫.入庫日).between(request.開始日付, request.終了日付)
    ).scalar()
    出庫最終更新日時 = db.query(func.max(models.T商品出庫.更新日時)).filter(
        models.T商品出庫.明細SEQ > 0,
        models.T商品出庫.有効 == True,
        func.date(models.T商品出庫.出庫日).between(request.開始日付, request.終了日付)
    ).scalar()
    棚卸最終更新日時 = db.query(func.max(models.T商品棚卸.更新日時)).filter(
        models.T商品棚卸.明細SEQ > 0,
        models.T商品棚卸.有効 == True,
        func.date(models.T商品棚卸.棚卸日).between(request.開始日付, request.終了日付)
    ).scalar()
    生産最終更新日時 = db.query(func.max(models.T生産.更新日時)).filter(
        models.T生産.有効 == True,
        func.date(
            func.coalesce(models.T生産.生産終了日時, models.T生産.生産開始日時)
        ).between(request.開始日付, request.終了日付)
    ).scalar()

    候補リスト = [値 for 値 in [入庫最終更新日時, 出庫最終更新日時, 棚卸最終更新日時, 生産最終更新日時] if 値 is not None]
    if not 候補リスト:
        最終更新日時 = None
    else:
        最終更新日時 = max(候補リスト)

    return schemas.ResponseBase(
        status="OK",
        message="最終更新日時を取得しました",
        data={"最終更新日時": 最終更新日時}
    )
