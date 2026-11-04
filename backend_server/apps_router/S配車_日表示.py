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

router = APIRouter(prefix="/apps/S配車_日表示", tags=["S配車_日表示"])


class 対象日Request(BaseModel):
    対象日付: Optional[str] = None


class 日付範囲Request(BaseModel):
    開始日付: Optional[str] = None
    終了日付: Optional[str] = None


class 配車ドラッグRequest(BaseModel):
    配車伝票ID: str
    車両ID: str
    変更後日付: Optional[str] = None
    変更後開始日時: Optional[str] = None
    変更後終了日時: Optional[str] = None


class 配車リサイズRequest(BaseModel):
    配車伝票ID: str
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


@router.post("/車両一覧", response_model=schemas.ResponseBase)
def get_daily_vehicles(
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    vehicles = db.query(models.M車両).filter(models.M車両.有効 == True).order_by(models.M車両.車両ID).all()
    items = [
        {
            "車両ID": vehicle.車両ID,
            "車両名": vehicle.車両名,
            "車両備考": vehicle.車両備考 or ""
        }
        for vehicle in vehicles
    ]
    logger.info("S配車_日表示 車両一覧取得: 件数=%d", len(items))
    return schemas.ResponseBase(
        status="OK",
        message="車両一覧を取得しました",
        data={"車両一覧": items}
    )


@router.post("/配車一覧", response_model=schemas.ResponseBase)
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
    conditions.append("T.有効 = 1")
    if start_date:
        conditions.append("date(T.配車終了日時) >= :start_date")
        params["start_date"] = start_date
    if end_date:
        conditions.append("date(T.配車開始日時) <= :end_date")
        params["end_date"] = end_date

    where_sql = ""
    if conditions:
        where_sql = "WHERE " + " AND ".join(conditions)

    sql = f"""
    SELECT
        T.配車伝票ID,
        T.配車開始日時,
        T.配車終了日時,
        T.配車区分ID,
        COALESCE(M2.配車区分名, '通常') AS 配車区分名,
        COALESCE(M2.配色枠, '#0066cc') AS 配色枠,
        COALESCE(M2.配色背景, '#e6f2ff') AS 配色背景,
        COALESCE(M2.配色前景, '#0066cc') AS 配色前景,
        COALESCE(T.配車内容, '') AS 配車内容,
        T.車両ID,
        COALESCE(T.配車備考, '') AS 配車備考
    FROM T配車 T
    LEFT JOIN M配車区分 M2 ON T.配車区分ID = M2.配車区分ID
    {where_sql}
    ORDER BY T.配車開始日時 DESC
    """

    rows = db.execute(text(sql), params).fetchall()
    items = []
    for row in rows:
        items.append({
            "配車伝票ID": row.配車伝票ID,
            "配車開始日時": row.配車開始日時,
            "配車終了日時": row.配車終了日時,
            "配車区分ID": row.配車区分ID,
            "配車区分名": row.配車区分名,
            "配色枠": row.配色枠,
            "配色背景": row.配色背景,
            "配色前景": row.配色前景,
            "配車内容": row.配車内容,
            "車両ID": row.車両ID,
            "配車備考": row.配車備考
        })

    logger.info("S配車_日表示 配車一覧取得: 開始=%s 終了=%s 件数=%d", start_date, end_date, len(items))
    return schemas.ResponseBase(
        status="OK",
        message="配車一覧を取得しました",
        data={"配車一覧": items}
    )


@router.post("/データ", response_model=schemas.ResponseBase)
def get_daily_view_data(
    request: Optional[対象日Request] = None,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    vehicles_response = get_daily_vehicles(db=db, 現在利用者=現在利用者)
    if vehicles_response.status != "OK":
        return vehicles_response

    schedules_response = get_daily_schedules(request=request, db=db, 現在利用者=現在利用者)
    if schedules_response.status != "OK":
        return schedules_response

    logger.info(
        "S配車_日表示 データ取得: 車両=%d 配車=%d",
        len(vehicles_response.data.get("車両一覧", [])) if vehicles_response.data else 0,
        len(schedules_response.data.get("配車一覧", [])) if schedules_response.data else 0,
    )
    return schemas.ResponseBase(
        status="OK",
        message="S配車_日表示データを取得しました",
        data={
            "車両一覧": vehicles_response.data.get("車両一覧", []) if vehicles_response.data else [],
            "配車一覧": schedules_response.data.get("配車一覧", []) if schedules_response.data else []
        }
    )


@router.post("/ドラッグ更新", response_model=schemas.ResponseBase)
def update_schedule_drag(
    request: 配車ドラッグRequest,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    logger.info("S配車_日表示 ドラッグ更新開始: 配車伝票ID=%s 車両ID=%s", request.配車伝票ID, request.車両ID)
    record = db.query(models.T配車).filter(
        models.T配車.配車伝票ID == request.配車伝票ID,
        models.T配車.有効 == True
    ).first()
    if not record:
        logger.warning("S配車_日表示 ドラッグ更新失敗: 配車伝票ID=%s が未存在", request.配車伝票ID)
        return schemas.ResponseBase(status="NG", message="配車伝票が見つかりません", error={"code": "NOT_FOUND"})

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    audit = update_audit_fields(認証情報)

    if request.変更後開始日時 and request.変更後終了日時:
        new_start_datetime = _parse_datetime(request.変更後開始日時)
        new_end_datetime = _parse_datetime(request.変更後終了日時)
    else:
        if not request.変更後日付:
            return schemas.ResponseBase(
                status="NG",
                message="必須パラメータが不足しています（配車伝票ID, 車両ID, 変更後日付）",
                error={"code": "MISSING_PARAMS"}
            )
        start_dt = _parse_datetime(record.配車開始日時)
        end_dt = _parse_datetime(record.配車終了日時)
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

    overlapping = db.query(models.T配車).filter(
        models.T配車.有効 == True,
        models.T配車.車両ID == request.車両ID,
        models.T配車.配車伝票ID != request.配車伝票ID,
        models.T配車.配車開始日時 < new_end_iso,
        models.T配車.配車終了日時 > new_start_iso
    ).first()
    if overlapping:
        return schemas.ResponseBase(
            status="NG",
            message=f"車両 {request.車両ID} が既存の配車（{overlapping.配車伝票ID}）と重複します",
            error={"code": "OVERLAP"}
        )

    record.車両ID = request.車両ID
    record.配車開始日時 = new_start_iso
    record.配車終了日時 = new_end_iso
    for key, value in audit.items():
        setattr(record, key, value)
    db.commit()

    logger.info("S配車_日表示 ドラッグ更新完了: 配車伝票ID=%s", request.配車伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="配車スケジュールを更新しました",
        data={"配車伝票ID": request.配車伝票ID}
    )


@router.post("/リサイズ更新", response_model=schemas.ResponseBase)
def update_schedule_resize(
    request: 配車リサイズRequest,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    logger.info("S配車_日表示 リサイズ更新開始: 配車伝票ID=%s", request.配車伝票ID)
    record = db.query(models.T配車).filter(
        models.T配車.配車伝票ID == request.配車伝票ID,
        models.T配車.有効 == True
    ).first()
    if not record:
        logger.warning("S配車_日表示 リサイズ更新失敗: 配車伝票ID=%s が未存在", request.配車伝票ID)
        return schemas.ResponseBase(status="NG", message="配車伝票が見つかりません", error={"code": "NOT_FOUND"})

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

    overlapping = db.query(models.T配車).filter(
        models.T配車.有効 == True,
        models.T配車.車両ID == record.車両ID,
        models.T配車.配車伝票ID != request.配車伝票ID,
        models.T配車.配車開始日時 < new_end_iso,
        models.T配車.配車終了日時 > new_start_iso
    ).first()
    if overlapping:
        return schemas.ResponseBase(
            status="NG",
            message=f"車両 {record.車両ID} が既存の配車（{overlapping.配車伝票ID}）と重複します",
            error={"code": "OVERLAP"}
        )

    認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
    audit = update_audit_fields(認証情報)

    record.配車開始日時 = new_start_iso
    record.配車終了日時 = new_end_iso
    for key, value in audit.items():
        setattr(record, key, value)
    db.commit()

    logger.info("S配車_日表示 リサイズ更新完了: 配車伝票ID=%s", request.配車伝票ID)
    return schemas.ResponseBase(
        status="OK",
        message="配車期間を更新しました",
        data={"配車伝票ID": request.配車伝票ID}
    )


@router.post("/最終更新日時", response_model=schemas.ResponseBase)
def get_display_data_last_modified(
    request: 日付範囲Request,
    db: Session = Depends(deps.get_db),
    現在利用者: models.C利用者 = Depends(deps.get_現在利用者)
):
    if not request.開始日付 or not request.終了日付:
        logger.warning("S配車_日表示 最終更新日時: 日付範囲不足")
        return schemas.ResponseBase(
            status="NG",
            message="開始日付と終了日付を指定してください",
            error={"code": "MISSING_PARAMS"}
        )

    最終更新日時 = db.query(func.max(models.T配車.更新日時)).filter(
        models.T配車.有効 == True,
        or_(
            func.date(models.T配車.配車開始日時).between(request.開始日付, request.終了日付),
            func.date(models.T配車.配車終了日時).between(request.開始日付, request.終了日付),
            and_(
                func.date(models.T配車.配車開始日時) <= request.開始日付,
                func.date(models.T配車.配車終了日時) >= request.終了日付
            )
        )
    ).scalar()

    if not 最終更新日時:
        最終更新日時 = None

    logger.info("S配車_日表示 最終更新日時取得: 開始=%s 終了=%s 結果=%s", request.開始日付, request.終了日付, 最終更新日時)
    return schemas.ResponseBase(
        status="OK",
        message="最終更新日時を取得しました",
        data={"最終更新日時": 最終更新日時}
    )
