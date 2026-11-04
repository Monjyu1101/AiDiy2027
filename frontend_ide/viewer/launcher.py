# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_ide の PATH ランチャーを登録・解除する。"""
from pathlib import Path
import shlex
import shutil
import sys
import importlib.util

_path_spec = importlib.util.spec_from_file_location('aidiy_viewer_launcher_path', Path(__file__).resolve().parents[2] / 'scripts' / '_setup_path.py')
_path_helper = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_path_helper)
ensure_launcher_path = _path_helper.ensure_launcher_path
remove_launcher_path = _path_helper.remove_launcher_path
windows_launcher_command = _path_helper.windows_launcher_command
launcher_owner_comment = _path_helper.launcher_owner_comment
launcher_owned_by = _path_helper.launcher_owned_by


def launcher_path(kind: str = 'ide') -> Path:
    return Path.home() / '.local' / 'bin' / (f'aidiy_{kind}.cmd' if sys.platform == 'win32' else f'aidiy_{kind}')


def install_launcher(root: Path, kind: str = 'ide', *, register_path: bool = True) -> None:
    node = shutil.which('node')
    if not node:
        raise OSError('Node.js が見つかりません。')
    script = root.resolve() / 'launch.mjs'
    if not script.is_file():
        raise OSError(f'起動スクリプトが見つかりません: {script}')
    path = launcher_path(kind)
    # この配置先の旧コマンドを撤去する。互換ランチャーは作らない。
    legacy = path.with_name('aidiy_dev.cmd' if sys.platform == 'win32' else 'aidiy_dev')
    if kind == 'ide' and legacy.is_file() and str(script) in legacy.read_text(encoding='utf-8'):
        legacy.unlink()
    if kind == 'console':
        # 改名前のこの配置先が所有するランチャーだけを解除する。
        old_path = launcher_path('term')
        old_script = root.resolve().parent / 'aidiy_term' / 'launch.mjs'
        if old_path.is_file() and launcher_owned_by(old_path.read_text(encoding='utf-8'), old_script):
            old_path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == 'win32':
        content = ('@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n'
                   + launcher_owner_comment(script) + '\n'
                   + windows_launcher_command([node, str(script)]) + '\nexit /b %errorlevel%\n')
        path.write_bytes(content.replace('\n', '\r\n').encode('utf-8'))
    else:
        path.write_text(f'#!/bin/sh\nexec {shlex.quote(node)} {shlex.quote(str(script))} "$@"\n', encoding='utf-8')
        path.chmod(0o755)
    print(f'\033[94m[OK] {path.name} を登録しました: {path}\033[0m')
    if register_path and not ensure_launcher_path(path.parent):
        raise OSError('ランチャーの PATH 登録に失敗しました。')


def remove_launcher(root: Path, kind: str = 'ide') -> bool:
    path = launcher_path(kind)
    try:
        # 別の作業コピーが登録したランチャーは消さない
        if path.is_file() and launcher_owned_by(path.read_text(encoding='utf-8'), root.resolve() / 'launch.mjs'):
            path.unlink()
            print(f'[OK] ランチャーを削除しました: {path}')
        return remove_launcher_path(path.parent)
    except OSError:
        print(f'[NG] ランチャーを削除できません: {path}')
        return False
