# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""2テーブルの専用DBを初期化する。旧DBにはアクセスしない。"""
import os
from pathlib import Path

from sqlalchemy import URL, create_engine, event
from sqlalchemy.engine import Engine

from apps_models.T日誌 import 日誌Base

現日誌ファイル = "diary_v20261127.db"


def 日誌DB初期化() -> Engine:
    場所 = Path.home() / ".aidiy" / "datas"
    場所.mkdir(mode=0o700, parents=True, exist_ok=True)
    パス = 場所 / 現日誌ファイル
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
        接続.exec_driver_sql("BEGIN IMMEDIATE" if 接続.get_execution_options().get("diary_write") else "BEGIN")

    try:
        with db_engine.connect().execution_options(diary_write=True) as conn, conn.begin():
            # ファイル名の日付は保存先の版。コピー済みの v4 と同じスキーマを使う。
            版 = conn.exec_driver_sql("PRAGMA user_version").scalar_one()
            if 版 == 0:
                日誌Base.metadata.create_all(conn)
                conn.exec_driver_sql("PRAGMA user_version = 4")
            elif 版 != 4:
                raise RuntimeError("対応していない日誌DBの版です。")
    except Exception:
        db_engine.dispose()
        raise
    return db_engine
