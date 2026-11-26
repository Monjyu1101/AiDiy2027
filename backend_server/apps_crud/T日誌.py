# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import os
from pathlib import Path

from sqlalchemy import URL, create_engine, delete, event, func, insert, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from apps_crud.utils import create_audit_fields, update_audit_fields
from apps_models.T日誌 import T日誌, T日誌明細, T日誌記録, 日誌Base
from apps_schema.T日誌 import T日誌一覧要求, T日誌保存要求
from list_controls import get_list_limit


def 日誌DB初期化() -> Engine:
    """Apps起動時にだけ専用DBを作る。既存データには触れない。"""
    パス = Path.home() / ".aidiy" / "diary" / "diary.db"
    パス.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        fd = os.open(パス, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    db_engine = create_engine(URL.create("sqlite+pysqlite", database=str(パス)), hide_parameters=True)

    @event.listens_for(db_engine, "connect")
    def _接続(接続, _):
        接続.isolation_level = None
        接続.execute("PRAGMA foreign_keys=ON")

    @event.listens_for(db_engine, "begin")
    def _開始(接続):
        接続.exec_driver_sql("BEGIN")

    try:
        日誌Base.metadata.create_all(db_engine)
    except Exception:
        db_engine.dispose()
        raise
    return db_engine


def _所有者条件(モデル, 利用者ID: str, 日付: str):
    return (モデル.利用者ID == 利用者ID, モデル.日付 == 日付)


def 一覧(db: Session, 利用者ID: str, 要求: T日誌一覧要求):
    条件 = [T日誌.利用者ID == 利用者ID, T日誌.有効.is_(True)]
    if 要求.開始日付:
        条件.append(T日誌.日付 >= 要求.開始日付)
    if 要求.終了日付:
        条件.append(T日誌.日付 <= 要求.終了日付)
    記録件数 = (
        select(func.count())
        .select_from(T日誌記録)
        .where(T日誌記録.利用者ID == T日誌.利用者ID, T日誌記録.日付 == T日誌.日付)
        .scalar_subquery()
        .label("記録件数")
    )
    limit = get_list_limit(要求)
    total = db.scalar(select(func.count()).select_from(T日誌).where(*条件))
    query = select(T日誌.日付, T日誌.利用者ID, T日誌.利用者名, 記録件数).where(*条件).order_by(T日誌.日付.desc())
    items = db.execute(query.limit(limit)).mappings()
    return {"items": [dict(行) for 行 in items], "total": total, "limit": limit}


def 取得(db: Session, 利用者ID: str, 日付: str):
    見出し = db.get(T日誌, (利用者ID, 日付))
    if 見出し is None or not 見出し.有効:
        return None
    記録 = {
        行.記録SEQ: {"記録SEQ": 行.記録SEQ, "記録タイトル": 行.記録タイトル, "明細": []}
        for 行 in db.scalars(
            select(T日誌記録).where(*_所有者条件(T日誌記録, 利用者ID, 日付)).order_by(T日誌記録.記録SEQ)
        )
    }
    for 行 in db.scalars(
        select(T日誌明細).where(*_所有者条件(T日誌明細, 利用者ID, 日付)).order_by(T日誌明細.記録SEQ, T日誌明細.行SEQ)
    ):
        記録[行.記録SEQ]["明細"].append(
            {"行SEQ": 行.行SEQ, "内容": 行.内容, "ファイル名": 行.ファイル名, "base64内容": 行.base64内容}
        )
    return {"日付": 日付, "利用者ID": 利用者ID, "利用者名": 見出し.利用者名, "記録": list(記録.values())}


def _明細登録(db: Session, 利用者ID: str, 要求: T日誌保存要求):
    共通 = {"利用者ID": 利用者ID, "日付": 要求.日付}
    db.execute(
        insert(T日誌記録),
        [{**共通, "記録SEQ": 記録.記録SEQ, "記録タイトル": 記録.記録タイトル} for 記録 in 要求.記録],
    )
    明細 = [
        {**共通, "記録SEQ": 記録.記録SEQ, **行.model_dump()}
        for 記録 in 要求.記録
        for 行 in 記録.明細
    ]
    if 明細:
        db.execute(insert(T日誌明細), 明細)


def 保存(db: Session, 認証情報: dict, 要求: T日誌保存要求, *, 新規: bool):
    利用者ID = 認証情報["利用者ID"]
    with db.begin():
        if 新規:
            stmt = (
                sqlite_insert(T日誌)
                .values(日付=要求.日付, **認証情報, **create_audit_fields(認証情報))
                .on_conflict_do_nothing(index_elements=[T日誌.利用者ID, T日誌.日付])
            )
        else:
            stmt = (
                update(T日誌)
                .where(*_所有者条件(T日誌, 利用者ID, 要求.日付), T日誌.有効.is_(True))
                .values(利用者名=認証情報["利用者名"], **update_audit_fields(認証情報))
            )
        if db.execute(stmt).rowcount != 1:
            return None
        if not 新規:
            # 記録の削除に明細が従う。見出しの更新から再登録までを一つのトランザクションとする。
            db.execute(delete(T日誌記録).where(*_所有者条件(T日誌記録, 利用者ID, 要求.日付)))
        _明細登録(db, 利用者ID, 要求)
        return 取得(db, 利用者ID, 要求.日付)


def 削除(db: Session, 利用者ID: str, 日付: str) -> bool:
    with db.begin():
        return db.execute(delete(T日誌).where(*_所有者条件(T日誌, 利用者ID, 日付))).rowcount == 1
