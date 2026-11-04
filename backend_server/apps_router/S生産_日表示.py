# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, and_, or_, text
from sqlalchemy.orm import Session

import apps_schema as schemas
import deps
import apps_models as models
from apps_crud.utils import update_audit_fields
from log_config import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/apps/S生産_日表示", tags=["S生産_日表示"])


class 対象日Request(BaseModel):
    対象日付: Optional[str] = None


class 日付範囲Request(BaseModel):
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None


class 生産ドラッグRequest(BaseModel):
    生産伝票ID: str
    生産工程ID: str
    変更後日付: Optional[str] = None
    変更後開始日時: Optional[str] = None
    変更後終了日時: Optional[str] = None


class 生産リサイズRequest(BaseModel):
    生産伝票ID: str
    変更後開始日時: str
    変更後終了日時: str


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _parse_date(value: str) -> datetime.date:
    return datetime.fromisoformat(value).date()


def _to_naive_iso(value: datetime) -> str:
    if value.tzinfo:
        value = value.replace(tzinfo=None)
    return value.replace(microsecond=0).isoformat()


def _expand_target_date(target_date: Optional[str]) -> Dict[str, Optional[str]]:
    start_date = target_date
    end_date = target_date
    if target_date:
        try:
            target_dt = _parse_date(target_date)
            start_date = (target_dt - timedelta(days=30)).strftime("%Y-%m-%d")
            end_date = (target_dt + timedelta(days=30)).strftime("%Y-%m-%d")
        except ValueError:
            logger.warning("日付形式が不正です: %s", target_date)
    return {"開始日付": start_date, "終了日付": end_date}


@router.post("/生産工程一覧", response_model=schemas.ResponseBase)
def get_daily_processes(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    processes = db.query(models.M生産工程).filter(models.M生産工程.有効 == True).order_by(models.M生産工程.生産工程ID).all()
    items = [
        {
            "生産工程ID": process.生産工程ID,
            "生産工程名": process.生産工程名,
            "生産工程備考": process.生産工程備考 or ""
        }
        for process in processes
    ]
    logger.info("S生産_日表示 生産工程一覧取得: 件数=%d", len(items))
    return schemas.ResponseBase(
        status="OK",
        message="生産工程一覧を取得しました",
        data={"生産工程一覧": items}
    )


@router.post("/生産一覧", response_model=schemas.ResponseBase)
def get_daily_schedules(
    request: Optional[対象日Request] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    target_date = request.対象日付 if request else None
    expanded = _expand_target_date(target_date)
    start_date = expanded["開始日付"]
    end_date = expanded["終了日付"]

    conditions = []
    params: Dict[str, Any] = {}
    conditions.append("T.明細SEQ = 0")  # ヘッダ行のみ
    conditions.append("T.有効 = 1")
    if start_date:
        conditions.append("date(T.生産終了日時) >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("date(T.生産開始日時) <= :end_date")
        params["end_date"] = end_date

    where_sql = ""
    if conditions:
        where_sql = "WHERE " + " AND ".join(conditions)

    sql = f"""
    SELECT
        T.生産伝票ID,
        T.受入商品ID,
        T.最小ロット数量,
        T.受入数量,
        T.生産開始日時,
        T.生産終了日時,
        T.生産区分ID,
        COALESCE(M2.生産区分名, '通常') AS 生産区分名,
        COALESCE(M2.配色枠, '#0066cc') AS 配色枠,
        COALESCE(M2.配色背景, '#e6f2ff') AS 配色背景,
        COALESCE(M2.配色前景, '#0066cc') AS 配色前景,
        COALESCE(T.生産内容, '') AS 生産内容,
        T.生産工程ID,
        COALESCE(T.生産備考, '') AS 生産備考,
        COALESCE(M.商品名, '') AS 商品名,
        COALESCE(M.単位, '') AS 単位
    FROM T生産 T
    LEFT JOIN M生産区分 M2 ON T.生産区分ID = M2.生産区分ID
    LEFT JOIN M商品 M ON T.受入商品ID = M.商品ID
    {where_sql}
    ORDER BY T.生産開始日時 DESC
    """

    rows = db.execute(text(sql), params).fetchall()
    items = []
    for row in rows:
        items.append({
            "生産伝票ID": row.生産伝票ID,
            "受入商品ID": row.受入商品ID,
            "最小ロット数量": row.最小ロット数量,
            "受入数量": row.受入数量,
            "生産開始日時": row.生産開始日時,
            "生産終了日時": row.生産終了日時,
            "生産区分ID": row.生産区分ID,
            "生産区分名": row.生産区分名,
            "配色枠": row.配色枠,
            "配色背景": row.配色背景,
            "配色前景": row.配色前景,
            "生産内容": row.生産内容,
            "生産工程ID": row.生産工程ID,
            "生産備考": row.生産備考,
            "商品名": row.商品名,
            "単位": row.単位
        })

    logger.info("S生産_日表示 生産一覧取得: 開始=%s 終了=%s 件数=%d", start_date, end_date, len(items))
    return schemas.ResponseBase(
        status="OK",
        message="生産一覧を取得しました",
        data={"生産一覧": items}
    )


@router.post("/データ", response_model=schemas.ResponseBase)
def get_daily_view_data(
    request: Optional[対象日Request] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    processes_response = get_daily_processes(db=db, 現在利用者=現在利用者)
    if processes_response.status != "OK":
        return processes_response

    schedules_response = get_daily_schedules(request=request, db=db, 現在利用者=現在利用者)
    if schedules_response.status != "OK":
        return schedules_response

    logger.info(
        "S生産_日表示 データ取得: 生産工程=%d 生産=%d",
        len(processes_response.data.get("生産工程一覧", [])) if processes_response.data else 0,
        len(schedules_response.data.get("生産一覧", [])) if schedules_response.data else 0,
    )
    return schemas.ResponseBase(
        status="OK",
        message="S生産_日表示データを取得しました",
        data={
            "生産工程一覧": processes_response.data.get("生産工程一覧", []) if processes_response.data else [],
            "生産一覧": schedules_response.data.get("生産一覧", []) if schedules_response.data else []
        }
    )


@router.post("/ドラッグ更新", response_model=schemas.ResponseBase)
def update_schedule_drag(
    request: 生産ドラッグRequest,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    logger.info("S生産_日表示 ドラッグ更新開始: 生産伝票ID=%s 生産工程ID=%s", request.生産伝票ID, request.生産工程ID)
    record = db.query(models.T生産).filter(
        models.T生産.生産伝票ID == request.生産伝票ID,
        models.T生産.明細SEQ == 0,
        models.T生産.有効 == True
    ).first()
    if not record:
        logger.warning("S生産_日表示 ドラッグ更新失敗: 生産伝票ID=%s が未存在", request.生産伝票ID)
        return schemas.ResponseBase(status="NG", message="生産伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    audit = update_audit_fields(認証情報)

    if request.変更後開始日時 and request.変更後終了日時:
        new_start_datetime = _parse_datetime(request.変更後開始日時)
        new_end_datetime = _parse_datetime(request.変更後終了日時)
    else:
        if not request.変更後日付:
            return schemas.ResponseBase(
                status="NG",
                message="必須パラメータが不足しています（生産伝票ID, 生産工程ID, 変更後日付）",
                error={"code": "MISSING_PARAMS"}
            )
        start_dt = _parse_datetime(record.生産開始日時)
        end_dt = _parse_datetime(record.生産終了日時)
        date_delta = _parse_date(request.変更後日付) - start_dt.date()
        new_start_datetime = start_dt + timedelta(days=date_delta.days)
        new_end_datetime = end_dt + timedelta(days=date_delta.days)

    if new_start_datetime >= new_end_datetime:
        return schemas.ResponseBase(
            status="NG",
            message="開始日時は終了日時より前でなければなりません",
            error={"code": "INVALID_RANGE"}
        )

    new_start_iso = _to_naive_iso(new_start_datetime)
    new_end_iso = _to_naive_iso(new_end_datetime)

    overlapping = db.query(models.T生産).filter(
        models.T生産.明細SEQ == 0,
        models.T生産.有効 == True,
        models.T生産.生産工程ID == request.生産工程ID,
        models.T生産.生産伝票ID != request.生産伝票ID,
        models.T生産.生産開始日時 < new_end_iso,
        models.T生産.生産終了日時 > new_start_iso
    ).first()
    if overlapping:
        return schemas.ResponseBase(
            status="NG",
            message=f"生産工程 {request.生産工程ID} が既存の生産（{overlapping.生産伝票ID}）と重複します",
            error={"code": "OVERLAP"}
        )

    record.生産工程ID = request.生産工程ID
    record.生産開始日時 = new_start_iso
    record.生産終了日時 = new_end_iso
    for key, value in audit.items():
        setattr(record, key, value)
    db.commit()

    logger.info("S生産_日表示 ドラッグ更新完了: 生産伝票ID=%s", request.生産伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="生産スケジュールを更新しました",
        data={"生産伝票ID": request.生産伝票ID}
    )


@router.post("/リサイズ更新", response_model=schemas.ResponseBase)
def update_schedule_resize(
    request: 生産リサイズRequest,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    logger.info("S生産_日表示 リサイズ更新開始: 生産伝票ID=%s", request.生産伝票ID)
    record = db.query(models.T生産).filter(
        models.T生産.生産伝票ID == request.生産伝票ID,
        models.T生産.明細SEQ == 0,
        models.T生産.有効 == True
    ).first()
    if not record:
        logger.warning("S生産_日表示 リサイズ更新失敗: 生産伝票ID=%s が未存在", request.生産伝票ID)
        return schemas.ResponseBase(status="NG", message="生産伝票が見つかりません", error={"code": "NOT_FOUND"})

    new_start_datetime = _parse_datetime(request.変更後開始日時)
    new_end_datetime = _parse_datetime(request.変更後終了日時)
    if new_start_datetime >= new_end_datetime:
        return schemas.ResponseBase(
            status="NG",
            message="開始日時は終了日時より前でなければなりません",
            error={"code": "INVALID_RANGE"}
        )

    new_start_iso = _to_naive_iso(new_start_datetime)
    new_end_iso = _to_naive_iso(new_end_datetime)

    overlapping = db.query(models.T生産).filter(
        models.T生産.明細SEQ == 0,
        models.T生産.有効 == True,
        models.T生産.生産工程ID == record.生産工程ID,
        models.T生産.生産伝票ID != request.生産伝票ID,
        models.T生産.生産開始日時 < new_end_iso,
        models.T生産.生産終了日時 > new_start_iso
    ).first()
    if overlapping:
        return schemas.ResponseBase(
            status="NG",
            message=f"生産工程 {record.生産工程ID} が既存の生産（{overlapping.生産伝票ID}）と重複します",
            error={"code": "OVERLAP"}
        )

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    audit = update_audit_fields(認証情報)

    record.生産開始日時 = new_start_iso
    record.生産終了日時 = new_end_iso
    for key, value in audit.items():
        setattr(record, key, value)
    db.commit()

    logger.info("S生産_日表示 リサイズ更新完了: 生産伝票ID=%s", request.生産伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="生産期間を更新しました",
        data={"生産伝票ID": request.生産伝票ID}
    )


@router.post("/最終更新日時", response_model=schemas.ResponseBase)
def get_display_data_last_modified(
    request: 日付範囲Request,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    if not request.開始日付 or not request.終了日付:
        logger.warning("S生産_日表示 最終更新日時: 日付範囲不足")
        return schemas.ResponseBase(
            status="NG",
            message="開始日付と終了日付を指定してください",
            error={"code": "MISSING_PARAMS"}
        )

    最終更新日時 = db.query(func.max(models.T生産.更新日時)).filter(
        models.T生産.明細SEQ == 0,
        models.T生産.有効 == True,
        or_(
            func.date(models.T生産.生産開始日時).between(request.開始日付, request.終了日付),
            func.date(models.T生産.生産終了日時).between(request.開始日付, request.終了日付),
            and_(
                func.date(models.T生産.生産開始日時) <= request.開始日付,
                func.date(models.T生産.生産終了日時) >= request.終了日付
            )
        )
    ).scalar()

    if not 最終更新日時:
        最終更新日時 = None

    logger.info("S生産_日表示 最終更新日時取得: 開始=%s 終了=%s 結果=%s", request.開始日付, request.終了日付, 最終更新日時)
    return schemas.ResponseBase(
        status="OK",
        message="最終更新日時を取得しました",
        data={"最終更新日時": 最終更新日時}
    )
