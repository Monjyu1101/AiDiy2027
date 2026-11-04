# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIコア APIエンドポイント
WebSocketベースのセッション管理とストリーミング処理
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException
from internal_api_auth import (authenticate, require_session_owner, require_session_settings,
                               require_manager_owner, bind_session_owner)
from starlette.websockets import WebSocketState
from pydantic import BaseModel
from typing import Dict, Optional
import uuid
import json
import asyncio
import os
import sys
import base64
import urllib.request
from datetime import datetime, timedelta
import time
import database
import core_crud as crud
import core_models as models

# WebSocket接続管理をインポート
# backend_serverディレクトリをパスに追加
現在ディレクトリ = os.path.dirname(os.path.abspath(__file__))
バックエンドディレクトリ = os.path.dirname(現在ディレクトリ)
# プロジェクトルート（backend_serverの親ディレクトリ）
プロジェクトルート = os.path.dirname(バックエンドディレクトリ)
if バックエンドディレクトリ not in sys.path:
    sys.path.insert(0, バックエンドディレクトリ)

from log_config import get_logger

# ロガー取得
logger = get_logger(__name__)


def _backend_local稼働中(app_conf) -> bool:
    """backend_local の /health を短時間で確認する。未起動なら local_chat を候補から外す。"""
    try:
        conf_json = getattr(app_conf, "json", {}) if app_conf else {}
        host = str(conf_json.get("LOCAL_HOST", "http://127.0.0.1") or "http://127.0.0.1").strip().rstrip("/")
        if host and "://" not in host:
            host = f"http://{host}"
        port_local = str(conf_json.get("PORT_LOCAL", "8096") or "8096").strip()
        url = f"{host}:{port_local}/health"
        with urllib.request.urlopen(url, timeout=0.35) as resp:
            return 200 <= int(getattr(resp, "status", 0) or 0) < 300
    except Exception:
        return False


def _local_chat候補除外(利用可能モデル: dict) -> dict:
    filtered: dict = {}
    for group_name, group_models in (利用可能モデル or {}).items():
        if not isinstance(group_models, dict):
            filtered[group_name] = group_models
            continue
        filtered_group = {}
        for provider, models in group_models.items():
            if provider == "local_chat":
                continue
            if isinstance(models, dict):
                filtered_group[provider] = {
                    model_key: model_label
                    for model_key, model_label in models.items()
                    if model_key != "local_chat"
                }
            else:
                filtered_group[provider] = models
        filtered[group_name] = filtered_group
    return filtered


def _short_sid(セッションID: Optional[str]) -> str:
    if not セッションID:
        return "-"
    sid = str(セッションID)
    return sid[:10]


def _ws_log(ch: str, 内容: str, セッションID: Optional[str] = None, level: str = "info"):
    sid = _short_sid(セッションID)
    msg = f"チャンネル={ch}, {内容}, セッションID={sid}"
    if level == "debug":
        logger.debug(msg)
    elif level == "warning":
        logger.warning(msg)
    elif level == "error":
        logger.error(msg)
    else:
        logger.info(msg)


def _is_disconnect_like_error(e: Exception) -> bool:
    msg = str(e)
    return any([
        "Cannot call \"receive\" once a disconnect message has been received." in msg,
        "Unexpected ASGI message 'websocket.send', after sending 'websocket.close'" in msg,
        "WebSocket is not connected" in msg,
    ])


def _is_ws_connected(ws: WebSocket) -> bool:
    return getattr(ws, "application_state", None) == WebSocketState.CONNECTED


_要求日時選択値 = {-2, -1, 0, 1, 5, 10, 60}
数値チャンネル一覧 = ["0", "1", "2", "3", "4", "5", "6"]
コードチャンネル一覧 = ["1", "2", "3", "4", "5", "6"]
welcome対象チャンネル一覧 = 数値チャンネル一覧 + ["core"]


def _要求日時分数取得(受信データ: dict, デフォルト値: int) -> int:
    内容 = 受信データ.get("メッセージ内容")
    候補値 = None
    if isinstance(内容, dict):
        候補値 = 内容.get("要求日時")
    elif 内容 not in (None, ""):
        候補値 = 内容

    try:
        分数 = int(候補値) if 候補値 is not None else デフォルト値
    except (TypeError, ValueError):
        return デフォルト値
    if 分数 not in _要求日時選択値:
        return デフォルト値
    return 分数


def _日時文字列解析(日時文字列: Optional[str]) -> Optional[datetime]:
    if not 日時文字列:
        return None
    値 = str(日時文字列).strip().replace("-", "/")
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(値, fmt)
        except ValueError:
            continue
    return None


def _要求日時基準時刻取得(要求日時分数: int) -> Optional[datetime]:
    now = datetime.now()
    if 要求日時分数 == 0:
        return None
    if 要求日時分数 > 0:
        return now - timedelta(minutes=要求日時分数)
    if 要求日時分数 == -1:
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if 要求日時分数 == -2:
        今日開始 = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return 今日開始 - timedelta(days=1)
    return None


def _日時フィルタ適用(ファイルリスト: list[dict], 要求日時分数: int) -> list[dict]:
    基準時刻 = _要求日時基準時刻取得(要求日時分数)
    if 基準時刻 is None:
        return list(ファイルリスト)

    結果 = []
    for item in ファイルリスト:
        更新日時 = _日時文字列解析(item.get("更新日時"))
        if 更新日時 and 更新日時 >= 基準時刻:
            結果.append(item)
    return 結果


def _最大更新日時文字列(ファイルリスト: list[dict]) -> str:
    最新 = None
    for item in ファイルリスト:
        更新日時 = _日時文字列解析(item.get("更新日時"))
        if 更新日時 and (最新 is None or 更新日時 > 最新):
            最新 = 更新日時
    return 最新.strftime("%Y/%m/%d %H:%M:%S") if 最新 else ""


try:
    from AIコア.AI履歴コンテキスト import (現在履歴パス, 要求履歴パス確定, セッション履歴パス, 履歴パス解決, 履歴要求処理中)
    from AIコア.AIセッション管理 import AIセッション管理, SessionConnection, 初期モデル設定生成
    from AIコア.AIストリーミング処理 import StreamingProcessor
    from AIコア.AI音声認識 import Recognition
    from AIコア.AI音声処理 import 音声入力データ処理, 統合音声分離ワーカー
    from AIコア.AIバックアップ import コードベース絶対パス取得
    from AIコア.AIバックアップ実行 import セッションバックアップ開始, セッションバックアップ完了待機, 対象パスキー
    from AIコア.AIチャット import Chat
    from AIコア.AIコード import CodeAgent
    from AIコア.AIライブ import Live
    from AIコア.AI入力ファイル import 入力ファイル保存
    from AIコア.AIファイルプレビュー import 画像プレビュー生成
    logger.info("WebSocketマネージャーをインポートしました")
except Exception as e:
    logger.exception("WebSocketマネージャーのインポートエラー: %s", e)
    raise

router = APIRouter()

# 後方互換性のため、REST API用のセッションデータも保持
セッション情報: Dict[str, dict] = {}


_履歴パス未指定 = object()


def 保存_会話履歴(
    セッションID: str,
    チャンネル: str,
    メッセージ識別: str,
    メッセージ内容: Optional[str] = None,
    ファイル名: Optional[str] = None,
    サムネイル画像: Optional[str] = None,
    プロジェクトパス=_履歴パス未指定
):
    """会話履歴を保存（AIコア用）。応答は受付時の要求コンテキストを使う。"""
    db = database.SessionLocal()
    try:
        シーケンス = crud.get_next_sequence(db, セッションID)
        crud.create_会話履歴(
            db,
            セッションID=セッションID,
            シーケンス=シーケンス,
            チャンネル=チャンネル,
            メッセージ識別=メッセージ識別,
            メッセージ内容=メッセージ内容,
            ファイル名=ファイル名,
            サムネイル画像=サムネイル画像,
            プロジェクトパス=(現在履歴パス(セッションID) if プロジェクトパス is _履歴パス未指定 else プロジェクトパス),
            認証情報={"利用者ID": "AIコア", "利用者名": "AIコア"}
        )
    finally:
        db.close()


def 取得_会話履歴一覧(
    セッションID: str,
    チャンネル: str = "0"
):
    """会話履歴一覧を取得（シーケンス昇順）"""
    db = database.SessionLocal()
    try:
        items = (
            db.query(models.A会話履歴)
            .filter(models.A会話履歴.セッションID == セッションID)
            .filter(models.A会話履歴.チャンネル == チャンネル)
            .order_by(models.A会話履歴.シーケンス.asc())
            .all()
        )
        return items
    finally:
        db.close()

def 取得_コードベース選択肢(アプリ設定=None) -> dict:
    """コードベースパス選択肢を取得"""
    options = {}

    # 常にデフォルトの ../ を「AiDiy 実行ルート」として追加
    options["../"] = "AiDiy 実行ルート"

    try:
        path_conf = getattr(アプリ設定, 'path', None) if アプリ設定 else None
        external_root_dic = getattr(path_conf, 'external_root_dic', None)
        if isinstance(external_root_dic, dict) and external_root_dic:
            # _AIDIY.md を含むプロジェクト一覧を絶対パスで追加
            for 表示名, 絶対パス in external_root_dic.items():
                try:
                    # 絶対パスをそのまま使用（../ との重複を避けるため）
                    パス = 絶対パス.replace('\\', '/')
                    if not パス.endswith('/'):
                        パス += '/'
                    options[パス] = 表示名
                except Exception:
                    continue
        # external_root_path とその親も探索（_AIDIY.md を含むフォルダ）
        external_root_path = getattr(path_conf, 'external_root_path', None) if path_conf else None
        探索ルート = []
        if external_root_path:
            探索ルート.append(external_root_path)
            親 = os.path.abspath(os.path.join(external_root_path, '..'))
            if 親 and 親 not in 探索ルート:
                探索ルート.append(親)

        def 追加探索(root_dir: str) -> None:
            root_dir = root_dir.replace('\\', '/').rstrip('/')
            if not root_dir or not os.path.isdir(root_dir):
                return
            # ルート自身
            root_marker = os.path.join(root_dir, '_AIDIY.md')
            if os.path.isfile(root_marker):
                表示名 = os.path.basename(root_dir) or 'project_root'
                try:
                    # 絶対パスをそのまま使用
                    パス = root_dir.replace('\\', '/')
                    if not パス.endswith('/'):
                        パス += '/'
                    options.setdefault(パス, 表示名)
                except Exception:
                    pass
            # ルート直下と1階層下
            try:
                for entry in os.scandir(root_dir):
                    if not entry.is_dir():
                        continue
                    candidates = [entry.path]
                    try:
                        for sub_entry in os.scandir(entry.path):
                            if sub_entry.is_dir():
                                candidates.append(sub_entry.path)
                    except (PermissionError, OSError):
                        pass
                    for path in candidates:
                        marker = os.path.join(path, '_AIDIY.md')
                        if os.path.isfile(marker):
                            表示名 = os.path.basename(path)
                            try:
                                # 絶対パスをそのまま使用
                                パス = path.replace('\\', '/')
                                if not パス.endswith('/'):
                                    パス += '/'
                                options.setdefault(パス, 表示名)
                            except Exception:
                                continue
            except (PermissionError, OSError):
                return

        for root in 探索ルート:
            追加探索(root)
    except Exception:
        options = {}

    if not options:
        # フォールバック: 従来の固定候補
        候補 = []
        候補.append(("../", "プロジェクトルート"))
        候補.append(("../backend_server", "backend_server"))
        候補.append(("../frontend_web", "frontend_web"))
        候補.append(("../docs", "docs"))

        for 相対パス, 表示名 in 候補:
            実パス = os.path.normpath(os.path.join(バックエンドディレクトリ, 相対パス))
            if os.path.isdir(実パス):
                options[相対パス] = 表示名

    if not options:
        options["../"] = "プロジェクトルート"

    return options


def 取得_CODE_ROOT_PATH(
    セッション: Optional[SessionConnection],
    アプリ設定=None,
) -> str:
    """セッション設定に基づくCODE_ROOT_PATH（絶対パス）を取得"""
    try:
        セッション設定 = セッション.モデル設定 if セッション else None
        return コードベース絶対パス取得(
            アプリ設定=アプリ設定,
            backend_dir=バックエンドディレクトリ,
            セッション設定=セッション設定,
        )
    except Exception:
        logger.exception("CODE_ROOT_PATH解決エラー")
        return ""


def 読取_AIDIY_MD内容(CODE_ROOT_PATH: str) -> str:
    """指定ルート配下の_AIDIY.md内容を返す（失敗時は空文字）"""
    if not CODE_ROOT_PATH:
        return ""
    try:
        aidiy_path = os.path.normpath(os.path.join(CODE_ROOT_PATH, "_AIDIY.md"))
        with open(aidiy_path, "r", encoding="utf-8-sig") as f:
            return f.read()
    except Exception:
        logger.info(f"_AIDIY.md読取失敗: root={CODE_ROOT_PATH}")
        return ""




async def 送信_会話履歴(
    接続: SessionConnection,
    セッションID: str,
    チャンネル: str = "0"
):
    """会話履歴をソケット送出（シーケンス昇順）"""
    履歴一覧 = 取得_会話履歴一覧(セッションID, チャンネル=チャンネル)
    for item in 履歴一覧:
        payload = {
            "セッションID": item.セッションID,
            "チャンネル": item.チャンネル,
            "メッセージ識別": item.メッセージ識別,
            "メッセージ内容": item.メッセージ内容,
            "ファイル名": item.ファイル名,
            "サムネイル画像": item.サムネイル画像,
            "プロジェクトパス": item.プロジェクトパス
        }
        await 接続.send_json(payload)
    logger.info(f"チャンネル={チャンネル}, 会話履歴送信, 件数={len(履歴一覧)}")

class 初期化リクエスト(BaseModel):
    セッションID: str = ""


class 初期化レスポンス(BaseModel):
    status: str
    message: str
    data: dict


@router.post("/core/AIコア/初期化", response_model=初期化レスポンス)
async def 初期化(http_request: Request, request: 初期化リクエスト):
    """
    AIコア画面の初期化
    セッションIDがなければ新規生成、あれば既存データを返す
    """
    principal, _ = authenticate(http_request, "POST", "/core/AIコア/初期化")
    require_manager_owner(AIセッション管理, request.セッションID, principal)
    try:
        セッションID = request.セッションID

        # セッションIDがない場合は新規生成
        if not セッションID:
            セッションID = AIセッション管理.セッションID生成()
            
            # セッションを確実に作成（存在しなければ新規）
            AIセッション管理.ensure_session(セッションID, app_conf=getattr(http_request.app, "conf", None))
            bind_session_owner(AIセッション管理, セッションID, principal)
            
            # 新規セッション作成時は、セッション固有のCODE_BASE_PATHでバックアップ実行
            session = AIセッション管理.sessions.get(セッションID)
            if session and session.モデル設定:
                セッションバックアップ開始(
                    session, AIセッション管理, 呼出しロガー=logger,
                    アプリ設定=getattr(http_request.app, "conf", None),
                    backend_dir=バックエンドディレクトリ,
                )
        else:
            # セッションを確実に作成（存在しなければ新規）
            AIセッション管理.ensure_session(セッションID, app_conf=getattr(http_request.app, "conf", None))
            bind_session_owner(AIセッション管理, セッションID, principal)

        return 初期化レスポンス(
            status="OK",
            message="初期化成功",
            data={
                "セッションID": セッションID
            }
        )

    except Exception as e:
        return 初期化レスポンス(
            status="NG",
            message=f"初期化エラー: {str(e)}",
            data={}
        )



@router.post("/core/AIコア/セッション一覧")
async def セッション一覧():
    """
    デバッグ用：現在のセッション一覧を取得（REST + WebSocket両方）
    """
    return {
        "status": "OK",
        "message": "セッション一覧",
        "data": {
            "REST_セッション数": len(セッション情報),
            "REST_セッションID一覧": list(セッション情報.keys()),
            "WebSocket_セッション数": AIセッション管理.get_session_count(),
            "WebSocket_セッション一覧": AIセッション管理.get_session_list()
        }
    }


class モデル情報取得リクエスト(BaseModel):
    セッションID: str = ""


class モデル設定リクエスト(BaseModel):
    セッションID: str
    モデル設定: dict
    再起動要求: Optional[dict] = None
    save: Optional[bool] = False
    リセット: Optional[bool] = False


class フォルダ参照リクエスト(BaseModel):
    初期パス: Optional[str] = None


def _フォルダ参照初期パス解決(初期パス: Optional[str]) -> str:
    path_value = str(初期パス or "").strip()
    if not path_value:
        return プロジェクトルート
    if os.path.isabs(path_value):
        return path_value
    return os.path.abspath(os.path.join(バックエンドディレクトリ, path_value))


def _フォルダ参照ダイアログ表示(初期パス: Optional[str]) -> str:
    import tkinter as tk
    from tkinter import filedialog

    resolved_initial_dir = _フォルダ参照初期パス解決(初期パス)
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    try:
        selected_dir = filedialog.askdirectory(
            title="CODE_BASE_PATH を選択",
            initialdir=resolved_initial_dir if os.path.isdir(resolved_initial_dir) else プロジェクトルート,
            mustexist=True,
            parent=root,
        )
    finally:
        root.destroy()

    normalized = str(selected_dir or "").strip().replace("\\", "/")
    if normalized and not normalized.endswith("/"):
        normalized += "/"
    return normalized

@router.post("/core/AIコア/モデル情報/取得")
async def モデル情報取得(http_request: Request, request: モデル情報取得リクエスト):
    """
    ソケットのAIモデル情報と設定を取得
    """
    principal, _ = authenticate(http_request, "POST", "/core/AIコア/モデル情報/取得")
    if request.セッションID:
        require_session_owner(AIセッション管理.get_session(request.セッションID), principal)
    try:
        セッションID = request.セッションID

        # 接続前は共通設定の既定値と候補だけを返す（セッションは作成しない）。
        接続 = AIセッション管理.get_session(セッションID) if セッションID else None
        if セッションID and not 接続:
            return {
                "status": "NG",
                "message": f"セッションID {セッションID} が見つかりません",
                "data": {}
            }

        # http_request.app.confから利用可能なモデル一覧を取得
        利用可能モデル = {}
        if hasattr(http_request.app, 'conf') and http_request.app.conf and http_request.app.conf.models:
            モデル一覧 = http_request.app.conf.models
            利用可能モデル = {
                "chat_models": モデル一覧.get_chat_models(),
                "live_models": モデル一覧.get_live_models(),
                "live_voices": モデル一覧.get_live_voices(),
                "code_models": モデル一覧.get_code_models(),
                "prediction_models": モデル一覧.get_prediction_models(),
                "decision_models": モデル一覧.get_decisions_models(),
            }
            if not _backend_local稼働中(http_request.app.conf):
                利用可能モデル = _local_chat候補除外(利用可能モデル)

        # ソケットのモデル設定を取得
        現在設定 = dict(接続.モデル設定) if 接続 else 初期モデル設定生成(getattr(http_request.app, "conf", None))
        # 予測・判断はToolsが共通JSONを読むため、保存後の再取得でもセッションの古い値を返さない。
        from AIコア.AI判断 import Decision
        共通設定 = getattr(getattr(http_request.app, "conf", None), "json", None)
        予測設定 = 共通設定 if 共通設定 is not None else 現在設定
        for key in ("PREDICTION_AI_NAME", "PREDICTION_OPENAI_MODEL", "PREDICTION_OAUTH_MODEL", "PREDICTION_GEMINI_MODEL", "PREDICTION_FREEAI_MODEL",
                    "PREDICTION_CODEX_CLI_MODEL", "PREDICTION_COPILOT_CLI_MODEL", "PREDICTION_AIDIY_HERMES_MODEL"):
            現在設定[key] = 予測設定.get(key, "auto") or "auto"
        判断設定 = 共通設定 if 共通設定 is not None else 現在設定
        現在設定["DECISION_AI_NAME"] = 判断設定.get("DECISION_AI_NAME", "auto") or "auto"
        for key in ("DECISION_OPENAI_MODEL", "DECISION_OAUTH_MODEL", "DECISION_GEMINI_MODEL", "DECISION_FREEAI_MODEL"):
            現在設定[key] = 判断設定.get(key, "auto") or "auto"
        利用可能モデル["decision_models"] = Decision.model_options(利用可能モデル.get("decision_models"))

        return {
            "status": "OK",
            "message": "モデル情報取得成功",
            "data": {
                "available_models": 利用可能モデル,
                "モデル設定": 現在設定,
                "external_root_dic": 取得_コードベース選択肢(http_request.app.conf if hasattr(http_request.app, 'conf') else None)
            }
        }

    except Exception as e:
        logger.exception("モデル情報取得エラー")
        return {
            "status": "NG",
            "message": f"モデル情報取得エラー: {str(e)}",
            "data": {}
        }


@router.post("/core/AIコア/モデル情報/TASK選択肢")
async def TASKモデル選択肢取得(http_request: Request):
    """AIタスク画面用に、セッション不要で TaskAI の候補と現在設定を返す。"""
    authenticate(http_request, "POST", "/core/AIコア/モデル情報/TASK選択肢")
    try:
        code_models = {
            "claude_sdk": {"auto": "auto"},
            "claude_cli": {"auto": "auto"},
            "copilot_cli": {"auto": "auto"},
            "codex_cli": {"auto": "auto"},
            "antigravity_cli": {"auto": "auto"},
            "grok_cli": {"auto": "auto"},
            "opencode_cli": {"auto": "auto"},
            "aidiy_hermes": {"auto": "auto"},
        }
        conf = getattr(http_request.app, "conf", None)
        if conf and getattr(conf, "models", None):
            for ai_name, models in (conf.models.get_code_models() or {}).items():
                if isinstance(models, dict) and models:
                    code_models[ai_name] = models
                else:
                    code_models.setdefault(ai_name, {"auto": "auto"})

        conf_json = getattr(conf, "json", None) if conf else None
        現在設定 = {
            "CODE_BASE_PATH": getattr(conf_json, "CODE_BASE_PATH", "../") if conf_json else "../",
            "TASK_AI_NAME": getattr(conf_json, "TASK_AI_NAME", "codex_cli") if conf_json else "codex_cli",
            "TASK_AI_MODEL_plan": getattr(conf_json, "TASK_AI_MODEL_plan", "auto") if conf_json else "auto",
            "TASK_AI_MODEL_do": getattr(conf_json, "TASK_AI_MODEL_do", "auto") if conf_json else "auto",
            "TASK_AI_MODEL_check": getattr(conf_json, "TASK_AI_MODEL_check", "auto") if conf_json else "auto",
        }
        code_models.setdefault(str(現在設定["TASK_AI_NAME"] or "codex_cli"), {"auto": "auto"})
        return {
            "status": "OK",
            "message": "TASKモデル選択肢取得成功",
            "data": {
                "available_models": {"code_models": code_models},
                "モデル設定": 現在設定,
            },
        }
    except Exception as e:
        logger.exception("TASKモデル選択肢取得エラー")
        return {
            "status": "NG",
            "message": f"TASKモデル選択肢取得エラー: {str(e)}",
            "data": {},
        }


@router.post("/core/AIコア/フォルダ参照")
async def フォルダ参照(request: フォルダ参照リクエスト):
    """
    ローカル環境でフォルダ選択ダイアログを開き、選択パスを返す
    """
    try:
        選択パス = await asyncio.to_thread(_フォルダ参照ダイアログ表示, request.初期パス)
        return {
            "status": "OK",
            "message": "フォルダ参照完了",
            "data": {
                "選択パス": 選択パス,
            }
        }
    except Exception as e:
        logger.exception("フォルダ参照エラー")
        return {
            "status": "NG",
            "message": f"フォルダ参照エラー: {str(e)}",
            "data": {
                "選択パス": "",
            }
        }


@router.post("/core/AIコア/モデル情報/設定")
async def モデル情報設定(http_request: Request, request: モデル設定リクエスト):
    """
    ソケットのAIモデル設定を更新（セッション内のみ、ファイル保存しない）
    """
    principal, _ = authenticate(http_request, "POST", "/core/AIコア/モデル情報/設定")
    require_session_settings(principal, request)
    if request.セッションID:
        require_session_owner(AIセッション管理.get_session(request.セッションID), principal)
    try:
        セッションID = request.セッションID
        設定 = dict(request.モデル設定 or {})
        再起動要求 = request.再起動要求 or {}
        save = request.save if request.save is not None else False
        リセット = bool(request.リセット)

        if not セッションID:
            return {
                "status": "NG",
                "message": "セッションIDが指定されていません"
            }

        # WebSocketマネージャーから接続を取得
        接続 = AIセッション管理.get_session(セッションID)

        if not 接続:
            return {
                "status": "NG",
                "message": f"セッションID {セッションID} が見つかりません"
            }

        # 設定可能なキーのホワイトリスト（セキュリティのため）
        許可キー = {
            # ChatAI設定
            "CHAT_AI_NAME", "CHAT_GEMINI_MODEL", "CHAT_FREEAI_MODEL", "CHAT_OPENRT_MODEL", "CHAT_OPENAI_MODEL", "CHAT_OLLAMA_MODEL", "CHAT_LOCAL_MODEL",
            # LiveAI設定
            "LIVE_AI_NAME", "LIVE_GEMINI_MODEL", "LIVE_GEMINI_VOICE",
            "LIVE_FREEAI_MODEL", "LIVE_FREEAI_VOICE",
            "LIVE_OPENAI_MODEL", "LIVE_OPENAI_VOICE",
            # PredictionAI設定
            "PREDICTION_AI_NAME",
            "PREDICTION_OPENAI_MODEL", "PREDICTION_OAUTH_MODEL", "PREDICTION_GEMINI_MODEL", "PREDICTION_FREEAI_MODEL",
            "PREDICTION_CODEX_CLI_MODEL", "PREDICTION_COPILOT_CLI_MODEL", "PREDICTION_AIDIY_HERMES_MODEL",
            # DecisionAI設定
            "DECISION_AI_NAME",
            "DECISION_OPENAI_MODEL", "DECISION_OAUTH_MODEL", "DECISION_GEMINI_MODEL", "DECISION_FREEAI_MODEL",
            # CodeAI設定
            "CODE_AI1_NAME", "CODE_AI2_NAME", "CODE_AI3_NAME", "CODE_AI4_NAME", "CODE_AI5_NAME", "CODE_AI6_NAME",
            "CODE_AI1_MODEL", "CODE_AI2_MODEL", "CODE_AI3_MODEL", "CODE_AI4_MODEL", "CODE_AI5_MODEL", "CODE_AI6_MODEL",
            "CODE_CLAUDE_SDK_MODEL", "CODE_CLAUDE_CLI_MODEL",
            "CODE_COPILOT_CLI_MODEL", "CODE_ANTIGRAVITY_CLI_MODEL", "CODE_CODEX_CLI_MODEL", "CODE_AIDIY_HERMES_MODEL",
            "CODE_OPENCODE_CLI_MODEL", "CODE_GROK_CLI_MODEL",
            "CODE_CLAUDE_OLLAMA_MODEL", "CODE_CODEX_OLLAMA_MODEL",
            "CODE_BASE_PATH",
            "CODE_MAX_TURNS", "CODE_PLAN", "CODE_VERIFY", "CODE_PERMISSIONS", "CODE_SELF_CHECK_LOOP",
            # TaskAI設定
            "TASK_AI_NAME", "TASK_AI_MODEL_plan", "TASK_AI_MODEL_do", "TASK_AI_MODEL_check",
            # TeamAI設定
            "TEAM_AI_NAME", "TEAM_AI_MODEL_plan", "TEAM_AI_MODEL_do", "TEAM_AI_MODEL_check",
        }

        if リセット:
            conf = getattr(http_request.app, "conf", None)
            conf_json = getattr(conf, "json", None)
            default_config = getattr(conf_json, "DEFAULT_CONFIG", {})
            設定 = {key: default_config[key] for key in 許可キー if key in default_config}

        reboot_core = bool(再起動要求.get("reboot_core"))
        reboot_apps = bool(再起動要求.get("reboot_apps"))
        reboot_tools = bool(再起動要求.get("reboot_tools"))
        reboot_local = bool(再起動要求.get("reboot_local"))
        reboot_task = bool(再起動要求.get("reboot_task"))
        reboot_team = bool(再起動要求.get("reboot_team"))
        再起動要求あり = reboot_core or reboot_apps or reboot_tools or reboot_local or reboot_task or reboot_team

        # ホワイトリストにあるキーのみをフィルタリング
        許可設定 = {k: v for k, v in 設定.items() if k in 許可キー}
        if "CODE_PERMISSIONS" in 許可設定 and 許可設定["CODE_PERMISSIONS"] not in ("auto", "full", "none"):
            return {
                "status": "NG",
                "message": "CODE_PERMISSIONSは auto / full / none のいずれかを指定してください"
            }

        # 再起動のみの場合は設定更新をスキップ
        再起動のみ = not 許可設定 and 再起動要求あり

        if not 許可設定 and not 再起動のみ:
            return {
                "status": "NG",
                "message": "有効な設定項目がありません"
            }

        # Codeだけの設定変更や同値の再送ではLive接続を作り直さない。
        Live設定変更 = any(
            (key.startswith("LIVE_") or key == "CODE_BASE_PATH")
            and 接続.モデル設定.get(key) != value
            for key, value in 許可設定.items()
        )

        # 実行中の要求を別プロジェクトへ移さない。保存のみの場合は現セッションを変えない。
        保存のみ = save and not リセット and not 再起動要求あり
        if "CODE_BASE_PATH" in 許可設定 and not 保存のみ:
            if 履歴パス解決(許可設定["CODE_BASE_PATH"]) != セッション履歴パス(接続) and 履歴要求処理中(接続):
                return {"status": "NG", "message": "会話の処理中はプロジェクトを変更できません。完了後に変更してください。"}

        # save=True またはリセットの場合は AiDiy_key.json へ書き込む
        設定保存済み = False
        if (save or リセット) and 許可設定:
            try:
                conf = getattr(http_request.app, "conf", None)
                conf_json = getattr(conf, "json", None)
                if not (conf_json and hasattr(conf_json, "update")):
                    return {
                        "status": "NG",
                        "message": "AiDiy_key.json保存先が見つかりません"
                    }
                if not conf_json.update(許可設定):
                    return {
                        "status": "NG",
                        "message": "AiDiy_key.json保存に失敗しました"
                    }
                設定保存済み = True
                if save and not リセット and not 再起動要求あり:
                    return {
                        "status": "OK",
                        "message": f"{len(許可設定)}件の設定をAiDiy_key.jsonに保存しました"
                    }
            except Exception as e:
                logger.exception("AiDiy_key.json保存エラー")
                return {
                    "status": "NG",
                    "message": f"AiDiy_key.json保存エラー: {str(e)}"
                }

        # 保存だけの場合はセッションへ適用しない。後の「適用」で変更を正しく判定する。
        if 許可設定:
            接続.update_model_settings(許可設定, manager=AIセッション管理)

        # 既存プロセッサに反映（即時反映、設定変更がある場合のみ）
        if 許可設定:
            try:
                実行パス = コードベース絶対パス取得(
                    アプリ設定=getattr(http_request.app, "conf", None),
                    backend_dir=バックエンドディレクトリ,
                    セッション設定=接続.モデル設定,
                )
                if hasattr(接続, "chat_processor") and 接続.chat_processor:
                    chat_ai = 接続.モデル設定.get("CHAT_AI_NAME", "")
                    chat_model = ""
                    if chat_ai == "openrt_chat":
                        chat_model = 接続.モデル設定.get("CHAT_OPENRT_MODEL", "")
                    elif chat_ai in ("openai_chat", "openai_oauth"):
                        chat_model = 接続.モデル設定.get("CHAT_OPENAI_MODEL", "")
                    elif chat_ai in ("gemini_chat", "freeai_chat"):
                        key = "CHAT_FREEAI_MODEL" if chat_ai == "freeai_chat" else "CHAT_GEMINI_MODEL"
                        chat_model = 接続.モデル設定.get(key, "")
                    elif chat_ai == "ollama_chat":
                        chat_model = 接続.モデル設定.get("CHAT_OLLAMA_MODEL", "")
                    elif chat_ai == "local_chat":
                        chat_model = 接続.モデル設定.get("CHAT_LOCAL_MODEL", "")
                    接続.chat_processor.AI_NAME = chat_ai
                    接続.chat_processor.AI_MODEL = chat_model
                    if hasattr(接続.chat_processor, "_select_ai_module"):
                        接続.chat_processor.AIモジュール = 接続.chat_processor._select_ai_module()
                    接続.chat_processor.AIインスタンス = None

                if hasattr(接続, "code_agent_processors") and 接続.code_agent_processors:
                    for idx, agent in enumerate(接続.code_agent_processors, start=1):
                        ai_key = f"CODE_AI{idx}_NAME"
                        model_key = f"CODE_AI{idx}_MODEL"
                        agent.AI_NAME = 接続.モデル設定.get(ai_key, "")
                        agent.AI_MODEL = 接続.モデル設定.get(model_key, "")
                        agent.絶対パス = 実行パス
                        if hasattr(agent, "_select_ai_module"):
                            agent.AIモジュール = agent._select_ai_module()
                        agent.AIインスタンス = None

                if Live設定変更:
                    async with 接続.初期化ロック:
                        if 接続.voice_enabled and getattr(接続, "live_processor", None):
                            live_ai = 接続.モデル設定.get("LIVE_AI_NAME", "")
                            live_model = ""
                            live_voice = ""
                            if live_ai in ("gemini_live", "freeai_live"):
                                model_key = "LIVE_FREEAI_MODEL" if live_ai == "freeai_live" else "LIVE_GEMINI_MODEL"
                                voice_key = "LIVE_FREEAI_VOICE" if live_ai == "freeai_live" else "LIVE_GEMINI_VOICE"
                                live_model = 接続.モデル設定.get(model_key, "")
                                live_voice = 接続.モデル設定.get(voice_key, "")
                            elif live_ai == "openai_live":
                                live_model = 接続.モデル設定.get("LIVE_OPENAI_MODEL", "")
                                live_voice = 接続.モデル設定.get("LIVE_OPENAI_VOICE", "")
                            接続.live_processor.AI_NAME = live_ai
                            接続.live_processor.AI_MODEL = live_model
                            接続.live_processor.AI_VOICE = live_voice
                            接続.live_processor.絶対パス = 実行パス
                            if hasattr(接続.live_processor, "_select_ai_module"):
                                接続.live_processor.AIモジュール = 接続.live_processor._select_ai_module()
                            # プロジェクト切り替え時はシステム指示を再構築
                            if hasattr(接続.live_processor, "システム指示更新"):
                                code_base_path = str(接続.モデル設定.get("CODE_BASE_PATH", ""))
                                接続.live_processor.システム指示更新(code_base_path)
                            if getattr(接続.live_processor, "AIインスタンス", None) or getattr(接続.live_processor, "is_alive", False):
                                try:
                                    await 接続.live_processor.終了()
                                except Exception:
                                    logger.exception("LiveAI停止に失敗しました")
                            音声接続 = 接続.get_socket("audio")
                            if 音声接続 and 音声接続.is_connected:
                                try:
                                    await 接続.live_processor.開始()
                                except Exception:
                                    logger.exception("LiveAI再開始に失敗しました")
            except Exception:
                logger.exception("モデル設定の反映に失敗しました")

        # 再起動要求があればバックアップ実行とフラグファイルを作成
        if 再起動要求あり:
            try:
                # 待機中に別プロジェクトへ切り替わった場合は、再起動を発行しない。
                再起動対象パス = 対象パスキー(コードベース絶対パス取得(
                    セッション設定=接続.モデル設定, backend_dir=バックエンドディレクトリ))
                await セッションバックアップ完了待機(
                    接続, AIセッション管理, 呼出しロガー=logger,
                    アプリ設定=getattr(http_request.app, "conf", None),
                    backend_dir=バックエンドディレクトリ,
                )
                if (AIセッション管理.get_session(接続.セッションID) is not 接続
                        or 対象パスキー(コードベース絶対パス取得(
                            セッション設定=接続.モデル設定, backend_dir=バックエンドディレクトリ)) != 再起動対象パス):
                    return {"status": "NG", "message": "バックアップ待機中に接続または対象が変わったため、再起動を中止しました。", "data": {}}
                if reboot_core:
                    with open(os.path.join(バックエンドディレクトリ, "temp", "reboot_core.txt"), "w", encoding="utf-8") as f:
                        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                if reboot_apps:
                    # apps_main再起動時にセッションのCODE_BASE_PATHを引き継ぐ
                    try:
                        code_base_path_for_apps = str(接続.モデル設定.get("CODE_BASE_PATH", "")).strip()
                        if code_base_path_for_apps:
                            with open(os.path.join(バックエンドディレクトリ, "temp", "reboot_apps_code_base_path.txt"), "w", encoding="utf-8") as f:
                                f.write(code_base_path_for_apps)
                    except Exception:
                        logger.exception("reboot_apps用CODE_BASE_PATHの保存に失敗しました")
                    with open(os.path.join(バックエンドディレクトリ, "temp", "reboot_apps.txt"), "w", encoding="utf-8") as f:
                        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                if reboot_tools:
                    tools_temp_dir = os.path.join(プロジェクトルート, "backend_tools", "temp")
                    os.makedirs(tools_temp_dir, exist_ok=True)
                    with open(os.path.join(tools_temp_dir, "reboot_tools.txt"), "w", encoding="utf-8") as f:
                        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                if reboot_local:
                    local_temp_dir = os.path.join(プロジェクトルート, "backend_local", "temp")
                    os.makedirs(local_temp_dir, exist_ok=True)
                    with open(os.path.join(local_temp_dir, "reboot_local.txt"), "w", encoding="utf-8") as f:
                        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                if reboot_task or reboot_team:
                    taskteam_temp_dir = os.path.join(プロジェクトルート, "backend_taskteam", "temp")
                    os.makedirs(taskteam_temp_dir, exist_ok=True)
                    with open(os.path.join(taskteam_temp_dir, "reboot_taskteam.txt"), "w", encoding="utf-8") as f:
                        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                logger.info(
                    "再起動要求受信: reboot_core=%s reboot_apps=%s reboot_tools=%s reboot_local=%s reboot_task=%s reboot_team=%s",
                    reboot_core,
                    reboot_apps,
                    reboot_tools,
                    reboot_local,
                    reboot_task,
                    reboot_team,
                )
            except Exception:
                logger.exception("再起動要求の処理に失敗しました")

        if リセット:
            return {
                "status": "OK",
                "message": "AI設定をデフォルトへリセットし、再起動要求を受け付けました" if 再起動要求あり else "AI設定をデフォルトへリセットしました"
            }
        if 再起動のみ:
            return {
                "status": "OK",
                "message": "再起動要求を受け付けました"
            }
        if 設定保存済み:
            return {
                "status": "OK",
                "message": f"{len(許可設定)}件の設定をAiDiy_key.jsonに保存しました"
            }
        return {
            "status": "OK",
            "message": f"{len(許可設定)}件の設定を更新しました（セッション内のみ）"
        }

    except Exception as e:
        logger.exception("モデル設定エラー")
        return {
            "status": "NG",
            "message": f"モデル設定エラー: {str(e)}"
        }

@router.websocket("/core/ws/AIコア")
async def websocket_endpoint(WebSocket接続: WebSocket):
    """
    AIコア WebSocketエンドポイント
    セッション確立、状態同期、ストリーミング処理を行う
    """
    try:
        principal, auth_protocol = authenticate(WebSocket接続, "WEBSOCKET", "/core/ws/AIコア")
    except HTTPException:
        await WebSocket接続.close(code=1008)
        return
    セッションID = None
    ソケット番号 = "input"

    try:
        await WebSocket接続.accept(subprotocol=auth_protocol)
        # ノイズ削減: 接続受付ログは通常運用では出力しない

        # 初回メッセージでセッションID・ソケット番号を受信
        try:
            初期データ = await WebSocket接続.receive_json()
            クライアントセッションID = 初期データ.get("セッションID")
            ソケット番号 = 初期データ.get("ソケット番号")
            if ソケット番号 is None:
                ソケット番号 = 初期データ.get("チャンネル")
            if ソケット番号 is None:
                ソケット番号 = "input"
            else:
                ソケット番号 = str(ソケット番号)
            _ws_log(ch=ソケット番号, 内容="接続要求", セッションID=クライアントセッションID)
        except WebSocketDisconnect as e:
            _ws_log(ch=-99, 内容=f"初回受信前に切断: code={getattr(e, 'code', '-')}", level="info")
            return
        except Exception as e:
            _ws_log(ch=-99, 内容=f"初回受信エラー: {e}", level="error")
            return

        # WebSocket接続を登録（accept済み）
        既存セッション再接続 = bool(クライアントセッションID and クライアントセッションID in AIセッション管理.sessions)
        新規セッション = not クライアントセッションID or クライアントセッションID not in AIセッション管理.sessions
        try:
            セッションID = await AIセッション管理.connect(
                WebSocket接続,
                セッションID=クライアントセッションID,
                socket_no=ソケット番号,
                app_conf=getattr(WebSocket接続.app, "conf", None),
                accept_in_connect=False,
                code_base_path=初期データ.get("CODE_BASE_PATH"),
                live_model_settings=初期データ.get("モデル設定"),
                voice=初期データ.get("voice"),
                auth_owner=principal.owner,
            )
        except ValueError as e:
            await WebSocket接続.send_json({"メッセージ識別": "error", "メッセージ内容": str(e)})
            await WebSocket接続.close(code=1008)
            return

        セッション = AIセッション管理.get_session(セッションID)
        if not セッション:
            raise RuntimeError("セッションの作成に失敗しました")
        
        # 新規セッション作成時は、セッション固有のCODE_BASE_PATHでバックアップ実行
        if 新規セッション and セッション.モデル設定 and ソケット番号 == "input":
            try:
                セッションバックアップ開始(
                    セッション, AIセッション管理, 呼出しロガー=logger,
                    アプリ設定=getattr(WebSocket接続.app, "conf", None),
                    backend_dir=バックエンドディレクトリ,
                )
            except Exception as e:
                logger.error(f"WebSocket接続時バックアップエラー: {e}")

        # セッション内の初期化は1回ずつ直列化（複数ソケット同時接続での重複起動防止）
        async with セッション.初期化ロック:
            # 同じ番号で接続し直した旧ハンドラーは、新しい接続を初期化しない。
            登録接続 = セッション.get_socket(ソケット番号)
            if not 登録接続 or 登録接続.websocket is not WebSocket接続:
                return
            # 初回のみプロセッサを起動
            if セッション.streaming_processor is None and ソケット番号 == "core":
                セッション.streaming_processor = StreamingProcessor(セッションID, セッション)
                await セッション.streaming_processor.start()

            if セッション.voice_enabled and セッション.recognition_processor is None:
                セッション.recognition_processor = Recognition(セッションID, セッション, 保存_会話履歴)
                await セッション.recognition_processor.開始()

            実行パス = コードベース絶対パス取得(
                アプリ設定=getattr(WebSocket接続.app, "conf", None),
                backend_dir=バックエンドディレクトリ,
                セッション設定=セッション.モデル設定,
            )
            チャット保存基準パス = バックエンドディレクトリ
            chat_ai = セッション.モデル設定.get("CHAT_AI_NAME", "")
            chat_model = ""
            if chat_ai == "openrt_chat":
                chat_model = セッション.モデル設定.get("CHAT_OPENRT_MODEL", "")
            elif chat_ai in ("openai_chat", "openai_oauth"):
                chat_model = セッション.モデル設定.get("CHAT_OPENAI_MODEL", "")
            elif chat_ai in ("gemini_chat", "freeai_chat"):
                key = "CHAT_FREEAI_MODEL" if chat_ai == "freeai_chat" else "CHAT_GEMINI_MODEL"
                chat_model = セッション.モデル設定.get(key, "")
            elif chat_ai == "ollama_chat":
                chat_model = セッション.モデル設定.get("CHAT_OLLAMA_MODEL", "")
            elif chat_ai == "local_chat":
                chat_model = セッション.モデル設定.get("CHAT_LOCAL_MODEL", "")

            if not hasattr(セッション, "chat_processor"):
                セッション.chat_processor = Chat(
                    親=WebSocket接続.app,
                    セッションID=セッションID,
                    チャンネル="0",
                    絶対パス=チャット保存基準パス,
                    AI_NAME=chat_ai,
                    AI_MODEL=chat_model,
                    接続=セッション,
                    保存関数=保存_会話履歴,
                )
                await セッション.chat_processor.開始()
            else:
                セッション.chat_processor.AI_NAME = chat_ai
                セッション.chat_processor.AI_MODEL = chat_model
                if hasattr(セッション.chat_processor, "_select_ai_module"):
                    セッション.chat_processor.AIモジュール = セッション.chat_processor._select_ai_module()
                if not getattr(セッション.chat_processor, "is_alive", False):
                    await セッション.chat_processor.開始()

            if (not hasattr(セッション, "code_agent_processors")) or (not isinstance(セッション.code_agent_processors, list)) or (len(セッション.code_agent_processors) != 6):
                セッション.code_agent_processors = []
                for i in range(1, 7):
                    ai_key = f"CODE_AI{i}_NAME"
                    model_key = f"CODE_AI{i}_MODEL"
                    agent = CodeAgent(
                        親=WebSocket接続.app,
                        セッションID=セッションID,
                        チャンネル=str(i),
                        絶対パス=実行パス,
                        AI_NAME=セッション.モデル設定.get(ai_key, ""),
                        AI_MODEL=セッション.モデル設定.get(model_key, ""),
                        接続=セッション,
                        保存関数=保存_会話履歴,
                    )
                    await agent.開始()
                    セッション.code_agent_processors.append(agent)
            else:
                for i, agent in enumerate(セッション.code_agent_processors, start=1):
                    ai_key = f"CODE_AI{i}_NAME"
                    model_key = f"CODE_AI{i}_MODEL"
                    agent.AI_NAME = セッション.モデル設定.get(ai_key, "")
                    agent.AI_MODEL = セッション.モデル設定.get(model_key, "")
                    agent.絶対パス = 実行パス
                    if hasattr(agent, "_select_ai_module"):
                        agent.AIモジュール = agent._select_ai_module()
                    if not getattr(agent, "is_alive", False):
                        await agent.開始()

            # Toolsインスタンスを作成（コードエージェント初期化後）
            if not hasattr(セッション, "tools_instance"):
                from AIコア.AI内部ツール import Tools
                セッション.tools_instance = Tools(セッション=セッション)

            if セッション.voice_enabled:
                live_ai = セッション.モデル設定.get("LIVE_AI_NAME", "")
                live_model = ""
                live_voice = ""
                if live_ai in ("gemini_live", "freeai_live"):
                    model_key = "LIVE_FREEAI_MODEL" if live_ai == "freeai_live" else "LIVE_GEMINI_MODEL"
                    voice_key = "LIVE_FREEAI_VOICE" if live_ai == "freeai_live" else "LIVE_GEMINI_VOICE"
                    live_model = セッション.モデル設定.get(model_key, "")
                    live_voice = セッション.モデル設定.get(voice_key, "")
                elif live_ai == "openai_live":
                    live_model = セッション.モデル設定.get("LIVE_OPENAI_MODEL", "")
                    live_voice = セッション.モデル設定.get("LIVE_OPENAI_VOICE", "")

                if not getattr(セッション, "live_processor", None):
                    セッション.live_processor = Live(
                        親=WebSocket接続.app,
                        セッションID=セッションID,
                        チャンネル="0",
                        絶対パス=実行パス,
                        AI_NAME=live_ai,
                        AI_MODEL=live_model,
                        AI_VOICE=live_voice,
                        接続=セッション,
                        保存関数=保存_会話履歴,
                    )
                else:
                    セッション.live_processor.AI_NAME = live_ai
                    セッション.live_processor.AI_MODEL = live_model
                    セッション.live_processor.AI_VOICE = live_voice
                    セッション.live_processor.絶対パス = 実行パス
                    if hasattr(セッション.live_processor, "_select_ai_module"):
                        セッション.live_processor.AIモジュール = セッション.live_processor._select_ai_module()
                    # リロード再接続時もCODE_BASE_PATHに応じたコンテキストを毎回再構築
                    if hasattr(セッション.live_processor, "システム指示更新"):
                        code_base_path = str(セッション.モデル設定.get("CODE_BASE_PATH", ""))
                        セッション.live_processor.システム指示更新(code_base_path)

                # 画面リフレッシュ再接続時はLive接続を張り直し、コンテキスト反映漏れを防ぐ
                if (
                    ソケット番号 == "audio"
                    and 既存セッション再接続
                    and hasattr(セッション, "live_processor")
                    and セッション.live_processor
                    and (getattr(セッション.live_processor, "AIインスタンス", None) or getattr(セッション.live_processor, "is_alive", False))
                ):
                    try:
                        await セッション.live_processor.終了()
                        _ws_log(ch=ソケット番号, 内容="Live接続をリセット", セッションID=セッションID)
                    except Exception:
                        logger.exception("Live接続リセットに失敗しました")

                # LiveAIは音声チャンネル(audio)接続時にのみ起動
                if ソケット番号 == "audio" and not getattr(セッション.live_processor, "is_alive", False):
                    await セッション.live_processor.開始()

                # audioチャンネル接続時にLiveAIのAPIキー確認結果をwelcome_textでch0に送信
                if ソケット番号 == "audio" and hasattr(セッション, "live_processor") and セッション.live_processor:
                    asyncio.create_task(セッション.live_processor.接続時welcome送信())

                if セッション.audio_split_task is None or セッション.audio_split_task.done():
                    セッション.audio_split_task = asyncio.create_task(統合音声分離ワーカー(セッション))

        # init はソケット登録だけを示す。要求したクライアントにはProviderの準備完了も通知する。
        if ソケット番号 == "audio" and 初期データ.get("Live準備確認") is True:
            try:
                await セッション.live_processor.待受準備確認()
            except Exception as e:
                await WebSocket接続.send_json({
                    "セッションID": セッションID,
                    "メッセージ識別": "error",
                    "メッセージ内容": str(e),
                })
                return
            await WebSocket接続.send_json({
                "セッションID": セッションID,
                "メッセージ識別": "live_ready",
                "メッセージ内容": "LiveAIの音声待受準備が完了しました。",
            })

        # 出力ソケット接続時にwelcome_info/welcome_textを送信（core/input含む）
        if ソケット番号 in welcome対象チャンネル一覧:
            追加メッセージ = ""
            ウェルカム本文 = ""
            if ソケット番号 == "core":
                CODE_ROOT_PATH = 取得_CODE_ROOT_PATH(
                    セッション=セッション,
                    アプリ設定=getattr(WebSocket接続.app, "conf", None),
                )
                ウェルカム本文 = f"Project: {CODE_ROOT_PATH}" if CODE_ROOT_PATH else "Root: (not found)"
                aidiy内容 = 読取_AIDIY_MD内容(CODE_ROOT_PATH)
                追加メッセージ = aidiy内容 if aidiy内容 else "_AIDIY.md にプロジェクト概要を記載してください。"
            elif ソケット番号 == "0":
                last_update = セッション.ソース最終更新日時
                if not last_update:
                    last_update = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                if not isinstance(last_update, str):
                    last_update = str(last_update)

                live_ai = セッション.モデル設定.get("LIVE_AI_NAME", "")
                live_model = ""
                live_voice = ""
                if live_ai in ("gemini_live", "freeai_live"):
                    model_key = "LIVE_FREEAI_MODEL" if live_ai == "freeai_live" else "LIVE_GEMINI_MODEL"
                    voice_key = "LIVE_FREEAI_VOICE" if live_ai == "freeai_live" else "LIVE_GEMINI_VOICE"
                    live_model = セッション.モデル設定.get(model_key, "")
                    live_voice = セッション.モデル設定.get(voice_key, "")
                elif live_ai == "openai_live":
                    live_model = セッション.モデル設定.get("LIVE_OPENAI_MODEL", "")
                    live_voice = セッション.モデル設定.get("LIVE_OPENAI_VOICE", "")
                if not live_model:
                    live_model = セッション.モデル設定.get("LIVE_GEMINI_MODEL", "") or セッション.モデル設定.get("LIVE_FREEAI_MODEL", "")
                if not live_voice:
                    live_voice = セッション.モデル設定.get("LIVE_GEMINI_VOICE", "") or セッション.モデル設定.get("LIVE_FREEAI_VOICE", "")

                ウェルカム本文 = (
                    f"私は AiDiy(アイディ) です。 (LastUpdate: {last_update})\n"
                    f"（Model: \"{live_model}\", Voice: \"{live_voice}\"）\n"
                    "音声、テキスト、画像共有しての会話ができます！"
                )
                追加メッセージ = "会話準備できました。よろしくお願いします。"
            elif ソケット番号 in コードチャンネル一覧:
                idx = int(ソケット番号)
                ai_key = f"CODE_AI{idx}_NAME"  # intに変換して使用
                model_key = f"CODE_AI{idx}_MODEL"
                ai_name = セッション.モデル設定.get(ai_key, "")
                ai_model = セッション.モデル設定.get(model_key, "")
                model_auto = not str(ai_model or "").strip() or str(ai_model).strip().lower() == "auto"
                if model_auto:
                    # CLIのautoは実行時に判断する。設定済みモデルで表示を置換しない。
                    ai_model = (
                        セッション.モデル設定.get("CODE_CLAUDE_SDK_MODEL", "auto")
                        if ai_name == "claude_sdk" else "auto"
                    )

                ウェルカム本文 = (
                    f"私は Code Agent ({idx}) です。\n"
                    f"（Name: \"{ai_name}\", Model: \"{ai_model}\"）\n"
                    "システム開発を支援します。"
                )
                追加メッセージ = "準備できました。"
            if ウェルカム本文:
                await セッション.send_to_channel(ソケット番号, {
                    "セッションID": セッションID,
                    "チャンネル": ソケット番号,
                    "メッセージ識別": "welcome_info",
                    "メッセージ内容": ウェルカム本文,
                    "ファイル名": None,
                    "サムネイル画像": None
                })
                _ws_log(ch=ソケット番号, 内容="welcome_info送信", セッションID=セッションID)

            await asyncio.sleep(0.1)
            if ソケット番号 in 数値チャンネル一覧:
                try:
                    await 送信_会話履歴(セッション, セッションID, チャンネル=ソケット番号)
                except Exception as e:
                    logger.exception(f"会話履歴送信エラー: {e}")
                # 初期化結果をAIモジュールからwelcome_textで通知（バックグラウンドタスク）
                try:
                    if ソケット番号 == "0" and hasattr(セッション, "chat_processor") and セッション.chat_processor:
                        asyncio.create_task(セッション.chat_processor.接続時welcome送信())
                    elif ソケット番号 in コードチャンネル一覧 and hasattr(セッション, "code_agent_processors"):
                        idx = int(ソケット番号) - 1
                        if idx < len(セッション.code_agent_processors):
                            asyncio.create_task(セッション.code_agent_processors[idx].接続時welcome送信())
                except Exception as e:
                    logger.exception(f"welcome_textタスク起動エラー: {e}")
            elif ソケット番号 == "core":
                try:
                    await セッション.send_to_channel(ソケット番号, {
                        "セッションID": セッションID,
                        "チャンネル": ソケット番号,
                        "メッセージ識別": "welcome_text",
                        "メッセージ内容": 追加メッセージ,
                        "ファイル名": None,
                        "サムネイル画像": None
                    })
                except Exception as e:
                    logger.exception(f"準備メッセージ送信エラー: {e}")

        # メインループ：メッセージを受信し処理
        while True:
            try:
                受信データ = await WebSocket接続.receive_json()
                # ブラウザ / Live 拡張のJSON heartbeatは会話や音声の要求に混ぜない。
                if 受信データ.get("type") == "ping":
                    await WebSocket接続.send_json({"type": "pong", "セッションID": セッションID})
                    continue
                メッセージ識別 = 受信データ.get("メッセージ識別")

                # fileチャンネル：ファイル系メッセージを独立処理
                if ソケット番号 == "file":
                    if メッセージ識別 == "files_backup":
                        try:
                            チャンネル = str(受信データ.get("チャンネル", "file"))
                            要求日時分数 = _要求日時分数取得(受信データ, デフォルト値=0)

                            # セッションに保存済みのバックアップ情報を使用
                            最終ファイルリスト = list(セッション.全ファイルリスト) if セッション else []
                            バックアップベースパス = セッション.バックアップベースパス if セッション else ""
                            # CODE_BASE_PATHを絶対パスに解決してフロントエンドへ送る
                            _raw = str((セッション.モデル設定 or {}).get("CODE_BASE_PATH", "")).strip() if セッション else ""
                            if _raw:
                                プロジェクトパス = os.path.abspath(_raw) if os.path.isabs(_raw) else os.path.abspath(os.path.join(バックエンドディレクトリ, _raw))
                            else:
                                プロジェクトパス = ""
                            フィルタ後リスト = _日時フィルタ適用(最終ファイルリスト, 要求日時分数)
                            ファイルリスト = sorted(フィルタ後リスト, key=lambda x: x.get("パス", ""))
                            最終ファイル日時 = _最大更新日時文字列(ファイルリスト)
                            if not 最終ファイル日時:
                                最終ファイル日時 = (セッション.ソース最終更新日時 if セッション else "") or ""

                            await セッション.send_to_channel(チャンネル, {
                                "セッションID": セッションID,
                                "チャンネル": チャンネル,
                                "メッセージ識別": "files_backup",
                                "メッセージ内容": {
                                    "要求日時": 要求日時分数,
                                    "プロジェクトパス": プロジェクトパス,
                                    "バックアップベースパス": バックアップベースパス,
                                    "最終ファイル日時": 最終ファイル日時,
                                    "ファイルリスト": ファイルリスト,
                                }
                            })
                            logger.info(f"[files_backup] 返信: {len(ファイルリスト)}件 ({セッションID})")
                        except Exception as e:
                            logger.error(f"[files_backup] エラー: {e}", exc_info=True)

                    elif メッセージ識別 == "files_save":
                        try:
                            # バックアップ再実行 → セッションのファイルリストを更新
                            if セッション and セッション.モデル設定:
                                await セッションバックアップ完了待機(
                                    セッション, AIセッション管理, 呼出しロガー=logger,
                                    アプリ設定=getattr(WebSocket接続.app, "conf", None),
                                    backend_dir=バックエンドディレクトリ,
                                )
                            logger.info(f"[files_save] バックアップ完了 ({セッションID})")
                        except Exception as e:
                            logger.error(f"[files_save] エラー: {e}", exc_info=True)

                    elif メッセージ識別 == "files_temp":
                        try:
                            チャンネル = str(受信データ.get("チャンネル", "file"))
                            要求日時分数 = _要求日時分数取得(受信データ, デフォルト値=60)

                            # tempフォルダのファイル一覧（要求日時で絞込）
                            tempパス = os.path.join(バックエンドディレクトリ, "temp")
                            全ファイルリスト = []
                            if os.path.exists(tempパス):
                                for root, dirs, files in os.walk(tempパス):
                                    dirs[:] = [d for d in dirs if d not in ["logs"]]
                                    for file in files:
                                        if file.endswith(".log"):
                                            continue
                                        full_path = os.path.join(root, file)
                                        try:
                                            mtime = os.path.getmtime(full_path)
                                            更新日時 = datetime.fromtimestamp(mtime).strftime("%Y/%m/%d %H:%M:%S")
                                        except OSError:
                                            continue
                                        相対パス = "temp/" + os.path.relpath(full_path, tempパス).replace("\\", "/")
                                        全ファイルリスト.append({"パス": 相対パス, "更新日時": 更新日時})

                            ファイルリスト = _日時フィルタ適用(全ファイルリスト, 要求日時分数)
                            作業ファイル日時 = _最大更新日時文字列(ファイルリスト)

                            await セッション.send_to_channel(チャンネル, {
                                "セッションID": セッションID,
                                "チャンネル": チャンネル,
                                "メッセージ識別": "files_temp",
                                "メッセージ内容": {
                                    "要求日時": 要求日時分数,
                                    "作業ファイル日時": 作業ファイル日時,
                                    "ファイルリスト": sorted(ファイルリスト, key=lambda x: x["パス"]),
                                }
                            })
                            logger.debug(f"[files_temp] 返信: {len(ファイルリスト)}件 ({セッションID})")
                        except Exception as e:
                            logger.error(f"[files_temp] エラー: {e}", exc_info=True)

                    elif メッセージ識別 == "file_select":
                        try:
                            内容 = 受信データ.get("メッセージ内容", {})
                            セッション.選択パス = 内容.get("パス", "")
                            セッション.選択種別 = 内容.get("種別", "")
                            セッション.選択パネル = 内容.get("パネル", "")
                            セッション.選択タイムスタンプ = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
                            logger.info(f"[file_select] {セッション.選択種別}={セッション.選択パス} ({セッションID})")

                            # 画像ファイル選択 + Live有効 → Liveへ画像送信
                            if セッション.選択種別 == "file" and セッション.選択パス:
                                _拡張子 = os.path.splitext(セッション.選択パス)[1].lower()
                                if _拡張子 in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
                                    # 絶対パスを解決（左パネル=バックアップ / 右パネル=temp）
                                    if セッション.選択パネル == "left":
                                        _raw = str((セッション.モデル設定 or {}).get("CODE_BASE_PATH", "")).strip()
                                        if _raw:
                                            _proj = os.path.abspath(_raw) if os.path.isabs(_raw) else os.path.abspath(os.path.join(バックエンドディレクトリ, _raw))
                                        else:
                                            _proj = バックエンドディレクトリ
                                        _絶対パス = os.path.join(_proj, セッション.選択パス)
                                    else:
                                        _絶対パス = os.path.abspath(os.path.join(バックエンドディレクトリ, セッション.選択パス))

                                    if os.path.exists(_絶対パス):
                                        _lp = getattr(セッション, "live_processor", None)
                                        if セッション.voice_enabled and _lp and getattr(getattr(_lp, "AIインスタンス", None), "is_alive", False):
                                            _fmt = "jpeg" if _拡張子 in (".jpg", ".jpeg") else _拡張子.lstrip(".")
                                            with open(_絶対パス, "rb") as _f:
                                                _画像データ = _f.read()
                                            await _lp.画像送信(_画像データ, format=_fmt)
                                            logger.info(f"[file_select] Live画像送信: {_絶対パス}")
                                        else:
                                            logger.debug(f"[file_select] Live未起動のため画像送信スキップ: {_絶対パス}")
                                    else:
                                        logger.warning(f"[file_select] 画像ファイルが見つかりません: {_絶対パス}")
                        except Exception as e:
                            logger.error(f"[file_select] エラー: {e}", exc_info=True)

                    elif メッセージ識別 == "file_deselect":
                        try:
                            セッション.選択パス = ""
                            セッション.選択種別 = ""
                            セッション.選択パネル = ""
                            セッション.選択タイムスタンプ = ""
                            logger.info(f"[file_deselect] ({セッションID})")
                        except Exception as e:
                            logger.error(f"[file_deselect] エラー: {e}", exc_info=True)

                    continue

                # input/audio チャンネル：通常メッセージ処理
                if ソケット番号 not in ("input", "audio"):
                    continue

                # awaitやキュー投入より前に固定。添付・最終応答も同じルートで分析できる。
                if メッセージ識別 in ("input_text", "input_request", "input_file"):
                    try:
                        受信データ["プロジェクトパス"] = 要求履歴パス確定(セッション, 受信データ)
                    except ValueError as e:
                        await WebSocket接続.send_json({
                            "セッションID": セッションID, "チャンネル": 受信データ.get("チャンネル", "0"),
                            "メッセージ識別": "error", "メッセージ内容": str(e),
                            "エラーコード": "PROJECT_CONTEXT_MISMATCH",
                        })
                        # 拒否でも送信待ち状態を解除する。Code拡張には本文を重複表示しない。
                        通知チャンネル = str(受信データ.get("チャンネル", "0"))
                        if 通知チャンネル not in 数値チャンネル一覧:
                            通知チャンネル = "0"
                        実行状態通知 = 受信データ.get("実行状態通知") is True
                        await セッション.send_to_channel(通知チャンネル, {
                            "セッションID": セッションID,
                            "メッセージ識別": "output_end" if 実行状態通知 else "output_text",
                            "メッセージ内容": "" if 実行状態通知 else f"! {e}",
                            "実行中": False,
                        })
                        continue

                if メッセージ識別 == "operations":
                    if ソケット番号 != "input":
                        continue
                    内容 = 受信データ.get("メッセージ内容", {})
                    ボタン = 内容.get("ボタン", {})
                    if not isinstance(ボタン, dict):
                        ボタン = {}
                    セッション.update_state(ボタン, manager=AIセッション管理)

                elif メッセージ識別 == "input_text":
                    if ソケット番号 != "input":
                        continue
                    メッセージ内容 = 受信データ.get("メッセージ内容") or 受信データ.get("text", "")
                    送信モード = str(受信データ.get("送信モード", ""))
                    チャンネル = str(受信データ.get("チャンネル", "0"))
                    # チャンネルでルーティング先を決定
                    # "1"-"4": AIコード.vue（コードエージェント）
                    # "input": AIイメージ.vue（ライブ）
                    # "0": AIチャット.vue → 送信モードで判断
                    if チャンネル in コードチャンネル一覧:
                        出力先チャンネル = チャンネル
                    elif チャンネル == "input":
                        出力先チャンネル = "0"  # エコーバック先はch0
                    elif 送信モード.startswith("Code") and 送信モード[4:].isdigit():
                        出力先チャンネル = 送信モード[4:]
                    else:
                        出力先チャンネル = "0"
                    入力フィードバック対象 = チャンネル in 数値チャンネル一覧
                    logger.debug(f"テキスト受信 (チャンネル={チャンネル}, 送信モード={送信モード}, 出力先={出力先チャンネル}, {セッションID}): {メッセージ内容}")

                    if セッション.is_channel_processing(出力先チャンネル):
                        await セッション.send_to_channel(出力先チャンネル, {
                            "セッションID": セッションID,
                            "チャンネル": 出力先チャンネル,
                            "メッセージ識別": "output_text",
                            "メッセージ内容": f"⏳ チャンネル{出力先チャンネル}は処理中です。キューに追加しました...",
                            "ファイル名": None,
                            "サムネイル画像": None
                        })
                        logger.info(f"チャンネル{出力先チャンネル}処理中のため、キューに追加: {セッションID}")
                        continue

                    セッション.set_channel_processing(出力先チャンネル, True)

                    # 1分以内のファイルを添付（エコーバック前に取得）
                    添付ファイル一覧 = セッション.最近のファイル取得(出力先チャンネル, 秒数=60)
                    エコーバック用メッセージ = メッセージ内容

                    # 画像ファイルがあればメッセージに添付通知を追加
                    if 添付ファイル一覧:
                        受信データ["添付ファイル一覧"] = 添付ファイル一覧
                        logger.info(f"添付ファイル({出力先チャンネル}): {len(添付ファイル一覧)}件 {添付ファイル一覧}")

                        # 最初の画像ファイルを検索
                        画像ファイル = None
                        for パス in 添付ファイル一覧:
                            if os.path.exists(パス):
                                拡張子 = os.path.splitext(パス)[1].lower()
                                if 拡張子 in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
                                    画像ファイル = パス
                                    break

                        # 画像ファイルがあればエコーバックメッセージに添付通知を追加
                        if 画像ファイル:
                            try:
                                カレントディレクトリ = os.getcwd()
                                if 画像ファイル.startswith(カレントディレクトリ):
                                    相対パス = os.path.relpath(画像ファイル, カレントディレクトリ).replace("\\", "/")
                                else:
                                    ファイル名のみ = os.path.basename(画像ファイル)
                                    相対パス = f"temp/output/{ファイル名のみ}"
                            except (ValueError, OSError) as e:
                                logger.debug(f"相対パス計算エラー: {e}")
                                ファイル名のみ = os.path.basename(画像ファイル)
                                相対パス = f"temp/output/{ファイル名のみ}"
                            エコーバック用メッセージ = f"{メッセージ内容}\n[ファイル添付: {相対パス}]"
                            logger.info(f"画像自動添付通知追加: {相対パス}")

                    # 60s以内のファイルがなく、ファイルパネルで選択中のパスがある場合はプロンプトに追加
                    elif セッション.選択パス:
                        種別名 = "フォルダ" if セッション.選択種別 == "folder" else "ファイル"
                        選択通知 = f"選択中の{種別名}: {セッション.選択パス}"
                        受信データ["選択ファイル情報"] = 選択通知
                        エコーバック用メッセージ = f"{メッセージ内容}\n[{選択通知}]"
                        logger.info(f"選択ファイル情報をプロンプトに追加: {選択通知}")

                    # 入力フィードバックはチャンネル0/1/2/3/4のみ表示する。
                    # チャンネルinput（AIイメージ）からのinput_textはLiveAIへ送るが、チャットへの入力エコーは出さない。
                    if 入力フィードバック対象:
                        フィードバック表示チャンネル一覧 = [出力先チャンネル]
                        # AIチャット.vue（ch0）からCode1-4へ送信した場合は、
                        # チャット画面(ch0)にも入力フィードバックを表示する。
                        if チャンネル == "0" and 出力先チャンネル in コードチャンネル一覧:
                            フィードバック表示チャンネル一覧.append("0")

                        for フィードバック表示チャンネル in dict.fromkeys(フィードバック表示チャンネル一覧):
                            # ch0からCode1-4へ送信時: ch1-4にはinput_request、ch0にはinput_text
                            if チャンネル == "0" and フィードバック表示チャンネル in コードチャンネル一覧:
                                await セッション.send_to_channel(フィードバック表示チャンネル, {
                                    "セッションID": セッションID,
                                    "チャンネル": フィードバック表示チャンネル,
                                    "メッセージ識別": "input_request",
                                    "メッセージ内容": エコーバック用メッセージ,
                                    "ファイル名": None,
                                    "サムネイル画像": None
                                })
                                保存_会話履歴(
                                    プロジェクトパス=受信データ.get("プロジェクトパス"),
                                    セッションID=セッションID,
                                    チャンネル=フィードバック表示チャンネル,
                                    メッセージ識別="input_request",
                                    メッセージ内容=エコーバック用メッセージ,
                                    ファイル名=None,
                                    サムネイル画像=None
                                )
                            else:
                                await セッション.send_to_channel(フィードバック表示チャンネル, {
                                    "セッションID": セッションID,
                                    "チャンネル": フィードバック表示チャンネル,
                                    "メッセージ識別": "input_text",
                                    "メッセージ内容": エコーバック用メッセージ,
                                    "ファイル名": None,
                                    "サムネイル画像": None
                                })
                                保存_会話履歴(
                                    プロジェクトパス=受信データ.get("プロジェクトパス"),
                                    セッションID=セッションID,
                                    チャンネル=フィードバック表示チャンネル,
                                    メッセージ識別="input_text",
                                    メッセージ内容=エコーバック用メッセージ,
                                    ファイル名=None,
                                    サムネイル画像=None
                                )

                    受信データ["チャンネル"] = 出力先チャンネル

                    try:
                        if 出力先チャンネル in コードチャンネル一覧 and hasattr(セッション, 'code_agent_processors'):
                            # コードエージェント（AIコード.vue: チャンネル1-4 / AIチャット.vue: 送信モードCode1-4）
                            # ch0からの送信はinput_requestとして処理する
                            if チャンネル == "0":
                                受信データ["メッセージ識別"] = "input_request"
                            await セッション.code_agent_processors[int(出力先チャンネル) - 1].コード要求(受信データ)
                        elif チャンネル == "input" or 送信モード == "Live":
                            # ライブAI（AIイメージ.vue: チャンネルinput / AIチャット.vue: 送信モードLive）
                            logger.info(f"input_text: LiveAIへルーティング (チャンネル={チャンネル}, 送信モード={送信モード}) socket={セッションID}")
                            if セッション.voice_enabled and getattr(セッション, "live_processor", None):
                                送信成功 = await セッション.live_processor.テキスト送信(メッセージ内容)
                                if 送信成功:
                                    logger.info(f"LiveAIテキスト送信完了: socket={セッションID}")
                                else:
                                    logger.warning(f"LiveAIテキスト送信失敗: socket={セッションID}")
                            else:
                                logger.warning(f"LiveAI未初期化のためChatへフォールバック ({セッションID})")
                                if hasattr(セッション, "chat_processor"):
                                    await セッション.chat_processor.チャット要求(受信データ)
                        else:
                            # チャットAI（AIチャット.vue: 送信モードChat）
                            if hasattr(セッション, "chat_processor"):
                                await セッション.chat_processor.チャット要求(受信データ)
                    finally:
                        セッション.set_channel_processing(出力先チャンネル, False)

                elif メッセージ識別 == "input_request":
                    if ソケット番号 != "input":
                        continue
                    メッセージ内容 = 受信データ.get("メッセージ内容") or 受信データ.get("text", "")
                    送信モード = str(受信データ.get("送信モード", ""))
                    チャンネル = str(受信データ.get("チャンネル", "1"))
                    # 送信モードからルーティングチャンネルを決定（後方互換: 出力先チャンネルも参照）
                    if 送信モード.startswith("Code") and 送信モード[4:].isdigit():
                        出力先チャンネル = 送信モード[4:]
                    else:
                        出力先チャンネル = str(受信データ.get("出力先チャンネル", チャンネル))
                    logger.debug(f"リクエスト受信 (送信モード={送信モード}, 出力先={出力先チャンネル}, {セッションID}): {メッセージ内容}")

                    # input_requestはコードエージェント専用（チャンネル1-4のみ）
                    if 出力先チャンネル not in ("1", "2", "3", "4"):
                        logger.warning(f"input_requestはチャンネル1-4のみ対応: 出力先={出力先チャンネル}")
                        continue

                    if セッション.is_channel_processing(出力先チャンネル):
                        await セッション.send_to_channel(出力先チャンネル, {
                            "セッションID": セッションID,
                            "チャンネル": 出力先チャンネル,
                            "メッセージ識別": "output_text",
                            "メッセージ内容": f"⏳ チャンネル{出力先チャンネル}は処理中です。キューに追加しました...",
                            "ファイル名": None,
                            "サムネイル画像": None
                        })
                        logger.info(f"チャンネル{出力先チャンネル}処理中のため、キューに追加: {セッションID}")
                        continue

                    セッション.set_channel_processing(出力先チャンネル, True)

                    # input_requestメッセージをエコーバック
                    await セッション.send_to_channel(出力先チャンネル, {
                        "セッションID": セッションID,
                        "チャンネル": 出力先チャンネル,
                        "メッセージ識別": "input_request",
                        "メッセージ内容": メッセージ内容,
                        "ファイル名": None,
                        "サムネイル画像": None
                    })

                    # 会話履歴保存
                    保存_会話履歴(
                        プロジェクトパス=受信データ.get("プロジェクトパス"),
                        セッションID=セッションID,
                        チャンネル=出力先チャンネル,
                        メッセージ識別="input_request",
                        メッセージ内容=メッセージ内容,
                        ファイル名=None,
                        サムネイル画像=None
                    )

                    受信データ["チャンネル"] = 出力先チャンネル

                    # 1分以内のファイルを添付
                    添付ファイル一覧 = セッション.最近のファイル取得(出力先チャンネル, 秒数=60)
                    if 添付ファイル一覧:
                        受信データ["添付ファイル一覧"] = 添付ファイル一覧
                        logger.info(f"添付ファイル(request ch{出力先チャンネル}): {len(添付ファイル一覧)}件 {添付ファイル一覧}")
                    # 60s以内のファイルがなく、ファイルパネルで選択中のパスがある場合はプロンプトに追加
                    elif セッション.選択パス:
                        種別名 = "フォルダ" if セッション.選択種別 == "folder" else "ファイル"
                        受信データ["選択ファイル情報"] = f"選択中の{種別名}: {セッション.選択パス}"
                        logger.info(f"選択ファイル情報をプロンプトに追加(code): {セッション.選択パス}")

                    # コードエージェントに処理を投入
                    try:
                        if hasattr(セッション, 'code_agent_processors'):
                            await セッション.code_agent_processors[int(出力先チャンネル) - 1].コード要求(受信データ)
                    finally:
                        セッション.set_channel_processing(出力先チャンネル, False)

                elif メッセージ識別 == "input_file":
                    if ソケット番号 != "input":
                        continue
                    メッセージ内容 = 受信データ.get("メッセージ内容") or ""
                    チャンネル = str(受信データ.get("チャンネル", "0"))
                    出力先チャンネル = str(受信データ.get("出力先チャンネル", チャンネル))
                    ファイル名 = 受信データ.get("ファイル名")
                    保存ファイル名 = None
                    サムネイル_base64 = None

                    Base64ペイロード = メッセージ内容
                    if Base64ペイロード and "base64," in Base64ペイロード:
                        Base64ペイロード = Base64ペイロード.split("base64,", 1)[1]

                    if Base64ペイロード:
                        try:
                            デコードデータ = base64.b64decode(Base64ペイロード)
                            保存ディレクトリ = os.path.join(バックエンドディレクトリ, "temp", "input")
                            保存ファイル名 = 入力ファイル保存(保存ディレクトリ, ファイル名, デコードデータ)

                            サムネイル_base64 = 画像プレビュー生成(デコードデータ)
                        except Exception as e:
                            logger.exception(f"ファイル保存エラー: {e}")
                            await セッション.send_to_channel(出力先チャンネル, {
                                "セッションID": セッションID, "チャンネル": 出力先チャンネル,
                                "メッセージ識別": "error", "エラーコード": "FILE_UPLOAD_FAILED",
                                "メッセージ内容": "ファイルを保存できませんでした。もう一度送信してください。",
                            })
                            continue

                    await セッション.send_to_channel(出力先チャンネル, {
                        "セッションID": セッションID,
                        "チャンネル": 出力先チャンネル,
                        "メッセージ識別": "input_file",
                        "メッセージ内容": f"ファイル受信: {ファイル名}" if ファイル名 else "ファイル受信",
                        "ファイル名": f"temp/input/{保存ファイル名}" if 保存ファイル名 else None,
                        "元ファイル名": ファイル名,
                        "サムネイル画像": サムネイル_base64
                    })

                    保存_会話履歴(
                        プロジェクトパス=受信データ.get("プロジェクトパス"),
                        セッションID=セッションID,
                        チャンネル=出力先チャンネル,
                        メッセージ識別="input_file",
                        メッセージ内容=f"ファイル受信: {ファイル名}" if ファイル名 else "ファイル受信",
                        ファイル名=f"temp/input/{保存ファイル名}" if 保存ファイル名 else None,
                        サムネイル画像=サムネイル_base64
                    )

                    # ファイルリストに登録（1分以内のチャット/コード要求時に添付用）
                    if セッション and 保存ファイル名:
                        セッション.ファイル登録(出力先チャンネル, f"temp/input/{保存ファイル名}")

                    # チャンネル0: 画像の場合はライブAIへ送信
                    if セッション and 出力先チャンネル == "0" and サムネイル_base64 and Base64ペイロード:
                        try:
                            if セッション.voice_enabled and getattr(セッション, "live_processor", None):
                                画像形式 = "png"
                                if ファイル名 and "." in ファイル名:
                                    拡張子 = ファイル名.rsplit(".", 1)[1].lower()
                                    if 拡張子 in ("jpg", "jpeg", "png", "gif", "webp"):
                                        画像形式 = 拡張子 if 拡張子 != "jpg" else "jpeg"
                                await セッション.live_processor.画像送信(Base64ペイロード, format=画像形式)
                        except Exception as e:
                            logger.warning(f"LiveAI画像送信エラー(input_file): {e}")

                elif メッセージ識別 == "input_audio":
                    if not セッション.voice_enabled:
                        continue
                    try:
                        base64_audio = 受信データ.get("ファイル名") or ""
                        mime_type = 受信データ.get("メッセージ内容", "audio/pcm")
                        if not base64_audio:
                            continue
                        try:
                            audio_bytes = base64.b64decode(base64_audio)
                        except Exception:
                            audio_bytes = b""
                        if not audio_bytes:
                            continue
                        if セッション:
                            # 音声入力では起動要求を行わない（接続初期化時の起動のみ許可）
                            await 音声入力データ処理(セッション, audio_bytes)
                    except Exception as e:
                        logger.warning(f"音声入力処理エラー: {e}")

                elif メッセージ識別 == "cancel_audio":
                    if not セッション.voice_enabled:
                        continue
                    try:
                        if セッション:
                            セッション.output_audio_paused = True
                            logger.info("音声出力停止")
                    except Exception as e:
                        logger.warning(f"cancel_audio処理エラー: {e}")

                elif メッセージ識別 == "cancel_run":
                    try:
                        チャンネル = str(受信データ.get("チャンネル", "0"))
                        if チャンネル in コードチャンネル一覧 and セッション and hasattr(セッション, 'code_agent_processors'):
                            agent = セッション.code_agent_processors[int(チャンネル) - 1]
                            # 即時フィードバック送信（強制停止完了を待たずに先行送信）
                            await セッション.send_to_channel(チャンネル, {
                                "セッションID": セッションID,
                                "チャンネル": チャンネル,
                                "メッセージ識別": "cancel_run",
                                "メッセージ内容": "処理中断！",
                            })
                            # asyncio.Taskベースの強制停止を呼び出し
                            停止成功 = await agent.強制停止()
                            logger.info(f"cancel_run: チャンネル{チャンネル} 強制停止{'成功' if 停止成功 else '(タスクなし)'} ({セッションID})")
                        else:
                            logger.warning(f"cancel_run: 無効なチャンネル={チャンネル} ({セッションID})")
                    except Exception as e:
                        logger.warning(f"cancel_run処理エラー: {e}")

                elif メッセージ識別 == "input_image":
                    if not セッション.voice_enabled:
                        continue
                    try:
                        base64_image = 受信データ.get("ファイル名") or ""
                        mime_type = 受信データ.get("メッセージ内容", "image/png")
                        if not base64_image:
                            continue
                        Base64ペイロード = base64_image
                        if "base64," in base64_image:
                            Base64ペイロード = base64_image.split("base64,", 1)[1]
                        try:
                            image_bytes = base64.b64decode(Base64ペイロード)
                        except Exception:
                            image_bytes = b""
                        if not image_bytes:
                            continue
                        try:
                            保存ディレクトリ = os.path.join(バックエンドディレクトリ, "temp", "input")
                            os.makedirs(保存ディレクトリ, exist_ok=True)
                            タイムスタンプ = datetime.now().strftime("%Y%m%d.%H%M%S")
                            保存ファイル名 = f"{タイムスタンプ}.image.png"
                            保存パス = os.path.join(保存ディレクトリ, 保存ファイル名)
                            with open(保存パス, "wb") as f:
                                f.write(image_bytes)
                            logger.info(f"画像保存完了 ({セッションID}): {保存パス}")
                        except Exception as e:
                            logger.exception(f"画像保存エラー: {e}")
                            continue
                        # LiveAIへ画像送信（大きい画像はLive側でリサイズ）
                        try:
                            if セッション and セッション.voice_enabled and getattr(セッション, "live_processor", None):
                                画像形式 = "png"
                                if isinstance(mime_type, str) and "/" in mime_type:
                                    画像形式 = mime_type.split("/", 1)[1].strip() or "png"
                                await セッション.live_processor.画像送信(Base64ペイロード, format=画像形式)
                        except Exception as e:
                            logger.warning(f"LiveAI画像送信エラー: {e}")
                    except Exception as e:
                        logger.warning(f"画像入力処理エラー: {e}")

                else:
                    logger.error(f"不明なメッセージ識別 ({セッションID}): {メッセージ識別} data={json.dumps(受信データ, ensure_ascii=False)}")

            except WebSocketDisconnect:
                break
            except Exception as e:
                if _is_disconnect_like_error(e):
                    _ws_log(ch=ソケット番号, 内容=f"切断検出: {e}", セッションID=セッションID, level="info")
                    break
                logger.error(f"メッセージ処理エラー ({セッションID}): {e}")
                if not _is_ws_connected(WebSocket接続):
                    break
                try:
                    await WebSocket接続.send_json({
                        "メッセージ識別": "error",
                        "セッションID": セッションID,
                        "メッセージ内容": str(e)
                    })
                except Exception as send_e:
                    if _is_disconnect_like_error(send_e):
                        break
                    logger.debug(f"エラー通知送信失敗 ({セッションID}): {send_e}")
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"エラー ({セッションID}): {e}")
    finally:
        if セッションID is not None:
            _ws_log(ch=ソケット番号, 内容="接続切断", セッションID=セッションID)
            await AIセッション管理.disconnect(セッションID, socket_no=ソケット番号, websocket=WebSocket接続)
            logger.debug(f"クリーンアップ完了: {セッションID}")
