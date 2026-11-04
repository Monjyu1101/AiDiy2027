# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""業務伝票の開始・終了日時を保存前に検証する。"""
from datetime import datetime


def 日時範囲検証(開始: str, 終了: str) -> None:
    try:
        start = datetime.fromisoformat(開始)
        end = datetime.fromisoformat(終了)
        reversed_range = end < start
    except (TypeError, ValueError) as exc:
        raise ValueError("開始日時・終了日時を正しい日時で入力してください。") from exc
    if reversed_range:
        raise ValueError("終了日時は開始日時以降にしてください。")
