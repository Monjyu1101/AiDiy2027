# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

# ■ バックエンド ベストプラクティス

# 1. 監査フィールドは必ずヘルパー関数を使用
from core_crud.utils import create_audit_fields, update_audit_fields

# 正解
認証情報 = {"利用者ID": 現在利用者.利用者ID, "利用者名": 現在利用者.利用者名}
監査項目 = create_audit_fields(認証情報)
db.add(Model(..., **監査項目))

# 誤り（手動で日時設定）
db.add(Model(..., 登録日時=datetime.now()))

# 2. エラーハンドリング
@router.post("/登録")
def create_item(...):
 try:
 db_item = crud.create_item(db, item, 認証情報)
 db.commit()
 return ResponseBase(status="OK", message="成功", data={...})
 except Exception as e:
 db.rollback()
 logger.error(f"エラー: {e}")
 return ResponseBase(status="NG", message="エラー発生")

# 3. 統一レスポンス形式
# 正解
return schemas.ResponseBase(
 status="OK",
 message="取得しました",
 data={"items": items, "total": len(items), "limit": 10000}
)

# 誤り（独自フォーマット）
return {"success": True, "data": items}

# 4. ログ出力
from log_config import get_logger
logger = get_logger(__name__)

logger.info("情報メッセージ")
logger.error("エラーメッセージ")
