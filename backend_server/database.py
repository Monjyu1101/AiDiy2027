# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import URL, create_engine, event
from pathlib import Path
from sqlalchemy.orm import declarative_base, sessionmaker

from database_paths import database_path

# 各プロセスは共通の現行ファイル名だけを使う。旧版へのフォールバックは行わない。
DB_PATH = str(database_path("core"))
APPS_DB_PATH = str(database_path("apps"))


def _engine(path):
    db_engine = create_engine(URL.create("sqlite", database=path),
                              connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(db_engine, "do_connect")
    def prepare_directory(_dialect, _record, _args, _kwargs):
        Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    return db_engine


engine = _engine(DB_PATH)
apps_engine = _engine(APPS_DB_PATH)
SessionLocal = sessionmaker(autoflush=False, bind=engine)
AppsSessionLocal = sessionmaker(autoflush=False, bind=apps_engine)

Base = declarative_base()
AppsBase = declarative_base()


def initialize_core_tables():
    # AppsがCoreより先に起動する場合も日誌採番のテーブルを用意できるようにする。
    import core_models

    with engine.begin() as conn:
        conn.exec_driver_sql("BEGIN IMMEDIATE")
        Base.metadata.create_all(conn, tables=[
            core_models.C採番.__table__, core_models.C権限.__table__,
            core_models.C利用者.__table__, core_models.A会話履歴.__table__,
        ])
