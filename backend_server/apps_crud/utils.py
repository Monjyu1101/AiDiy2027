# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from datetime import datetime
from typing import Optional, Dict

# NOTE: core_crud と apps_crud で同内容の utils.py を保持しています（監査項目の共通化用）。
# 通常は変更しません。変更が必要な場合は両方に同内容を反映してください。

def get_current_datetime() -> str:
    """現在日時を文字列形式で返す"""
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def create_audit_fields(認証情報: Optional[Dict] = None, is_update: bool = False) -> Dict:
    """登録/更新項目を作成"""
    now = get_current_datetime()
    利用者ID = 認証情報.get('利用者ID', 'system') if 認証情報 else 'system'
    利用者名 = 認証情報.get('利用者名', 'system') if 認証情報 else 'system'
    端末ID = 認証情報.get('端末ID', 'localhost') if 認証情報 else 'localhost'

    if is_update:
        # 更新時は更新項目のみ
        return {
            '更新日時': now,
            '更新利用者ID': 利用者ID,
            '更新利用者名': 利用者名,
            '更新端末ID': 端末ID
        }
    else:
        # 登録時は登録・更新項目両方
        return {
            '登録日時': now,
            '登録利用者ID': 利用者ID,
            '登録利用者名': 利用者名,
            '登録端末ID': 端末ID,
            '更新日時': now,
            '更新利用者ID': 利用者ID,
            '更新利用者名': 利用者名,
            '更新端末ID': 端末ID
        }

def update_audit_fields(認証情報: Optional[Dict] = None) -> Dict:
    """更新項目を作成"""
    return create_audit_fields(認証情報, is_update=True)
