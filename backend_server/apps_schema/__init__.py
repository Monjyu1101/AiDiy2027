# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from apps_schema.common import ResponseBase, ErrorResponse, ListRequest
from apps_schema.M配車区分 import (
    M配車区分Base, M配車区分Create, M配車区分Update, M配車区分Delete, M配車区分Get, M配車区分,
)
from apps_schema.M生産区分 import (
    M生産区分Base, M生産区分Create, M生産区分Update, M生産区分Delete, M生産区分Get, M生産区分,
)
from apps_schema.M生産工程 import M生産工程Base, M生産工程Create, M生産工程Update, M生産工程Delete, M生産工程Get, M生産工程
from apps_schema.M商品分類 import (
    M商品分類Base, M商品分類Create, M商品分類Update, M商品分類Delete, M商品分類Get, M商品分類,
)
from apps_schema.M取引先分類 import (
    M取引先分類Base, M取引先分類Create, M取引先分類Update, M取引先分類Delete, M取引先分類Get, M取引先分類,
)
from apps_schema.M取引先 import M取引先Base, M取引先Create, M取引先Update, M取引先Delete, M取引先Get, M取引先
from apps_schema.M車両 import M車両Base, M車両Create, M車両Update, M車両Delete, M車両Get, M車両
from apps_schema.M商品 import M商品Base, M商品Create, M商品Update, M商品Delete, M商品Get, M商品
from apps_schema.M商品構成 import (
    M商品構成明細Base, M商品構成明細,
    M商品構成Base, M商品構成Create, M商品構成Update, M商品構成Delete, M商品構成Get, M商品構成,
)
from apps_schema.T配車 import T配車Base, T配車Create, T配車Update, T配車Delete, T配車Get, T配車
from apps_schema.T生産 import (
    T生産明細Base, T生産明細,
    T生産Base, T生産Create, T生産Update, T生産Delete, T生産Get, T生産,
    V生産ListRequest, T生産払出ListRequest,
)
from apps_schema.T商品出庫 import (
    T商品出庫明細Base, T商品出庫明細,
    T商品出庫Base, T商品出庫Create, T商品出庫Update, T商品出庫Delete, T商品出庫Get, T商品出庫,
)
from apps_schema.T商品棚卸 import (
    T商品棚卸明細Base, T商品棚卸明細,
    T商品棚卸Base, T商品棚卸Create, T商品棚卸Update, T商品棚卸Delete, T商品棚卸Get, T商品棚卸,
)
from apps_schema.T商品入庫 import (
    T商品入庫明細Base, T商品入庫明細,
    T商品入庫Base, T商品入庫Create, T商品入庫Update, T商品入庫Delete, T商品入庫Get, T商品入庫,
)

__all__ = [
    'ResponseBase', 'ErrorResponse', 'ListRequest',
    'M配車区分Base', 'M配車区分Create', 'M配車区分Update', 'M配車区分Delete', 'M配車区分Get', 'M配車区分',
    'M生産区分Base', 'M生産区分Create', 'M生産区分Update', 'M生産区分Delete', 'M生産区分Get', 'M生産区分',
    'M生産工程Base', 'M生産工程Create', 'M生産工程Update', 'M生産工程Delete', 'M生産工程Get', 'M生産工程',
    'M商品分類Base', 'M商品分類Create', 'M商品分類Update', 'M商品分類Delete', 'M商品分類Get', 'M商品分類',
    'M取引先分類Base', 'M取引先分類Create', 'M取引先分類Update', 'M取引先分類Delete', 'M取引先分類Get', 'M取引先分類',
    'M取引先Base', 'M取引先Create', 'M取引先Update', 'M取引先Delete', 'M取引先Get', 'M取引先',
    'M車両Base', 'M車両Create', 'M車両Update', 'M車両Delete', 'M車両Get', 'M車両',
    'M商品Base', 'M商品Create', 'M商品Update', 'M商品Delete', 'M商品Get', 'M商品',
    'M商品構成明細Base', 'M商品構成明細',
    'M商品構成Base', 'M商品構成Create', 'M商品構成Update', 'M商品構成Delete', 'M商品構成Get', 'M商品構成',
    'T配車Base', 'T配車Create', 'T配車Update', 'T配車Delete', 'T配車Get', 'T配車',
    'T生産明細Base', 'T生産明細',
    'T生産Base', 'T生産Create', 'T生産Update', 'T生産Delete', 'T生産Get', 'T生産',
    'V生産ListRequest', 'T生産払出ListRequest',
    'T商品出庫明細Base', 'T商品出庫明細',
    'T商品出庫Base', 'T商品出庫Create', 'T商品出庫Update', 'T商品出庫Delete', 'T商品出庫Get', 'T商品出庫',
    'T商品棚卸明細Base', 'T商品棚卸明細',
    'T商品棚卸Base', 'T商品棚卸Create', 'T商品棚卸Update', 'T商品棚卸Delete', 'T商品棚卸Get', 'T商品棚卸',
    'T商品入庫明細Base', 'T商品入庫明細',
    'T商品入庫Base', 'T商品入庫Create', 'T商品入庫Update', 'T商品入庫Delete', 'T商品入庫Get', 'T商品入庫',
]
