# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""フロントエンド(IDE) 起動スクリプト

AiDiy IDE のサーバーを空きポートで起動し、
Electron（使えない環境では Web）で開きます。全体起動ではリポジトリ直下を表示します。

公開 API:
    check_environment() -> (bool, str)
    start(open_window=None) -> subprocess.Popen
    kill_ports()
"""

from __future__ import annotations

import os
import ntpath
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from uuid import uuid4


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKCYAN = "\033[96m"
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


# ============================================================
# 設定
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
NAME = "フロントエンド(IDE)"
_processes: list[subprocess.Popen[bytes]] = []
sys.path.insert(0, str(THIS_DIR.parent.parent / "scripts"))
from _cleanup_processes import list_processes, process_arguments, stop_matching
from _runtime_requirements import check_project_node_runtime


def node_command() -> str | None:
    return shutil.which("node")


def check_node_environment() -> tuple[bool, str]:
    ok, detail = check_project_node_runtime(THIS_DIR, fallback=">=22.13", command=node_command())
    if detail.startswith("[WARN]"):
        print(detail)
    return ok, detail


def check_environment() -> tuple[bool, str]:
    ok, detail = check_node_environment()
    if not ok:
        return False, detail
    assets = (
        "monaco-editor/min/vs/loader.js", "docx-preview/dist/docx-preview.min.js",
        "xlsx/dist/xlsx.full.min.js", "pptxviewjs/dist/PptxViewJS.min.js",
        "pdfjs-dist/build/pdf.mjs", "pdfjs-dist/build/pdf.worker.mjs",
        "jszip/dist/jszip.min.js", "chart.js/dist/chart.umd.js",
    )
    if any(not (THIS_DIR / "node_modules" / asset).is_file() for asset in assets):
        return False, f'ビューアの依存関係が不足しています。python "{THIS_DIR / "_setup.py"}" を実行してください。'
    if not (THIS_DIR.parent.parent / "frontend_ide/dist/app.js").is_file():
        return False, f'Vue画面が未準備です。python "{THIS_DIR.parent / "_setup.py"}" を実行してください。'
    return True, "Vue / Node.js / Monaco / Office文書ビューア"


def start(open_window: bool | None = None, *, kind='ide') -> subprocess.Popen[bytes]:
    """空きポートで独立起動する。親の終了後もログファイルへ出力して継続する。"""
    ok, detail = check_node_environment()
    if not ok:
        raise RuntimeError(detail)
    label = f'フロントエンド({kind})' if kind != 'ide' else NAME
    node = node_command()
    if node is None:
        raise RuntimeError("Node.js が見つかりません")
    if open_window is None:
        open_window = True
    project = THIS_DIR.parent.parent
    entry = THIS_DIR / 'launch.mjs' if kind == 'ide' else THIS_DIR.parent / f'aidiy_{kind}/launch.mjs'
    command = [node, str(entry), str(project)]
    if not open_window:
        command.append("--no-open")
    print_info(f"[{label}] 作業ディレクトリ: {project}")
    print_info(f"[{label}] コマンド: {' '.join(command)}")
    # 起動ログだけを配置先リポジトリの一時領域へ置く。Electronの保存先は変えない。
    log_dir = project / 'temp' / f'aidiy_{kind}' / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{uuid4().hex}.log"
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if sys.platform == "win32" else {"start_new_session": True}
    with log_path.open("ab", buffering=0) as output:
        process = subprocess.Popen(command, cwd=str(project), stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT, **kwargs)
    _processes[:] = [item for item in _processes if item.poll() is None]
    _processes.append(process)
    print_success(f"[{label}] 独立起動しました。URL / ログ: {log_path}")
    return process


# ============================================================
# 起動元を照合して停止（ポート番号は使わない）
# ============================================================
def is_dev_process(process: dict, root: Path, windows: bool, kind='ide') -> bool:
    """この配置先の絶対パスで起動した Node / Electron だけを対象にする。"""
    if (process.get("Name") or "").lower() not in ("node", "node.exe", "electron", "electron.exe"):
        return False
    try:
        args = process_arguments(process.get("CommandLine") or "", windows)
    except ValueError:
        return False
    path = ntpath if windows else os.path
    entries = {path.normcase(path.normpath(path.join(str(root), name))) for name in ("launch.mjs", "desktop.cjs")}
    development = path.join(str(root), '..')
    if kind != 'ide':
        entries.clear()
    entries.add(path.normcase(path.normpath(path.join(development, f'aidiy_{kind}', 'launch.mjs'))))
    if len(args) > 1 and path.normcase(path.normpath(args[1])) in {path.normcase(path.normpath(path.join(development, file))) for file in ('launch.mjs', 'desktop.cjs')}:
        selected = args[args.index('--app') + 1] if '--app' in args and args.index('--app') + 1 < len(args) else 'ide'
        return selected == kind
    return len(args) > 1 and path.normcase(path.normpath(args[1])) in entries


def kill_ports(*, kind='ide') -> None:
    """全体 cleanup と共通の API 名。自分が起動したプロセスと配置先を照合する。"""
    for process in _processes:
        if process.poll() is None:
            _stop(process)
    _processes.clear()
    if not stop_matching(lambda item: is_dev_process(item, THIS_DIR, sys.platform == "win32", kind),
                         print_info, print_error, f'AiDiy {kind.upper()}'):
        raise RuntimeError("AiDiy IDE を停止できませんでした。")


def process_tree_pids(*, kind='ide') -> set[int]:
    """通常の全体停止から保護する IDE と、その子孫の PID を返す。"""
    records = list_processes()
    pids = {item["ProcessId"] for item in records if is_dev_process(item, THIS_DIR, sys.platform == "win32", kind)}
    while True:
        children = {item["ProcessId"] for item in records if item.get("ParentProcessId") in pids} - pids
        if not children:
            return pids
        pids |= children


# ============================================================
# 単体実行
# ============================================================
def _stop(process: subprocess.Popen[bytes]) -> None:
    print_info(f"[{NAME}] 停止しています")
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True, timeout=5,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    print_success(f"[{NAME}] 停止しました")


def main() -> None:
    print_header(f"{NAME} 起動")
    ok, detail = check_environment()
    if not ok:
        print_error(f"環境が準備されていません: {detail}")
        sys.exit(1)
    print_success(f"環境確認: OK ({detail})")
    start(open_window=True)
    print_info("起動スクリプトの終了後も IDE は継続します。停止処理は cleanup で行います。")


if __name__ == "__main__":
    main()
