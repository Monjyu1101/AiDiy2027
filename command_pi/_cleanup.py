# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""コマンド(pi) クリーンアップスクリプト

この配置先が登録した `aidiy_pi` ランチャーと PATH 登録の解除、
setup が作った依存物（全階層の node_modules と生成モデルデータ）の削除を行います。
Pi のソースと、利用者の設定・認証（~/.pi）は削除しません。

公開 API:
    cleanup(choices: dict) -> bool
    collect_choices() -> dict | None
"""

import importlib.util
import os
import shutil
import stat
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt

# ============================================================
# 設定
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parent
PI_DIR = THIS_DIR
PROGRAM_NAME = "aidiy_pi"
CLI_PATH = PI_DIR / "packages" / "coding-agent" / "src" / "cli.ts"
ENTRY_PATH = PI_DIR / "aidiy" / "aidiy_pi.ts"
MODEL_DATA_DIR = PI_DIR / "packages" / "ai" / "src" / "providers" / "data"

_path_spec = importlib.util.spec_from_file_location("aidiy_pi_cleanup_path", PROJECT_ROOT / "scripts" / "_setup_path.py")
_path_helper = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_path_helper)

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
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{message}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'=' * 60}{Colors.ENDC}\n")


def print_success(message):
    print(f"{Colors.OKBLUE}[OK] {message}{Colors.ENDC}")


def print_info(message):
    print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def print_warning(message):
    print(f"{Colors.WARNING}[WARN] {message}{Colors.ENDC}")


def print_error(message):
    print(f"{Colors.FAIL}[NG] {message}{Colors.ENDC}")


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


def ask_yes_no(prompt, default="n"):
    if AUTO_MODE:
        print_info(f"[AUTO] {prompt} -> {'Yes' if default.lower() == 'y' else 'No'} (default)")
        return default.lower() == "y"

    bracket = "[y]/n" if default.lower() == "y" else "y/[n]"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N"), default_key)
    return key in (b"y", b"Y")


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


def handle_remove_readonly(func, path, exc_info):
    del exc_info
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _is_directory_link(path: Path) -> bool:
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def remove_directory(path: Path, description: str) -> bool:
    try:
        # npm workspaces のリンク（junction）はリンク自体だけを外し、リンク先のソースを辿らない。
        if _is_directory_link(path):
            os.rmdir(path) if sys.platform == "win32" else path.unlink()
        else:
            shutil.rmtree(path, onerror=handle_remove_readonly)
        print_success(f"{description} を削除しました: {path}")
        return True
    except Exception as e:
        print_error(f"{description} の削除に失敗しました: {path}")
        print_error(f"  理由: {e}")
        print_warning("  ヒント: aidiy_pi を終了してから再実行するか、手動で削除してください")
        return False


# ============================================================
# ランチャー
# ============================================================
def launcher_path() -> Path:
    name = f"{PROGRAM_NAME}.cmd" if sys.platform == "win32" else PROGRAM_NAME
    return _path_helper.launcher_directory(PROGRAM_NAME) / name


def remove_launcher(label: str) -> bool:
    """この配置先が登録したランチャーだけを削除し、PATH 登録を解除する。"""
    try:
        path = launcher_path()
        if path.is_file():
            content = path.read_text(encoding="utf-8")
            # 現在の AiDiy 入口と、旧版（Pi の cli.ts を直接起動）のランチャーを照合する。
            # POSIX 版は所有者コメントを持たないため、起動対象のパスでも照合する。
            owners = (ENTRY_PATH.resolve(), CLI_PATH.resolve())
            if any(_path_helper.launcher_owned_by(content, owner) or str(owner) in content for owner in owners):
                path.unlink()
                print_success(f"{label}: ランチャーを削除しました: {path}")
            else:
                print_warning(f"{label}: 別の配置先のランチャーのため残します: {path}")
        if not _path_helper.remove_launcher_path(path.parent):
            print_error(f"{label}: PATH 登録の解除に失敗しました。")
            return False
        # 空になった保存先だけを片付ける。
        for directory in (path.parent, path.parent.parent):
            if directory.is_dir() and not any(directory.iterdir()):
                directory.rmdir()
        return True
    except (OSError, ValueError) as e:
        print_error(f"{label}: ランチャーの解除に失敗しました: {e}")
        return False


# ============================================================
# node_modules
# ============================================================
def find_node_modules() -> list[Path]:
    """command_pi 配下の node_modules を列挙する（node_modules の内側とリンクは辿らない）。"""
    targets: list[Path] = []
    for current, directories, _files in os.walk(PI_DIR, followlinks=False):
        for name in list(directories):
            path = Path(current) / name
            if name in (".git", ".git_local") or _is_directory_link(path):
                directories.remove(name)
                continue
            if name == "node_modules":
                directories.remove(name)
                targets.append(path)
    return sorted(targets)


def find_dependency_dirs() -> list[Path]:
    """setup が作る依存物（node_modules と hydrate:model-data の生成モデルデータ）。"""
    targets = find_node_modules()
    if MODEL_DATA_DIR.is_dir() and not _is_directory_link(MODEL_DATA_DIR):
        targets.append(MODEL_DATA_DIR)
    return targets


# ============================================================
# クリーンアップ本体
# ============================================================
def cleanup(choices: dict) -> bool:
    label = "コマンド(pi)"
    print_header(f"{label} のクリーンアップ")

    cleanup_ok = remove_launcher(label)
    deleted_count = 0

    if not PI_DIR.exists():
        print_warning(f"{label} のフォルダが見つかりません")
        return cleanup_ok

    targets = find_dependency_dirs()
    if targets:
        if choices.get("pi_dependencies") is True:
            for path in targets:
                if remove_directory(path, f"{path.name} ({label})"):
                    deleted_count += 1
                else:
                    cleanup_ok = False
        elif choices.get("pi_dependencies") is False:
            print_info("  依存物（node_modules / 生成モデルデータ）はそのまま残します")

    if not cleanup_ok:
        print_warning(f"{label}: 一部のクリーンアップを完了できませんでした")
    elif deleted_count > 0:
        print_success(f"{label} のクリーンアップ完了 ({deleted_count}個削除)")
    else:
        print_info(f"{label}: ランチャー解除のみ実行しました")
    return cleanup_ok


def collect_choices() -> dict | None:
    choices: dict = {"pi_dependencies": None}
    if PI_DIR.exists() and find_dependency_dirs():
        choices["pi_dependencies"] = ask_yes_no(
            "  command_pi の依存物（node_modules / 生成モデルデータ）を削除しますか？", default="y",
        )
    return choices


def main():
    global AUTO_MODE
    print_header("コマンド(pi) クリーンアップ")
    run_cleanup, AUTO_MODE = ask_start_mode("クリーンアップを実行しますか？", default="n")
    if not run_cleanup:
        print_info("クリーンアップをキャンセルしました")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。以降の質問はデフォルト値で自動回答します。")
    choices = collect_choices()
    if not cleanup(choices):
        sys.exit(1)
    print_success("クリーンアップが完了しました")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("クリーンアップが中断されました")
        sys.exit(1)
