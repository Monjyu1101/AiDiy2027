# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

# Service層は AiDiy2027 では未実装です
#
# このプロジェクトでは、Service層を省略し、
# RouterからCRUDを直接呼び出す構成になっています。
#
# Service層相当の処理（ビジネスロジック、権限チェック等）は
# Router層に直接記述しています。
#
# 【参考】Service層を導入する場合の実装例
# ============================================================

"""
from sqlalchemy.orm import Session
from core_models import C利用者
import apps_crud as crud
import apps_schema as schemas


class M商品Service:
    def __init__(self, db: Session, 現在利用者: C利用者):
        self.db = db
        self.現在利用者 = 現在利用者

    def 登録(self, 商品データ: schemas.M商品Create):
        # 権限チェック
        if self.現在利用者.権限ID not in ['1', '2']:
            raise HTTPException(403, "登録権限がありません")

        # ビジネスロジック
        existing = crud.get_M商品(self.db, 商品データ.商品ID)
        if existing:
            raise HTTPException(400, "商品IDが重複しています")

        # CRUD呼び出し
        認証情報 = {"利用者ID": self.現在利用者.利用者ID, "利用者名": self.現在利用者.利用者名}
        return crud.create_M商品(self.db, 商品データ, 認証情報=認証情報)
"""

# ============================================================
# 現在のプロジェクトでは、上記のようなService層は未実装です。
# Router層で直接ビジネスロジックを実装しています。
# 詳細は apps_router/M商品.py を参照してください。
# ============================================================
