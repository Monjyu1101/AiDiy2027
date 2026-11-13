# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Pi セットアップスクリプト

このフォルダ (command_pi) 単体のセットアップを行います。
Pi（MIT ライセンスの AI エージェントハーネス）の npm 依存を lockfile どおりに導入し、
ソースから直接起動する `aidiy_pi` ランチャーを `_AIDIY/aidiy_pi/bin` に作成して
Windows ではユーザー PATH へ登録します。

- 依存導入は Pi 本体の方針に合わせ `npm ci --ignore-scripts`（lifecycle script 不実行）。
- ソース実行に必要なモデルデータは `npm run hydrate:model-data` で生成する（ネットワーク使用）。
- `npm run build` は行わない。起動は `pi-test.ps1` と同じソース実行方式。
- `aidiy_pi` は aidiy_hermes と同様、実行したフォルダをそのまま作業フォルダ（プロジェクト）にする。
- 起動入口は `aidiy/aidiy_pi.ts`。aidiy_diag の pi_models_info.json・AiDiy_key.json・
  Codex / Grok の共有ログインから、Hermes と同じ区分名のプロバイダを登録する。
  初期モデルは openai_oauth/gpt-6.1-sol、以後は最後に選んだモデル（~/.pi/agent/aidiy_model.json）。
  利用者の設定・認証・セッションは Pi 既定の `~/.pi/agent` に保存される。

公開 API:
    setup(choices=None) -> bool
    install_standalone_launcher() -> bool
"""

import importlib.util
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
PROJECT_ROOT = THIS_DIR.parent
PI_DIR = THIS_DIR
PROGRAM_NAME = "aidiy_pi"
CLI_PATH = PI_DIR / "packages" / "coding-agent" / "src" / "cli.ts"
# AiDiy 入口: Pi の CLI に AiDiy のプロバイダ（モデル一覧・キー・OAuth）と初期モデルを加える。
ENTRY_PATH = PI_DIR / "aidiy" / "aidiy_pi.ts"
RESOLVER_PATH = PI_DIR / "packages" / "coding-agent" / "src" / "experimental" / "source-resolver.ts"
MODEL_DATA_DIR = PI_DIR / "packages" / "ai" / "src" / "providers" / "data"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from _runtime_requirements import check_project_node_runtime  # noqa: E402

_path_spec = importlib.util.spec_from_file_location("aidiy_pi_setup_path", PROJECT_ROOT / "scripts" / "_setup_path.py")
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


def run_command(command, cwd=None):
    try:
        print_info(f"実行中: {' '.join(str(c) for c in command)}")
        subprocess.run(command, cwd=cwd, check=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"コマンド実行エラー: {e}")
        return False
    except Exception as e:
        print_error(f"予期しないエラー: {e}")
        return False


def npm_command() -> str:
    return "npm.cmd" if sys.platform == "win32" else "npm"


# ============================================================
# ランチャー
# ============================================================
def launcher_path() -> Path:
    name = f"{PROGRAM_NAME}.cmd" if sys.platform == "win32" else PROGRAM_NAME
    return _path_helper.launcher_directory(PROGRAM_NAME) / name


def launcher_command(node: str) -> list[str]:
    """`pi-test.ps1` と同じソース実行。--import にはファイル URL を渡す。

    作業フォルダは変更しない（起動したフォルダがそのまま Pi の対象プロジェクトになる）。
    """
    return [node, "--import", RESOLVER_PATH.resolve().as_uri(), str(ENTRY_PATH.resolve())]


def install_standalone_launcher() -> bool:
    """依存の再導入なしで `aidiy_pi` ランチャーと PATH 登録を作成・修復する。"""
    label = "Pi"
    node = shutil.which("node")
    if not node:
        print_error(f"{label}: Node.js が見つかりません。")
        return False
    for path in (CLI_PATH, ENTRY_PATH, RESOLVER_PATH):
        if not path.is_file():
            print_error(f"{label}: 起動スクリプトが見つかりません: {path}")
            return False
    try:
        path = launcher_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        command = launcher_command(node)
        if sys.platform == "win32":
            content = ("@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n"
                       + _path_helper.launcher_owner_comment(ENTRY_PATH.resolve()) + "\n"
                       + _path_helper.windows_launcher_command(command) + "\nexit /b %errorlevel%\n")
            path.write_bytes(content.replace("\n", "\r\n").encode("utf-8"))
        else:
            path.write_text("#!/bin/sh\nexec " + " ".join(shlex.quote(c) for c in command) + ' "$@"\n',
                            encoding="utf-8")
            path.chmod(0o755)
        print_success(f"{label}: {path.name} を作成しました: {path}")
        print_info(f"  Node: {node}")
        print_info(f"  CLI : {ENTRY_PATH.resolve()}")
        if not _path_helper.ensure_launcher_path(path.parent):
            print_error(f"{label}: ランチャーの PATH 登録に失敗しました。")
            return False
    except (OSError, ValueError) as e:
        print_error(f"{label}: ランチャーの作成に失敗しました: {e}")
        return False
    print_success(f"{label}: 起動コマンド {PROGRAM_NAME} を登録しました。")
    return True


def verify_cli() -> bool:
    """依存導入後にソース実行で `--version` が通ることを確認する。"""
    node = shutil.which("node")
    if not node:
        return False
    try:
        result = subprocess.run(launcher_command(node) + ["--version"], cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        print_error(f"Pi: 起動確認に失敗しました: {e}")
        return False
    output = (result.stdout or result.stderr or "").strip()
    if result.returncode != 0:
        print_error(f"Pi: 起動確認に失敗しました (exit {result.returncode})")
        if output:
            print_error("  " + output.splitlines()[-1])
        return False
    print_success(f"Pi: 起動確認 OK（{output.splitlines()[0] if output else 'version'}）")
    return True


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    del choices
    label = "Pi"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {PI_DIR}")
    print_info("対象: Node.js / npm / Pi CLI")

    if not (PI_DIR / "package.json").is_file() or not (PI_DIR / "package-lock.json").is_file():
        print_error(f"{label}: package.json / package-lock.json が見つかりません: {PI_DIR}")
        return False

    ok, message = check_project_node_runtime(PI_DIR)
    (print_info if ok else print_error)(f"{label}: {message}")
    if not ok:
        print_info("  Node.js 22.19 以降を導入してください: https://nodejs.org/")
        return False
    if shutil.which(npm_command()) is None:
        print_error(f"{label}: npm が見つかりません。")
        return False

    # lockfile が依存の正。lifecycle script は Pi の方針どおり実行しない。
    if not run_command([npm_command(), "ci", "--ignore-scripts", "--no-fund", "--no-audit"], cwd=PI_DIR):
        print_error(f"{label}: npm ci に失敗しました。")
        return False

    # ソース実行に必要なモデルデータ（packages/ai/src/providers/data）を生成・更新する。
    if not run_command([npm_command(), "run", "hydrate:model-data"], cwd=PI_DIR):
        if any(MODEL_DATA_DIR.glob("*.json")):
            print_warning(f"{label}: モデルデータを更新できませんでした。既存のモデルデータで続行します。")
        else:
            print_error(f"{label}: モデルデータの生成に失敗しました（ネットワーク接続を確認してください）。")
            return False

    if not install_standalone_launcher():
        return False
    if not verify_cli():
        return False

    print_success(f"{label}: セットアップが完了しました。")
    print_info(f"  起動: {PROGRAM_NAME}（初回は Pi 内で /login を実行してプロバイダへ接続）")
    return True


def main():
    global AUTO_MODE
    print_header("Pi セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Pi のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not setup():
        print_error("Pi のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
