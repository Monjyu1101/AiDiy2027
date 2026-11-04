# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from log_config import get_logger
logger = get_logger(__name__)

from typing import Optional

from .conf_json import conf_json
from .conf_path import conf_path
from .conf_model import conf_models

class Conf:
    """設定クラス（型定義を明確化）"""

    def __init__(self):
        logger.debug("Conf インスタンスを初期化します")

        # 基本設定項目
        self.run_mode: str = 'debug'

        # JSON/モデル/パス設定（init実行時に初期化）
        self.json: Optional[conf_json] = None
        self.path: Optional[conf_path] = None
        self.models: Optional[conf_models] = None

    def __getattr__(self, key: str):
        """conf.xxxxx で json 設定へ簡単アクセス"""
        json_obj = object.__getattribute__(self, "json")
        if json_obj is not None and hasattr(json_obj, key):
            return getattr(json_obj, key)
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{key}'")

    def __setattr__(self, key: str, value):
        """conf.xxxxx で json 設定へ簡単保存"""
        if key in ("run_mode", "json", "path", "models") or key.startswith("_"):
            object.__setattr__(self, key, value)
            return
        json_obj = object.__getattribute__(self, "json")
        if json_obj is not None and hasattr(json_obj, key):
            setattr(json_obj, key, value)
        else:
            object.__setattr__(self, key, value)

    def init(
        self,
        runMode: str = 'debug',
        qLog_fn: str = '',
        conf_path_enabled: bool = True,
        conf_models_enabled: bool = True
    ) -> bool:
        """設定の初期化処理"""
        try:
            if self.json is None:
                self.json = conf_json()

            if conf_path_enabled:
                if self.path is None:
                    self.path = conf_path()
                if not self.path.init():
                    raise RuntimeError('パス初期化に失敗しました')
            else:
                self.path = None

            if conf_models_enabled:
                if self.models is None:
                    self.models = conf_models(self)
            else:
                self.models = None

            requested_mode = (runMode or 'debug').lower()
            if requested_mode not in ('debug', 'production', 'test'):
                raise ValueError(f'unknown mode: {runMode}')
            self.run_mode = requested_mode

            if self.models is not None:
                self.models.fetch_all_models()
            return True

        except Exception as e:
            logger.error(f'設定初期化エラー: {e}')
            return False


_conf_class = Conf
conf = Conf()

__all__ = [
    "Conf",
    "_conf_class",
    "conf",
]
