# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""バックエンド(local) クリーンアップスクリプト

キャッシュ / 仮想環境 / temp（ダウンロード済みモデルを含む大容量）の削除を行います。

公開 API:
    cleanup(choices: dict) -> bool
    collect_choices() -> dict | None
"""

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
BACKEND_LOCAL_DIR = THIS_DIR
BACKEND_LOCAL_ENV_LIST = [".venv", "venv"]

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


def remove_directory(path: Path, description: str) -> bool:
    if path.exists() and path.is_dir():
        try:
            shutil.rmtree(path, onerror=handle_remove_readonly)
            print_success(f"{description} を削除しました: {path}")
            return True
        except Exception as e:
            print_error(f"{description} の削除に失敗しました: {path}")
            print_error(f"  理由: {e}")
            print_warning("  ヒント: 管理者権限で実行するか、手動で削除してください")
            return False
    return False


def cleanup_common_python_caches(target_dir: Path, label: str) -> tuple[int, bool]:
    deleted_count = 0
    cleanup_ok = True
    print_info(f"{label}: __pycache__ フォルダを検索中...")
    for pycache in target_dir.rglob("__pycache__"):
        if remove_directory(pycache, f"__pycache__ ({label})"):
            deleted_count += 1
        else:
            cleanup_ok = False
    print_info(f"{label}: .pytest_cache フォルダを検索中...")
    for pytest_cache in target_dir.rglob(".pytest_cache"):
        if remove_directory(pytest_cache, f".pytest_cache ({label})"):
            deleted_count += 1
        else:
            cleanup_ok = False
    return deleted_count, cleanup_ok


# ============================================================
# クリーンアップ本体
# ============================================================
def cleanup(choices: dict) -> bool:
    label = "バックエンド(local)"
    print_header(f"{label} のクリーンアップ")

    if not BACKEND_LOCAL_DIR.exists():
        print_warning(f"{label} のフォルダが見つかりません")
        return True

    deleted_count, cleanup_ok = cleanup_common_python_caches(BACKEND_LOCAL_DIR, label)

    local_envs = choices.get("local_envs", {})
    for env_name in BACKEND_LOCAL_ENV_LIST:
        env_dir = BACKEND_LOCAL_DIR / env_name
        if not env_dir.exists():
            continue
        if local_envs.get(env_name):
            if remove_directory(env_dir, f"{env_name} ({label})"):
                deleted_count += 1
            else:
                cleanup_ok = False
                print_error(f"  {env_name} 削除失敗。手動で削除してください: {env_dir}")
        elif env_name in local_envs:
            print_info(f"  {env_name} はそのまま残します")

    # temp 配下にダウンロード済みモデル (大容量) を含む
    temp_dir = BACKEND_LOCAL_DIR / "temp"
    if temp_dir.exists():
        if choices.get("local_temp") is True:
            if remove_directory(temp_dir, f"temp ({label})"):
                deleted_count += 1
            else:
                cleanup_ok = False
        elif choices.get("local_temp") is False:
            print_info("  temp はそのまま残します")

    if not cleanup_ok:
        print_warning(f"{label}: 一部のクリーンアップを完了できませんでした")
    elif deleted_count > 0:
        print_success(f"{label} のクリーンアップ完了 ({deleted_count}個削除)")
    else:
        print_info(f"{label}: 削除対象はありませんでした")
    return cleanup_ok


def collect_choices() -> dict | None:
    choices: dict = {"local_envs": {}, "local_temp": None}
    if BACKEND_LOCAL_DIR.exists():
        for env_name in BACKEND_LOCAL_ENV_LIST:
            if (BACKEND_LOCAL_DIR / env_name).exists():
                choices["local_envs"][env_name] = ask_yes_no(f"  {env_name} を削除しますか？", default="y")
        if (BACKEND_LOCAL_DIR / "temp").exists():
            choices["local_temp"] = ask_yes_no(
                "  temp フォルダ(ダウンロード済みモデル含む)を削除しますか？", default="y"
            )
    return choices


def main():
    global AUTO_MODE
    print_header("バックエンド(local) クリーンアップ")
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
