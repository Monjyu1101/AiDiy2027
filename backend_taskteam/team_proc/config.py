# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from __future__ import annotations

import importlib.util
from functools import lru_cache
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_SERVER_DIR = PROJECT_ROOT / "backend_server"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
KEY_JSON_PATH = (BACKEND_SERVER_DIR / DEFAULT_CONFIG_PATH).resolve()
CONF_JSON_PATH = BACKEND_SERVER_DIR / "conf" / "conf_json.py"


def _conf_jsonクラス読込() -> type:
    """conf パッケージ全体を読み込まず、共通 conf_json 実装だけを利用する。"""
    spec = importlib.util.spec_from_file_location("_aidiy_team_conf_json", CONF_JSON_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"conf_json.py を読み込めません: {CONF_JSON_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.conf_json


@lru_cache(maxsize=1)
def 設定読込() -> Any:
    """共通 conf_json で AiDiy_key.json を読み、不足キーも共通規則で補完する。"""
    return _conf_jsonクラス読込()(json=str(KEY_JSON_PATH))


def AIモデル(接頭辞: str, フェーズ: str, 既定: str = "auto") -> str:
    """`TASK_AI_MODEL_<フェーズ>` / `TEAM_AI_MODEL_<フェーズ>` を返す。

    接頭辞は TASK / TEAM、フェーズは plan / do / check。
    """
    try:
        設定 = 設定読込()
    except Exception:
        return 既定
    return str(getattr(設定, f"{接頭辞}_AI_MODEL_{フェーズ}", "") or "").strip() or 既定

