# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Task / Team セットアップスクリプト。"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt


THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import python_requirement
BACKEND_TASKTEAM_DIR = THIS_DIR
BACKEND_TASKTEAM_ENV = ".venv"
AUTO_MODE = False


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"


def print_header(message: str) -> None:
    print(f"\n{Colors.HEADER}{'=' * 60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{message}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 60}{Colors.ENDC}\n")


def print_success(message: str) -> None:
    print(f"{Colors.OKBLUE}[OK] {message}{Colors.ENDC}")


def print_error(message: str) -> None:
    print(f"{Colors.FAIL}[NG] {message}{Colors.ENDC}")


def print_warning(message: str) -> None:
    print(f"{Colors.WARNING}[WARN] {message}{Colors.ENDC}")


def print_info(message: str) -> None:
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


def ask_start_mode(prompt: str, default: str = "n") -> tuple[bool, bool]:
    bracket = "[y]/n/a=auto" if default.lower() == "y" else "y/[n]/a=auto"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N", b"a", b"A"), default_key)
    if key in (b"a", b"A"):
        return True, True
    if key in (b"y", b"Y"):
        return True, False
    return False, False


def run_command(command: list[str], cwd: Path | None = None) -> bool:
    try:
        print_info(f"実行中: {' '.join(command)}")
        subprocess.run(command, cwd=cwd, check=True, capture_output=False, text=True)
        return True
    except subprocess.CalledProcessError as exc:
        print_error(f"コマンド実行エラー: {exc}")
        return False
    except Exception as exc:
        print_error(f"予期しないエラー: {exc}")
        return False


def check_uv_installed() -> bool:
    return shutil.which("uv") is not None


def setup(choices: dict | None = None) -> bool:
    del choices
    label = "Task / Team"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {BACKEND_TASKTEAM_DIR}")
    print_info("対象: Python / uv / FastAPI / SQLite")

    if not BACKEND_TASKTEAM_DIR.exists():
        print_error(f"{label}: フォルダが見つかりません: {BACKEND_TASKTEAM_DIR}")
        return False
    if not check_uv_installed():
        print_error(f"{label}: uv がインストールされていません。")
        print_info("  PowerShell: irm https://astral.sh/uv/install.ps1 | iex")
        print_info("  または: pip install uv")
        return False
    if not (BACKEND_TASKTEAM_DIR / "pyproject.toml").exists():
        print_error(f"{label}: pyproject.toml が見つかりません。")
        return False

    try:
        requirement = python_requirement(BACKEND_TASKTEAM_DIR)
    except (OSError, ValueError) as exc:
        print_warning(f"{label}: Python 実行条件を確認できません。uv の確認を続行します: {exc}")
    else:
        print_info(f"実行環境: Python {requirement}（pyproject.toml。uv が互換 Python を選択します）")

    venv_dir = BACKEND_TASKTEAM_DIR / BACKEND_TASKTEAM_ENV
    if venv_dir.exists():
        print_success(f"{label}: 既存の仮想環境を検出しました: {venv_dir}")

    if not run_command(["uv", "sync", "--upgrade"], cwd=BACKEND_TASKTEAM_DIR):
        print_error(f"{label}: uv sync --upgrade に失敗しました。")
        return False

    print_success(f"{label}: 依存関係のセットアップが完了しました。")
    return True


def main() -> None:
    global AUTO_MODE
    print_header("Task / Team セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Task / Team のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not setup():
        print_error("Task / Team のセットアップに失敗しました。")
        sys.exit(1)
    print_success("Task / Team のセットアップが完了しました。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
