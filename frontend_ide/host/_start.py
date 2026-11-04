# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_code / aidiy_live のコマンド起動と停止を全体起動へ提供する。"""
from pathlib import Path
import shutil
import subprocess
import sys

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent.parent / "scripts"))
from _runtime_requirements import check_project_node_runtime
sys.path.insert(0, str(THIS_DIR / 'scripts'))
from standalone_processes import standalone_tree_pids, stop_standalone


def launch_command(module: str) -> list[str]:
    ok, detail = check_project_node_runtime(THIS_DIR, dependency="electron", fallback=">=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        raise RuntimeError(detail)
    if module not in ('code', 'live'):
        raise ValueError(f'未対応のフロントエンドです: {module}')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js が必要です。')
    # aidiy_code / aidiy_live と同じ入口を絶対パスで呼び、作業フォルダは維持する。
    return [node, str(THIS_DIR / f'aidiy_{module}/launch.mjs')]


def check_environment(module: str) -> tuple[bool, str]:
    try:
        launch_command(module)
    except (OSError, RuntimeError) as error:
        return False, str(error)
    if not (THIS_DIR / f'dist/aidiy_{module}/server.cjs').is_file() or not (THIS_DIR.parent.parent / 'frontend_ide/dist/app.js').is_file():
        return False, f'画面が未準備です。python "{THIS_DIR / "_setup.py"}" を実行してください。'
    sys.path.insert(0, str(THIS_DIR.parent.parent / 'scripts'))
    from _setup_electron import electron_binary_ready
    if any(electron_binary_ready(folder) for folder in (THIS_DIR.parent / 'viewer', THIS_DIR)):
        return True, f'aidiy_{module} / Electron'
    return True, f'aidiy_{module} / Web へ切替（専用ウィンドウの復旧: python "{THIS_DIR.parent / "_setup.py"}"）'


def _start(module: str, args: list[str]) -> subprocess.Popen[bytes]:
    kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {'start_new_session': True}
    return subprocess.Popen(launch_command(module) + args, cwd=THIS_DIR.parent.parent,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0, **kwargs)


def start_code() -> subprocess.Popen[bytes]:
    # --wait を付けず、画面とログをランチャーから独立させる。
    return _start('code', [])


def start_live(auto_connect: bool = False) -> subprocess.Popen[bytes]:
    return _start('live', ['--foreground'] + (['--connect'] if auto_connect else []))


def process_tree_pids(module: str) -> set[int]:
    """全体起動の停止から保護するため、単独実行とその子孫の PID を返す。"""
    return standalone_tree_pids(THIS_DIR, module)


def kill_ports(module: str | None = None) -> None:
    if not stop_standalone(THIS_DIR, print, print, module=module):
        raise RuntimeError('Code / Live の単独実行を終了できないため処理を中止します。')
