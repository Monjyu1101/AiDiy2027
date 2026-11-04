# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Browserの独立起動・環境確認・この配置先だけの停止。"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aidiy_browser_shared_start', ROOT.parent / 'viewer/_start.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

def check_environment():
    ok, detail = shared.check_node_environment()
    if not ok:
        return False, detail
    from _setup_electron import electron_binary_ready
    if not any(electron_binary_ready(ROOT.parent / folder) for folder in ('viewer', 'host')):
        return False, f'Browser は Electron 専用です。python "{ROOT.parent / "_setup.py"}" を実行してください。'
    return ((True, 'Vue Browser') if (ROOT.parent / 'dist/app.js').is_file()
            else (False, f'Vue画面が未準備です。python "{ROOT.parent / "_setup.py"}" を実行してください。'))

def start(open_window=None):
    if open_window is False:
        raise ValueError('BrowserはElectron専用のため、画面なしでは起動できません。')
    return shared.start(open_window, kind='browser')

def kill_ports():
    return shared.kill_ports(kind='browser')

def process_tree_pids():
    return shared.process_tree_pids(kind='browser')
