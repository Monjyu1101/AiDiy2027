# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from datetime import timedelta
from typing import Optional
from auth_keyring import CoreKeyring

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 600
_keyring = None


def get_keyring():
    """import だけではファイルを生成しない。Core startup が初期化する。"""
    global _keyring
    if _keyring is None:
        _keyring = CoreKeyring()
    return _keyring


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    return get_keyring().issue_normal(data, expires_delta)


def verify_access_token(token: str):
    # Apps はこの読取専用検証を使い、Core の鍵を生成・更新しない。
    return get_keyring().verify_normal(token)
