# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""CPUの独立起動・環境確認・この配置先だけの停止。"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aidiy_cpu_shared_start', ROOT.parent / 'viewer/_start.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

def check_environment():
    ok, detail = shared.check_node_environment()
    if not ok:
        return False, detail
    return ((True, 'Vue CPU') if (ROOT.parent / 'dist/app.js').is_file()
            else (False, f'Vue画面が未準備です。python "{ROOT.parent / "_setup.py"}" を実行してください。'))

def start(open_window=None):
    return shared.start(open_window, kind='cpu')

def kill_ports():
    return shared.kill_ports(kind='cpu')

def process_tree_pids():
    return shared.process_tree_pids(kind='cpu')
