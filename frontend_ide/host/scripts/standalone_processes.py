# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""この作業コピーの Code / Live 単独実行だけを削除前に強制終了する。"""

import ntpath
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from _cleanup_processes import list_processes, process_arguments, stop_matching


def is_standalone(process: dict, root: Path, windows: bool, module: str | None = None) -> bool:
    """プロファイルまたは実行入口の完全一致で判定する（パス部分一致は使わない）。"""
    command = process.get('CommandLine') or ''
    name = (process.get('Name') or '').lower()
    try:
        args = process_arguments(command, windows)
    except ValueError:
        return False
    normalize = (lambda value: ntpath.normcase(ntpath.normpath(value))) if windows else os.path.normpath
    root_text = str(root)
    join = ntpath.join if windows else os.path.join
    modules = (f'aidiy_{module}',) if module in ('code', 'live') else ('aidiy_code', 'aidiy_live')
    if name in ('chrome.exe', 'msedge.exe', 'chrome', 'chromium', 'chromium-browser', 'msedge'):
        profiles = {normalize(join(root_text, 'out', module, 'browser-profile'))
                    for module in modules}
        return any(normalize(arg.split('=', 1)[1]) in profiles
                   for arg in args if arg.startswith('--user-data-dir='))
    if name not in ('node.exe', 'node', 'electron.exe', 'electron'):
        return False
    if module is None and name in ('electron.exe', 'electron') and args:
        executable = join(root_text, 'node_modules', 'electron', 'dist',
                          'electron.exe' if windows else 'electron')
        if normalize(args[0]) == normalize(executable):
            return True
    entries = {normalize(join(root_text, module, filename))
               for module in modules
               for filename in ('launch.mjs', 'desktop.cjs')}
    entries.update(normalize(join(root_text, 'dist', module, 'server.cjs'))
                   for module in modules)
    development = join(root_text, '..')
    entries.update(normalize(join(development, module, 'launch.mjs')) for module in modules)
    # 共通入口を直接呼んだ場合も、種類を明示して照合する。
    if len(args) > 1 and normalize(args[1]) in {normalize(join(development, file)) for file in ('launch.mjs', 'desktop.cjs')}:
        selected = args[args.index('--app') + 1] if '--app' in args and args.index('--app') + 1 < len(args) else 'ide'
        return 'aidiy_' + selected in modules
    # 実行入口は最初の非オプション引数。別スクリプトの引数に同じパスがあっても対象外。
    entry = next((arg for arg in args[1:] if not arg.startswith('-')), '')
    return normalize(entry) in entries


def standalone_tree_pids(root: Path, module: str | None = None) -> set[int]:
    """単独実行プロセスと、その子孫（hermes や tools の MCP 接続など）の PID を返す。"""
    windows = sys.platform == 'win32'
    processes = list_processes()
    pids = {p['ProcessId'] for p in processes if is_standalone(p, root, windows, module)}
    while True:
        children = {p['ProcessId'] for p in processes if p.get('ParentProcessId') in pids} - pids
        if not children:
            return pids
        pids |= children


def stop_standalone(root: Path, info, error, module: str | None = None) -> bool:
    return stop_matching(lambda p: is_standalone(p, root, sys.platform == 'win32', module),
                         info, error, f'{module.title() if module else "Code / Live"} の単独実行')
