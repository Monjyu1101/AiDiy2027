# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Consoleの独立起動・環境確認・この配置先だけの停止。"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aidiy_console_shared_start', ROOT.parent / 'viewer/_start.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)

def check_environment():
    ok, detail = shared.check_node_environment()
    if not ok:
        return False, detail
    for name in ('node-pty', 'ws', '@xterm/xterm', '@xterm/addon-fit'):
        if not (ROOT.parent / 'node_modules' / name).is_dir():
            return False, f'python "{ROOT.parent / "_setup.py"}" を実行してください。'
    return ((True, 'PTY / Vue ターミナル') if (ROOT.parent / 'dist/app.js').is_file()
            else (False, f'Vue画面が未準備です。python "{ROOT.parent / "_setup.py"}" を実行してください。'))

def start(open_window=None):
    return shared.start(open_window, kind='console')

def kill_ports():
    return shared.kill_ports(kind='console')

def process_tree_pids():
    return shared.process_tree_pids(kind='console')
