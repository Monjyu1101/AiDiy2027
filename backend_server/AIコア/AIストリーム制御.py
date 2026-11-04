# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027


"""AI ストリームの境界通知に使う ASCII 制御コード。"""

# 制御コード自体は表示用テキストではない。
# 制御コード1バイトだけをプロトコル値とし、改行は含めない。
# 将来廃止する場合はこの定義と送信呼び出しを外す。
AIストリーム開始 = "\x02"  # STX
AIストリーム終了 = "\x03"  # ETX
AIストリーム中断 = "\x18"  # CAN
