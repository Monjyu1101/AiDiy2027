# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Web セットアップスクリプト

Vue 3 / Vite / TypeScript の依存関係を導入し、宣言範囲内の最新版へ更新します。

公開 API:
    setup(choices=None) -> bool
"""

import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt

# ============================================================
# 設定
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
FRONTEND_WEB_DIR = THIS_DIR
FRONTEND_COMMAND = "npm"
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import check_project_node_runtime

AUTO_MODE = False


class Colors:
    HEADER = '\033[97m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(message):
    print(f"\n{Colors.HEADER}{'=' * 60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{message}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 60}{Colors.ENDC}\n")


def print_success(message):
    print(f"{Colors.OKBLUE}[OK] {message}{Colors.ENDC}")


def print_error(message):
    print(f"{Colors.FAIL}[NG] {message}{Colors.ENDC}")


def print_warning(message):
    print(f"{Colors.WARNING}[WARN] {message}{Colors.ENDC}")


def print_info(message):
    print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def _clear_keyboard_buffer() -> None:
    if sys.platform != "win32":
        return
    while msvcrt.kbhit():
        key = msvcrt.getch()
        if key in (b"\x00", b"\xe0") and msvcrt.kbhit():
            msvcrt.getch()


def _read_single_key(valid: tuple[bytes, ...], default_key: bytes) -> bytes:
    if sys.platform == "win32":
        _clear_keyboard_buffer()
        while True:
            if msvcrt.kbhit():
                key = msvcrt.getch()
                if key in (b"\x00", b"\xe0"):
                    if msvcrt.kbhit():
                        msvcrt.getch()
                    continue
                if key in (b"\r", b"\n"):
                    print(default_key.decode("ascii"))
                    return default_key
                if key in valid:
                    print(key.decode("ascii", errors="replace"))
                    return key
            time.sleep(0.05)

    response = input().strip().lower()
    if response == "":
        return default_key
    first = response[0:1].encode("ascii", errors="replace")
    if first in valid:
        return first
    return default_key


def ask_start_mode(prompt, default="n"):
    bracket = "[y]/n/a=auto" if default.lower() == "y" else "y/[n]/a=auto"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N", b"a", b"A"), default_key)
    if key in (b"a", b"A"):
        return True, True
    if key in (b"y", b"Y"):
        return True, False
    return False, False


def run_command(command, cwd=None, shell=False, env=None):
    try:
        if isinstance(command, list):
            cmd_str = " ".join(str(c) for c in command)
        else:
            cmd_str = command
        print_info(f"実行中: {cmd_str}")
        subprocess.run(command, cwd=cwd, shell=shell, check=True, capture_output=False, text=True, env=env)
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"コマンド実行エラー: {e}")
        return False
    except Exception as e:
        print_error(f"予期しないエラー: {e}")
        return False


def npm_command():
    return f"{FRONTEND_COMMAND}.cmd" if sys.platform == "win32" else FRONTEND_COMMAND


def check_npm_installed():
    import shutil
    return shutil.which(npm_command()) is not None or shutil.which(FRONTEND_COMMAND) is not None


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    label = "Web"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {FRONTEND_WEB_DIR}")
    print_info("対象: Node.js / Vue 3 / Vite / TypeScript")

    if not FRONTEND_WEB_DIR.exists():
        print_error(f"{label}: フォルダが見つかりません: {FRONTEND_WEB_DIR}")
        return False

    ok, detail = check_project_node_runtime(FRONTEND_WEB_DIR, dependency="vite", fallback="^20.19.0 || >=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False

    if not check_npm_installed():
        print_error(f"{label}: npm がインストールされていません。")
        print_info("  対応する Node.js と同梱の npm をインストールしてください: https://nodejs.org/")
        return False

    package_json = FRONTEND_WEB_DIR / "package.json"
    if not package_json.exists():
        print_error(f"{label}: package.json が見つかりません: {package_json}")
        return False

    if not run_command([npm_command(), "install"], cwd=FRONTEND_WEB_DIR):
        print_error(f"{label}: セットアップに失敗しました。")
        return False

    if not run_command([npm_command(), "update"], cwd=FRONTEND_WEB_DIR):
        print_error(f"{label}: 依存関係の最新版への更新に失敗しました。")
        return False

    print_success(f"{label}: セットアップが完了しました。")
    return True


def main():
    global AUTO_MODE
    print_header("Web セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Web のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not setup():
        print_error("Web のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
