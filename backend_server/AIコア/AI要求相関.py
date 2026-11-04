# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""任意のNavigator要求ID。権限や処理ルートの判断には使用しない。"""


def ナビ要求相関(受信データ: dict) -> dict:
    request_id = 受信データ.get("navigationRequestId")
    # 不正な型や無制限の入力を応答へ反射しない。通常要求の形は変更しない。
    if isinstance(request_id, str) and 0 < len(request_id) <= 128 and request_id.strip():
        return {"navigationRequestId": request_id}
    return {}
