# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AiDiy_key.json 読み取りユーティリティ（backend_local 用）

プロジェクトルートの _config/AiDiy_key.json を読み込み、backend_local の各種設定を
環境変数を一切使わずに JSON から取得する。

値の優先順位:
    1. AiDiy_key.json の該当キー（プレースホルダ "< ... >" は未設定扱い）
    2. 組み込みデフォルト

環境変数は使用しない（設定はすべて AiDiy_key.json に集約する）。
"""

import json
import os
from typing import Any, Optional

# backend_local ディレクトリ（local_proc の親）と共有設定の既定パス
_BACKEND_LOCAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG_DIR = "../_config"
_CONFIG_DIR = os.path.normpath(
    os.path.join(_BACKEND_LOCAL_DIR, DEFAULT_CONFIG_DIR)
)
_KEY_PATH = os.path.join(_CONFIG_DIR, "AiDiy_key.json")
# ローカル LLM のモデル一覧ファイル（--all の取得対象）
_CHAT_LOCAL_PATH = os.path.normpath(os.path.join(_BACKEND_LOCAL_DIR, "..", "_AIDIY", "aidiy_diag", "chat_models_info.json"))


def load_local_models(path: Optional[str] = None) -> list[str]:
    """chat合成JSONの local_chat.models からモデル ID 一覧を返す。

    無い/壊れている場合は空リストを返す。
    """
    target = path or _CHAT_LOCAL_PATH
    try:
        with open(target, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception:
        return []
    entry = data.get("local_chat") if isinstance(data, dict) else None
    models = entry.get("models") if isinstance(entry, dict) else None
    if isinstance(models, dict):
        return [str(k) for k in models.keys() if k]
    return []


def _is_placeholder(value: Any) -> bool:
    """`< your xxx >` 形式のプレースホルダ（未設定）かどうか。"""
    return (
        isinstance(value, str)
        and value.strip().startswith("<")
        and value.strip().endswith(">")
    )


class AiDiyConfig:
    """AiDiy_key.json を読み込み、設定値を返す軽量ローダー（環境変数は使わない）。"""

    def __init__(self, path: Optional[str] = None):
        self.path = path or _KEY_PATH
        self._data: dict = {}
        try:
            with open(self.path, "r", encoding="utf-8-sig") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                self._data = loaded
        except Exception:
            # 読めない場合は空 dict（= すべてデフォルトにフォールバック）
            self._data = {}

    @property
    def loaded(self) -> bool:
        return bool(self._data)

    def _json_value(self, key: Optional[str]) -> Any:
        if not key:
            return None
        val = self._data.get(key)
        if val is None or _is_placeholder(val):
            return None
        return val

    def get_str(self, json_key: Optional[str], default: Optional[str] = None) -> Optional[str]:
        val = self._json_value(json_key)
        if val is not None:
            return str(val)
        return default

    def get_int(self, json_key: Optional[str], default: int) -> int:
        raw = self.get_str(json_key, None)
        if raw is None:
            return default
        try:
            return int(str(raw).strip())
        except (TypeError, ValueError):
            return default

    def get_bool(self, json_key: Optional[str], default: bool = False) -> bool:
        raw = self.get_str(json_key, None)
        if raw is None:
            return default
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
