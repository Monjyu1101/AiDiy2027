# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Slack パネルの単独起動と cleanup 用の停止 API。"""
from pathlib import Path
import shutil
import subprocess
import sys

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent.parent / "scripts"))
from _runtime_requirements import check_project_node_runtime
sys.path.insert(0, str(THIS_DIR))
from slack_processes import slack_tree_pids, stop_slack_processes


def print_header(message: str) -> None:
    print(f'\n\033[97m{"=" * 60}\033[0m')
    print(f'\033[97m{message}\033[0m')
    print(f'\033[97m{"=" * 60}\033[0m\n')


def launch_command() -> list[str]:
    ok, detail = check_project_node_runtime(THIS_DIR, fallback=">=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        raise RuntimeError(detail)
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js 22.12 以降が必要です。')
    return [node, str(THIS_DIR / 'panel/launch.mjs')]


def check_environment() -> tuple[bool, str]:
    try:
        command = launch_command()
    except (OSError, RuntimeError) as error:
        return False, str(error)
    if not (THIS_DIR / 'node_modules/tsx/dist/loader.mjs').is_file():
        return False, f'依存関係がありません。python "{THIS_DIR / "_setup.py"}" を実行してください。'
    from _setup_electron import electron_binary_ready
    desktop_ready = electron_binary_ready(THIS_DIR)
    try:
        result = subprocess.run(command + ['--check'], cwd=THIS_DIR, capture_output=True,
                                encoding='utf-8', errors='replace', timeout=30,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
    except (OSError, subprocess.SubprocessError):
        return False, 'Node.js / Slack 設定を確認できません。frontend_channels/slack で npm run config:check を実行してください。'
    if result.returncode:
        # 出力全体には実行環境の情報が含まれ得るため転記しない。
        return False, 'Slack 設定または Hermes が未準備です。frontend_channels/slack で npm run config:check を実行してください。'
    detail = 'Node.js / Slack 設定 / Hermes（外部接続なし）'
    if not desktop_ready:
        detail += f' / Web へ切替（専用ウィンドウの復旧: python "{THIS_DIR / "_setup.py"}"）'
    return True, detail


def kill_ports() -> None:
    """cleanup 用 API。ポートの代わりにパネル・worker・Bot の実行入口で照合する。"""
    if not stop_slack_processes(THIS_DIR):
        raise RuntimeError('Slack Bot を終了できないため処理を中止します。')


def process_tree_pids() -> set[int]:
    return slack_tree_pids(THIS_DIR)


def start(auto_connect: bool = False) -> subprocess.Popen[bytes]:
    kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {'start_new_session': True}
    # パネルはログファイルを使って独立起動し、全体起動の終了後も継続する。
    # 二重起動はパネルの単一起動ロックが防ぎ、起動済みなら既存パネルで接続する。
    args = ['--connect'] if auto_connect else ['--no-connect']
    # aidiy_code / aidiy_live と同じく、全体起動ではリポジトリ直下をプロジェクトにする。
    return subprocess.Popen(launch_command() + args, cwd=THIS_DIR.parent.parent, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, bufsize=0, **kwargs)


def main() -> None:
    print_header('フロントエンド(Slack) パネル起動')
    try:
        sys.exit(subprocess.call(launch_command() + sys.argv[1:], cwd=THIS_DIR.parent.parent,
                                 creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0))
    except (OSError, RuntimeError) as error:
        print(error)
        sys.exit(1)


if __name__ == '__main__':
    main()
