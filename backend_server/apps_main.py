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
import database, apps_crud, apps_models
from conf import conf as app_conf
import threading
import time
from log_config import setup_logging, get_logger
from AIコア.AIバックアップ import バックアップ実行_共通ログ

# ロガー取得
logger = get_logger(__name__)

from apps_router import M配車区分
from apps_router import V配車区分
from apps_router import M生産区分
from apps_router import V生産区分
from apps_router import M生産工程
from apps_router import V生産工程
from apps_router import M商品分類
from apps_router import V商品分類
from apps_router import M取引先分類
from apps_router import V取引先分類
from apps_router import M取引先
from apps_router import V取引先
from apps_router import M車両
from apps_router import V車両
from apps_router import M商品
from apps_router import V商品
from apps_router import M商品構成
from apps_router import V商品構成
from apps_router import T配車
from apps_router import V配車
from apps_router import T生産
from apps_router import V生産
from apps_router import V生産払出
from apps_router import T商品出庫
from apps_router import V商品出庫
from apps_router import T商品棚卸
from apps_router import V商品棚卸
from apps_router import T商品入庫
from apps_router import V商品入庫
from apps_router import V商品推移表
from apps_router import S配車_週表示
from apps_router import S配車_日表示
from apps_router import S生産_週表示
from apps_router import S生産_日表示

app = FastAPI(title="Welcome to AiDiy system")

# テーブル作成（apps系のみ）
database.Base.metadata.create_all(
    bind=database.engine,
    tables=[
        apps_models.M配車区分.__table__,
        apps_models.M生産区分.__table__,
        apps_models.M生産工程.__table__,
        apps_models.M商品分類.__table__,
        apps_models.M取引先分類.__table__,
        apps_models.M取引先.__table__,
        apps_models.M車両.__table__,
        apps_models.M商品.__table__,
        apps_models.M商品構成.__table__,
        apps_models.T配車.__table__,
        apps_models.T生産.__table__,
        apps_models.T商品出庫.__table__,
        apps_models.T商品棚卸.__table__,
        apps_models.T商品入庫.__table__,
    ]
)

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
app.include_router(M配車区分.router)
app.include_router(V配車区分.router)
app.include_router(M生産区分.router)
app.include_router(V生産区分.router)
app.include_router(M生産工程.router)
app.include_router(V生産工程.router)
app.include_router(M商品分類.router)
app.include_router(V商品分類.router)
app.include_router(M取引先分類.router)
app.include_router(V取引先分類.router)
app.include_router(M取引先.router)
app.include_router(V取引先.router)
app.include_router(M車両.router)
app.include_router(V車両.router)
app.include_router(M商品.router)
app.include_router(V商品.router)
app.include_router(M商品構成.router)
app.include_router(V商品構成.router)
app.include_router(T配車.router)
app.include_router(V配車.router)
app.include_router(T生産.router)
app.include_router(V生産.router)
app.include_router(V生産払出.router)
app.include_router(T商品出庫.router)
app.include_router(V商品出庫.router)
app.include_router(T商品棚卸.router)
app.include_router(V商品棚卸.router)
app.include_router(T商品入庫.router)
app.include_router(V商品入庫.router)
app.include_router(V商品推移表.router)
app.include_router(S配車_週表示.router)
app.include_router(S配車_日表示.router)
app.include_router(S生産_週表示.router)
app.include_router(S生産_日表示.router)

@app.on_event("startup")
def startup_event():
    # tempフォルダ準備 & 再起動フラグ処理
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    reboot_self_path = os.path.join(temp_dir, "reboot_apps.txt")
    if os.path.isfile(reboot_self_path):
        try:
            os.remove(reboot_self_path)
        except Exception:
            pass
        raise SystemExit("reboot_apps.txt detected")
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

    # 構成情報を初期化（config.jsonは読むが、path/modelsは無効化）
    if not app_conf.init(conf_path_enabled=False, conf_models_enabled=False):
        logger.warning("構成情報の初期化に失敗しました")
    else:
        app.conf = app_conf

    # apps系の初期データ投入
    db = database.SessionLocal()
    try:
        apps_crud.init_db_data(db)
    finally:
        db.close()

    # ベースラインバックアップ実行（並列スレッドで処理）
    def バックアップ並列処理():
        try:
            # CODE_BASE_PATHの相対解決は backend_server 基準に統一
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            セッション設定 = None
            reboot_apps_code_base_path = os.path.join(temp_dir, "reboot_apps_code_base_path.txt")
            if os.path.isfile(reboot_apps_code_base_path):
                try:
                    with open(reboot_apps_code_base_path, "r", encoding="utf-8") as f:
                        code_base_path = f.read().strip()
                    if code_base_path:
                        セッション設定 = {"CODE_BASE_PATH": code_base_path}
                finally:
                    try:
                        os.remove(reboot_apps_code_base_path)
                    except Exception:
                        pass
            バックアップ実行_共通ログ(
                呼出しロガー=logger,
                アプリ設定=app_conf,
                backend_dir=backend_dir,
                セッション設定=セッション設定,
            )
        except Exception as e:
            logger.error(f"バックアップ実行時エラー: {e}")
    
    threading.Thread(target=バックアップ並列処理, daemon=True).start()

@app.get("/")
def read_root():
    return {"message": "FastAPI Server is running"}
