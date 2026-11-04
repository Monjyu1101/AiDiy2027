# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Coreの入力/生成画像を、展開量と縦横を制限した静止PNGへ変換する。"""
import base64
from io import BytesIO
import os
import stat

最大画像バイト数 = 32 * 1024 * 1024
最大画像画素数 = 16_777_216


def 画像プレビュー生成(source: bytes | str) -> str | None:
    try:
        from PIL import Image
        if isinstance(source, bytes):
            data = source
        elif isinstance(source, str):
            info = os.stat(source)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 最大画像バイト数:
                return None
            with open(source, "rb") as file:
                data = file.read(最大画像バイト数 + 1)
        else:
            return None
        if not data or len(data) > 最大画像バイト数:
            return None
        with Image.open(BytesIO(data)) as image:
            width, height = image.size
            # convert/load前に確認。細長い画像を幅固定で拡大しない。
            if width <= 0 or height <= 0 or width * height > 最大画像画素数:
                return None
            image.thumbnail((320, 320), Image.Resampling.LANCZOS)
            with image.convert("RGBA") as thumbnail:
                output = BytesIO()
                thumbnail.save(output, format="PNG")
                return base64.b64encode(output.getvalue()).decode("ascii")
    except Exception:
        # 非画像/破損画像でも元ファイルの保存・名前の表示は継続できる。
        return None
