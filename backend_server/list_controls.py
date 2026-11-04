# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from typing import Optional

LIMITED_MAX_ITEMS = 1000


def _to_bool(value: Optional[bool], default: bool) -> bool:
    if value is None:
        return default
    return bool(value)


def is_limit_enabled(request) -> bool:
    return _to_bool(getattr(request, "件数制限", None), True)


def should_show_inactive(request) -> bool:
    return _to_bool(getattr(request, "無効も表示", None), False)


def get_list_limit(request) -> Optional[int]:
    if is_limit_enabled(request):
        return LIMITED_MAX_ITEMS
    return None


def get_limit_clause(request) -> tuple[str, Optional[int]]:
    limit_value = get_list_limit(request)
    if limit_value is None:
        return "", None
    return "LIMIT :limit", limit_value


def append_active_condition(conditions: list[str], request, column_name: str) -> None:
    if not should_show_inactive(request):
        conditions.append(f"{column_name} = 1")


def apply_active_filter(query, model, request):
    if should_show_inactive(request):
        return query
    return query.filter(model.有効 == True)
