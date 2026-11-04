# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# backend_server/ を基準にしたデータベース既定値（実体はプロジェクトルート）
DEFAULT_DATABASE_PATH = "../_data/AiDiy/database.db"
DB_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), DEFAULT_DATABASE_PATH))
DB_DIR = os.path.dirname(DB_PATH)

# ディレクトリが存在しない場合は作成
os.makedirs(DB_DIR, exist_ok=True)

# SQLiteデータベースのURL
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# データベースエンジンの作成
# check_same_thread=False はSQLiteのみで必要
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# セッションローカルクラスの作成
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ベースクラスの作成
Base = declarative_base()

# DBセッション取得用の依存関係関数
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
