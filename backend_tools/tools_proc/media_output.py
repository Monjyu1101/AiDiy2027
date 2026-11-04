# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""メディア返却（base64 / ファイル）の共通ルール。

スクリーンショット、デスクトップキャプチャ、画像生成、音声合成は、
どれも「ファイルへ保存する」と「base64 で中身を返す」の両方ができる。
両方を同時に行うと、呼び出し側が読めるファイルがあるのに同じ中身が
base64 でも返り、AI のコンテキストを二重に圧迫する。

そこで返し方を 1 つに決める。判定はこのモジュールに集約し、
各 MCP レイヤーはここを呼ぶだけにする。
"""

from typing import Optional


def base64を返すか(save_path: Optional[str]) -> bool:
    """base64 を返すべきかを返す。

    - save_path を明示された: False。呼び出し側は保存先を知っていて
      ファイルを読めばよいので、base64 は返さない。
    - save_path の指定なし: True。既定フォルダへ自動保存はするが
      呼び出し側はその場所を前提にできないため、base64 で返す。
    """
    return not (save_path and str(save_path).strip())


def ファイル応答(save_path: str, mime_type: str) -> dict:
    """base64 を省いたときの HTTP 応答。保存先だけを返す。"""
    return {
        "type": "file",
        "save_path": save_path,
        "mimeType": mime_type,
        "note": "save_path 指定のため base64 は返していません。ファイルを読んでください。",
    }
