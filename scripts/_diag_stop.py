# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Diag の強制停止用。固定カタログの1機能だけを既存の停止処理で止める。"""
import json
import os
import sys
import time
from uuid import uuid4

from _diag_start import ROOT, RUNTIME, TARGETS, hidden_commands, load_module, stop_previous


def cancel_previous(kind):
    """別の Diag が所有する同機能の監視にも、既存の実行IDで停止を通知する。"""
    RUNTIME.mkdir(parents=True, exist_ok=True)
    temporary = RUNTIME / (kind + '.' + uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps({'run': uuid4().hex}), encoding='utf-8')
        os.replace(temporary, RUNTIME / (kind + '.json'))
    finally:
        temporary.unlink(missing_ok=True)


def stop_target(kind):
    target = next((item for item in TARGETS if item['id'] == kind), None)
    if target is None:
        raise ValueError('停止対象が不正です。')
    module = load_module('aidiy_diag_stop_' + kind, ROOT / target['フォルダ'] / '_start.py')
    cleanup = load_module('aidiy_diag_stop_control', ROOT / '_cleanup.py')
    with cleanup.cleanup_stop_request({}, services=[target['監視名']]), hidden_commands(module):
        cancel_previous(kind)
        # 通常起動の監視が停止通知を受け取るまで待ち、自動復活を防ぐ。
        time.sleep(1.3)
        stop_previous(module, target)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('停止対象を1つ指定してください。')
    stop_target(sys.argv[1])
