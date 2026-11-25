# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""この配置先から起動した Git パネルのみ停止する。"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aidiy_git_shared_start', ROOT.parent / 'viewer/_start.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def kill_ports():
    return shared.kill_ports(kind='git')
