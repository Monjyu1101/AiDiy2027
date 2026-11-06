# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Discord フロントエンドの依存導入と、共通設定の不足キー補完。"""
import importlib.util
import ntpath
import shutil
import os
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
# 全体処理で他フォルダの同名 launcher がキャッシュされても取り違えない。
_launcher_spec = importlib.util.spec_from_file_location('aidiy_frontend_discord_launcher', THIS_DIR / 'launcher.py')
_launcher = importlib.util.module_from_spec(_launcher_spec)
_launcher_spec.loader.exec_module(_launcher)
install_launcher = _launcher.install_launcher
sys.path.insert(0, str(THIS_DIR.parent / 'scripts'))
from _setup_electron import prepare_electron_binary, _runtime_in_use
from _runtime_requirements import check_project_node_runtime
from _setup_processes import snapshot, process_role
from _cleanup_processes import process_arguments
from discord_processes import is_discord_process


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"


def print_header(message):
    print(f"\n{Colors.HEADER}{'=' * 60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{message}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 60}{Colors.ENDC}\n")


def print_success(message):
    print(f"{Colors.OKBLUE}[OK] {message}{Colors.ENDC}")


def print_error(message):
    print(f"{Colors.FAIL}[NG] {message}{Colors.ENDC}")


def print_info(message):
    print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def _discord_in_use() -> bool:
    """この配置先の Bot / パネルを読み取りだけで確認する。判定不能時は更新しない。"""
    if _runtime_in_use(THIS_DIR):
        return True
    windows = sys.platform == 'win32'
    slack_root = THIS_DIR / 'slack'
    path_module = ntpath if windows else os.path
    slack_runtime = path_module.normcase(path_module.join(str(slack_root), 'node_modules', 'electron', 'dist')) + path_module.sep
    for process in snapshot():
        if process.get('ProcessId') == os.getpid():
            continue  # この _setup.py 自身は Discord の稼働ではない。
        # 双子の実行入口を同じ matcher で照合する。--project 等の引数は所属に使わない。
        if (is_discord_process(process, slack_root, windows)
                or process_role(process, slack_root, windows) == 'supervisor'):
            continue
        name = (process.get('Name') or '').lower()
        if name.startswith('electron'):
            # 親を失った Electron 子プロセスも、専用 runtime の配置先で分離する。
            args = process_arguments(process.get('CommandLine') or '', windows)
            executable = process.get('ExecutablePath') or (args[0] if args else '')
            if path_module.normcase(path_module.normpath(executable)).startswith(slack_runtime):
                continue
        if (process_role(process, THIS_DIR.parent, windows) == 'frontend_channels'
                or is_discord_process(process, THIS_DIR, windows)):
            return True
        if name in ('node', 'node.exe') or name.startswith('electron'):
            # 権限不足・壊れた引数一覧を「未起動」と見なさない。
            if not process_arguments(process.get('CommandLine') or '', windows):
                raise ValueError('Node / Electron の所属を確認できません')
    return False


def _supplement_config():
    # 共通設定は既存の補完・原子的保存を使い、独自に上書きしない。
    backend_dir = THIS_DIR.parent / "backend_server"
    sys.path.insert(0, str(backend_dir))
    spec = importlib.util.spec_from_file_location("_discord_conf_json", backend_dir / "conf" / "conf_json.py")
    conf_json_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conf_json_mod)
    conf_json_mod.conf_json()
    print_success("共通設定の不足キーを補完しました。")


def setup(choices=None, *, report=True) -> bool:
    if choices is not None and choices.get("channels") is False:
        return True
    continue_on_error = bool(choices and choices.get("continue_on_error"))
    failures = []
    copy_warnings = []
    if report:
        print_header("Discord セットアップ")
    print_info(f"作業ディレクトリ: {THIS_DIR}")
    print_info("対象: Discord / Node.js / Vue 3 / TypeScript / Electron")
    if report:
        print_info("外部チャンネル: Discord / Slack")
    # 続行を明示した場合だけ、稼働中でも停止せず可能な処理を試す。
    try:
        if _discord_in_use():
            if not continue_on_error:
                print_error('起動中の Discord は停止せず、この Discord の依存更新を保留しました。他項目だけ更新する場合は Channels(Discord / Slack) を選択しないでください。')
                return False
            print_info('[WARN] Discord は起動中ですが、エラーでも継続の指定によりセットアップを試行します。使用中ファイルの更新に失敗する場合があります。')
    except (OSError, ValueError, subprocess.SubprocessError):
        if not continue_on_error:
            print_error('Discord の停止状態を確認できないためセットアップを中止します。依存・設定は変更しません。')
            return False
        failures.append('稼働状態の確認')
        print_info('[WARN] Discord の稼働状態を確認できません。エラーを記録してセットアップを続行します。')
    ok, detail = check_project_node_runtime(THIS_DIR, fallback=">=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False

    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not npm:
        print_error("Node.js 22.12 以降と npm を導入してください。")
        return False

    def attempt(label, action):
        try:
            # ランチャー登録など成功時に None を返す既存APIにも対応する。
            if action() is not False:
                return True
        except (OSError, ValueError, ImportError, RuntimeError, subprocess.SubprocessError):
            pass
        failures.append(label)
        print_error(f"Discord: {label} に失敗しました。")
        if continue_on_error:
            print_info('[WARN] エラーを記録して、後続のセットアップを試行します。')
        return continue_on_error

    env = {**os.environ, 'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}
    command = "ci"
    commands = [
        [npm, command, "--include=dev", "--no-fund", "--no-audit"],
        [npm, "run", "update:electron"],
        [npm, "run", "build:panel"],
        [npm, "run", "check:panel"],
    ]
    for args in commands:
        print_info(f"実行中: {' '.join(args)}")
        if not attempt(' '.join(args[1:]), lambda: subprocess.run(args, cwd=THIS_DIR, env=env, check=True)):
            return False
    def prepare_electron():
        ready = prepare_electron_binary(THIS_DIR, 'Discord', continue_on_error=continue_on_error,
                                        copy_warnings=copy_warnings)
        if not ready and continue_on_error and copy_warnings:
            # コピー失敗だけは WARN。依存欠損等の準備失敗は通常の NG に残す。
            if choices is not None:
                choices.setdefault('_setup_warnings', []).extend(copy_warnings)
            return True
        return ready

    if not attempt('Electron 本体の準備', prepare_electron):
        return False
    if not attempt('ランチャー登録', lambda: install_launcher(THIS_DIR)):
        return False
    if not attempt('共通設定の補完', _supplement_config):
        return False
    if failures:
        print_error('Discord: 未完了の項目: ' + ' / '.join(failures))
        return False
    if copy_warnings:
        print_info('[WARN] Discord: 警告あり／Electron配置未確認。画面を閉じてセットアップを再実行してください。')
    elif report:
        print_success("Discord: aidiy_discord で起動できます。")
    return True


if __name__ == "__main__":
    sys.exit(0 if setup() else 1)
