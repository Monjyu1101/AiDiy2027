# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

import os
import sys

# UTF-8出力を強制（Windows文字化け対策）
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import database, core_crud, core_models
import threading
import time
import auth as token_auth
from conf import conf as app_conf
from log_config import setup_logging, get_logger

# ロガー取得
logger = get_logger(__name__)

from core_router import auth
from core_router import C権限
from core_router import V権限
from core_router import C利用者
from core_router import V利用者
from core_router import C採番
from core_router import V採番
from core_router import files

from core_router import AIコア
from core_router import A会話履歴

# テーブル作成（core系のみ）
database.Base.metadata.create_all(
    bind=database.engine,
    tables=[
        core_models.C採番.__table__,
        core_models.C権限.__table__,
        core_models.C利用者.__table__,
        core_models.A会話履歴.__table__,
    ]
)

app = FastAPI(title="Welcome to AiDiy system")

# CORS設定
origins = [
    "http://localhost:5173", # Vite default
    "http://127.0.0.1:5173", # Vite default
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8090", # New Port
    "http://127.0.0.1:8090", # New Port
    "http://localhost:8092", # Avatar Port
    "http://127.0.0.1:8092", # Avatar Port
    "https://localhost",     # Docker Nginx HTTPS
    "http://localhost",      # Docker Nginx HTTP
    "https://127.0.0.1",     # Docker Nginx HTTPS
    "http://127.0.0.1",      # Docker Nginx HTTP
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(auth.router)
app.include_router(C権限.router)
app.include_router(V権限.router)
app.include_router(C利用者.router)
app.include_router(V利用者.router)
app.include_router(C採番.router)
app.include_router(V採番.router)
app.include_router(files.router)

app.include_router(AIコア.router)
app.include_router(A会話履歴.router)

@app.on_event("startup")
def startup_event():
    # tempフォルダ準備 & 再起動フラグ処理
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    reboot_self_path = os.path.join(temp_dir, "reboot_core.txt")
    if os.path.isfile(reboot_self_path):
        try:
            os.remove(reboot_self_path)
        except Exception:
            pass
        raise SystemExit("reboot_core.txt detected")
    def reboot_watcher() -> None:
        while True:
            try:
                if os.path.isfile(reboot_self_path):
                    try:
                        os.remove(reboot_self_path)
                    except Exception:
                        pass
                    os._exit(0)
            except Exception:
                pass
            time.sleep(1)
    threading.Thread(target=reboot_watcher, daemon=True).start()

    # ログ設定
    setup_logging()

    # 構成情報を初期化
    if not app_conf.init():
        logger.warning("構成情報の初期化に失敗しました")
    # Shortcut for easy access (app.conf)
    app.conf = app_conf

    # DB初期化 & VIEW作成
    db = database.SessionLocal()
    try:
        core_crud.init_db_data(db)
    finally:
        db.close()

    # 通常/内部の別署名鍵を永続化し、有効な最新鍵は起動時に再利用する。
    rotator = token_auth.get_keyring()
    rotator.on_error = lambda: logger.warning("認証鍵の更新に失敗しました。再試行します")
    rotator.start()
    app.state.internal_token_authority = rotator
    app.state.internal_token_rotator = rotator


@app.on_event("shutdown")
def shutdown_internal_auth():
    rotator = getattr(app.state, "internal_token_rotator", None)
    if rotator is not None:
        rotator.stop()


@app.get("/")
def read_root():
    return {"message": "FastAPI Server is running"}

@app.get("/core/サーバー状態")
def get_ready_count():
    """サーバー状態を返すエンドポイント（タイトルバーのアニメーション用）"""
    # 簡易実装: 常に処理可能状態を返す
    # 実際の実装では、タスクキューやワーカーの状態を確認する
    # ログ出力なし（頻繁に呼ばれるため）
    return {
        "ready_count": 1,  # 処理可能数
        "busy_count": 0    # 処理中数
    }
