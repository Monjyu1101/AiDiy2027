# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""フロントエンド(IDE) のクリーンアップ。

この配置先のサーバープロセスを停止してから、PATH ランチャー・node_modules・Python キャッシュを削除する。

公開 API:
    cleanup(choices: dict | None = None) -> bool
"""
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import sys

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
# 全体処理で他フォルダの同名 launcher がキャッシュされても取り違えない。
_launcher_spec = importlib.util.spec_from_file_location('aidiy_frontend_ide_viewer_launcher', THIS_DIR / 'launcher.py')
_launcher = importlib.util.module_from_spec(_launcher_spec)
_launcher_spec.loader.exec_module(_launcher)
remove_launcher = _launcher.remove_launcher

TARGETS = ('node_modules', '__pycache__', '.pytest_cache')
LABEL = 'IDE'
SERVICE_NAME = 'フロントエンド(IDE)'


class Colors:
    HEADER = '\033[97m'
    OKBLUE = '\033[94m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'


def print_header(message):
    print(f'\n{Colors.HEADER}{"=" * 60}{Colors.ENDC}')
    print(f'{Colors.HEADER}{message}{Colors.ENDC}')
    print(f'{Colors.HEADER}{"=" * 60}{Colors.ENDC}\n')


def print_success(message):
    print(f'{Colors.OKBLUE}[OK] {message}{Colors.ENDC}')


def print_error(message):
    print(f'{Colors.FAIL}[NG] {message}{Colors.ENDC}')


def print_warning(message):
    print(f'{Colors.WARNING}[WARN] {message}{Colors.ENDC}')


def print_info(message):
    print(f'{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}')


def _load_start_module():
    spec = importlib.util.spec_from_file_location('aidiy_frontend_ide_viewer_start_for_cleanup', THIS_DIR / '_start.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def remove_directory(path: Path) -> bool:
    root = THIS_DIR.resolve()
    # junction / symlink の解決後にも、このフォルダ内だけを削除する。
    try:
        target = path.resolve()
        if target == root or not target.is_relative_to(root):
            raise ValueError('コンポーネント外のパスです。')
        if not path.exists():
            return True
        if not path.is_dir():
            raise ValueError('ディレクトリではありません。')

        def writable(func, name, _error):
            os.chmod(name, stat.S_IWRITE)
            func(name)

        shutil.rmtree(path, onerror=writable)
        print_success(f'削除しました: {path}')
        return True
    except (OSError, ValueError):
        print_error(f'削除できません: {path}')
        return False


def cleanup(choices: dict | None = None, *, report: bool = True) -> bool:
    if choices is not None and choices.get('ide') is False:
        return True
    if report:
        print_header(f'{LABEL} のクリーンアップ')
        print_info('IDEの単独起動ランチャー・依存関係を解除します。')
    try:
        _load_start_module().kill_ports()
    except Exception as error:
        print_warning(f'サーバーの停止を確認できないため、削除を中止します: {error}')
        return False
    ok = remove_launcher(THIS_DIR)
    deleted_count = 0
    paths = [THIS_DIR / name for name in TARGETS]
    paths += sorted(THIS_DIR.rglob('__pycache__'), key=lambda item: len(item.parts), reverse=True)
    for path in paths:
        existed = path.exists()
        if remove_directory(path):
            deleted_count += existed
        else:
            ok = False
    if not ok:
        print_warning(f'{LABEL}: 一部のクリーンアップを完了できませんでした')
    elif report and deleted_count:
        print_success(f'{LABEL} のクリーンアップ完了 ({deleted_count}個削除)')
    elif report:
        print_info(f'{LABEL}: 削除対象はありませんでした')
    return ok


def main() -> None:
    print_header(f'{LABEL} クリーンアップ')
    answer = input('AiDiy IDE を停止し、依存関係・キャッシュを削除しますか？ ([n]/y): ').strip().lower()
    if answer == 'y':
        spec = importlib.util.spec_from_file_location('aidiy_ide_root_cleanup', THIS_DIR.parent.parent / '_cleanup.py')
        root_cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(root_cleanup)
        with root_cleanup.cleanup_stop_request({}, services=[SERVICE_NAME]):
            sys.exit(0 if cleanup() else 1)


if __name__ == '__main__':
    main()
