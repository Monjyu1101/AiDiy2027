# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from core_schema.common import ResponseBase, ErrorResponse, LoginRequest, Token, ListRequest
from core_schema.A会話履歴 import (
    A会話履歴Base, A会話履歴Create, A会話履歴Update, A会話履歴Delete,
    A会話履歴Get, A会話履歴ListRequest, A会話履歴Response,
)
from core_schema.C権限 import C権限Base, C権限Create, C権限Update, C権限Delete, C権限
from core_schema.C利用者 import (
    C利用者Base, C利用者Create, C利用者Update, C利用者Delete, C利用者Get, C利用者,
)
from core_schema.C採番 import C採番Base, C採番Create, C採番Update, C採番Delete, C採番Get, C採番

__all__ = [
    'ResponseBase', 'ErrorResponse', 'LoginRequest', 'Token', 'ListRequest',
    'A会話履歴Base', 'A会話履歴Create', 'A会話履歴Update', 'A会話履歴Delete',
    'A会話履歴Get', 'A会話履歴ListRequest', 'A会話履歴Response',
    'C権限Base', 'C権限Create', 'C権限Update', 'C権限Delete', 'C権限',
    'C利用者Base', 'C利用者Create', 'C利用者Update', 'C利用者Delete', 'C利用者Get', 'C利用者',
    'C採番Base', 'C採番Create', 'C採番Update', 'C採番Delete', 'C採番Get', 'C採番',
]
