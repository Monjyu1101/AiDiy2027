# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""フロントエンド(Avatar) クリーンアップスクリプト

この作業コピーの起動ランチャーを解除し、
node_modules / dist / dist-electron / __pycache__ / .pytest_cache を削除します。

公開 API:
    cleanup(choices: dict | None = None) -> bool
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
FRONTEND_AVATAR_DIR = THIS_DIR
FRONTEND_AVATAR_BUILD_DIRS = ["dist", "dist-electron"]

sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _setup_path import launcher_directory, remove_launcher_path, launcher_owned_by

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
    # 削除中に再帰探索の列挙結果が変わらないよう、全階層の対象を先に確定する。
    # 万一キャッシュフォルダが入れ子でも、深い階層から削除する。
    pycache_dirs = sorted(
        (path for path in target_dir.rglob("__pycache__") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for pycache in pycache_dirs:
        if remove_directory(pycache, f"__pycache__ ({label})"):
            deleted_count += 1
        else:
            cleanup_ok = False
    print_info(f"{label}: .pytest_cache フォルダを検索中...")
    pytest_cache_dirs = sorted(
        (path for path in target_dir.rglob(".pytest_cache") if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for pytest_cache in pytest_cache_dirs:
        if remove_directory(pytest_cache, f".pytest_cache ({label})"):
            deleted_count += 1
        else:
            cleanup_ok = False
    return deleted_count, cleanup_ok


# ============================================================
# クリーンアップ本体
# ============================================================
def remove_standalone_launcher() -> bool:
    """この作業コピーの Avatar ランチャーだけを解除する。"""
    directory = launcher_directory('aidiy_avatar')
    # 現行の launch.mjs と、旧形式の _start.py 登録の両方を解除対象にする。
    scripts = [str(FRONTEND_AVATAR_DIR.resolve() / name) for name in ('launch.mjs', '_start.py')]
    try:
        for name in ('aidiy_avatar.cmd', 'aidiy_avatar', 'aidiy_avatar_alone.cmd', 'aidiy_avatar_alone'):
            launcher = directory / name
            if launcher.is_file() and any(launcher_owned_by(launcher.read_text(encoding='utf-8'), script) for script in scripts):
                launcher.unlink()
                print_success(f'起動ランチャーを解除しました: {launcher}')
        return remove_launcher_path(directory)
    except OSError as exc:
        print_error(f'Avatar ランチャーの解除に失敗しました: {exc}')
        return False


def cleanup(choices: dict | None = None) -> bool:
    label = "フロントエンド(Avatar)"
    print_header(f"{label} のクリーンアップ")

    if not remove_standalone_launcher():
        return False

    if not FRONTEND_AVATAR_DIR.exists():
        print_warning(f"{label} のフォルダが見つかりません")
        return True

    deleted_count = 0
    cleanup_ok = True

    node_modules_dir = FRONTEND_AVATAR_DIR / "node_modules"
    if remove_directory(node_modules_dir, f"node_modules ({label})"):
        deleted_count += 1
    elif node_modules_dir.exists():
        print_error(f"  node_modules 削除失敗。手動で削除してください: {node_modules_dir}")
        cleanup_ok = False

    for build_dir_name in FRONTEND_AVATAR_BUILD_DIRS:
        build_dir = FRONTEND_AVATAR_DIR / build_dir_name
        if remove_directory(build_dir, f"{build_dir_name} ({label})"):
            deleted_count += 1
        elif build_dir.exists():
            cleanup_ok = False

    # node_modules / ビルド成果物を消してから走査し、無駄なスキャンを避ける。
    cache_count, cache_ok = cleanup_common_python_caches(FRONTEND_AVATAR_DIR, label)
    deleted_count += cache_count
    cleanup_ok = cleanup_ok and cache_ok

    if not cleanup_ok:
        print_warning(f"{label}: 一部のクリーンアップを完了できませんでした")
    elif deleted_count > 0:
        print_success(f"{label} のクリーンアップ完了 ({deleted_count}個削除)")
    else:
        print_info(f"{label}: 削除対象はありませんでした")
    return cleanup_ok


def main():
    global AUTO_MODE
    print_header("フロントエンド(Avatar) クリーンアップ")
    run_cleanup, AUTO_MODE = ask_start_mode("クリーンアップを実行しますか？", default="n")
    if not run_cleanup:
        print_info("クリーンアップをキャンセルしました")
        return
    if not cleanup():
        sys.exit(1)
    print_success("クリーンアップが完了しました")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("クリーンアップが中断されました")
        sys.exit(1)
