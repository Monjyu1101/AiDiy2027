# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Slack フロントエンドの依存導入と、共通設定の不足キー補完。"""
import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
# 全体処理で他フォルダの同名 launcher がキャッシュされても取り違えない。
_launcher_spec = importlib.util.spec_from_file_location('aidiy_frontend_slack_launcher', THIS_DIR / 'launcher.py')
_launcher = importlib.util.module_from_spec(_launcher_spec)
_launcher_spec.loader.exec_module(_launcher)
install_launcher = _launcher.install_launcher
sys.path.insert(0, str(THIS_DIR.parent.parent / 'scripts'))
from _runtime_requirements import check_project_node_runtime
from _setup_electron import prepare_electron_binary, _runtime_in_use
from slack_processes import slack_tree_pids


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


def _slack_in_use() -> bool:
    """この配置先のパネル・Bot を読み取りだけで確認する（Discord の _discord_in_use と同じ役割）。"""
    return bool(slack_tree_pids(THIS_DIR)) or _runtime_in_use(THIS_DIR)


def _supplement_config():
    # 共通設定は既存の補完・原子的保存を使い、独自に上書きしない。
    backend_dir = THIS_DIR.parent.parent / "backend_server"
    sys.path.insert(0, str(backend_dir))
    spec = importlib.util.spec_from_file_location("_slack_conf_json", backend_dir / "conf" / "conf_json.py")
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
        print_header("Slack セットアップ")
    print_info(f"作業ディレクトリ: {THIS_DIR}")
    print_info("対象: Slack / Node.js / Vue 3 / TypeScript / Electron（HTTPS の定期取得、WebSocket 不使用）")
    # 続行を明示した場合だけ、稼働中でも停止せず可能な処理を試す。
    try:
        if _slack_in_use():
            if not continue_on_error:
                print_error('起動中の Slack は停止せず、依存更新を保留しました。他項目だけ更新する場合は Channels (Discord / Slack) を選択しないでください。')
                return False
            print_info('[WARN] Slack は起動中ですが、エラーでも継続の指定によりセットアップを試行します。使用中ファイルの更新に失敗する場合があります。')
    except (OSError, ValueError, subprocess.SubprocessError):
        if not continue_on_error:
            print_error('Slack の停止状態を確認できないためセットアップを中止します。依存・設定は変更しません。')
            return False
        failures.append('稼働状態の確認')
        print_info('[WARN] Slack の稼働状態を確認できません。エラーを記録してセットアップを続行します。')
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
        print_error(f"Slack: {label} に失敗しました。")
        if continue_on_error:
            print_info('[WARN] エラーを記録して、後続のセットアップを試行します。')
        return continue_on_error

    env = {**os.environ, 'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}
    command = "ci" if (THIS_DIR / "package-lock.json").is_file() else "install"
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
        ready = prepare_electron_binary(THIS_DIR, 'Slack', continue_on_error=continue_on_error,
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
        print_error('Slack: 未完了の項目: ' + ' / '.join(failures))
        return False
    if copy_warnings:
        print_info('[WARN] Slack: 警告あり／Electron配置未確認。画面を閉じてセットアップを再実行してください。')
    elif report:
        print_success("Slack: aidiy_slack で起動できます。")
    return True


if __name__ == "__main__":
    sys.exit(0 if setup() else 1)
