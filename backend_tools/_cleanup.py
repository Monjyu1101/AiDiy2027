# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""バックエンド(tools) クリーンアップスクリプト

このフォルダ (backend_tools) 単体のクリーンアップを行います。
フォルダ内成果物 (venv / node_modules / temp) の削除に加え、各 CLI の
グローバル MCP 設定 (aidiy_*) の解除も行います。

公開 API:
    cleanup(choices: dict) -> bool
    collect_choices() -> dict | None
"""

import json
import ntpath
import os
import re
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
BACKEND_TOOLS_DIR = THIS_DIR
sys.path.insert(0, str(THIS_DIR.parent / 'scripts'))
from _cleanup_processes import process_arguments, stop_matching
BACKEND_TOOLS_ENV_LIST = [".venv", "venv"]
BACKEND_TOOLS_SERVER_PREFIX = "aidiy_"
VSCODE_CHAT_PROVIDER_PREFIX = "aidiy_"

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
            resolved = path.resolve()
            root = BACKEND_TOOLS_DIR.resolve()
            if resolved == root or not resolved.is_relative_to(root):
                raise ValueError(f"削除対象が backend_tools の外を参照しています: {resolved}")
            for attempt in range(5):
                try:
                    shutil.rmtree(path, onerror=handle_remove_readonly)
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.2)
            print_success(f"{description} を削除しました: {path}")
            return True
        except Exception as e:
            print_error(f"{description} の削除に失敗しました: {path}")
            print_error(f"  理由: {e}")
            print_warning("  削除対象を使用中のプロセスが残っていないか確認してください")
            return False
    return False


def cleanup_common_python_caches(target_dir: Path, label: str) -> tuple[int, bool]:
    deleted_count = 0
    ok = True
    print_info(f"{label}: __pycache__ フォルダを検索中...")
    for pycache in target_dir.rglob("__pycache__"):
        if remove_directory(pycache, f"__pycache__ ({label})"):
            deleted_count += 1
        else:
            ok = False
    print_info(f"{label}: .pytest_cache フォルダを検索中...")
    for pytest_cache in target_dir.rglob(".pytest_cache"):
        if remove_directory(pytest_cache, f".pytest_cache ({label})"):
            deleted_count += 1
        else:
            ok = False
    return deleted_count, ok


# ============================================================
# JSON / TOML / グローバル MCP 設定解除ヘルパー
# ============================================================
def write_json_file(path: Path, data: dict) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return True
    except Exception as e:
        print_error(f"設定ファイル書き込みエラー: {path} ({e})")
        return False


def load_json_dict_file(path: Path) -> dict:
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8-sig")
    if raw.strip() == "":
        return {}
    loaded = json.loads(raw)
    if isinstance(loaded, dict):
        return loaded
    return {}


def load_json_list_file(path: Path) -> list:
    if not path.exists():
        return []
    raw = path.read_text(encoding="utf-8-sig")
    if raw.strip() == "":
        return []
    loaded = json.loads(raw)
    return loaded if isinstance(loaded, list) else []


def write_json_list_file(path: Path, data: list) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return True
    except Exception as e:
        print_error(f"設定ファイル書き込みエラー: {path} ({e})")
        return False


def remove_json_mcp_servers_by_prefix(path: Path, prefix: str, top_key: str = "mcpServers") -> bool:
    try:
        if not path.exists():
            print_info(f"MCP 設定ファイルなし: {path}")
            return True
        loaded = load_json_dict_file(path)
        servers = loaded.get(top_key)
        if not isinstance(servers, dict):
            print_info(f"{prefix}* は未設定です: {path}")
            return True
        matched = [name for name in servers if name.startswith(prefix)]
        if not matched:
            print_info(f"{prefix}* は未設定です: {path}")
            return True
        for name in matched:
            del servers[name]
        if servers:
            loaded[top_key] = servers
        else:
            loaded.pop(top_key, None)
        if not write_json_file(path, loaded):
            return False
        print_success(f"{', '.join(matched)} の MCP 設定を削除しました: {path}")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"MCP 設定更新エラー: {path} ({e})")
        return False


def get_vscode_mcp_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "Code" / "User" / "mcp.json"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Code" / "User" / "mcp.json"
    return Path.home() / ".config" / "Code" / "User" / "mcp.json"


def get_vscode_chat_models_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "Code" / "User" / "chatLanguageModels.json"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Code" / "User" / "chatLanguageModels.json"
    return Path.home() / ".config" / "Code" / "User" / "chatLanguageModels.json"


def remove_vscode_aidiy_chat_models(path: Path) -> bool:
    try:
        if not path.exists():
            print_info(f"VS Code チャットモデル設定ファイルなし: {path}")
            return True
        providers = load_json_list_file(path)
        if not providers:
            print_info(f"{VSCODE_CHAT_PROVIDER_PREFIX}* は未設定です: {path}")
            return True
        removed_names = [
            entry.get("name")
            for entry in providers
            if isinstance(entry, dict)
            and isinstance(entry.get("name"), str)
            and entry.get("name").startswith(VSCODE_CHAT_PROVIDER_PREFIX)
        ]
        remaining = [
            entry for entry in providers
            if not (
                isinstance(entry, dict)
                and isinstance(entry.get("name"), str)
                and entry.get("name").startswith(VSCODE_CHAT_PROVIDER_PREFIX)
            )
        ]
        if len(remaining) == len(providers):
            print_info(f"{VSCODE_CHAT_PROVIDER_PREFIX}* は未設定です: {path}")
            return True
        if not write_json_list_file(path, remaining):
            return False
        print_success(f"{', '.join(removed_names)} の VS Code チャットモデル設定を削除しました: {path}")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"VS Code チャットモデル設定更新エラー: {path} ({e})")
        return False


def get_opencode_config_path() -> Path:
    xdg_config_home = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg_config_home:
        return Path(xdg_config_home) / "opencode" / "opencode.json"
    return Path.home() / ".config" / "opencode" / "opencode.json"


def get_antigravity_mcp_config_path() -> Path:
    return Path.home() / ".gemini" / "config" / "mcp_config.json"


def get_grok_config_path() -> Path:
    return Path.home() / ".grok" / "config.toml"


def remove_toml_table(content: str, table_header: str) -> str:
    lines = content.splitlines()
    table_index = None
    for i, line in enumerate(lines):
        if line.strip() == table_header:
            table_index = i
            break
    if table_index is None:
        return content if content.endswith("\n") or content == "" else content + "\n"
    next_table_index = len(lines)
    for i in range(table_index + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            next_table_index = i
            break
    del lines[table_index:next_table_index]
    while lines and lines[-1].strip() == "":
        lines.pop()
    return "\n".join(lines).rstrip() + ("\n" if lines else "")


def remove_toml_mcp_servers_by_prefix(config_path: Path, prefix: str, label: str) -> bool:
    header_prefix = f"[mcp_servers.{prefix}"
    try:
        if not config_path.exists():
            print_info(f"MCP 設定ファイルなし: {config_path}")
            return True
        content = config_path.read_text(encoding="utf-8")
        removed_names: list[str] = []
        updated = content
        while True:
            match_header = None
            match_name = None
            for line in updated.splitlines():
                stripped = line.strip()
                if stripped.startswith(header_prefix) and stripped.endswith("]"):
                    match_header = stripped
                    match_name = stripped[len("[mcp_servers."):-1]
                    break
            if match_header is None:
                break
            new_updated = remove_toml_table(updated, match_header)
            if new_updated == updated:
                break
            updated = new_updated
            removed_names.append(match_name)
        if not removed_names:
            print_info(f"{prefix}* は未設定です: {config_path}")
            return True
        config_path.write_text(updated, encoding="utf-8")
        print_success(f"{', '.join(removed_names)} の MCP 設定を削除しました: {config_path} ({label})")
        return True
    except Exception as e:
        print_error(f"{label}設定更新エラー: {config_path} ({e})")
        return False


def remove_codex_mcp_servers_by_prefix(prefix: str) -> bool:
    return remove_toml_mcp_servers_by_prefix(
        Path.home() / ".codex" / "config.toml", prefix, "Codex"
    )


def remove_grok_mcp_servers_by_prefix(prefix: str) -> bool:
    return remove_toml_mcp_servers_by_prefix(get_grok_config_path(), prefix, "Grok")


def cleanup_global_mcp_configs(prefix: str = BACKEND_TOOLS_SERVER_PREFIX) -> bool:
    print_header("グローバルMCP設定の解除")

    copilot_home = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot")))
    targets = [
        (Path.home() / ".claude.json",            "mcpServers"),
        (copilot_home / "mcp-config.json",        "mcpServers"),
        (get_antigravity_mcp_config_path(),       "mcpServers"),
        # 以前のセットアップが書き込んだ stdio 設定も解除する。
        (Path.home() / ".gemini" / "antigravity-cli" / "mcp_config.json", "mcpServers"),
        (get_opencode_config_path(),              "mcp"),
        (get_vscode_mcp_path(),                   "servers"),
    ]

    cleanup_ok = True
    for path, top_key in targets:
        if not remove_json_mcp_servers_by_prefix(path, prefix, top_key=top_key):
            cleanup_ok = False

    print_info(f"Codex CLI 設定も解除対象です: {Path.home() / '.codex' / 'config.toml'}")
    if not remove_codex_mcp_servers_by_prefix(prefix):
        cleanup_ok = False

    print_info(f"Grok CLI 設定も解除対象です: {get_grok_config_path()}")
    if not remove_grok_mcp_servers_by_prefix(prefix):
        cleanup_ok = False

    vscode_chat = get_vscode_chat_models_path()
    print_info(f"VS Code チャットモデル設定も解除対象です: {vscode_chat}")
    if not remove_vscode_aidiy_chat_models(vscode_chat):
        cleanup_ok = False

    if cleanup_ok:
        print_success(f"グローバルMCP設定の解除処理を完了しました: {prefix}*")
    else:
        print_warning(f"グローバルMCP設定の解除に失敗しました: {prefix}*")

    return cleanup_ok


# ============================================================
# クリーンアップ本体
# ============================================================
def is_tools_process(process: dict, root: Path, windows: bool) -> bool:
    name = (process.get('Name') or '').lower()
    if not (name.startswith('python') and (not windows or name.endswith('.exe'))):
        return False
    try:
        args = process_arguments(process.get('CommandLine') or '', windows)
    except ValueError:
        return False
    normalize = (lambda value: ntpath.normcase(ntpath.normpath(value))) if windows else os.path.normpath
    join = ntpath.join if windows else os.path.join
    interpreters = {normalize(join(str(root), env, 'Scripts' if windows else 'bin', executable))
                    for env in BACKEND_TOOLS_ENV_LIST
                    for executable in (('python.exe', 'pythonw.exe') if windows else ('python', 'python3'))}
    if normalize(process.get('ExecutablePath') or '') in interpreters:
        return True
    if args and normalize(args[0]) in interpreters:
        # Windows の venv ランチャーが起動した通常 Python の子も含む。
        return True
    entry = next((arg for arg in args[1:] if not arg.startswith('-')), '')
    return normalize(entry) in {normalize(join(str(root), filename))
                               for filename in ('mcp_stdio.py', 'tools_main.py')}


def is_tools_chrome_process(process: dict, root: Path, windows: bool) -> bool:
    """通常のChromeには触れず、この配置先の専用プロファイルだけ照合する。"""
    if (process.get('Name') or '').lower() not in ('chrome.exe', 'chrome', 'google-chrome', 'chromium', 'chromium-browser'):
        return False
    try:
        args = process_arguments(process.get('CommandLine') or '', windows)
    except ValueError:
        return False
    path_api = ntpath if windows else os.path
    for index, arg in enumerate(args):
        if arg.startswith('--user-data-dir='):
            profile = arg.split('=', 1)[1]
        elif arg == '--user-data-dir' and index + 1 < len(args):
            profile = args[index + 1]
        else:
            continue
        profile = path_api.normcase(path_api.normpath(profile))
        parent = path_api.normcase(path_api.normpath(path_api.join(str(root), 'temp')))
        return (path_api.dirname(profile) == parent
                and re.fullmatch(r'_chrome_profile(?:_s\d+)?', path_api.basename(profile)) is not None)
    return False


def stop_tools_processes(exclude_pids: frozenset[int] = frozenset()) -> bool:
    """tools の Python / MCP 接続を止める。`exclude_pids`（例: aidiy_code 配下）は対象外。"""
    return stop_matching(lambda p: p.get('ProcessId') not in exclude_pids
                         and (is_tools_process(p, BACKEND_TOOLS_DIR.resolve(), sys.platform == 'win32')
                              or is_tools_chrome_process(p, BACKEND_TOOLS_DIR.resolve(), sys.platform == 'win32')),
                         print_info, print_warning, 'バックエンド(tools) の Python / MCP 接続・専用Chrome')


def cleanup(choices: dict) -> bool:
    label = "バックエンド(tools)"
    print_header(f"{label} のクリーンアップ")
    if not stop_tools_processes():
        return False
    cleanup_ok = True
    deleted_count = 0

    if not BACKEND_TOOLS_DIR.exists():
        print_warning(f"{label} のフォルダが見つかりません")
    else:
        deleted_count, cleanup_ok = cleanup_common_python_caches(BACKEND_TOOLS_DIR, label)

        tools_envs = choices.get("tools_envs", {})
        for env_name in BACKEND_TOOLS_ENV_LIST:
            env_dir = BACKEND_TOOLS_DIR / env_name
            if not env_dir.exists():
                continue
            if tools_envs.get(env_name):
                if remove_directory(env_dir, f"{env_name} ({label})"):
                    deleted_count += 1
                else:
                    cleanup_ok = False
                    print_error(f"  {env_name} 削除失敗。手動で削除してください: {env_dir}")
            elif env_name in tools_envs:
                print_info(f"  {env_name} はそのまま残します")

        node_modules_dir = BACKEND_TOOLS_DIR / "node_modules"
        if node_modules_dir.exists():
            if choices.get("tools_node_modules") is True:
                if remove_directory(node_modules_dir, f"node_modules ({label})"):
                    deleted_count += 1
                else:
                    cleanup_ok = False
            elif choices.get("tools_node_modules") is False:
                print_info("  node_modules はそのまま残します")

        temp_dir = BACKEND_TOOLS_DIR / "temp"
        if temp_dir.exists():
            if choices.get("tools_temp") is True:
                if remove_directory(temp_dir, f"temp ({label})"):
                    deleted_count += 1
                else:
                    cleanup_ok = False
            elif choices.get("tools_temp") is False:
                print_info("  temp はそのまま残します")

    # 各 CLI のグローバル MCP 設定 (aidiy_*) を解除する
    print()
    if not cleanup_global_mcp_configs(BACKEND_TOOLS_SERVER_PREFIX):
        cleanup_ok = False

    if not cleanup_ok:
        print_warning(f"{label}: 一部のクリーンアップを完了できませんでした")
    elif deleted_count > 0:
        print_success(f"{label} のクリーンアップ完了 ({deleted_count}個削除)")
    else:
        print_info(f"{label}: 削除対象はありませんでした")
    return cleanup_ok


def collect_choices() -> dict | None:
    choices: dict = {
        "tools_envs": {},
        "tools_node_modules": None,
        "tools_temp": None,
    }
    if BACKEND_TOOLS_DIR.exists():
        for env_name in BACKEND_TOOLS_ENV_LIST:
            if (BACKEND_TOOLS_DIR / env_name).exists():
                choices["tools_envs"][env_name] = ask_yes_no(f"  {env_name} を削除しますか？", default="y")
        if (BACKEND_TOOLS_DIR / "node_modules").exists():
            choices["tools_node_modules"] = ask_yes_no("  node_modules を削除しますか？", default="y")
        if (BACKEND_TOOLS_DIR / "temp").exists():
            choices["tools_temp"] = ask_yes_no("  temp フォルダを削除しますか？", default="y")
    return choices


def main():
    global AUTO_MODE
    print_header("バックエンド(tools) クリーンアップ")
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
