# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Avatar セットアップスクリプト

Vue 3 / Vite / TypeScript / Electron の依存関係を導入し、宣言範囲内の最新版へ更新します。
Electron は scripts/_setup_electron.py の共通処理で準備し、配置済みバイナリと共有 ZIP を再利用します。

公開 API:
    setup(choices=None) -> bool
"""

import os
import shlex
import shutil
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
FRONTEND_AVATAR_DIR = THIS_DIR
FRONTEND_COMMAND = "npm"

# 単体実行とルートセットアップの両方から共通処理を参照する。
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _setup_electron import setup_dependencies
from _runtime_requirements import check_project_node_runtime
from _setup_path import launcher_directory, ensure_launcher_path, windows_launcher_command, launcher_owner_comment, launcher_owned_by, sync_shared_launcher

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
    return shutil.which(npm_command()) is not None or shutil.which(FRONTEND_COMMAND) is not None


def install_standalone_launcher(launcher_dir: Path | None = None) -> bool:
    """Avatar の独立起動（launch.mjs）を aidiy_avatar コマンドとして登録する。"""
    script_path = FRONTEND_AVATAR_DIR / "launch.mjs"
    node = shutil.which("node") or "node"
    if not script_path.is_file():
        print_error(f"起動スクリプトが見つかりません: {script_path}")
        return False
    launcher_dir = launcher_dir or launcher_directory('aidiy_avatar')
    try:
        launcher_dir.mkdir(parents=True, exist_ok=True)
        # 廃止した旧コマンドは、この配置元が登録したものだけ除去する。
        for name in ('aidiy_avatar_alone', 'aidiy_avatar_alone.cmd'):
            legacy = launcher_dir / name
            if legacy.is_file() and launcher_owned_by(legacy.read_text(encoding='utf-8'), str(script_path)):
                legacy.unlink()
        launcher_path = launcher_dir / ("aidiy_avatar.cmd" if sys.platform == "win32" else "aidiy_avatar")
        command = [node, str(script_path)]
        if sys.platform == "win32":
            content = (
                "@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n"
                + launcher_owner_comment(script_path) + "\n"
                + windows_launcher_command(command)
                + "\nexit /b %ERRORLEVEL%\n"
            )
            launcher_path.write_bytes(content.replace("\n", "\r\n").encode("utf-8"))
        else:
            content = '#!/usr/bin/env sh\nexec ' + ' '.join(shlex.quote(arg) for arg in command) + ' "$@"\n'
            launcher_path.write_text(content, encoding="utf-8")
            launcher_path.chmod(0o755)
        sync_shared_launcher(launcher_path, script_path, legacy_scripts=(FRONTEND_AVATAR_DIR / '_start.py',))
        print_success(f"aidiy_avatar を登録しました: {launcher_path}")
    except OSError as exc:
        print_error(f"Avatar を登録できません: {launcher_dir} ({exc})")
        return False
    return ensure_launcher_path(launcher_dir)


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    label = "Avatar"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {FRONTEND_AVATAR_DIR}")
    print_info("対象: Node.js / Vue 3 / Vite / TypeScript / Electron")

    if not FRONTEND_AVATAR_DIR.exists():
        print_error(f"{label}: フォルダが見つかりません: {FRONTEND_AVATAR_DIR}")
        return False

    ok, detail = check_project_node_runtime(FRONTEND_AVATAR_DIR, dependency="electron", fallback=">=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False

    if not check_npm_installed():
        print_error(f"{label}: npm がインストールされていません。")
        print_info("  対応する Node.js と同梱の npm をインストールしてください: https://nodejs.org/")
        return False

    continue_on_error = bool((choices or {}).get("continue_on_error"))
    copy_warnings = choices.setdefault("_setup_warnings", []) if choices is not None else []
    warning_count = len(copy_warnings)
    dependencies_ok = setup_dependencies(
        FRONTEND_AVATAR_DIR, npm_command(), label, run_command,
        info=print_info, warning=print_warning, error=print_error,
        continue_on_error=continue_on_error, copy_warnings=copy_warnings,
    )
    if not dependencies_ok and not continue_on_error:
        return False
    if not dependencies_ok:
        print_warning(f"{label}: 依存の準備に失敗しました。続行指定のためランチャー登録を試行します。")
    try:
        launcher_ok = install_standalone_launcher()
    except (OSError, subprocess.SubprocessError) as exc:
        print_error(f"{label}: ランチャー登録に失敗しました: {exc}")
        launcher_ok = False
    if not dependencies_ok or not launcher_ok:
        return False

    if len(copy_warnings) > warning_count:
        print_warning(f"{label}: セットアップ処理は終了しましたが、Electron の配置は未確認です。")
        return True
    print_success(f"{label}: セットアップが完了しました。")
    print_info("起動方法: aidiy_avatar （または cd frontend_avatar && npm run dev）")
    return True


def main():
    global AUTO_MODE
    if sys.argv[1:] == ["--launchers-only"]:
        raise SystemExit(0 if install_standalone_launcher() else 1)
    print_header("Avatar セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Avatar のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not setup():
        print_error("Avatar のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
