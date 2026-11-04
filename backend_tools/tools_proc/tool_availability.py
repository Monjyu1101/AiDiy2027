# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""接続先の登録を維持したまま、起動チェックの利用可否を伝える。"""


def availability_status(label: str, checks: dict) -> dict:
    available = [name for name, info in checks.items() if info.get("ok")]
    unavailable = [name for name, info in checks.items() if not info.get("ok")]
    if available:
        message = f"{label} 利用可能: {', '.join(available)}"
        if unavailable:
            message += f"。現在利用不可: {', '.join(unavailable)}"
    else:
        message = f"現在利用不可：{label} の起動チェックに成功した実行機能がありません。設定・依存ツール・認証を確認して再起動してください。"
    return {"status": "OK" if available else "NG", "available": bool(available), "message": message}
