# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""この作業コピーの Slack パネル・Bot を実行入口で照合し、子孫ごと停止する。"""
import ntpath
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'scripts'))
from _cleanup_processes import list_processes, process_arguments, stop_matching


def is_slack_process(process: dict, root: Path, windows: bool) -> bool:
    if (process.get('Name') or '').lower() not in ('node', 'node.exe', 'electron', 'electron.exe'):
        return False
    try:
        args = process_arguments(process.get('CommandLine') or '', windows)
    except ValueError:
        return False
    path_module = ntpath if windows else os.path

    def normalize(value):
        if value.startswith('file:'):
            parsed = urlsplit(value)
            value = unquote(parsed.path)
            if windows and value.startswith('/') and len(value) > 2 and value[2] == ':':
                value = value[1:]
        return path_module.normcase(path_module.normpath(value))

    # Discord（frontend_channels/discord/src/main.ts）とは入口のパスで区別する。
    main = normalize(path_module.join(str(root), 'src', 'main.ts'))
    entries = {main, *(normalize(path_module.join(str(root), *parts)) for parts in (
        ('src', 'panel-worker.ts'), ('src', 'web-server.ts'), ('panel', 'desktop.cjs'), ('panel', 'launch.mjs'),
    ))}
    cli = normalize(path_module.join(str(root), 'node_modules', 'tsx', 'dist', 'cli.mjs'))
    loader = normalize(path_module.join(str(root), 'node_modules', 'tsx', 'dist', 'loader.mjs'))
    relative_main = normalize(path_module.join('src', 'main.ts'))
    own_loader = False
    index = 1
    while index < len(args):
        arg = args[index]
        if arg in ('--eval', '-e', '--print', '-p', '--test'):
            return False
        if arg in ('--import', '--require', '-r', '--loader', '--experimental-loader', '--conditions'):
            index += 1
            if index >= len(args):
                return False
            own_loader |= normalize(args[index]) == loader
        elif arg.startswith(('--import=', '--loader=')):
            own_loader |= normalize(arg.split('=', 1)[1]) == loader
        elif arg == '--':
            index += 1
            break
        elif not arg.startswith('-'):
            break
        index += 1
    if index >= len(args):
        return False
    entry = normalize(args[index])
    if entry in entries or own_loader and entry == relative_main:
        return True
    # Slack 専用 node_modules の tsx ランチャーも対象。別スクリプトを実行中なら停止しない。
    return entry == cli and index + 1 < len(args) and normalize(args[index + 1]) in (main, relative_main)


def slack_tree_pids(root: Path) -> set[int]:
    """継続する Slack パネル・Bot と、その配下の Hermes / MCP の PID を返す。"""
    records = list_processes()
    pids = {item['ProcessId'] for item in records if is_slack_process(item, root, sys.platform == 'win32')}
    while True:
        children = {item['ProcessId'] for item in records if item.get('ParentProcessId') in pids} - pids
        if not children:
            return pids
        pids |= children


def stop_slack_processes(root: Path) -> bool:
    return stop_matching(lambda item: is_slack_process(item, root, sys.platform == 'win32'),
                         lambda text: print(f'[INFO] {text}'), lambda text: print(f'[NG] {text}'),
                         'Slack Bot')
