# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AIコアのAI判断への薄い接続。判断ロジックはbackend_serverに集約する。"""
from pathlib import Path
import sys

_backend = str(Path(__file__).resolve().parents[2] / "backend_server")
if _backend not in sys.path:
    sys.path.append(_backend)

from AIコア.AI判断 import Decision  # noqa: E402, F401
from AIコア.AI判断共通 import DecisionError, DecisionRequest  # noqa: E402, F401
