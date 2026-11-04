# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Taskを停止し、この配置先のランチャーを解除する。共有依存は残す。"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def cleanup(choices=None, *, report=True):
    if choices is not None and choices.get('ide') is False:
        return True
    try:
        load('aidiy_task_cleanup_start', ROOT / '_start.py').kill_ports()
        return load('aidiy_task_cleanup_launcher', ROOT.parent / 'viewer/launcher.py').remove_launcher(ROOT, 'task')
    except Exception as error:
        print(f'[NG] Taskの解除に失敗しました: {error}')
        return False
