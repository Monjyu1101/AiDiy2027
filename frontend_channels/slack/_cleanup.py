# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Slack Bot の停止を確認してから依存物とキャッシュを削除する。共通設定は保持する。"""
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import sys

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
from slack_processes import stop_slack_processes
# 全体処理で他フォルダの同名 launcher がキャッシュされても取り違えない。
_launcher_spec = importlib.util.spec_from_file_location('aidiy_frontend_slack_launcher', THIS_DIR / 'launcher.py')
_launcher = importlib.util.module_from_spec(_launcher_spec)
_launcher_spec.loader.exec_module(_launcher)
remove_launcher = _launcher.remove_launcher

TARGETS = ('node_modules', 'out', 'temp', '__pycache__', '.pytest_cache')
LABEL = 'フロントエンド(Slack)'


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


def remove_directory(path: Path) -> bool:
    root = THIS_DIR.resolve()
    # junction / symlink の解決後にも、Slack モジュール内だけを削除する。
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


def cleanup(choices: dict | None = None) -> bool:
    if choices is not None and choices.get('slack') is False:
        return True
    print_header(f'{LABEL} のクリーンアップ')
    if not stop_slack_processes(THIS_DIR):
        print_warning('Slack パネル・Bot の停止を確認できないため、ランチャーと生成物の削除を中止します。')
        return False
    ok = remove_launcher(THIS_DIR)
    deleted_count = 0

    def remove_counted(path: Path) -> None:
        nonlocal ok, deleted_count
        existed = path.exists()
        if remove_directory(path):
            deleted_count += existed
        else:
            ok = False

    for name in TARGETS:
        remove_counted(THIS_DIR / name)
    if ok and deleted_count:
        print_success(f'{LABEL} のクリーンアップ完了 ({deleted_count}個削除)')
    elif ok:
        print_info(f'{LABEL}: 削除対象はありませんでした')
    else:
        print_warning(f'{LABEL}: 一部のクリーンアップを完了できませんでした')
    return ok


def main() -> None:
    print_header(f'{LABEL} クリーンアップ')
    answer = input('Slack パネル・Bot を停止し、依存関係・キャッシュを削除しますか？ ([n]/y): ').strip().lower()
    if answer == 'y':
        sys.exit(0 if cleanup() else 1)


if __name__ == '__main__':
    main()
