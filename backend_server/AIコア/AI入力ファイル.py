# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""同名・同秒・別sessionの入力ファイルを上書きせず保存する。"""
from datetime import datetime
import os
import uuid


def 入力ファイル保存(directory: str, name: str | None, data: bytes) -> str:
    safe = os.path.basename(str(name or "file.bin").replace("\\", "/")) or "file.bin"
    safe = "".join("_" if ord(char) < 32 or ord(char) == 127 or char in '<>:"|?*' else char for char in safe).rstrip(". ") or "file.bin"
    # UUID/時刻を含めても一般的な255-byte filename上限へ収め、拡張子を維持する。
    stem, ext = os.path.splitext(safe)
    ext = ext.encode("utf-8")[:32].decode("utf-8", "ignore")
    stem = stem.encode("utf-8")[:180 - len(ext.encode("utf-8"))].decode("utf-8", "ignore")
    safe = (stem or "file") + ext
    os.makedirs(directory, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d.%H%M%S")
    for _ in range(8):
        filename = f"{stamp}.{uuid.uuid4().hex}.{safe}"
        try:
            # 名前の衝突を乱数だけに委ねず、既存ファイルを開かない。
            with open(os.path.join(directory, filename), "xb") as output:
                output.write(data)
            return filename
        except FileExistsError:
            continue
    raise FileExistsError("入力ファイルの保存名を確保できませんでした。")
