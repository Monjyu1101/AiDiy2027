# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2026 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2026
# -------------------------------------------------------------------------

"""プロジェクト セットアップスクリプト（まとめ役）

各フォルダの `_setup.py` を import し、プロジェクト全体の初期セットアップを
対話的に一括実行します。共通（グローバル）のセットアップ（Python ツール更新・
AI CLI ツール導入）のみこのスクリプトが直接担当し、フォルダ固有の処理は
各フォルダの `_setup.py` に委譲します。

フォルダ別スクリプト:
- backend_diag/_setup.py     環境診断（Node.js / Electron / Vue 3）
- backend_server/_setup.py   バックエンド(core,apps)
- backend_taskteam/_setup.py バックエンド(task,team)
- backend_tools/_setup.py    バックエンド(tools) + MCP 設定
- backend_local/_setup.py    バックエンド(local)
- frontend_web/_setup.py     フロントエンド(Web)
- frontend_avatar/_setup.py  フロントエンド(Avatar)
- command_hermes/_setup.py   コマンド(hermes)
- frontend_ide/_setup.py     IDE群(Navigator / Console / Code / Live / IDE / Task / Team)
- frontend_channels/_setup.py フロントエンド(Discord、任意)
- frontend_channels/slack/_setup.py フロントエンド(Slack、任意)

Usage:
    python _setup.py
"""

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt

# ============================================================
# プロジェクト設定
# ============================================================
BASE_DIR = Path(__file__).resolve().parent
from scripts._runtime_requirements import project_node_requirement, version_satisfies

FRONTEND_COMMAND = "npm"
DATABASE_TYPE = "sqlite"
PORT_CORE = 8091
PORT_APPS = 8098
PORT_TASKTEAM = 8093
PORT_TOOLS = 8095
PORT_LOCAL = 8096

AUTO_MODE = False
GLOBAL_CLI_INSTALL_PROCESSES = []
HERMES_AGENT_INSTALL_COMMAND = (
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
)
OLLAMA_INSTALL_COMMAND = "curl -fsSL https://ollama.com/install.sh | sh"
GIT_INSTALL_COMMAND_WINDOWS = ["winget", "install", "--id", "Git.Git", "-e", "--source", "winget"]
NODE_INSTALL_COMMAND_WINDOWS = ["winget", "install", "--id", "OpenJS.NodeJS.LTS", "-e", "--source", "winget"]
GIT_DOWNLOAD_URL = "https://git-scm.com/downloads"
NODE_DOWNLOAD_URL = "https://nodejs.org/"
ANTIGRAVITY_INSTALL_COMMAND_WINDOWS = (
    "curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd"
)
ANTIGRAVITY_INSTALL_COMMAND_UNIX = "curl -fsSL https://antigravity.google/cli/install.sh | bash"
GROK_BUILD_INSTALL_COMMAND_WINDOWS = (
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"irm https://x.ai/cli/install.ps1 | iex\""
)
GROK_BUILD_INSTALL_COMMAND_UNIX = "curl -fsSL https://x.ai/cli/install.sh | bash"


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


def print_setup_summary(error_locations: list[str], copy_warnings=None) -> None:
    print()
    print_header("セットアップ完了")
    if error_locations:
        print_warning("セットアップ処理は完了しましたが、一部でエラーが発生しました。")
        print_warning("エラー発生場所:")
        for location in error_locations:
            print_warning(f"  - {location}")
    elif not copy_warnings:
        print_success("セットアップ処理が完了しました。")
    if copy_warnings:
        print_warning("Electron の配置に警告があります。使用可能とは確認できていません。")
        for message in copy_warnings:
            print_warning(message)


# ============================================================
# フォルダ別 _setup.py のローダー
# ============================================================
def _load_folder_module(folder: str, entry: str = "_setup.py"):
    name = f"aidiy_{folder}_{Path(entry).stem.lstrip('_')}"
    path = BASE_DIR / folder / entry
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def stop_setup_apps() -> None:
    """Code / IDE / Discord / Slack以外の、この作業コピーのAiDiy実行を依存物更新前に停止する。"""
    print_header("AiDiy プロセスの停止（Code / IDE / Discord / Slack は継続）")
    sys.path.insert(0, str(BASE_DIR / "scripts"))
    from _setup_processes import stop_setup_processes
    if not stop_setup_processes(BASE_DIR, print_info, print_error):
        print_error("既存プロセスの停止を確認できないため、セットアップを中止します。")
        raise SystemExit(1)


def run_diag_headless() -> bool:
    """`aidiy_diag --headless` を実行する。処理本体は全体起動と共通の `_start.py` を使う。"""
    print_header("Diag: aidiy_diag --headless")
    path = BASE_DIR / "backend_diag" / "_start.py"
    spec = importlib.util.spec_from_file_location("aidiy_backend_diag_start", path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        mod.run_headless()
    except (OSError, RuntimeError) as exc:
        print_error(str(exc))
        return False
    print_success("Diag の事前実行が完了しました。")
    return True


# `_setup.py` を import するフォルダ（= `__pycache__` が生成される）。
IMPORT_CACHE_FOLDERS = (
    "backend_diag",
    "backend_local",
    "backend_tools",
    "backend_server",
    "backend_taskteam",
    "frontend_web",
    "frontend_avatar",
    "command_hermes",
    "frontend_ide",
    "frontend_ide/host",
    "frontend_ide/viewer",
    "frontend_channels",
    "frontend_channels/slack",
)


def _handle_remove_readonly(func, path, exc_info):
    del exc_info
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_folder_import_caches() -> None:
    """フォルダ別 `_setup.py` の import で生成された `__pycache__` を消す。

    フロントエンド(Web/Avatar)は Node.js プロジェクトだが、セットアップと
    クリーンアップだけ Python で実行するため、この import 分だけが残ってしまう。
    """
    for folder in IMPORT_CACHE_FOLDERS:
        pycache_dir = BASE_DIR / folder / "__pycache__"
        if not pycache_dir.is_dir():
            continue
        try:
            shutil.rmtree(pycache_dir, onerror=_handle_remove_readonly)
            print_success(f"__pycache__ ({folder}) を削除しました: {pycache_dir}")
        except Exception as e:
            print_warning(f"__pycache__ ({folder}) の削除に失敗しました: {e}")


# ============================================================
# 対話入力
# ============================================================
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
    global AUTO_MODE
    if AUTO_MODE:
        print_info(f"[AUTO] {prompt} -> {'Yes' if default.lower() == 'y' else 'No'} (default)")
        return default.lower() == "y"

    bracket = "[y]/n" if default.lower() == "y" else "y/[n]"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N"), default_key)
    return key in (b"y", b"Y")


def ask_start_mode(prompt, default="n"):
    """戻り値: (実行可否または "node", AUTO)。既存 y/n/a の戻り値は維持する。"""
    bracket = "[y]/n/a=auto/b=build（Node.js系の再ビルド）" if default.lower() == "y" else "y/[n]/a=auto/b=build（Node.js系の再ビルド）"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N", b"a", b"A", b"b", b"B"), default_key)
    if key in (b"b", b"B"):
        return "node", False
    if key in (b"a", b"A"):
        return True, True
    if key in (b"y", b"Y"):
        return True, False
    return False, False


def ask_download_mode(prompt, default="n"):
    """モデルDL選択。戻り値: "no"(取得しない) / "one"(設定モデル) / "all"(候補一括)。"""
    global AUTO_MODE
    mode_of = {"y": "one", "a": "all"}
    if AUTO_MODE:
        mode = mode_of.get(default.lower(), "no")
        print_info(f"[AUTO] {prompt} -> {mode} (default)")
        return mode

    if default.lower() == "y":
        bracket = "[y]/n/a(all)"
    elif default.lower() == "a":
        bracket = "y/n/[a](all)"
    else:
        bracket = "y/[n]/a(all)"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = {"y": b"y", "a": b"a"}.get(default.lower(), b"n")
    key = _read_single_key((b"y", b"Y", b"n", b"N", b"a", b"A"), default_key)
    if key in (b"a", b"A"):
        return "all"
    if key in (b"y", b"Y"):
        return "one"
    return "no"


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


# ============================================================
# 共通（グローバル）セットアップ
# ============================================================
def npm_command():
    return f"{FRONTEND_COMMAND}.cmd" if sys.platform == "win32" else FRONTEND_COMMAND


def _command_version(executable, version_arg="--version"):
    """コマンドを実際に実行し、バージョン文字列を返す。動かなければ None。

    `shutil.which` による PATH 存在チェックだけでは、Node を一度アンインストール
    した後も `%APPDATA%\\npm` に残る `npm.cmd` / `npx.cmd` 等のシムを拾ってしまい、
    node 本体が無いのに「導入済み」と誤判定する。実行して終了コードまで確認し、
    あわせてバージョン表示用の文字列を取得する。
    """
    import shutil
    path = shutil.which(executable)
    if path is None:
        return None
    try:
        result = subprocess.run(
            [path, version_arg],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=20,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            return None
        text = (result.stdout or "").strip()
        return text.splitlines()[0] if text else "(バージョン不明)"
    except Exception:
        return None


def get_git_version():
    return _command_version("git")


def get_node_version():
    return _command_version("node")


def get_npm_version():
    return _command_version(npm_command()) or _command_version(FRONTEND_COMMAND)


def get_node_toolchain_version():
    """Node.js 本体（と判明すれば npm）のバージョン文字列を返す。未導入は None。"""
    node_v = get_node_version()
    if node_v is None:
        return None
    npm_v = get_npm_version()
    return f"{node_v} / npm {npm_v}" if npm_v else node_v


def check_npm_installed():
    return get_npm_version() is not None


def check_git_installed():
    return get_git_version() is not None


def check_node_installed():
    return get_node_version() is not None


def install_prerequisite(name, win_command, download_url) -> bool:
    """前提ツール(git/node)を導入する。Windows は winget を使う。"""
    if sys.platform != "win32":
        print_warning(f"{name}: 自動導入は Windows のみ対応です。手動で導入してください: {download_url}")
        return False
    import shutil
    if shutil.which("winget") is None:
        print_error(f"{name}: winget が見つからないため自動導入できません。手動で導入してください: {download_url}")
        return False
    return run_command(win_command)


def ensure_prerequisites() -> bool:
    """git / Node.js の導入確認。未導入なら [y]/n で導入を促す。

    通常の導入ステップは git / Node.js が導入済みであることを前提とする。
    両方とも導入済み（または導入成功）なら True を返す。
    """
    print_header("Git / Node.js")
    print_info(f"管理スクリプト: Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
    if sys.version_info < (3, 13):
        print_warning("Python 3.13以降を推奨します。版数だけで一括中止せず、バックエンドの対象環境はuv / pyproject.tomlで確認します。")
    print_info("全体構成の推奨: Node.js 22.13以降。各モジュールの実際の必要条件は個別に確認します。")
    print_info("Vue 3 / Electronは各npmプロジェクトの依存です。VS Code 1.106以降はCode / Live拡張の配置時だけ必要です。")

    all_ok = True

    for name, version_getter, win_command, url in (
        ("Git", get_git_version, GIT_INSTALL_COMMAND_WINDOWS, GIT_DOWNLOAD_URL),
        ("Node.js", get_node_toolchain_version, NODE_INSTALL_COMMAND_WINDOWS, NODE_DOWNLOAD_URL),
    ):
        version = version_getter()
        if version is not None:
            print_success(f"{name} は導入済みです。（{version}）")
            if name == "Node.js":
                try:
                    recommended = version_satisfies(version.split(" / ", 1)[0], ">=22.13")
                except ValueError:
                    recommended = False
                if not recommended:
                    print_warning("Node.jsの版数は全体構成の推奨範囲外または確認不能です。続行し、対象モジュールの実互換性を個別確認します。")
            continue

        print_warning(f"{name} が見つかりません。")
        if ask_yes_no(f"{name} を導入しますか？", default="y"):
            installed = install_prerequisite(name, win_command, url)
            new_version = version_getter()
            if installed and new_version is not None:
                print_success(f"{name} を導入しました。（{new_version}）")
            else:
                print_warning(
                    f"{name} の導入を現在のシェルで確認できませんでした。"
                    " PATH 反映のためターミナルの再起動が必要な場合があります。"
                )
                all_ok = False
        else:
            print_warning(f"{name} の導入をスキップしました。手動で導入してください: {url}")
            all_ok = False

    if not all_ok:
        print_warning("Git / Node.js が未導入のままです。一部のセットアップが失敗する可能性があります。")

    return all_ok


def get_antigravity_install_command() -> str:
    return ANTIGRAVITY_INSTALL_COMMAND_WINDOWS if sys.platform == "win32" else ANTIGRAVITY_INSTALL_COMMAND_UNIX


def get_grok_build_install_command() -> str:
    return GROK_BUILD_INSTALL_COMMAND_WINDOWS if sys.platform == "win32" else GROK_BUILD_INSTALL_COMMAND_UNIX


def prepare_antigravity_installer():
    import tempfile
    import urllib.request
    install_url = (
        "https://antigravity.google/cli/install.cmd"
        if sys.platform == "win32"
        else "https://antigravity.google/cli/install.sh"
    )
    suffix = ".cmd" if sys.platform == "win32" else ".sh"
    try:
        with urllib.request.urlopen(install_url) as response:
            installer_bytes = response.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="antigravity_install_") as tmp:
            tmp.write(installer_bytes)
            installer_path = Path(tmp.name)
        if sys.platform != "win32":
            installer_path.chmod(0o700)
        if sys.platform == "win32":
            return ["cmd", "/c", str(installer_path)], installer_path
        return ["/bin/bash", str(installer_path)], installer_path
    except Exception as exc:
        print_error(f"antigravity インストーラーの準備に失敗しました: {exc}")
        return None, None


def prepare_grok_build_installer():
    import tempfile
    import urllib.request
    install_url = "https://x.ai/cli/install.ps1" if sys.platform == "win32" else "https://x.ai/cli/install.sh"
    suffix = ".ps1" if sys.platform == "win32" else ".sh"
    try:
        with urllib.request.urlopen(install_url) as response:
            installer_bytes = response.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="grok_build_install_") as tmp:
            tmp.write(installer_bytes)
            installer_path = Path(tmp.name)
        if sys.platform == "win32":
            return [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(installer_path),
            ], installer_path
        installer_path.chmod(0o700)
        return ["/bin/bash", str(installer_path)], installer_path
    except Exception as exc:
        print_error(f"Grok Build インストーラーの準備に失敗しました: {exc}")
        return None, None


def cleanup_temp_file(path) -> None:
    if path is None:
        return
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def print_ai_cli_manual_setup():
    print_info("AI CLI: 手動導入コマンド")
    if check_npm_installed():
        cmd = npm_command()
        print_info(f"    Claude Code : {cmd} install -g @anthropic-ai/claude-code")
        print_info(f"    GitHub Copilot: {cmd} install -g @github/copilot")
        print_info(f"    OpenAI Codex : {cmd} install -g @openai/codex")
        print_info(f'    OpenCode   : node "{BASE_DIR / "scripts" / "cli_bat" / "install_opencode.mjs"}"')
        print_info("      所有確認した旧 opencode-ai だけを削除して V2 へ移行します。導入失敗時は利用できなくなる場合があります。")
    else:
        print_info("    npm 系 CLI : Node.js / npm を導入後に個別セットアップしてください")
        print_info("      https://nodejs.org/")
    print_info(f"    Antigravity: {get_antigravity_install_command()}")
    print_info(f"    Grok Build : {get_grok_build_install_command()}")
    print_info(f"    Hermes Agent: {HERMES_AGENT_INSTALL_COMMAND}")
    print_info(f"    Ollama     : {OLLAMA_INSTALL_COMMAND}")


def start_global_cli_tools_install() -> list[str]:
    """導入を投入し、準備・投入に失敗したパッケージを返す。"""
    print_header("AI CLI: 導入開始")
    print_info("対象: Claude Code / GitHub Copilot / OpenAI Codex / OpenCode / Antigravity / Grok Build")
    print_info(f"参考: Hermes Agent: {HERMES_AGENT_INSTALL_COMMAND}")
    print_info(f"参考: Ollama: {OLLAMA_INSTALL_COMMAND}")
    print_info("AI CLI: 並列導入中（完了待ち）")

    failed_packages = []
    npm_packages = ["@anthropic-ai/claude-code", "@github/copilot", "@openai/codex", "@opencode/cli"]
    targets = []
    if check_npm_installed():
        cmd = npm_command()
        for package in npm_packages[:-1]:
            command = [cmd, "install", "-g", package]
            targets.append((package, command, " ".join(command), None))
        command = [shutil.which("node") or "node", str(BASE_DIR / "scripts" / "cli_bat" / "install_opencode.mjs")]
        print_info("OpenCode: 所有確認した旧 opencode-ai がある場合だけ削除して V2 へ移行します。導入失敗時は利用できなくなる場合があります。")
        targets.append(("@opencode/cli", command, " ".join(command), None))
    else:
        failed_packages.extend(npm_packages)
        print_warning("共通: npm がインストールされていないため、npm 系 CLI を導入できません。")
        print_info("  Node.js をインストールしてください: https://nodejs.org/")

    antigravity_command, antigravity_temp_path = prepare_antigravity_installer()
    if antigravity_command:
        targets.append(("antigravity", antigravity_command, get_antigravity_install_command(), antigravity_temp_path))
    else:
        failed_packages.append("antigravity")
        cleanup_temp_file(antigravity_temp_path)

    grok_build_command, grok_build_temp_path = prepare_grok_build_installer()
    if grok_build_command:
        targets.append(("grok-build", grok_build_command, get_grok_build_install_command(), grok_build_temp_path))
    else:
        failed_packages.append("grok-build")
        cleanup_temp_file(grok_build_temp_path)

    GLOBAL_CLI_INSTALL_PROCESSES.clear()
    for i, (label, command, display_command, temp_path) in enumerate(targets, 1):
        print_info(f"  [{i}/{len(targets)}] 投入: {display_command}")
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
            )
            GLOBAL_CLI_INSTALL_PROCESSES.append((label, process, temp_path))
            print_success(f"  [{i}/{len(targets)}] {label}: 投入完了")
        except Exception as exc:
            print_error(f"  [{i}/{len(targets)}] {label}: 投入失敗 - {exc}")
            failed_packages.append(label)
            cleanup_temp_file(temp_path)

    if not GLOBAL_CLI_INSTALL_PROCESSES:
        print_warning("共通: AI CLI ツールの投入対象がありませんでした。")
    else:
        print_success("共通: AI CLI ツールの投入を開始しました。")
    return failed_packages


def wait_global_cli_tools_install() -> list[str]:
    if not GLOBAL_CLI_INSTALL_PROCESSES:
        return []

    print_header("AI CLI: 導入結果")

    failed_packages = []
    for i, (package, process, temp_path) in enumerate(GLOBAL_CLI_INSTALL_PROCESSES, 1):
        try:
            # OpenCode は専用入口が各段階の期限と子プロセスの停止確認を管理する。
            # 親から強制終了すると npm の子と排他を残すため、停止確認まで待つ。
            stdout, stderr = process.communicate(timeout=None if package == "@opencode/cli" else 300)
            if process.returncode == 0:
                print_success(f"  [{i}/{len(GLOBAL_CLI_INSTALL_PROCESSES)}] {package}: 導入完了")
            else:
                print_error(f"  [{i}/{len(GLOBAL_CLI_INSTALL_PROCESSES)}] {package}: 導入失敗 (終了コード: {process.returncode})")
                detail = (stderr or stdout or "").strip()
                if detail:
                    print_error(f"      エラー内容: {detail[:200]}")
                failed_packages.append(package)
        except subprocess.TimeoutExpired:
            process.kill()
            print_error(f"  [{i}/{len(GLOBAL_CLI_INSTALL_PROCESSES)}] {package}: タイムアウト")
            failed_packages.append(package)
        except Exception as exc:
            print_error(f"  [{i}/{len(GLOBAL_CLI_INSTALL_PROCESSES)}] {package}: エラー - {exc}")
            failed_packages.append(package)
        finally:
            cleanup_temp_file(temp_path)

    GLOBAL_CLI_INSTALL_PROCESSES.clear()

    if failed_packages:
        print_warning(f"共通: 一部 AI CLI ツールの導入に失敗しました: {', '.join(failed_packages)}")
        return failed_packages

    print_success("共通: AI CLI ツールの導入確認が完了しました。")
    return []


def setup_common_global_tools(choices: dict) -> list[str]:
    print_header("共通セットアップ")
    print_info("対象: pip / wheel / setuptools / uv / AI CLI ツール")

    error_locations: list[str] = []

    if choices.get("common_python_upgrade"):
        commands = [
            ([sys.executable, "-m", "pip", "install", "--upgrade", "pip"], "pip"),
            (["pip", "install", "--upgrade", "wheel"], "wheel"),
            (["pip", "install", "--upgrade", "setuptools"], "setuptools"),
            (["pip", "install", "--upgrade", "uv"], "uv"),
        ]
        failed_tools = []
        for cmd, tool_name in commands:
            if not run_command(cmd):
                failed_tools.append(tool_name)
        if failed_tools:
            print_warning(f"共通: 一部ツールのアップグレードに失敗しました: {', '.join(failed_tools)}")
            error_locations.extend([f"共通: Python ツール更新 ({tool_name})" for tool_name in failed_tools])
        else:
            print_success("共通: Python ツールのアップグレードが完了しました。")
    else:
        print_warning("共通: Python ツールのアップグレードをスキップしました。")

    if choices.get("common_npm_install"):
        failed_packages = start_global_cli_tools_install()
        error_locations.extend([f"共通: AI CLI ツール導入 ({package})" for package in failed_packages])
    else:
        print_header("AI CLI ツール セットアップ")
        print_warning("共通: AI CLI ツールのインストールをスキップしました。")
        print()
        print_ai_cli_manual_setup()

    return error_locations


# ============================================================
# 選択収集
# ============================================================
def collect_setup_choices() -> dict | None:
    """全ての y/n を最初にまとめて聞く。キャンセル時は None を返す。"""
    global AUTO_MODE

    run_setup, AUTO_MODE = ask_start_mode("セットアップを実行しますか?", default="n")
    if not run_setup:
        return None

    if run_setup == "node":
        return {"node_refresh": True}

    if AUTO_MODE:
        print_info("AUTO: 各項目の既定値で実行")

    print_header("セットアップ内容の選択")

    choices: dict = {
        "common":                False,
        "common_python_upgrade": False,
        "common_npm_install":    False,
        "backend":               False,
        "pg_user_created":       False,
        "pg_restore":            False,
        "pg_migrate":            False,
        "local":                 False,
        "local_download":        "no",
        "taskteam":              False,
        "mcp":                   False,
        "mcp_config":            False,
        "web":                   False,
        "avatar":                False,
        "hermes":                False,
        "ide":                   False,
        "diag":                  False,
        "discord":               False,
        "slack":                 False,
        "continue_on_error":     False,
    }

    choices["common"] = ask_yes_no("共通セットアップを実行しますか？", default="y")
    if choices["common"]:
        choices["common_python_upgrade"] = ask_yes_no("共通: グローバル環境 Python ツールをアップグレードしますか？", default="y")
        choices["common_npm_install"]    = ask_yes_no("共通: グローバル環境の AI CLI ツール(npm + Antigravity + Grok Build)をインストール/アップデートしますか？", default="n")

    choices["diag"] = True
    print_info("Diag / Electron: セットアップ [y]")

    choices["local"] = ask_yes_no("Local のセットアップを実行しますか？", default="y")
    if choices["local"]:
        choices["local_download"] = ask_download_mode("Local: モデルを事前ダウンロードしますか？（n=しない / y=設定モデル / a=候補一括 ※劇遅注意）", default="n")

    choices["mcp"] = ask_yes_no("Tools のセットアップを実行しますか？", default="y")
    if choices["mcp"]:
        choices["mcp_config"] = ask_yes_no("Tools: MCP 設定を各クライアントのグローバル設定へ書き込みますか？", default="y")

    choices["backend"] = ask_yes_no("Core / Apps のセットアップを実行しますか？", default="y")
    if choices["backend"] and DATABASE_TYPE.lower() == "postgresql":
        choices["pg_user_created"] = ask_yes_no("PostgreSQL: ユーザー(appsuser)を作成しましたか？", default="y")
        choices["pg_restore"]      = ask_yes_no("PostgreSQL: 初期データベースを復元しますか？", default="n")
        choices["pg_migrate"]      = ask_yes_no("PostgreSQL: alembic upgrade head を実行しますか？", default="y")

    choices["taskteam"] = ask_yes_no("Task / Team のセットアップを実行しますか？", default="y")

    choices["web"] = ask_yes_no("Web のセットアップを実行しますか？", default="y")
    choices["avatar"] = ask_yes_no("Avatar のセットアップを実行しますか？", default="y")
    choices["hermes"] = ask_yes_no("Hermes のセットアップを実行しますか？", default="y")
    choices["ide"] = ask_yes_no("Navigator / Console / Code / Live / IDE / Task / Team のセットアップを実行しますか？", default="y")
    choices["discord"] = ask_yes_no("Discord のセットアップを実行しますか？", default="y")
    choices["slack"] = ask_yes_no("Slack のセットアップを実行しますか？", default="y")

    choices["continue_on_error"] = ask_yes_no("エラーが発生しても続行しますか？", default="y")

    return choices


# ============================================================
# git pull 後の Node.js 系再ビルド
# ============================================================
def check_refresh_node_runtime(version: str) -> bool:
    """一括buildの実package条件を案内。版数だけでは停止しない。"""
    projects = ("backend_diag", "backend_diag/ui", "frontend_web", "frontend_avatar",
                "frontend_ide", "frontend_ide/host", "frontend_ide/viewer", "frontend_channels")
    try:
        for folder in projects:
            directory = BASE_DIR / folder
            package = json.loads((directory / "package.json").read_text(encoding="utf-8-sig"))
            dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
            targets = [None] + [name for name in ("vite", "electron", "esbuild", "@vscode/vsce", "@discordjs/voice") if name in dependencies]
            for dependency in targets:
                requirement = project_node_requirement(directory, dependency)
                if requirement and not version_satisfies(version, requirement):
                    print_warning(f"{folder} ({dependency or 'package.json'}): Node.js {version} は宣言された必要条件 {requirement} を満たしません。実行結果を確認して続行します。")
        return True
    except (OSError, ValueError, TypeError, AttributeError):
        print_warning("Node.js / package metadataの版数条件を判定できません。実行結果を確認して続行します。")
        return True


def setup_node_refresh() -> list[str]:
    """依存同期・既存ビルド・ランチャー再配置のみ。初期設定や診断は実行しない。"""
    print_header("Node.js系の再ビルド")
    print_info("対象: Diag / Web / Avatar / Navigator / Console / Code / Live / IDE / Task / Team / Discord")
    print_info("依存同期 / 再ビルド / 起動コマンド登録")
    print_info("Python環境・モデル・共通設定・グローバルCLIは変更しません。")
    node_version = get_node_version()
    if node_version is None or get_npm_version() is None:
        print_error("Node.js と npm が必要です。導入後に b（build）を再実行してください。")
        return ["Node.js / npm の確認"]
    check_refresh_node_runtime(node_version)

    spec = importlib.util.spec_from_file_location("aidiy_refresh_electron", BASE_DIR / "scripts" / "_setup_electron.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    npm = npm_command()
    desktop = not (os.environ.get("ELECTRON_SKIP_BINARY_DOWNLOAD") == "1"
                   or os.environ.get("CODESPACES") == "true"
                   or (sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))))

    def dependencies(folder, *, electron=False):
        directory = BASE_DIR / folder
        if electron:
            return helper.setup_dependencies(directory, npm, folder, run_command,
                                             update=False, desktop=desktop, locked=(folder == "frontend_channels"),
                                             info=print_info, warning=print_warning, error=print_error)
        guarded = helper.frontend_dependency_guard(
            directory, folder, desktop=False, info=print_info, warning=print_warning, error=print_error,
        )
        if guarded is not None:
            return guarded
        return run_command([npm, "install", "--include=dev", "--no-fund", "--no-audit"], cwd=directory)

    def build(folder, script="build"):
        return run_command([npm, "run", script], cwd=BASE_DIR / folder)

    # 項目ごとに失敗場所を残し、その後の配置を止める。
    steps = [
        ("Diag: 依存", lambda: dependencies("backend_diag", electron=True)),
        ("Diag UI: 依存", lambda: dependencies("backend_diag/ui")),
        ("Diag UI: ビルド", lambda: build("backend_diag/ui")),
        ("Diag: aidiy_diag", lambda: _load_folder_module("backend_diag").setup(desktop=False)),
        ("Web: 依存", lambda: dependencies("frontend_web")),
        ("Web: ビルド", lambda: build("frontend_web")),
        ("Avatar: 依存", lambda: dependencies("frontend_avatar", electron=True)),
        ("Avatar: ビルド", lambda: build("frontend_avatar")),
        ("Avatar: aidiy_avatar", lambda: _load_folder_module("frontend_avatar").install_standalone_launcher()),
        ("IDE UI: 依存", lambda: dependencies("frontend_ide")),
        ("Code / Live: 依存", lambda: dependencies("frontend_ide/host", electron=True)),
        # hostの既存compile/packageは共通Vueのビルドも行うため、二重ビルドしない。
        ("Code / Live / IDE: ビルド・配置", lambda: _load_folder_module("frontend_ide/host").setup_assets(npm)),
        ("IDE Viewer: 依存", lambda: dependencies("frontend_ide/viewer", electron=True)),
        ("IDE: aidiy_ide", lambda: _load_folder_module("frontend_ide/viewer").install_launcher(BASE_DIR / "frontend_ide/viewer")),
        ("Navigator: aidiy_navi", lambda: _load_folder_module("frontend_ide/aidiy_navi").setup()),
        ("Console: aidiy_console", lambda: _load_folder_module("frontend_ide/aidiy_console").setup()),
        ("Task: aidiy_task", lambda: _load_folder_module("frontend_ide/aidiy_task").setup()),
        ("Team: aidiy_team", lambda: _load_folder_module("frontend_ide/aidiy_team").setup()),
        ("Browser: aidiy_browser", lambda: _load_folder_module("frontend_ide/aidiy_browser").setup()),
        ("Discord: 依存", lambda: dependencies("frontend_channels", electron=True)),
        ("Discord: ビルド", lambda: build("frontend_channels", "build:panel")),
        ("Discord: aidiy_discord", lambda: _load_folder_module("frontend_channels").install_launcher(BASE_DIR / "frontend_channels")),
        ("Slack: 依存", lambda: dependencies("frontend_channels/slack", electron=True)),
        ("Slack: ビルド", lambda: build("frontend_channels/slack", "build:panel")),
        ("Slack: aidiy_slack", lambda: _load_folder_module("frontend_channels/slack").install_launcher(BASE_DIR / "frontend_channels/slack")),
    ]
    for label, action in steps:
        print_info(label)
        try:
            # install_launcherは成功時にNoneを返す既存APIもある。
            if action() is not False:
                continue
        except (OSError, RuntimeError, ValueError, ImportError, subprocess.SubprocessError) as exc:
            print_error(f"{label}: {exc}")
        return [label]
    return []


# ============================================================
# メイン
# ============================================================
def setup_launchers_only() -> list[str]:
    """全12コマンドの登録を修復する。依存導入・ビルド・サービス起動は行わない。"""
    steps = [
        ('Diag', lambda: _load_folder_module('backend_diag').setup(desktop=False)),
        ('Avatar', lambda: _load_folder_module('frontend_avatar').install_standalone_launcher()),
        ('Hermes', lambda: _load_folder_module('command_hermes').install_standalone_launcher()),
        ('Navigator', lambda: _load_folder_module('frontend_ide/aidiy_navi').setup()),
        ('Console', lambda: _load_folder_module('frontend_ide/aidiy_console').setup()),
        ('Code / Live', lambda: _load_folder_module('frontend_ide/host').install_standalone_launcher()),
        ('IDE', lambda: _load_folder_module('frontend_ide/viewer').install_launcher(BASE_DIR / 'frontend_ide/viewer')),
        ('Task', lambda: _load_folder_module('frontend_ide/aidiy_task').setup()),
        ('Team', lambda: _load_folder_module('frontend_ide/aidiy_team').setup()),
        ('Browser', lambda: _load_folder_module('frontend_ide/aidiy_browser').setup()),
        ('Discord', lambda: _load_folder_module('frontend_channels').install_launcher(BASE_DIR / 'frontend_channels')),
        ('Slack', lambda: _load_folder_module('frontend_channels/slack').install_launcher(BASE_DIR / 'frontend_channels/slack')),
    ]
    errors = []
    for label, action in steps:
        try:
            if action() is not False:
                continue
        except (OSError, RuntimeError, ValueError, ImportError) as exc:
            print_error(f'{label}: {exc}')
        errors.append(label)
    return errors


def print_app_launch_commands():
    """アプリ名の最長幅に揃えて起動コマンドを表示する。"""
    app_commands = (
        ('Avatar', 'aidiy_avatar （または cd frontend_avatar && npm run dev）'),
        ('Diag', 'aidiy_diag （ブラウザ版: aidiy_diag --browser）'),
        ('Hermes', 'aidiy_hermes'),
        ('Navigator', 'aidiy_navi'),
        ('Console', 'aidiy_console'),
        ('Task', 'aidiy_task'),
        ('Team', 'aidiy_team'),
        ('Browser', 'aidiy_browser'),
        ('Code', 'aidiy_code'),
        ('Live', 'aidiy_live'),
        ('IDE', 'aidiy_ide'),
        ('Discord', 'aidiy_discord'),
        ('Slack', 'aidiy_slack'),
    )
    app_width = max(len(name) for name, _ in app_commands)
    for name, command in app_commands:
        print_info(f"    {name:<{app_width}}起動: {command}")


def main():
    global AUTO_MODE
    if sys.argv[1:] == ['--launchers-only']:
        print_header('起動コマンドと PATH の修復')
        errors = setup_launchers_only()
        print_setup_summary(errors)
        raise SystemExit(1 if errors else 0)
    print_header("プロジェクト セットアップ")
    print_info("セットアップ対象:")
    print_info("  0. 共通")
    print_info("  1. Diag")
    print_info("  2. Local")
    print_info("  3. Tools")
    print_info("  4. Core / Apps")
    print_info("  5. Task / Team")
    print_info("  6. Web")
    print_info("  7. Avatar")
    print_info("  8. Hermes")
    print_info("  9. Navigator / Console / Code / Live / IDE / Task / Team")
    print_info(" 10. Discord")
    print_info(" 11. Slack")
    print_info("外部チャンネル: Discord / Slack")
    print()

    choices = collect_setup_choices()
    if choices is None:
        print_warning("セットアップをキャンセルしました。")
        sys.exit(0)

    stop_setup_apps()

    if choices.get("node_refresh"):
        errors = setup_node_refresh()
        print_setup_summary(errors)
        if errors:
            sys.exit(1)
        return

    print_header("一括実行開始")
    continue_on_error = choices["continue_on_error"]
    copy_warnings = choices.setdefault("_setup_warnings", [])
    error_locations: list[str] = []
    local_setup_ok = False
    model_download_launched = False

    print()
    # 共通・Diag・local のセットアップ前に Git / Node.js の前提を確認する。
    # 従来は a=auto 選択前の対話だったため、OS ツール導入は自動承認に変えない。
    selected_auto_mode = AUTO_MODE
    try:
        AUTO_MODE = False
        prerequisites_ok = ensure_prerequisites()
    finally:
        AUTO_MODE = selected_auto_mode

    # 前提不足では後続処理の安全な実行を保証できないため、続行指定でも停止する。
    if not prerequisites_ok:
        error_locations.append("前提条件: Git / Node.js")
        print_setup_summary(error_locations)
        sys.exit(1)

    from scripts.local_git_setup import ensure_local_git
    git_status, git_message = ensure_local_git(BASE_DIR)
    if git_status in ("error", "skipped"):
        print_warning(git_message)
    else:
        print_info(git_message)
    if git_status == "error":
        error_locations.append("Git: ローカル管理")
        if not continue_on_error:
            print_setup_summary(error_locations)
            sys.exit(1)

    if choices["common"]:
        error_locations.extend(setup_common_global_tools(choices))
        if GLOBAL_CLI_INSTALL_PROCESSES:
            print()
            failed_packages = wait_global_cli_tools_install()
            error_locations.extend([f"共通: AI CLI ツール導入 ({package})" for package in failed_packages])
        if error_locations and not continue_on_error:
            print_setup_summary(error_locations)
            sys.exit(1)
    else:
        print_warning("共通セットアップをスキップしました。")

    # 表示順と同じく、共通処理（CLI 導入待機も含む）→ Diag → local の順で実行する。
    print()
    if choices.get("diag"):
        if not _load_folder_module("backend_diag").setup(choices, desktop=False):
            error_locations.append("Diag")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
        if not _load_folder_module("backend_diag").setup_desktop(continue_on_error=continue_on_error, copy_warnings=copy_warnings):
            error_locations.append("Diag: Electron")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)

    print()
    if choices["local"]:
        local_mod = _load_folder_module("backend_local")
        local_setup_ok = local_mod.setup(choices)
        if not local_setup_ok:
            error_locations.append("Local")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Local のセットアップをスキップしました。")

    print()
    if choices["mcp"]:
        tools_mod = _load_folder_module("backend_tools")
        if not tools_mod.setup_dependencies():
            error_locations.append("Tools")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
        print()
        tools_mod.show_current_config()
        if choices["mcp_config"]:
            if not tools_mod.configure_clients():
                error_locations.append("Tools: MCP 設定ファイル書き込み")
                if not continue_on_error:
                    print_setup_summary(error_locations)
                    sys.exit(1)
        else:
            print_warning("Tools の MCP 設定ファイル書き込みをスキップしました。")
    else:
        print_warning("Tools のセットアップをスキップしました。")

    print()
    if choices["backend"]:
        backend_mod = _load_folder_module("backend_server")
        if not backend_mod.setup(choices):
            error_locations.append("Core / Apps")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Core / Apps のセットアップをスキップしました。")

    print()
    if choices["taskteam"]:
        taskteam_mod = _load_folder_module("backend_taskteam")
        if not taskteam_mod.setup(choices):
            error_locations.append("Task / Team")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Task / Team のセットアップをスキップしました。")

    print()
    if choices["web"]:
        web_mod = _load_folder_module("frontend_web")
        if not web_mod.setup(choices):
            error_locations.append("Web")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Web のセットアップをスキップしました。")

    print()
    if choices["avatar"]:
        avatar_mod = _load_folder_module("frontend_avatar")
        if not avatar_mod.setup(choices):
            error_locations.append("Avatar")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Avatar のセットアップをスキップしました。")

    # モデル事前ダウンロードは時間がかかるため、別プロセスで投入する。
    # Hermes はセットアップ全体の最後に回すため、その前に投入だけ済ませる。
    print()
    if local_setup_ok:
        local_mod = _load_folder_module("backend_local")
        model_download_launched = local_mod.launch_model_download(choices)
        download_requested = choices.get("local_download") is True or choices.get("local_download") in ("one", "all")
        if download_requested and not model_download_launched:
            error_locations.append("Local: モデルダウンロード投入")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)

    print()
    if choices["hermes"]:
        hermes_mod = _load_folder_module("command_hermes")
        if not hermes_mod.setup(choices):
            error_locations.append("Hermes")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Hermes のセットアップをスキップしました。")

    print()
    if choices.get("ide"):
        if not _load_folder_module("frontend_ide").setup(choices):
            error_locations.append("Navigator / Console / Code / Live / IDE / Task / Team")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Navigator / Console / Code / Live / IDE / Task / Team のセットアップをスキップしました。")

    print()
    if choices.get("discord"):
        if not _load_folder_module("frontend_channels").setup(choices):
            error_locations.append("Discord")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Discord のセットアップをスキップしました。")

    print()
    if choices.get("slack"):
        if not _load_folder_module("frontend_channels/slack").setup(choices):
            error_locations.append("Slack")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)
    else:
        print_warning("Slack のセットアップをスキップしました。")

    print_header("キャッシュクリア")
    remove_folder_import_caches()

    # キャッシュクリア後に全体起動と同じ診断を実行し、モデル合成JSONを生成しておく。
    print()
    if choices.get("diag"):
        if not run_diag_headless():
            error_locations.append("Diag: aidiy_diag --headless")
            if not continue_on_error:
                print_setup_summary(error_locations)
                sys.exit(1)

    print_setup_summary(error_locations, **({"copy_warnings": copy_warnings} if copy_warnings else {}))
    print_info("起動方法:")
    print_info("  全体起動: python _start.py")
    print_info("  個別起動:")
    print_info(f"    Local起動  : cd backend_local && uv run uvicorn local_main:app --reload --host 127.0.0.1 --port {PORT_LOCAL} --ws-max-size 20971520")
    print_info(f"    MCP起動    : cd backend_tools && uv run uvicorn tools_main:app --reload --host 127.0.0.1 --port {PORT_TOOLS} --ws-max-size 20971520")
    print_info(f"    Core起動   : cd backend_server && uv run uvicorn core_main:app --reload --host 0.0.0.0 --port {PORT_CORE} --ws-max-size 20971520")
    print_info(f"    Apps起動   : cd backend_server && uv run uvicorn apps_main:app --reload --host 0.0.0.0 --port {PORT_APPS} --ws-max-size 20971520")
    print_info("    Task / Team起動:")
    print_info(f"                 cd backend_taskteam && uv run uvicorn taskteam_main:app --reload --host 0.0.0.0 --port {PORT_TASKTEAM} --ws-max-size 20971520")
    print_info("    Web開発    : cd frontend_web && npm run dev")
    print_app_launch_commands()

    print()
    if error_locations:
        print_error("セットアップに失敗した項目があります。上記のエラー発生場所を確認してください。")
    elif copy_warnings:
        print_warning("セットアップ処理は終了しました（警告あり／Electron 配置未確認）。")
    else:
        print_success("セットアップは正常終了しました。")
    if model_download_launched:
        print_info("Local のモデルダウンロードは別プロセスに投入済みです。進捗はコンソールまたはログで確認してください。")
    print_info("5秒後に終了します...")
    time.sleep(5)
    # 「続行」は残りの項目を実行する指定であり、失敗を成功には変えない。
    if error_locations:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
    except Exception as e:
        print_error(f"予期しないエラーが発生しました: {e}")
        sys.exit(1)
    finally:
        # 中断・エラー終了でも import 由来の `__pycache__` を残さない。
        remove_folder_import_caches()
