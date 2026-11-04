# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2026 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2026
# -------------------------------------------------------------------------

"""開発環境起動スクリプト（まとめ役）

各フォルダの `_start.py` を import し、バックエンド(local/tools/core/apps/task,team)・
フロントエンド(Web/Avatar/task/team/console/code/live/IDE/Discord) を統一手順で起動します。各サービスの環境確認・
起動コマンドはフォルダ側に委譲し、このスクリプトは起動順序・出力集約・
ブラウザ表示・自動再起動監視・一括停止を一元管理します。

フォルダ別スクリプト:
- backend_diag/_start.py     check_environment / start / run_headless / kill_ports
- backend_local/_start.py    PORT_LOCAL / check_environment / start / kill_ports
- backend_tools/_start.py    PORT_TOOLS / check_environment / start / kill_ports
- backend_server/_start.py   PORT_CORE / PORT_APPS / check_environment / start_core / start_apps
- backend_taskteam/_start.py PORT_TASKTEAM / check_environment / start / kill_ports
- frontend_web/_start.py     PORT_WEB / check_environment / start / kill_ports
- frontend_avatar/_start.py  PORT_AVATAR / check_environment / start / kill_electron_processes
- frontend_ide/aidiy_task/_start.py  check_environment / start / kill_ports
- frontend_ide/aidiy_team/_start.py  check_environment / start / kill_ports
- frontend_ide/aidiy_console/_start.py  check_environment / start / kill_ports
- frontend_ide/host/_start.py  check_environment / start_code / start_live / kill_ports
- frontend_ide/viewer/_start.py     check_environment / start / kill_ports（空きポート）
- frontend_channels/_start.py check_environment / start / kill_ports（パネルから自動接続）
- frontend_channels/slack/_start.py check_environment / start / kill_ports（パネルから自動接続）

開始承認後と Ctrl+C 終了時は、setupと共通のプロセス照合で停止します。
この配置先の aidiy_code / aidiy_ide / aidiy_discord / aidiy_slack と必要な補助プロセスを保持します。
独立して起動された Live / Console 等は、Code / IDE / Discord / Slack の子でも停止対象です。
cleanupの全停止とは別の保持方針です。

標準の起動順:
0. 開始承認後に既存プロセス整理（aidiy_code / aidiy_ide を継続。サービス起動直前の再停止なし）
1. バックエンド(local)
2. バックエンド(tools)
3. バックエンド(core)
4. バックエンド(apps)
5. バックエンド(task,team)
6. フロントエンド(Web)
7. フロントエンド(Avatar)
8. フロントエンド(task・選択時)
9. フロントエンド(team・選択時)
10. フロントエンド(console)
11. フロントエンド(code)
12. フロントエンド(live、選択時に自動接続)
13. フロントエンド(IDE・選択時)
14. フロントエンド(Discord、選択時にパネルを開いて自動接続)
15. フロントエンド(Slack、選択時にパネルを開いて自動接続)
16. ページ表示
17. 自動再起動監視
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


def _configure_loopback_proxy_bypass() -> None:
    """子プロセスのローカルHTTP通信がシステムプロキシを経由しないようにする。"""
    required = ("localhost", "127.0.0.1", "::1")
    for key in ("NO_PROXY", "no_proxy"):
        current = [item.strip() for item in os.environ.get(key, "").split(",") if item.strip()]
        known = {item.lower() for item in current}
        current.extend(item for item in required if item.lower() not in known)
        os.environ[key] = ",".join(current)


_configure_loopback_proxy_bypass()


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes
    import msvcrt


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
BASE_DIR = Path(__file__).resolve().parent
STARTUP_DEFAULTS = {item['id']: item['初期設定']['起動対象'] for item in
                    json.loads((BASE_DIR / 'scripts/起動対象.json').read_text(encoding='utf-8'))}

FRONTEND_COMMAND = "npm"
QUIET_WAIT_SECONDS = 20
QUIET_MAX_WAIT_SECONDS = 60
RESTART_WAIT_SECONDS = 15
BACKEND_TOOLS_SHOW_AUTOMATION_BANNER = False
CLEANUP_STOP_REQUEST_PATH = BASE_DIR / ".cleanup_stop_request.json"
MANAGED_SERVICE_NAMES = frozenset({
    "バックエンド(local)",
    "バックエンド(tools)",
    "バックエンド(core)",
    "バックエンド(apps)",
    "バックエンド(task,team)",
    "バックエンド(Diag)",
    "フロントエンド(Web)",
    "フロントエンド(Avatar)",
    "フロントエンド(task)",
    "フロントエンド(team)",
    "フロントエンド(code)",
    "フロントエンド(live)",
    "フロントエンド(Discord)",
    "フロントエンド(Slack)",
})

# フォルダ別 _start.py モジュール（_init_modules で設定）
LOCAL = TOOLS = SERVER = TASKTEAM = WEB = AVATAR = VSCODE = DISCORD = SLACK = DEV = CONSOLE = DIAG = TASK = TEAM = None
# collect_startup_choices で設定する Slack の起動選択。
SLACK_ENABLED = False


def _load_folder_module(folder: str):
    name = f"aidiy_{folder}_start"
    path = BASE_DIR / folder / "_start.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _remove_folder_import_cache(folder: str) -> None:
    """フォルダ別 `_start.py` の import で生成された `__pycache__` を消す。

    フロントエンド(Web/Avatar)は Node.js プロジェクトだが、起動処理だけ
    Python で実行するため、この import 分だけがフォルダに残ってしまう。
    モジュールは読み込み済みのため、削除しても起動処理には影響しない。
    """
    pycache_dir = BASE_DIR / folder / "__pycache__"
    if not pycache_dir.is_dir():
        return
    try:
        shutil.rmtree(pycache_dir, ignore_errors=True)
    except Exception:
        pass


def _init_modules() -> None:
    global LOCAL, TOOLS, SERVER, TASKTEAM, WEB, AVATAR, VSCODE, DISCORD, SLACK, DEV, CONSOLE, DIAG, TASK, TEAM
    DIAG = _load_folder_module("backend_diag")
    LOCAL = _load_folder_module("backend_local")
    TOOLS = _load_folder_module("backend_tools")
    SERVER = _load_folder_module("backend_server")
    TASKTEAM = _load_folder_module("backend_taskteam")
    WEB = _load_folder_module("frontend_web")
    AVATAR = _load_folder_module("frontend_avatar")
    TASK = _load_folder_module("frontend_ide/aidiy_task")
    TEAM = _load_folder_module("frontend_ide/aidiy_team")
    CONSOLE = _load_folder_module("frontend_ide/aidiy_console")
    VSCODE = _load_folder_module("frontend_ide/host")
    DEV = _load_folder_module("frontend_ide/viewer")
    DISCORD = _load_folder_module("frontend_channels")
    SLACK = _load_folder_module("frontend_channels/slack")

    # 起動そのものには不要なので、import で残ったキャッシュは畳んでおく。
    for folder in ("backend_diag", "frontend_web", "frontend_avatar", "frontend_ide/host", "frontend_ide/viewer", "frontend_channels", "frontend_channels/slack"):
        _remove_folder_import_cache(folder)


def _pid_is_running(pid: int) -> bool:
    if pid <= 0:
        return False

    if sys.platform == "win32":
        # Windows の os.kill(pid, 0) は POSIX の存在確認とは異なり、
        # TerminateProcess(..., 0) として対象を終了させるため使用しない。
        process_query_limited_information = 0x1000
        still_active = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        open_process = kernel32.OpenProcess
        open_process.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        open_process.restype = wintypes.HANDLE
        get_exit_code_process = kernel32.GetExitCodeProcess
        get_exit_code_process.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        get_exit_code_process.restype = wintypes.BOOL
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = [wintypes.HANDLE]
        close_handle.restype = wintypes.BOOL

        handle = open_process(process_query_limited_information, False, pid)
        if not handle:
            # 権限不足なら存在しないとは断定せず、停止要求を維持する。
            return ctypes.get_last_error() == 5
        try:
            exit_code = wintypes.DWORD()
            if not get_exit_code_process(handle, ctypes.byref(exit_code)):
                return True
            return exit_code.value == still_active
        finally:
            close_handle(handle)

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def cleanup_stop_requested_services() -> set[str]:
    """稼働中の `_cleanup.py` が停止を要求したサービス名を返す。"""
    try:
        payload = json.loads(CLEANUP_STOP_REQUEST_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    except (json.JSONDecodeError, OSError):
        CLEANUP_STOP_REQUEST_PATH.unlink(missing_ok=True)
        return set()

    try:
        owner_pid = int(payload.get("owner_pid", 0))
    except (TypeError, ValueError):
        owner_pid = 0
    if not _pid_is_running(owner_pid):
        CLEANUP_STOP_REQUEST_PATH.unlink(missing_ok=True)
        return set()

    services = payload.get("services", [])
    if not isinstance(services, list):
        return set()
    return {
        service
        for service in services
        if isinstance(service, str) and service in MANAGED_SERVICE_NAMES
    }


def get_npm_command() -> str | None:
    candidates = [f"{FRONTEND_COMMAND}.cmd", FRONTEND_COMMAND] if sys.platform == "win32" else [FRONTEND_COMMAND]
    for candidate in candidates:
        try:
            subprocess.run([candidate, "--version"], stdin=subprocess.DEVNULL, capture_output=True, timeout=15, check=True)
            return candidate
        except subprocess.TimeoutExpired:
            print_warning(f"{candidate} のバージョン確認が15秒でタイムアウトしました。")
            continue
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return None


# ============================================================
# ポート整理（監視・初期整理用）
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


# ============================================================
# 出力集約 / 安定待機
# ============================================================
_OUTPUT_LOCK = threading.Lock()


def stream_output(name: str, stream, last_output_times: dict[str, float]) -> None:
    if stream is None:
        return
    pending = b""

    def write_line(line: bytes) -> None:
        # UTF-8の途中でデコードせず、サービス名は行頭に1回だけ付ける。
        text = line.decode("utf-8", errors="replace")
        with _OUTPUT_LOCK:
            sys.stdout.write(f"{Colors.OKCYAN}[{name}]{Colors.ENDC} {text}\n")
            sys.stdout.flush()

    try:
        while True:
            chunk = stream.read(1024)
            if not chunk:
                break
            last_output_times[name] = time.time()
            lines = (pending + chunk).split(b"\n")
            pending = lines.pop()
            for line in lines:
                write_line(line.rstrip(b"\r"))
        # 改行のない最終行も、他サービスのログと連結させずに表示する。
        if pending:
            write_line(pending.rstrip(b"\r"))
    except Exception:
        pass


def attach_output_thread(name: str, process: subprocess.Popen[bytes], last_output_times: dict[str, float]) -> None:
    last_output_times[name] = time.time()
    thread = threading.Thread(target=stream_output, args=(name, process.stdout, last_output_times), daemon=True)
    thread.start()


def wait_for_services_quiet(
    last_output_times: dict[str, float],
    names: list[str],
    seconds: int = QUIET_WAIT_SECONDS,
    max_wait: int = QUIET_MAX_WAIT_SECONDS,
    label: str | None = None,
) -> None:
    label_text = label or ", ".join(names)
    print_header(f"{label_text} 落ち着き待機 ({seconds}s)")
    start_time = time.time()

    while True:
        now = time.time()
        quiet = True
        for name in names:
            last_time = last_output_times.get(name, start_time)
            if now - last_time < seconds:
                quiet = False
                break

        if quiet:
            print_success(f"{label_text} は {seconds} 秒間安定しました")
            return

        if now - start_time >= max_wait:
            print_warning(f"{label_text} は安定待機を {max_wait} 秒で打ち切りました")
            return

        time.sleep(0.5)


# ============================================================
# キー入力
# ============================================================
def clear_keyboard_buffer() -> None:
    if sys.platform != "win32":
        return
    while msvcrt.kbhit():
        key = msvcrt.getch()
        if key in (b"\x00", b"\xe0") and msvcrt.kbhit():
            msvcrt.getch()


def is_r_pressed() -> bool:
    if sys.platform != "win32":
        return False
    if not msvcrt.kbhit():
        return False
    key = msvcrt.getch()
    if key in (b"\x00", b"\xe0"):
        if msvcrt.kbhit():
            msvcrt.getch()
        return False
    return key in (b"r", b"R")


def prompt_choice(question: str, default_yes: bool) -> bool:
    bracket = "[y]/n" if default_yes else "[n]/y"
    print(f"{Colors.FAIL}{question} {bracket}{Colors.ENDC}", end="  ", flush=True)

    if sys.platform == "win32":
        clear_keyboard_buffer()
        while True:
            if msvcrt.kbhit():
                key = msvcrt.getch()
                result = default_yes if key not in (b"y", b"Y", b"n", b"N") else key in (b"y", b"Y")
                print(key.decode("ascii", errors="replace"))
                return result
            time.sleep(0.05)

    v = input().strip().lower()
    if v in ("y", "n"):
        return v == "y"
    return default_yes


def collect_startup_choices() -> tuple[bool, ...]:
    print_header("起動条件の確認")
    print_info("外部チャンネル: Discord / Slack")
    print("診断")
    diag_enabled          = prompt_choice("  Diag      : 開始しますか?", default_yes=True)
    if diag_enabled:
        # 起動指示は aidiy_diag の画面で行うため、後続の入力はすべて省く。
        return (False,) * 6 + (True,) + (False,) * 7
    print("バックエンド")
    local_enabled         = prompt_choice("  local     : 起動しますか?", default_yes=STARTUP_DEFAULTS['local'])
    backend_tools_enabled = prompt_choice("  tools     : 起動しますか?", default_yes=STARTUP_DEFAULTS['tools'])
    backend_enabled       = prompt_choice("  core,apps : 起動しますか?", default_yes=STARTUP_DEFAULTS['core'])
    backend_taskteam_enabled = prompt_choice("  task,team : 起動しますか?", default_yes=STARTUP_DEFAULTS['taskteam'])
    print("フロントエンド")
    web_enabled           = prompt_choice("  Web       : 起動しますか?", default_yes=STARTUP_DEFAULTS['web'])
    avatar_enabled        = prompt_choice("  Avatar    : 起動しますか?", default_yes=STARTUP_DEFAULTS['avatar'])
    task_enabled          = prompt_choice("  aidiy_task: 起動しますか?", default_yes=False)
    team_enabled          = prompt_choice("  aidiy_team: 起動しますか?", default_yes=False)
    print("フロントエンド(IDE)")
    console_enabled         = prompt_choice("  Console      : 起動しますか?", default_yes=STARTUP_DEFAULTS['console'])
    code_enabled          = prompt_choice("  Code      : 起動しますか?", default_yes=STARTUP_DEFAULTS['code'])
    live_enabled          = prompt_choice("  Live      : 起動しますか?", default_yes=STARTUP_DEFAULTS['live'])
    dev_enabled           = prompt_choice("  IDE       : 起動しますか?", default_yes=STARTUP_DEFAULTS['ide'])
    print("フロントエンド(その他)")
    discord_enabled       = prompt_choice("  Discord   : 起動しますか?", default_yes=STARTUP_DEFAULTS['discord'])
    # 既存の選択結果の並びを変えないよう、Slack はモジュール変数で main へ渡す。
    global SLACK_ENABLED
    SLACK_ENABLED         = prompt_choice("  Slack     : 起動しますか?", default_yes=STARTUP_DEFAULTS.get('slack', False))
    return local_enabled, backend_tools_enabled, backend_enabled, backend_taskteam_enabled, web_enabled, avatar_enabled, diag_enabled, console_enabled, code_enabled, live_enabled, dev_enabled, discord_enabled, task_enabled, team_enabled


# ============================================================
# ブラウザ表示
# ============================================================
def open_browser(port: int) -> None:
    print_header("ページ表示")
    url = f"http://127.0.0.1:{port}"
    try:
        webbrowser.open(url)
        print_success(f"ブラウザを開きました: {url}")
    except Exception as exc:
        print_warning(f"ブラウザを開けませんでした: {exc}")


def _tools_post(path: str, body: dict, timeout: int = 30) -> dict:
    """backend_tools の HTTP POST インターフェースを呼ぶ (urllib のみ使用)"""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{TOOLS.PORT_TOOLS}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def open_browser_via_tools(port: int) -> bool:
    print_header("ブラウザページ表示")
    url = f"http://127.0.0.1:{port}"
    try:
        _tools_post(
            "/aidiy_chrome_devtools/new_page",
            {"url": url, "show_automation_banner": BACKEND_TOOLS_SHOW_AUTOMATION_BANNER},
            timeout=60,
        )
        print_success(f"(tools) Chrome でページを開きました: {url}")
        return True
    except Exception as exc:
        print_warning(f"(tools) HTTP POST 経由でページを開けませんでした: {exc}")
        try:
            webbrowser.open(url)
        except Exception as exc2:
            print_warning(f"ブラウザを開けませんでした: {exc2}")
        return False


# ============================================================
# プロセス停止
# ============================================================
def stop_processes(processes: dict[str, subprocess.Popen[bytes]], *, keep_standalone: bool = True) -> None:
    avatar_was_running = "フロントエンド(Avatar)" in processes
    # 通常終了では Code / IDE / Discord / Slack を継続し、明示的な cleanup 要求では停止する。
    standalone_modules = [module for module in (("live",) if keep_standalone else ("code", "live"))
                          if f"フロントエンド({module})" in processes]
    discord_was_running = not keep_standalone and "フロントエンド(Discord)" in processes
    slack_was_running = not keep_standalone and "フロントエンド(Slack)" in processes
    task_windows = [module for label, module in (("task", TASK), ("team", TEAM))
                    if f"フロントエンド({label})" in processes and module is not None]
    console_was_running = "フロントエンド(console)" in processes
    dev_was_running = not keep_standalone and "フロントエンド(IDE)" in processes
    for name, process in list(processes.items()):
        if name == "フロントエンド(Avatar)":
            # 起動通知後のランチャーPIDは終了済み。所有する8092とElectronを後段で回収する。
            processes.pop(name, None)
            continue
        if keep_standalone and name in ("フロントエンド(code)", "フロントエンド(IDE)", "フロントエンド(Discord)", "フロントエンド(Slack)"):
            print_info(f"[{name}] 全体停止の対象外として継続します")
            processes.pop(name, None)
            continue
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
                except PermissionError:
                    process.terminate()
                    time.sleep(0.5)
                    process.kill()

            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            print_success(f"[{name}] 停止しました")
        except Exception as exc:
            print_error(f"[{name}] 停止時にエラーが発生しました: {exc}")
        finally:
            processes.pop(name, None)

    # Avatar は Live と同じく全体終了時に停止し、Web（8092）も回収する。
    if avatar_was_running and AVATAR is not None:
        AVATAR.kill_ports()
    for module in task_windows:
        module.kill_ports()
    if console_was_running and CONSOLE is not None:
        CONSOLE.kill_ports()
    if VSCODE is not None:
        for module in standalone_modules:
            VSCODE.kill_ports(module)
    if dev_was_running and DEV is not None:
        DEV.kill_ports()
    if discord_was_running and DISCORD is not None:
        DISCORD.kill_ports()
    if slack_was_running and SLACK is not None:
        SLACK.kill_ports()


def stop_all_tasks(title: str = "起動中サービスの一括停止") -> bool:
    """setupと共通の照合で、この配置先のCode / IDE / Discord / Slack以外を停止する。

    cleanupの全停止とは分ける。ポート番号だけでは判定せず、呼出元と
    Code / IDE / Discord / Slackを保護した個別PID停止を使う。
    """
    print_header(title)
    try:
        sys.path.insert(0, str(BASE_DIR / "scripts"))
        from _setup_processes import stop_setup_processes
        return stop_setup_processes(BASE_DIR, print_info, print_warning)
    except Exception as exc:
        print_warning(f"一部のタスクを停止できませんでした: {exc}")
        return False


# ============================================================
# 環境確認 / サービス起動
# ============================================================
def validate_initial_environment(
    local_enabled: bool,
    backend_tools_enabled: bool,
    backend_enabled: bool,
    backend_taskteam_enabled: bool,
    web_enabled: bool,
    avatar_enabled: bool,
    discord_enabled: bool = False,
    console_enabled: bool = False,
    code_enabled: bool = False,
    live_enabled: bool = False,
    dev_enabled: bool = False,
    diag_enabled: bool = False,
    task_enabled: bool = False,
    team_enabled: bool = False,
    slack_enabled: bool = False,
) -> tuple[bool, str | None]:
    print_header("環境確認")
    has_error = False
    npm_command = get_npm_command()

    if local_enabled:
        ok, detail = LOCAL.check_environment()
        if ok:
            print_success(f"バックエンド(local): OK ({detail})")
        else:
            print_error(f"バックエンド(local): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "backend_local" / "_setup.py"}"')
            has_error = True

    if backend_tools_enabled:
        ok, detail = TOOLS.check_environment()
        if ok:
            print_success(f"バックエンド(tools): OK ({detail})")
        else:
            print_error(f"バックエンド(tools): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "backend_tools" / "_setup.py"}"')
            has_error = True

    if backend_enabled:
        ok, detail = SERVER.check_environment()
        if ok:
            print_success(f"バックエンド(core,apps): OK ({detail})")
        else:
            print_error(f"バックエンド(core,apps): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "backend_server" / "_setup.py"}"')
            has_error = True

    if backend_taskteam_enabled:
        ok, detail = TASKTEAM.check_environment()
        if ok:
            print_success(f"バックエンド(task,team): OK ({detail})")
        else:
            print_error(f"バックエンド(task,team): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "backend_taskteam" / "_setup.py"}"')
            has_error = True

    if web_enabled or avatar_enabled:
        if npm_command is None:
            print_error("npm を確認できません (未導入・実行失敗・15秒のタイムアウトを確認してください)")
            has_error = True
        else:
            print_success(f"npm: OK ({npm_command})")

    if web_enabled:
        ok, detail = WEB.check_environment()
        if ok:
            print_success(f"フロントエンド(Web): OK ({detail})")
        else:
            print_error(f"フロントエンド(Web): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "frontend_web" / "_setup.py"}"')
            has_error = True

    if avatar_enabled:
        ok, detail = AVATAR.check_environment()
        if ok:
            print_success(f"フロントエンド(Avatar): OK ({detail})")
        else:
            print_error(f"フロントエンド(Avatar): 未準備 ({detail})")
            print_info(f'  対応例: python "{BASE_DIR / "frontend_avatar" / "_setup.py"}"')
            has_error = True

    for label, module, enabled in (("task", TASK, task_enabled), ("team", TEAM, team_enabled)):
        if enabled:
            ok, detail = module.check_environment()
            if ok:
                print_success(f"フロントエンド({label}): OK ({detail})")
            else:
                print_error(f"フロントエンド({label}): 未準備 ({detail})")
                has_error = True

    if diag_enabled:
        print_header("バックエンド(Diag)")
        ok, detail = DIAG.check_environment()
        if ok:
            print_success(f"バックエンド(Diag): OK ({detail})")
        else:
            print_error(f"バックエンド(Diag): 未準備 ({detail})")
            has_error = True
    if console_enabled or code_enabled or live_enabled or dev_enabled:
        print_header("IDE群(Console / Code / Live / IDE)")
    if console_enabled:
        ok, detail = CONSOLE.check_environment()
        if ok:
            print_success(f'フロントエンド(console): OK ({detail})')
        else:
            print_error(f'フロントエンド(console): 未準備 ({detail})')
            has_error = True
    for module, enabled in (("code", code_enabled), ("live", live_enabled)):
        if enabled:
            ok, detail = VSCODE.check_environment(module)
            if ok:
                print_success(f"フロントエンド({module}): OK ({detail})")
            else:
                print_error(f"フロントエンド({module}): 未準備 ({detail})")
                has_error = True

    if dev_enabled:
        ok, detail = DEV.check_environment()
        if ok:
            print_success(f"フロントエンド(IDE): OK ({detail})")
        else:
            print_error(f"フロントエンド(IDE): 未準備 ({detail})")
            has_error = True
    if discord_enabled:
        ok, detail = DISCORD.check_environment()
        if ok:
            print_success(f"フロントエンド(Discord): OK ({detail})")
        else:
            print_error(f"フロントエンド(Discord): 未準備 ({detail})")
            has_error = True
    if slack_enabled:
        ok, detail = SLACK.check_environment()
        if ok:
            print_success(f"フロントエンド(Slack): OK ({detail})")
        else:
            print_error(f"フロントエンド(Slack): 未準備 ({detail})")
            has_error = True

    return (not has_error), npm_command


def ensure_optional_service_ready(name: str, npm_command: str | None) -> bool:
    if npm_command is None:
        print_warning(f"{name}: npm を確認できないため起動をスキップします")
        print_info("  Node.js / npm の導入状態と、直前のタイムアウト表示を確認してください")
        return False
    ok, detail = AVATAR.check_environment()
    if ok:
        print_success(f"{name}: OK ({detail})")
        return True
    print_warning(f"{name}: 未準備のため起動をスキップします ({detail})")
    print_info(f'  対応例: python "{BASE_DIR / "frontend_avatar" / "_setup.py"}"')
    return False


def _port_for(name: str) -> int | None:
    return {
        "バックエンド(local)": LOCAL.PORT_LOCAL,
        "バックエンド(tools)": TOOLS.PORT_TOOLS,
        "バックエンド(core)": SERVER.PORT_CORE,
        "バックエンド(apps)": SERVER.PORT_APPS,
        "バックエンド(task,team)": TASKTEAM.PORT_TASKTEAM,
        "フロントエンド(Web)": WEB.PORT_WEB,
        "フロントエンド(Avatar)": AVATAR.PORT_AVATAR,
    }.get(name)


def start_service(
    name: str,
    processes: dict[str, subprocess.Popen[bytes]],
    last_output_times: dict[str, float],
    npm_command: str | None,
) -> bool:
    if name in cleanup_stop_requested_services():
        print_warning(f"[{name}] クリーンアップ対象のため起動をスキップします")
        return False

    if name == "バックエンド(tools)":
        print_header("バックエンド(Diag) [y] aidiy_diag --headless")
        try:
            DIAG.run_headless()
        except (OSError, RuntimeError) as exc:
            print_error(str(exc))
            sys.exit(1)

    try:
        if name == "バックエンド(tools)":
            print_header("バックエンド(tools) 起動")
            process = TOOLS.start()
        elif name == "バックエンド(local)":
            process = LOCAL.start()
        elif name == "バックエンド(task,team)":
            process = TASKTEAM.start()
        elif name == "バックエンド(core)":
            process = SERVER.start_core()
        elif name == "バックエンド(apps)":
            process = SERVER.start_apps()
        elif name == "フロントエンド(Web)":
            if npm_command is None:
                print_error("フロントエンド(Web): npm を確認できません (未導入・実行失敗・タイムアウト)")
                return False
            process = WEB.start(npm_command)
        elif name == "フロントエンド(Avatar)":
            if npm_command is None:
                print_error("フロントエンド(Avatar): npm を確認できません (未導入・実行失敗・タイムアウト)")
                return False
            process = AVATAR.start(npm_command)
        elif name == "バックエンド(Diag)":
            process = DIAG.start()
        elif name == "フロントエンド(task)":
            process = TASK.start()
        elif name == "フロントエンド(team)":
            process = TEAM.start()
        elif name == "フロントエンド(console)":
            process = CONSOLE.start()
        elif name == "フロントエンド(code)":
            process = VSCODE.start_code()
        elif name == "フロントエンド(live)":
            process = VSCODE.start_live(auto_connect=True)
        elif name == "フロントエンド(Discord)":
            process = DISCORD.start(auto_connect=True)
        elif name == "フロントエンド(Slack)":
            process = SLACK.start(auto_connect=True)
        elif name == "フロントエンド(IDE)":
            # 全体終了後も継続する独立プロセスとして起動する。
            process = DEV.start()
        else:
            print_error(f"未対応のサービスです: {name}")
            return False
    except Exception as exc:
        print_error(f"[{name}] 起動に失敗しました: {exc}")
        return False

    processes[name] = process
    attach_output_thread(name, process, last_output_times)
    return True


def start_initial_services(
    start_backend_local_enabled: bool,
    start_backend_tools_enabled: bool,
    start_backend_enabled: bool,
    start_backend_taskteam_enabled: bool,
    avatar_enabled: bool,
    web_enabled: bool,
    processes: dict[str, subprocess.Popen[bytes]],
    last_output_times: dict[str, float],
    npm_command: str | None,
    discord_enabled: bool = False,
    console_enabled: bool = False,
    code_enabled: bool = False,
    live_enabled: bool = False,
    dev_enabled: bool = False,
    diag_enabled: bool = False,
    task_enabled: bool = False,
    team_enabled: bool = False,
    slack_enabled: bool = False,
) -> dict[str, bool]:
    selected_flags = {
        "バックエンド(local)": start_backend_local_enabled,
        "バックエンド(tools)": start_backend_tools_enabled,
        "バックエンド(core)": start_backend_enabled,
        "バックエンド(apps)": start_backend_enabled,
        "バックエンド(task,team)": start_backend_taskteam_enabled,
        "フロントエンド(Web)": web_enabled,
        "フロントエンド(Avatar)": False,
        # 手動で閉じた単独ウィンドウ・パネルは自動で開き直さない。
        "フロントエンド(task)": False,
        "フロントエンド(team)": False,
        "バックエンド(Diag)": False,
        "フロントエンド(console)": False,
        "フロントエンド(code)": False,
        "フロントエンド(live)": False,
        "フロントエンド(IDE)": False,
        "フロントエンド(Discord)": False,
        "フロントエンド(Slack)": False,
    }

    if start_backend_local_enabled:
        print_header("バックエンド(local) 起動")
        start_service("バックエンド(local)", processes, last_output_times, npm_command)
        wait_for_services_quiet(last_output_times, ["バックエンド(local)"], label="バックエンド(local)")

    if start_backend_tools_enabled:
        start_service("バックエンド(tools)", processes, last_output_times, npm_command)
        wait_for_services_quiet(last_output_times, ["バックエンド(tools)"], label="バックエンド(tools)")

    if start_backend_enabled:
        print_header("バックエンド(core) 起動")
        start_service("バックエンド(core)", processes, last_output_times, npm_command)
        wait_for_services_quiet(last_output_times, ["バックエンド(core)"], label="バックエンド(core)")

        print_header("バックエンド(apps) 起動")
        start_service("バックエンド(apps)", processes, last_output_times, npm_command)
        wait_for_services_quiet(last_output_times, ["バックエンド(apps)"], label="バックエンド(apps)")

    if start_backend_taskteam_enabled:
        print_header("バックエンド(task,team) 起動")
        start_service("バックエンド(task,team)", processes, last_output_times, npm_command)
        wait_for_services_quiet(
            last_output_times,
            ["バックエンド(task,team)"],
            label="バックエンド(task,team)",
        )

    if web_enabled:
        print_header("フロントエンド(Web) 起動")
        if start_service("フロントエンド(Web)", processes, last_output_times, npm_command):
            wait_for_services_quiet(last_output_times, ["フロントエンド(Web)"], label="フロントエンド(Web)")

    if avatar_enabled and ensure_optional_service_ready("フロントエンド(Avatar)", npm_command):
        # 表示後すぐ戻り、終了検知・自動再起動の対象にしない。全体終了時は停止する。
        print_header("フロントエンド(Avatar) 起動")
        start_service("フロントエンド(Avatar)", processes, last_output_times, npm_command)
        wait_for_services_quiet(last_output_times, ["フロントエンド(Avatar)"], label="フロントエンド(Avatar)")

    for label, enabled in (("task", task_enabled), ("team", team_enabled)):
        if enabled:
            name = f"フロントエンド({label})"
            print_header(f"{name} 起動")
            if start_service(name, processes, last_output_times, npm_command):
                wait_for_services_quiet(last_output_times, [name], label=name)

    if diag_enabled:
        print_header("バックエンド(Diag) 起動")
        if start_service("バックエンド(Diag)", processes, last_output_times, npm_command):
            wait_for_services_quiet(last_output_times, ["バックエンド(Diag)"], label="バックエンド(Diag)")

    if console_enabled or code_enabled or live_enabled or dev_enabled:
        print_header("IDE群(Console / Code / Live / IDE)")
    for module, enabled in (("console", console_enabled), ("code", code_enabled), ("live", live_enabled)):
        if enabled:
            name = f"フロントエンド({module})"
            print_header(f"{name} 起動" + ("・自動接続" if module == "live" else ""))
            if start_service(name, processes, last_output_times, npm_command):
                wait_for_services_quiet(last_output_times, [name], label=name)

    if dev_enabled:
        print_header("フロントエンド(IDE) 起動")
        if start_service("フロントエンド(IDE)", processes, last_output_times, npm_command):
            wait_for_services_quiet(last_output_times, ["フロントエンド(IDE)"], label="フロントエンド(IDE)")

    if discord_enabled:
        print_header("フロントエンド(Discord) パネル起動・自動接続")
        if start_service("フロントエンド(Discord)", processes, last_output_times, npm_command):
            wait_for_services_quiet(last_output_times, ["フロントエンド(Discord)"], label="フロントエンド(Discord)")

    if slack_enabled:
        print_header("フロントエンド(Slack) パネル起動・自動接続")
        if start_service("フロントエンド(Slack)", processes, last_output_times, npm_command):
            wait_for_services_quiet(last_output_times, ["フロントエンド(Slack)"], label="フロントエンド(Slack)")

    if web_enabled and "フロントエンド(Web)" in processes:
        if not (start_backend_tools_enabled and "バックエンド(tools)" in processes and open_browser_via_tools(WEB.PORT_WEB)):
            open_browser(WEB.PORT_WEB)

    if avatar_enabled and "フロントエンド(Avatar)" in processes:
        if not (start_backend_tools_enabled and "バックエンド(tools)" in processes and open_browser_via_tools(AVATAR.PORT_AVATAR)):
            open_browser(AVATAR.PORT_AVATAR)

    return selected_flags


def suspend_services_for_cleanup(
    selected_services: dict[str, bool],
    processes: dict[str, subprocess.Popen[bytes]],
    process_crash_time: dict[str, float],
) -> set[str]:
    """クリーンアップ対象を自動再起動から外し、監視中なら停止する。"""
    requested_services = cleanup_stop_requested_services()
    for name in list(selected_services):
        if name not in requested_services:
            continue
        was_selected = selected_services.get(name, False)
        process = processes.pop(name, None)
        if not was_selected and process is None:
            continue

        selected_services[name] = False
        process_crash_time.pop(name, None)
        print_warning(f"[{name}] クリーンアップ対象のため自動再起動を停止します")
        if process is not None:
            stop_processes({name: process}, keep_standalone=False)

    return requested_services


def monitor_and_restart(
    selected_services: dict[str, bool],
    processes: dict[str, subprocess.Popen[bytes]],
    last_output_times: dict[str, float],
    npm_command: str | None,
) -> None:
    print_header("自動再起動監視")
    print_info(f"監視対象: {', '.join(name for name, enabled in selected_services.items() if enabled) or 'なし'}")
    print_info(f"停止検出時は {RESTART_WAIT_SECONDS} 秒後に自動再起動します")
    print_info("Ctrl+C で停止します")

    process_crash_time: dict[str, float] = {}

    while True:
        current_time = time.time()
        suspend_services_for_cleanup(selected_services, processes, process_crash_time)

        for name in list(processes.keys()):
            process = processes[name]
            if process.poll() is not None:
                print_warning(f"{name} が終了しました (終了コード: {process.returncode})")
                processes.pop(name, None)
                process_crash_time.setdefault(name, current_time)

        for name, enabled in selected_services.items():
            if not enabled or name in processes:
                continue

            crash_time = process_crash_time.get(name)
            if crash_time is None:
                process_crash_time[name] = current_time
                print_info(f"[{name}] {RESTART_WAIT_SECONDS} 秒後に再起動します")
                continue

            if current_time - crash_time < RESTART_WAIT_SECONDS:
                continue

            print_info(f"[{name}] 再起動を試みます")
            port = _port_for(name)
            if port is not None:
                kill_process_on_port(port)
                time.sleep(1)

            if start_service(name, processes, last_output_times, npm_command):
                print_success(f"[{name}] 再起動しました")
                process_crash_time.pop(name, None)
            else:
                print_error(f"[{name}] 再起動に失敗しました。{RESTART_WAIT_SECONDS} 秒後に再試行します")
                process_crash_time[name] = current_time

        time.sleep(1)


def launch_diag_gui() -> None:
    """aidiy_diag --auto の画面を開いて終了する。設定起動とその後の操作は画面側で行う。"""
    print_header("バックエンド(Diag) 起動")
    ok, detail = DIAG.check_environment()
    if not ok:
        print_error(f"バックエンド(Diag): 未準備 ({detail})")
        print_info(f'必要に応じて次を実行してください: python "{BASE_DIR / "_setup.py"}"')
        sys.exit(1)
    try:
        DIAG.launch_gui()
    except (OSError, RuntimeError) as exc:
        print_error(str(exc))
        sys.exit(1)
    print_success("バックエンド(Diag): aidiy_diag --auto を起動しました")
    print_info("保存済みの起動設定で設定起動します。進捗は aidiy_diag のシステム起動タブで確認してください")
    print_info("5秒後に終了します")
    time.sleep(5)


def main() -> None:
    _init_modules()

    (
        local_enabled,
        backend_tools_enabled,
        backend_enabled,
        backend_taskteam_enabled,
        web_enabled,
        avatar_enabled,
        diag_enabled,
        console_enabled,
        code_enabled,
        live_enabled,
        dev_enabled,
        discord_enabled,
        task_enabled,
        team_enabled,
    ) = collect_startup_choices()
    slack_enabled = SLACK_ENABLED and not diag_enabled

    # 開始承認後に一度だけ停止する。各サービスの起動直前には重ねて停止しない。
    if stop_all_tasks("AiDiy プロセスの停止（Code / IDE / Discord / Slack は継続）") is False:
        print_error("既存プロセスを停止できないため、起動を中止します。")
        raise SystemExit(1)

    if diag_enabled:
        launch_diag_gui()
        return

    is_ready, npm_command = validate_initial_environment(
        local_enabled=local_enabled,
        backend_tools_enabled=backend_tools_enabled,
        backend_enabled=backend_enabled,
        backend_taskteam_enabled=backend_taskteam_enabled,
        web_enabled=web_enabled,
        avatar_enabled=avatar_enabled,
        task_enabled=task_enabled,
        team_enabled=team_enabled,
        discord_enabled=discord_enabled,
        slack_enabled=slack_enabled,
        diag_enabled=diag_enabled,
        console_enabled=console_enabled,
        code_enabled=code_enabled,
        live_enabled=live_enabled,
        dev_enabled=dev_enabled,
    )
    if not is_ready:
        print()
        print_error("必要な環境が準備されていないため、起動を中止します")
        print_info(f'必要に応じて次を実行してください: python "{BASE_DIR / "_setup.py"}"')
        sys.exit(1)

    while True:
        print_header("開発環境起動")
        processes: dict[str, subprocess.Popen[bytes]] = {}
        last_output_times: dict[str, float] = {}
        reboot_requested = False
        shutdown_verified = None

        try:
            selected_services = start_initial_services(
                start_backend_local_enabled=local_enabled,
                start_backend_tools_enabled=backend_tools_enabled,
                start_backend_enabled=backend_enabled,
                start_backend_taskteam_enabled=backend_taskteam_enabled,
                avatar_enabled=avatar_enabled,
                task_enabled=task_enabled,
                team_enabled=team_enabled,
                web_enabled=web_enabled,
                processes=processes,
                last_output_times=last_output_times,
                npm_command=npm_command,
                discord_enabled=discord_enabled,
                slack_enabled=slack_enabled,
                diag_enabled=diag_enabled,
                console_enabled=console_enabled,
                code_enabled=code_enabled,
                live_enabled=live_enabled,
                dev_enabled=dev_enabled,
            )

            print_header("起動完了")
            if "バックエンド(local)" in processes:
                print_success(f"バックエンド(local): http://127.0.0.1:{LOCAL.PORT_LOCAL}/docs")
                print_info   (f"  OpenAI互換 (利用時にモデルロード): http://127.0.0.1:{LOCAL.PORT_LOCAL}/v1/chat/completions")
            if "バックエンド(tools)" in processes:
                print_success(f"バックエンド(tools) Swagger UI : http://127.0.0.1:{TOOLS.PORT_TOOLS}/docs")
                print_info   (f"  ツール一覧(例)            : http://127.0.0.1:{TOOLS.PORT_TOOLS}/aidiy_text_to_speech/list")
                print_info   (f"  利用可能 ツール 一覧      : http://127.0.0.1:{TOOLS.PORT_TOOLS}/")
            if "バックエンド(core)" in processes:
                print_success(f"バックエンド(core): http://127.0.0.1:{SERVER.PORT_CORE}/docs")
            if "バックエンド(apps)" in processes:
                print_success(f"バックエンド(apps): http://127.0.0.1:{SERVER.PORT_APPS}/docs")
            if "バックエンド(task,team)" in processes:
                print_success(f"バックエンド(task,team): http://127.0.0.1:{TASKTEAM.PORT_TASKTEAM}/docs")
            if "フロントエンド(Web)" in processes:
                print_success(f"フロントエンド(Web): http://127.0.0.1:{WEB.PORT_WEB}/")
            if "フロントエンド(Avatar)" in processes:
                print_success(f"フロントエンド(Avatar): renderer http://127.0.0.1:{AVATAR.PORT_AVATAR}")
            if "バックエンド(Diag)" in processes:
                print_success("バックエンド(Diag): aidiy_diag 起動済み")
            for module in ("console", "code", "live"):
                if f"フロントエンド({module})" in processes:
                    print_success(f"フロントエンド({module}): aidiy_{module} 起動済み")
            if "フロントエンド(IDE)" in processes:
                print_success("フロントエンド(IDE): 空きポートで起動済み（URL は起動ログを参照）")
            if "フロントエンド(Discord)" in processes:
                print_success("フロントエンド(Discord): パネル起動済み（接続状態はパネルで確認してください）")
            if "フロントエンド(Slack)" in processes:
                print_success("フロントエンド(Slack): パネル起動済み（接続状態はパネルで確認してください）")
            monitor_and_restart(selected_services, processes, last_output_times, npm_command)

        except KeyboardInterrupt:
            print_header("停止処理")
            print_info("Ctrl+C を検出しました。Code / IDE / Discord / Slack を継続し、この配置先の他の AiDiy プロセスを停止します")
            stop_processes(processes)
            print_info("Code / IDE / Discord / Slack と必要な補助プロセスを保持し、残る停止対象を確認します")
            shutdown_verified = stop_all_tasks("終了時の既存プロセス整理（Code / IDE / Discord / Slack は継続）")

            if sys.platform == "win32":
                clear_keyboard_buffer()
                print("\n\n")
                print(f"{Colors.FAIL}R を押すとリブートします (10秒以内){Colors.ENDC}")
                deadline = time.time() + 10
                while time.time() < deadline:
                    if is_r_pressed():
                        reboot_requested = True
                        print_info("リブートを開始します")
                        break
                    time.sleep(0.05)

        finally:
            stop_processes(processes)

        if reboot_requested:
            if sys.platform == "win32":
                os.system("cls")
            continue

        if shutdown_verified is True:
            print_header("停止完了")
            print_success("この配置先の停止対象を確認しました（Code / IDE / Discord / Slack と必要な補助プロセスは継続）")
        elif shutdown_verified is False:
            print_header("停止確認未完了")
            print_warning("停止できなかったプロセス、または確認できない対象があります。上記の警告を確認してください")
        else:
            print_header("終了処理完了")
            print_info("起動プロセスの終了処理を行いました。全体の停止確認は実施していません")
        print_info("5秒後に終了します")
        time.sleep(5)
        break


if __name__ == "__main__":
    sys.path.insert(0, str(BASE_DIR / "scripts"))
    from _setup_processes import register_start_owner
    with register_start_owner(BASE_DIR):
        main()
