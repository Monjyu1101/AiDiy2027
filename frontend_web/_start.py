# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""フロントエンド(Web) 起動スクリプト

Vite 開発サーバー (ポート 8090) を起動します。

公開 API:
    PORT_WEB
    get_npm_command() -> str | None
    check_environment() -> (bool, str)
    start(npm_command) -> subprocess.Popen
    kill_ports()
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


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
FRONTEND_WEB_DIR = THIS_DIR
PORT_WEB = 8090
FRONTEND_COMMAND = "npm"
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import check_project_node_runtime


def get_npm_command() -> str | None:
    candidates = [f"{FRONTEND_COMMAND}.cmd", FRONTEND_COMMAND] if sys.platform == "win32" else [FRONTEND_COMMAND]
    for candidate in candidates:
        try:
            # Diag の停止要求用パイプを npm の確認処理へ継承させない。
            subprocess.run([candidate, "--version"], stdin=subprocess.DEVNULL, capture_output=True, timeout=15, check=True)
            return candidate
        except subprocess.TimeoutExpired:
            print_warning(f"{candidate} のバージョン確認が15秒でタイムアウトしました。")
            continue
        except (subprocess.CalledProcessError, OSError):
            continue
    return None


def check_npm_project_environment(project_dir: Path) -> tuple[bool, str]:
    package_json = project_dir / "package.json"
    if not project_dir.exists():
        return False, f"フォルダが見つかりません: {project_dir}"
    if not package_json.exists():
        return False, f"package.json が見つかりません: {package_json}"
    node_modules = project_dir / "node_modules"
    if not node_modules.exists() or not node_modules.is_dir():
        return False, f"node_modules が見つかりません: {node_modules}"
    try:
        if not any(node_modules.iterdir()):
            return False, f"node_modules が空です: {node_modules}"
    except Exception as exc:
        return False, f"node_modules の確認でエラー: {exc}"
    for package in ("vue", "vite"):
        if not (node_modules / package / "package.json").is_file():
            return False, f'{package} が未準備です。python "{FRONTEND_WEB_DIR / "_setup.py"}" を実行してください。'
    return True, str(node_modules)


def check_environment() -> tuple[bool, str]:
    ok, detail = check_project_node_runtime(FRONTEND_WEB_DIR, dependency="vite", fallback="^20.19.0 || >=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        return False, detail
    if get_npm_command() is None:
        return False, "npm を確認できません (未導入・実行失敗・15秒のタイムアウトを確認してください)"
    return check_npm_project_environment(FRONTEND_WEB_DIR)


def launch_process(name: str, command: list[str], cwd: Path) -> subprocess.Popen[bytes]:
    print_info(f"[{name}] 作業ディレクトリ: {cwd}")
    print_info(f"[{name}] コマンド: {' '.join(command)}")
    if sys.platform == "win32":
        process = subprocess.Popen(
            command, cwd=str(cwd), stdout=subprocess.PIPE, stdin=(subprocess.DEVNULL if os.environ.get("AIDIY_DIAG_CONSOLE") == "1" else None), stderr=subprocess.STDOUT,
            bufsize=0, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    else:
        process = subprocess.Popen(
            command, cwd=str(cwd), stdout=subprocess.PIPE, stdin=(subprocess.DEVNULL if os.environ.get("AIDIY_DIAG_CONSOLE") == "1" else None), stderr=subprocess.STDOUT,
            bufsize=0, preexec_fn=os.setpgrp,
        )
    print_success(f"[{name}] 起動しました")
    return process


def start(npm_command: str | None = None) -> subprocess.Popen[bytes]:
    npm_command = npm_command or get_npm_command()
    if npm_command is None:
        raise RuntimeError("npm を確認できません (未導入・実行失敗・15秒のタイムアウトを確認してください)")
    return launch_process(
        "フロントエンド(Web)",
        [npm_command, "run", "dev", "--", "--port", str(PORT_WEB)],
        FRONTEND_WEB_DIR,
    )


# ============================================================
# ポート整理
# ============================================================
def _listening_pids_windows(port: int) -> list[str]:
    result = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, encoding="oem", errors="replace", timeout=5)
    if result.returncode != 0:
        return []
    pids = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        local_address = parts[1]
        state = parts[3].upper()
        pid = parts[-1]
        local_port = local_address.rsplit(":", 1)[-1]
        if local_port != str(port):
            continue
        if state not in ("LISTENING", "待ち受け"):
            continue
        if pid.isdigit() and pid != "0":
            pids.add(pid)
    return sorted(pids, key=int)


def _listening_pids_linux(port: int) -> list[str]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode in (0, 1):
            pids = {pid.strip() for pid in result.stdout.splitlines() if pid.strip().isdigit()}
            return sorted(pids, key=int)
    except FileNotFoundError:
        pass
    try:
        result = subprocess.run(
            ["ss", "-ltnp", f"sport = :{port}"], capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
        pids = set(re.findall(r"pid=(\d+)", result.stdout))
        return sorted(pids, key=int)
    except FileNotFoundError:
        return []


def kill_process_on_port(port: int) -> bool:
    print_info(f"[ポート {port}] 使用中プロセスを確認します")
    try:
        if sys.platform == "win32":
            finder = _listening_pids_windows
            killer = lambda pid: subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True, encoding="oem", errors="replace", timeout=8)
        else:
            finder = _listening_pids_linux
            killer = lambda pid: subprocess.run(["kill", "-9", pid], capture_output=True, text=True, timeout=5)

        killed = False
        for _ in range(8):
            pids = finder(port)
            if not pids:
                if killed:
                    print_success(f"[ポート {port}] ポート解放を確認しました")
                else:
                    print_info(f"[ポート {port}] 使用中プロセスはありません")
                return killed
            for pid in pids:
                print_info(f"[ポート {port}] PID={pid} を停止します")
                result = killer(pid)
                if result.returncode == 0:
                    print_success(f"[ポート {port}] PID={pid} を停止しました")
                    killed = True
                else:
                    detail = (result.stderr or result.stdout or "").strip()
                    print_warning(f"[ポート {port}] PID={pid} の停止に失敗しました: {detail}")
            time.sleep(0.5)

        remaining = finder(port)
        if remaining:
            print_error(f"[ポート {port}] 停止後も使用中です: PID={','.join(remaining)}")
        return killed
    except Exception as exc:
        print_error(f"[ポート {port}] 確認時にエラーが発生しました: {exc}")
        return False


def kill_ports() -> None:
    kill_process_on_port(PORT_WEB)


# ============================================================
# 単体実行用の簡易監視
# ============================================================
def _stream_output(name: str, stream) -> None:
    if stream is None:
        return
    try:
        while True:
            chunk = stream.read(1024)
            if not chunk:
                break
            text = chunk.decode("utf-8", errors="replace")
            for line in text.splitlines(keepends=True):
                sys.stdout.write(f"{Colors.OKCYAN}[{name}]{Colors.ENDC} {line}")
            sys.stdout.flush()
    except Exception:
        pass


def _stop(process: subprocess.Popen[bytes], name: str) -> None:
    try:
        print_info(f"[{name}] 停止しています")
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True, timeout=5)
        else:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                time.sleep(0.5)
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        print_success(f"[{name}] 停止しました")
    except Exception as exc:
        print_error(f"[{name}] 停止時にエラーが発生しました: {exc}")


def main() -> None:
    name = "フロントエンド(Web)"
    print_header(f"{name} 起動")
    ok, detail = check_environment()
    if not ok:
        print_error(f"環境が準備されていません: {detail}")
        print_info(f'  対応例: python "{FRONTEND_WEB_DIR / "_setup.py"}"')
        sys.exit(1)
    print_success("環境確認: OK")

    kill_ports()
    time.sleep(1)

    process = start()
    threading.Thread(target=_stream_output, args=(name, process.stdout), daemon=True).start()
    print_success(f"{name}: http://127.0.0.1:{PORT_WEB}/")
    print_info("Ctrl+C で停止します")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print_header("停止処理")
        _stop(process, name)
        print_success("停止しました")


if __name__ == "__main__":
    if '--diag-start' in sys.argv:
        import runpy
        runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / '_diag_start.py'),
                       init_globals={'START_MODULE': sys.modules[__name__]}, run_name='__main__')
    else:
        main()
