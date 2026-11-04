# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AIチャット・AIコードの最終応答に共通するエラー表現。"""


def 応答正規化(応答) -> str:
    """無応答を ! に揃える。途中のストリーム断片には適用しない。"""
    本文 = str(応答).strip() if 応答 is not None else ""
    return "!" if 本文 in ("", "（応答なし）", "(応答なし)") else 本文


def エラー応答(説明=None) -> str:
    本文 = 応答正規化(説明)
    return 本文 if 本文.startswith("!") else f"! {本文}"


def エラー応答判定(応答) -> bool:
    return 応答正規化(応答).startswith("!")
