# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""要求受付時のプロジェクトを、キュー・子タスク・履歴保存まで固定する。"""

from contextlib import contextmanager
from contextvars import ContextVar
import ntpath
import os

from 会話履歴パス import normalize_project_path


_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_履歴コンテキスト = ContextVar("aidiy_history_project", default=None)


def 履歴パス解決(value):
    """既知の CODE_BASE_PATH の相対値だけを backend_server 基準で解決する。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise ValueError("プロジェクトパスは文字列で指定してください")
    value = value.strip().replace("\\", "/")
    # Windows絶対パスはPOSIX上で検証しても相対パス化しない。
    if not os.path.isabs(value) and not ntpath.splitdrive(value)[0]:
        value = os.path.abspath(os.path.join(_BACKEND_DIR, value))
    return normalize_project_path(value)


def セッション履歴パス(接続):
    settings = getattr(接続, "モデル設定", None)
    return 履歴パス解決(settings.get("CODE_BASE_PATH")) if isinstance(settings, dict) else None


def 要求履歴パス確定(接続, 受信データ):
    """クライアントの古いプロジェクト表示を検出し、受付時の実際のルートを返す。"""
    current = セッション履歴パス(接続)
    supplied = 履歴パス解決(受信データ.get("プロジェクトパス"))
    if supplied is not None and supplied != current:
        raise ValueError("プロジェクトが変更されています。画面を更新してから再送してください。")
    return current


def 現在履歴パス(セッションID):
    context = _履歴コンテキスト.get()
    return context[1] if context is not None and context[0] == セッションID else None


def 内部要求履歴パス(接続):
    """既存要求からのツール呼出しは、その要求のプロジェクトを引き継ぐ。"""
    context = _履歴コンテキスト.get()
    session_id = getattr(接続, "セッションID", None)
    if context is not None and context[0] == session_id:
        return context[1]
    return セッション履歴パス(接続)


def 履歴要求コピー(接続, 受信データ):
    data = dict(受信データ)
    if "プロジェクトパス" not in data:
        data["プロジェクトパス"] = 内部要求履歴パス(接続)
    else:
        data["プロジェクトパス"] = normalize_project_path(data["プロジェクトパス"])
    return data


@contextmanager
def 履歴要求コンテキスト(セッションID, プロジェクトパス):
    token = _履歴コンテキスト.set((セッションID, normalize_project_path(プロジェクトパス)))
    try:
        yield
    finally:
        _履歴コンテキスト.reset(token)


def 履歴要求処理中(接続):
    processors = [getattr(接続, "chat_processor", None)]
    processors.extend(getattr(接続, "code_agent_processors", None) or [])
    for processor in processors:
        if getattr(processor, "履歴処理中", False):
            return True
        # Python 識別子の全角Ｑは属性名では半角Qへ正規化される。
        for name in ("チャット処理Q", "コード処理Q"):
            queue = getattr(processor, name, None)
            if queue is not None and not queue.empty():
                return True
    return False
