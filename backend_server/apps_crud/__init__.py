# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from apps_crud.utils import get_current_datetime, create_audit_fields, update_audit_fields
from apps_crud.M配車区分 import get_M配車区分, get_M配車区分一覧, create_M配車区分
from apps_crud.M生産区分 import get_M生産区分, get_M生産区分一覧, create_M生産区分
from apps_crud.M生産工程 import get_M生産工程, get_M生産工程一覧, create_M生産工程
from apps_crud.M商品分類 import get_M商品分類, get_M商品分類一覧, create_M商品分類
from apps_crud.M取引先分類 import get_M取引先分類, get_M取引先分類一覧, create_M取引先分類
from apps_crud.M取引先 import get_M取引先, get_M取引先一覧, create_M取引先
from apps_crud.M車両 import get_M車両, get_M車両一覧, create_M車両
from apps_crud.M商品 import get_M商品, get_M商品一覧, create_M商品
from apps_crud.M商品構成 import (
    get_M商品構成, get_M商品構成一覧, get_M商品構成明細一覧,
    build_M商品構成_data, create_M商品構成, update_M商品構成, delete_M商品構成,
)
from apps_crud.T配車 import get_T配車, get_T配車一覧, create_T配車, update_T配車, delete_T配車, init_T配車_data
from apps_crud.T生産 import (
    get_T生産, get_T生産ヘッダ, get_T生産一覧, get_T生産明細一覧,
    build_T生産_data, create_T生産, update_T生産, delete_T生産, init_T生産_data,
)
from apps_crud.T商品出庫 import (
    get_T商品出庫, get_T商品出庫ヘッダ, get_T商品出庫一覧, get_T商品出庫明細一覧,
    build_T商品出庫_data, create_T商品出庫, update_T商品出庫, delete_T商品出庫, init_T商品出庫_data,
)
from apps_crud.T商品棚卸 import (
    get_T商品棚卸, get_T商品棚卸ヘッダ, get_T商品棚卸一覧, get_T商品棚卸明細一覧,
    build_T商品棚卸_data, create_T商品棚卸, update_T商品棚卸, delete_T商品棚卸, init_T商品棚卸_data,
)
from apps_crud.T商品入庫 import (
    get_T商品入庫, get_T商品入庫ヘッダ, get_T商品入庫一覧, get_T商品入庫明細一覧,
    build_T商品入庫_data, create_T商品入庫, update_T商品入庫, delete_T商品入庫, init_T商品入庫_data,
)
from apps_crud.init import init_db_data

__all__ = [
    # utils
    'get_current_datetime',
    'create_audit_fields',
    'update_audit_fields',
    # M配車区分
    'get_M配車区分',
    'get_M配車区分一覧',
    'create_M配車区分',
    # M生産区分
    'get_M生産区分',
    'get_M生産区分一覧',
    'create_M生産区分',
    # M生産工程
    'get_M生産工程',
    'get_M生産工程一覧',
    'create_M生産工程',
    # M商品分類
    'get_M商品分類',
    'get_M商品分類一覧',
    'create_M商品分類',
    # M取引先分類
    'get_M取引先分類',
    'get_M取引先分類一覧',
    'create_M取引先分類',
    # M取引先
    'get_M取引先',
    'get_M取引先一覧',
    'create_M取引先',
    # M車両
    'get_M車両',
    'get_M車両一覧',
    'create_M車両',
    # M商品
    'get_M商品',
    'get_M商品一覧',
    'create_M商品',
    # M商品構成
    'get_M商品構成',
    'get_M商品構成一覧',
    'get_M商品構成明細一覧',
    'build_M商品構成_data',
    'create_M商品構成',
    'update_M商品構成',
    'delete_M商品構成',
    # T配車
    'get_T配車',
    'get_T配車一覧',
    'create_T配車',
    'update_T配車',
    'delete_T配車',
    'init_T配車_data',
    # T生産
    'get_T生産',
    'get_T生産ヘッダ',
    'get_T生産一覧',
    'get_T生産明細一覧',
    'build_T生産_data',
    'create_T生産',
    'update_T生産',
    'delete_T生産',
    'init_T生産_data',
    # T商品出庫
    'get_T商品出庫',
    'get_T商品出庫ヘッダ',
    'get_T商品出庫一覧',
    'get_T商品出庫明細一覧',
    'build_T商品出庫_data',
    'create_T商品出庫',
    'update_T商品出庫',
    'delete_T商品出庫',
    'init_T商品出庫_data',
    # T商品棚卸
    'get_T商品棚卸',
    'get_T商品棚卸ヘッダ',
    'get_T商品棚卸一覧',
    'get_T商品棚卸明細一覧',
    'build_T商品棚卸_data',
    'create_T商品棚卸',
    'update_T商品棚卸',
    'delete_T商品棚卸',
    'init_T商品棚卸_data',
    # T商品入庫
    'get_T商品入庫',
    'get_T商品入庫ヘッダ',
    'get_T商品入庫一覧',
    'get_T商品入庫明細一覧',
    'build_T商品入庫_data',
    'create_T商品入庫',
    'update_T商品入庫',
    'delete_T商品入庫',
    'init_T商品入庫_data',
    # init
    'init_db_data',
]
