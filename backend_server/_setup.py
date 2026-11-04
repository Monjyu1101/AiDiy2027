# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Core / Apps セットアップスクリプト

このフォルダ (backend_server) 単体のセットアップを行います。
ルートの `_setup.py` から import して `setup(choices)` を呼び出すことも、
このスクリプトを直接実行して単体セットアップすることもできます。

Usage:
    python _setup.py              # 単体セットアップ
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
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import python_requirement
BACKEND_DIR = THIS_DIR
BACKEND_ENV = ".venv"
BACKEND_VENV_DIR = BACKEND_DIR / BACKEND_ENV

DATABASE_TYPE = "sqlite"
POSTGRES_DIR = BACKEND_DIR / "postgres"

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
    """1文字入力を受け付ける。Enter でデフォルト、valid 以外は無視して待機。"""
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


def run_command(command, cwd=None, shell=False, env=None):
    try:
        if isinstance(command, list):
            cmd_str = " ".join(str(c) for c in command)
        else:
            cmd_str = command

        print_info(f"実行中: {cmd_str}")
        subprocess.run(
            command,
            cwd=cwd,
            shell=shell,
            check=True,
            capture_output=False,
            text=True,
            env=env,
        )
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"コマンド実行エラー: {e}")
        return False
    except Exception as e:
        print_error(f"予期しないエラー: {e}")
        return False


def check_uv_installed():
    import shutil
    return shutil.which("uv") is not None


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    """Core / Apps をセットアップする。"""
    choices = choices or {}
    label = "Core / Apps"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {BACKEND_DIR}")
    print_info("対象: Python / uv / FastAPI / SQLAlchemy / SQLite")

    if not BACKEND_DIR.exists():
        print_error(f"{label}: フォルダが見つかりません: {BACKEND_DIR}")
        return False

    pyproject_file = BACKEND_DIR / "pyproject.toml"
    if not pyproject_file.exists():
        print_error(f"{label}: pyproject.toml が見つかりません: {pyproject_file}")
        return False

    if not check_uv_installed():
        print_error(f"{label}: uv がインストールされていません。")
        print_info("  PowerShell: irm https://astral.sh/uv/install.ps1 | iex")
        print_info("  または: pip install uv")
        return False

    try:
        requirement = python_requirement(BACKEND_DIR)
    except (OSError, ValueError) as exc:
        print_warning(f"{label}: Python 実行条件を確認できません。uv の確認を続行します: {exc}")
    else:
        print_info(f"実行環境: Python {requirement}（pyproject.toml。uv が互換 Python を選択します）")

    if BACKEND_VENV_DIR.exists():
        print_success(f"{label}: 既存の仮想環境を検出しました: {BACKEND_VENV_DIR}")

    if run_command(["uv", "sync", "--upgrade"], cwd=BACKEND_DIR):
        print_success(f"{label}: セットアップが完了しました。")
    else:
        print_error(f"{label}: uv sync --upgrade に失敗しました。")
        return False

    if DATABASE_TYPE.lower() == "postgresql":
        print_header(f"{label} PostgreSQL 補助処理")

        print_info("PostgreSQL を使う場合は以下のユーザーが必要です。")
        print_info("  ユーザー名: appsuser")
        print_info("  パスワード: appspass")
        print_info("  DB名: appsdb")

        if not choices.get("pg_user_created"):
            print_error("PostgreSQL ユーザーが未作成のため処理を終了します。")
            return False

        if choices.get("pg_restore"):
            create_db_script = POSTGRES_DIR / "create_database.py"
            if create_db_script.exists():
                if not run_command(["uv", "run", "python", str(create_db_script.name)], cwd=POSTGRES_DIR):
                    return False
            else:
                print_warning(f"初期データベース復元をスキップします: {create_db_script} が見つかりません。")

        if choices.get("pg_migrate"):
            if not run_command(["uv", "run", "alembic", "upgrade", "head"], cwd=BACKEND_DIR):
                return False
    else:
        print_info(f"{label}: DATABASE_TYPE={DATABASE_TYPE} のため PostgreSQL 関連処理はスキップします。")

    return True


def _collect_standalone_choices() -> dict | None:
    """単体実行時の対話。キャンセル時は None。"""
    global AUTO_MODE
    run_setup, AUTO_MODE = ask_start_mode("Core / Apps のセットアップを実行しますか?", default="n")
    if not run_setup:
        return None
    if AUTO_MODE:
        print_info("AUTOモードで実行します。以降の質問はデフォルト値で自動回答します。")

    choices: dict = {"pg_user_created": False, "pg_restore": False, "pg_migrate": False}
    if DATABASE_TYPE.lower() == "postgresql":
        choices["pg_user_created"] = ask_yes_no("PostgreSQL ユーザー(appsuser)を作成しましたか？", default="y")
        choices["pg_restore"]      = ask_yes_no("初期データベースを復元しますか？", default="n")
        choices["pg_migrate"]      = ask_yes_no("マイグレーション(alembic upgrade head)を実行しますか？", default="y")
    return choices


def main():
    print_header("Core / Apps セットアップ")
    choices = _collect_standalone_choices()
    if choices is None:
        print_warning("セットアップをキャンセルしました。")
        return
    ok = setup(choices)
    if ok:
        print_success("Core / Apps のセットアップが完了しました。")
    else:
        print_error("Core / Apps のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
