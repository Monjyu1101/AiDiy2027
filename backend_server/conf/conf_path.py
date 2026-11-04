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

import os
from typing import Dict, Optional


# backend_server/ を基準にした共有フォルダの既定値。
# 実体はプロジェクトルート直下へ集約し、各機能はこの相対値から絶対パスを解決する。
DEFAULT_CONFIG_DIR = '../_config'
DEFAULT_DATA_DIR = '../_data'
DEFAULT_DATABASE_PATH = '../_data/AiDiy/database.db'
DEFAULT_ICONS_DIR = '../_icons'


class conf_path:
    """パス管理クラス"""

    def __init__(self):
        """パス管理クラスの初期化(/形式)"""
        self.conf = None

        # 実行中の絶対パス（初期値は相対パス）
        self.exec_abs_path = './'

        # 実行中のルートパス(1階層上、初期値は相対パス)
        self.exec_abs_root = '../'

        # 外部パス一覧のルート(2階層上、初期値は相対パス)
        self.external_root_path = '../../'

        # プロジェクト共有フォルダ（backend_server/ 基準、初期値は相対パス）
        self.config_path = DEFAULT_CONFIG_DIR
        self.data_path = DEFAULT_DATA_DIR
        self.database_path = DEFAULT_DATABASE_PATH
        self.icons_path = DEFAULT_ICONS_DIR

        # 外部パス一覧 - _AIDIY.md を含むプロジェクト検出
        self.external_root_dic = {}

    def init(self) -> bool:
        """パス情報の初期化"""
        try:
            # 生成するパスはすべて / 形式・末尾スラッシュ付きで統一

            # 実行中の絶対パス（backend_server/ を基準にする）
            current_file_dir = os.path.dirname(os.path.abspath(__file__))  # backend_server/conf/
            backend_dir = os.path.dirname(current_file_dir)  # backend_server/
            self.exec_abs_path = self._normalize_path(backend_dir)

            # 実行中のルートパス(1階層上、プロジェクトルート)
            parent_path = os.path.abspath(os.path.join(backend_dir, '..'))
            if not os.path.exists(parent_path):
                self.exec_abs_root = '../'  # 初期値を保持
            else:
                self.exec_abs_root = self._normalize_path(parent_path)

            # 外部パス一覧のルート(2階層上)
            grandparent_path = os.path.abspath(os.path.join(backend_dir, '..', '..'))
            if not os.path.exists(grandparent_path):
                self.external_root_path = self.exec_abs_root  # フォールバック
            else:
                self.external_root_path = self._normalize_path(grandparent_path)

            # 共有フォルダは backend_server の1階層上（プロジェクトルート）に置く
            self.config_path = self._normalize_path(os.path.join(backend_dir, DEFAULT_CONFIG_DIR))
            self.data_path = self._normalize_path(os.path.join(backend_dir, DEFAULT_DATA_DIR))
            self.database_path = os.path.abspath(
                os.path.join(backend_dir, DEFAULT_DATABASE_PATH)
            ).replace('\\', '/')
            self.icons_path = self._normalize_path(os.path.join(backend_dir, DEFAULT_ICONS_DIR))

            # 外部パス一覧の構築
            self.external_root_dic = self._discover_agents_projects(self.external_root_path)

            logger.info('パス情報の初期化が完了しました')
            return True

        except Exception as e:
            logger.error(f'パス初期化エラー: {e}')
            return False

    def _normalize_path(self, path: str, base: Optional[str] = None) -> str:
        """パスを / 形式・末尾スラッシュ付きで正規化する"""
        if not os.path.isabs(path):
            if base and os.path.isabs(base):
                base_dir = base
            else:
                base_dir = os.getcwd()
            path = os.path.join(base_dir, path)

        normalized = os.path.abspath(path).replace('\\', '/')
        if not normalized.endswith('/'):
            normalized += '/'
        return normalized

    def _discover_agents_projects(self, search_root: Optional[str] = None) -> Dict[str, str]:
        """指定ルート直下、およびその1階層下で「_AIDIY.md」を含むフォルダを列挙"""
        result: Dict[str, str] = {}
        try:
            if search_root and not os.path.isabs(search_root):
                search_root = os.path.abspath(search_root)

            base = search_root or self.external_root_path
            if not base or not os.path.isabs(base):
                base = os.getcwd()

            root_dir = self._normalize_path(base).rstrip('/')

            if not os.path.exists(root_dir) or not os.path.isdir(root_dir):
                return result

            def try_add(path: str) -> None:
                agents_file = os.path.join(path, '_AIDIY.md')
                if os.path.isfile(agents_file):
                    key = os.path.basename(path)
                    if key not in result:
                        result[key] = self._normalize_path(path)

            for entry in os.scandir(root_dir):
                if not entry.is_dir():
                    continue
                try_add(entry.path)
                try:
                    for sub_entry in os.scandir(entry.path):
                        if sub_entry.is_dir():
                            try_add(sub_entry.path)
                except (PermissionError, OSError):
                    continue
        except Exception as e:
            logger.warning(f'外部パス探索エラー: {e}')
        return result


__all__ = [
    "DEFAULT_CONFIG_DIR",
    "DEFAULT_DATA_DIR",
    "DEFAULT_DATABASE_PATH",
    "DEFAULT_ICONS_DIR",
    "conf_path",
]
