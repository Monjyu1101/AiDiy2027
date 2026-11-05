# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Tools セットアップスクリプト

このフォルダ (backend_tools) 単体のセットアップを行います。
依存関係 (uv sync --upgrade / npm install) のインストールに加え、Claude / Copilot /
Antigravity / OpenCode / Codex / Grok / VS Code 各クライアントの MCP 設定書き込みを行います。

ルートの `_setup.py` から import して下記関数を呼び出すことも、
このスクリプトを直接実行して単体セットアップすることもできます。

公開 API:
    MODULE                       # backend_tools の MCP モジュール定義
    setup_dependencies() -> bool # uv sync --upgrade + npm install
    show_current_config()        # 各 CLI の MCP 設定状態を表示
    configure_clients() -> bool  # 各 CLI へ MCP 設定を書き込む
    setup(choices) -> bool       # 上記をまとめて実行
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    # セットアップ入口は古い Python でも案内を続ける。追加依存は要求しない。
    tomllib = None

if sys.platform == "win32":
    import msvcrt

# ============================================================
# 設定
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import python_requirement
PROJECT_ROOT = THIS_DIR.parent
BASE_DIR = PROJECT_ROOT
BACKEND_DIR = PROJECT_ROOT / "backend_server"
CONFIG_DIR = PROJECT_ROOT / "_config"
backend_tools_DIR = THIS_DIR
backend_tools_ENV_CANDIDATES = [".venv", "venv"]

FRONTEND_COMMAND = "npm"
AUTO_MODE = False

# VS Code チャットモデル (chatLanguageModels.json) 用設定
# 注意: URL は 127.0.0.1 を使う（localhost は ::1=IPv6 に先に解決され、サーバーが
#       IPv4 0.0.0.0 のみ待受の場合 VS Code/Electron から ERR_CONNECTION_REFUSED になる）。
CHAT_COMPLETIONS_PROVIDER_NAME = "aidiy_chat_completions"
CHAT_COMPLETIONS_URL = "http://127.0.0.1:8095/aidiy_chat_completions/v1/chat/completions"
CHAT_COMPLETIONS_MODEL_IDS = ["freeai_chat", "openrt_chat", "openrt_free", "gemini_chat", "ollama_chat"]
VSCODE_CHAT_MODEL_MAX_INPUT_TOKENS = 256000
VSCODE_CHAT_MODEL_MAX_OUTPUT_TOKENS = 16000

# VS Code チャットモデル (chatLanguageModels.json) 用設定 — backend_local（ローカル LLM / OpenAI 互換）
LOCAL_CHAT_PROVIDER_NAME = "aidiy_local"
LOCAL_CHAT_URL = "http://127.0.0.1:8096/v1/chat/completions"
# backend_local の既定フォールバック（モデル合成JSONが読めない場合のみ使用）
LOCAL_CHAT_MODEL_IDS_FALLBACK = [
    "google/gemma-4-E2B-it",
    "google/gemma-4-E4B-it",
    "google/gemma-4-E2B-it-qat-mobile-transformers",
    "google/gemma-4-E4B-it-qat-mobile-transformers",
]
# Gemma 4 は 128K コンテキスト。生成上限は backend_local の CHAT_LOCAL_MAX_TOKENS に従う。
VSCODE_LOCAL_MAX_INPUT_TOKENS = 128000
VSCODE_LOCAL_MAX_OUTPUT_TOKENS = 16000

# VS Code チャットモデル (chatLanguageModels.json) 用設定 — Ollama Cloud
OLLAMA_CLOUD_PROVIDER_NAME = "aidiy_ollama_cloud"
OLLAMA_CLOUD_URL = "https://ollama.com/v1/chat/completions"
OLLAMA_CLOUD_MODEL_IDS = [
    "gpt-oss:120b",
    "gemma4:31b",
    "qwen3.5:397b",
    "mistral-large-3:675b",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
]


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
        subprocess.run(command, cwd=cwd, shell=shell, check=True, capture_output=False, text=True, env=env)
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


def npm_command():
    return f"{FRONTEND_COMMAND}.cmd" if sys.platform == "win32" else FRONTEND_COMMAND


def check_npm_installed():
    import shutil
    return shutil.which(npm_command()) is not None or shutil.which(FRONTEND_COMMAND) is not None


# ============================================================
# JSON / TOML / 設定ファイルヘルパー
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


def upsert_json_mcp_servers(
    path: Path, entries: list[tuple[str, dict]], top_key: str = "mcpServers",
    *, remove_keys: tuple[str, ...] = (),
) -> bool:
    """複数サーバーをまとめて 1 つの JSON ファイルへ書き込む（読み書き各 1 回）。"""
    try:
        data = load_json_dict_file(path)
        servers = data.get(top_key)
        if not isinstance(servers, dict):
            servers = {}
        for server_name, server_config in entries:
            current = servers.get(server_name)
            if isinstance(current, dict):
                merged = dict(current)
                for key in remove_keys:
                    merged.pop(key, None)
                merged.update(server_config)
                servers[server_name] = merged
            else:
                servers[server_name] = dict(server_config)
        data[top_key] = servers
        if not write_json_file(path, data):
            return False
        names = ", ".join(sn for sn, _ in entries)
        print_success(f"MCP設定を書き込みました: {path} ({names})")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"MCP設定更新エラー: {path} ({e})")
        return False


def remove_json_mcp_servers(path: Path, server_names: set[str], top_key: str = "mcpServers") -> bool:
    """JSON MCP 設定から指定サーバーを削除する。存在しない場合は成功扱い。"""
    try:
        if not path.exists():
            return True
        data = load_json_dict_file(path)
        servers = data.get(top_key)
        if not isinstance(servers, dict):
            return True
        removed = [sn for sn in sorted(server_names) if sn in servers]
        if not removed:
            return True
        for sn in removed:
            servers.pop(sn, None)
        data[top_key] = servers
        if not write_json_file(path, data):
            return False
        print_info(f"MCP設定から削除しました: {path} ({', '.join(removed)})")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"MCP設定削除エラー: {path} ({e})")
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


def get_opencode_config_path() -> Path:
    xdg_config_home = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg_config_home:
        return Path(xdg_config_home) / "opencode" / "opencode.json"
    return Path.home() / ".config" / "opencode" / "opencode.json"


def get_antigravity_mcp_config_path() -> Path:
    return Path.home() / ".gemini" / "config" / "mcp_config.json"


def get_grok_config_path() -> Path:
    return Path.home() / ".grok" / "config.toml"


def _build_chat_completions_provider() -> dict:
    models = [
        {
            "id": ai_name,
            "name": ai_name,
            "url": CHAT_COMPLETIONS_URL,
            "toolCalling": True,
            "vision": True,
            "maxInputTokens": VSCODE_CHAT_MODEL_MAX_INPUT_TOKENS,
            "maxOutputTokens": VSCODE_CHAT_MODEL_MAX_OUTPUT_TOKENS,
        }
        for ai_name in CHAT_COMPLETIONS_MODEL_IDS
    ]
    return {
        "name": CHAT_COMPLETIONS_PROVIDER_NAME,
        "vendor": "customendpoint",
        "apiType": "chat-completions",
        "apiKey": "aidiy",
        "models": models,
    }


def _load_local_chat_model_ids() -> list:
    """backend_local の利用可能モデル ID をchat合成JSONから取得する。

    読めない／空の場合は LOCAL_CHAT_MODEL_IDS_FALLBACK を使う。
    """
    local_path = CONFIG_DIR.parent / "_AIDIY" / "aidiy_diag" / "chat_models_info.json"
    try:
        data = load_json_dict_file(local_path)
        models = data.get("local_chat", {}).get("models")
        if isinstance(models, dict) and models:
            return list(models.keys())
    except Exception:
        pass
    return list(LOCAL_CHAT_MODEL_IDS_FALLBACK)


def _build_local_chat_provider() -> dict:
    models = [
        {
            "id": model_id,
            "name": model_id,
            "url": LOCAL_CHAT_URL,
            "toolCalling": True,
            "vision": True,
            "maxInputTokens": VSCODE_LOCAL_MAX_INPUT_TOKENS,
            "maxOutputTokens": VSCODE_LOCAL_MAX_OUTPUT_TOKENS,
        }
        for model_id in _load_local_chat_model_ids()
    ]
    return {
        "name": LOCAL_CHAT_PROVIDER_NAME,
        "vendor": "customendpoint",
        "apiType": "chat-completions",
        "apiKey": "local",
        "models": models,
    }


def _load_aidiy_key_value(key: str) -> str:
    key_path = CONFIG_DIR / "AiDiy_key.json"
    try:
        data = load_json_dict_file(key_path)
        return str(data.get(key, ""))
    except Exception:
        return ""


def _is_valid_api_key(value: str) -> bool:
    return bool(value) and not value.startswith("<")


def _build_ollama_cloud_provider(api_key: str) -> dict:
    models = [
        {
            "id": model_id,
            "name": model_id,
            "url": OLLAMA_CLOUD_URL,
            "toolCalling": True,
            "vision": True,
            "maxInputTokens": VSCODE_CHAT_MODEL_MAX_INPUT_TOKENS,
            "maxOutputTokens": VSCODE_CHAT_MODEL_MAX_OUTPUT_TOKENS,
        }
        for model_id in OLLAMA_CLOUD_MODEL_IDS
    ]
    return {
        "name": OLLAMA_CLOUD_PROVIDER_NAME,
        "vendor": "customendpoint",
        "apiType": "chat-completions",
        "apiKey": api_key,
        "models": models,
    }


def _upsert_provider(providers: list, provider: dict) -> list:
    name = provider["name"]
    for i, entry in enumerate(providers):
        if isinstance(entry, dict) and entry.get("name") == name:
            providers[i] = provider
            return providers
    providers.append(provider)
    return providers


def upsert_vscode_chat_completions(path: Path) -> bool:
    try:
        providers = load_json_list_file(path)
        if not providers:
            providers = [{"name": "Ollama", "vendor": "ollama", "url": "http://127.0.0.1:11434"}]

        providers = _upsert_provider(providers, _build_chat_completions_provider())
        providers = _upsert_provider(providers, _build_local_chat_provider())

        ollama_key = _load_aidiy_key_value("ollama_key_id")
        if _is_valid_api_key(ollama_key):
            providers = _upsert_provider(providers, _build_ollama_cloud_provider(ollama_key))
            cloud_msg = f", {OLLAMA_CLOUD_PROVIDER_NAME}"
        else:
            print_warning(f"ollama_key_id が未設定のため {OLLAMA_CLOUD_PROVIDER_NAME} はスキップしました。")
            cloud_msg = ""

        if not write_json_list_file(path, providers):
            return False
        print_success(f"VS Code チャットモデル設定を書き込みました: {path} ({CHAT_COMPLETIONS_PROVIDER_NAME}, {LOCAL_CHAT_PROVIDER_NAME}{cloud_msg})")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"VS Code チャットモデル設定更新エラー: {path} ({e})")
        return False


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


def toml_escape_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def upsert_toml_table(path: Path, table_header: str, body_lines: list[str]) -> bool:
    try:
        content = path.read_text(encoding="utf-8-sig") if path.exists() else ""
        updated = remove_toml_table(content, table_header).rstrip()
        block = table_header + "\n" + "\n".join(body_lines).rstrip() + "\n"
        if updated:
            updated = updated + "\n\n" + block
        else:
            updated = block
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(updated, encoding="utf-8")
        return True
    except Exception as e:
        print_error(f"TOML設定更新エラー: {path} ({e})")
        return False


def remove_toml_mcp_servers(config_path: Path, server_names: set[str], label: str) -> bool:
    try:
        if not config_path.exists():
            return True
        original = config_path.read_text(encoding="utf-8")
        updated = original
        removed: list[str] = []
        for server_name in sorted(server_names):
            table_header = f"[mcp_servers.{server_name}]"
            next_updated = remove_toml_table(updated, table_header)
            if next_updated != updated:
                removed.append(server_name)
                updated = next_updated
        if not removed:
            return True
        config_path.write_text(updated, encoding="utf-8")
        print_info(f"{label} MCP設定から削除しました: {config_path} ({', '.join(removed)})")
        return True
    except Exception as e:
        print_error(f"{label} MCP設定削除エラー: {config_path} ({e})")
        return False


def remove_codex_mcp_servers(server_names: set[str]) -> bool:
    return remove_toml_mcp_servers(Path.home() / ".codex" / "config.toml", server_names, "Codex")


def remove_grok_mcp_servers(server_names: set[str]) -> bool:
    return remove_toml_mcp_servers(get_grok_config_path(), server_names, "Grok")


def find_python_in_env(base_dir: Path, env_candidates: list[str]) -> Path | None:
    for env_name in env_candidates:
        if sys.platform == "win32":
            python_path = base_dir / env_name / "Scripts" / "python.exe"
        else:
            python_path = base_dir / env_name / "bin" / "python"
        if python_path.exists():
            return python_path
    return None


def ensure_python_module_attribute(
    python_path: Path,
    module_name: str,
    attr_name: str,
    repair_command: list[str],
    cwd: Path,
    label: str,
) -> bool:
    check_code = (
        "import importlib, sys; "
        "m = importlib.import_module(sys.argv[1]); "
        "raise SystemExit(0 if hasattr(m, sys.argv[2]) else 1)"
    )
    check_command = [str(python_path), "-c", check_code, module_name, attr_name]
    result = subprocess.run(check_command, cwd=cwd, capture_output=True, text=True)
    if result.returncode == 0:
        return True
    print_warning(f"{label}: {module_name}.{attr_name} が見つかりません。依存関係を修復します。")
    if not run_command(repair_command, cwd=cwd):
        return False
    result = subprocess.run(check_command, cwd=cwd, capture_output=True, text=True)
    if result.returncode == 0:
        print_success(f"{label}: {module_name} の修復が完了しました。")
        return True
    print_error(f"{label}: {module_name}.{attr_name} の確認に失敗しました。")
    return False


def upsert_codex_backend_tools_config(module: dict) -> bool:
    """Codex CLI へ Streamable HTTP の /mcp 接続を登録する。"""
    config_path = Path.home() / ".codex" / "config.toml"
    server_name = module.get("server_name", module["name"])
    sse_url = module.get("sse_url", "").strip().rstrip("/")
    mcp_url = sse_url.removesuffix("/sse") + "/mcp"
    table_header = f"[mcp_servers.{server_name}]"
    body_lines = [
        f'url = "{toml_escape_string(mcp_url)}"',
        "startup_timeout_sec = 60",
    ]
    if not upsert_toml_table(config_path, table_header, body_lines):
        return False
    return True


def upsert_grok_backend_tools_config(module: dict) -> bool:
    """Grok Build CLI は SSE をネイティブ対応するため、stdio ブリッジは使わない。"""
    config_path = get_grok_config_path()
    server_name = module.get("server_name", module["name"])
    sse_url = module.get("sse_url", "").strip()
    table_header = f"[mcp_servers.{server_name}]"
    body_lines = [
        f'url = "{toml_escape_string(sse_url)}"',
        'type = "sse"',
        "enabled = true",
    ]
    if not upsert_toml_table(config_path, table_header, body_lines):
        return False
    return True


# ============================================================
# tools モジュール定義
# 新しい tools を追加するときはここにエントリを追加するだけ
# ============================================================
MCP_MODULES = [
    {
        "name":        "backend_tools",
        "server_name": "aidiy_chrome_devtools",   # MCP 設定ファイル上のサーバーキー名
        "dir":         "backend_tools",
        "desc":        "Python / uv / FastAPI / MCP",
        "start":       "uv run uvicorn tools_main:app --host 127.0.0.1 --port 8095 --ws-max-size 20971520",
        "sse_url":     "http://127.0.0.1:8095/aidiy_chrome_devtools/sse",
        # 同一プロセスで追加公開するサーバー（uv sync は不要、設定書き込みのみ）
        "extra_servers": [
            {"server_name": "aidiy_desktop_capture",   "sse_url": "http://127.0.0.1:8095/aidiy_desktop_capture/sse"},
            {"server_name": "aidiy_sqlite",            "sse_url": "http://127.0.0.1:8095/aidiy_sqlite/sse"},
            {"server_name": "aidiy_postgres",          "sse_url": "http://127.0.0.1:8095/aidiy_postgres/sse"},
            {"server_name": "aidiy_logs",              "sse_url": "http://127.0.0.1:8095/aidiy_logs/sse"},
            {"server_name": "aidiy_code_check",        "sse_url": "http://127.0.0.1:8095/aidiy_code_check/sse"},
            {"server_name": "aidiy_decisions_check",   "sse_url": "http://127.0.0.1:8095/aidiy_decisions_check/sse"},
            {"server_name": "aidiy_backup",            "sse_url": "http://127.0.0.1:8095/aidiy_backup/sse"},
            {"server_name": "aidiy_image_generation",  "sse_url": "http://127.0.0.1:8095/aidiy_image_generation/sse"},
            {"server_name": "aidiy_movie_generation",  "sse_url": "http://127.0.0.1:8095/aidiy_movie_generation/sse"},
            {"server_name": "aidiy_speech_to_text",    "sse_url": "http://127.0.0.1:8095/aidiy_speech_to_text/sse"},
            {"server_name": "aidiy_text_to_speech",    "sse_url": "http://127.0.0.1:8095/aidiy_text_to_speech/sse"},
            {"server_name": "aidiy_obs_studio_control","sse_url": "http://127.0.0.1:8095/aidiy_obs_studio_control/sse"},
            {"server_name": "aidiy_ffmpeg_control",    "sse_url": "http://127.0.0.1:8095/aidiy_ffmpeg_control/sse"},
            {"server_name": "aidiy_notification_sounds","sse_url": "http://127.0.0.1:8095/aidiy_notification_sounds/sse"},
            {"server_name": "aidiy_windows_control",   "sse_url": "http://127.0.0.1:8095/aidiy_windows_control/sse", "platforms": ["win32"]},
            # aidiy_code_agents / aidiy_chat_llms は自前 MCP 群をツールとして利用する
            # （他サーバーが出そろってから接続したい）ため、必ず末尾に並べる。
            {"server_name": "aidiy_code_agents",       "sse_url": "http://127.0.0.1:8095/aidiy_code_agents/sse"},
            {"server_name": "aidiy_chat_llms",         "sse_url": "http://127.0.0.1:8095/aidiy_chat_llms/sse"},
            {"server_name": "aidiy_task_agents",       "sse_url": "http://127.0.0.1:8095/aidiy_task_agents/sse"},
            {"server_name": "aidiy_team_agents",       "sse_url": "http://127.0.0.1:8095/aidiy_team_agents/sse"},
        ],
    },
]

# backend_tools の MCP モジュール定義（公開用）
MODULE = MCP_MODULES[0]

CODE_CLI_MCP_EXCLUDE = {
    "aidiy_image_generation",
}


def setup_mcp_module(module: dict) -> bool:
    """tools モジュールを汎用的にセットアップする (uv sync --upgrade + npm install)"""
    label = "Tools"
    mcp_dir = BASE_DIR / module["dir"]

    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {mcp_dir}")
    print_info(f"対象: {module.get('desc', '')}")

    if not mcp_dir.exists():
        print_error(f"{label}: フォルダが見つかりません: {mcp_dir}")
        return False

    # uv sync --upgrade (pyproject.toml があれば)
    if (mcp_dir / "pyproject.toml").exists():
        try:
            requirement = python_requirement(mcp_dir)
        except (OSError, ValueError) as exc:
            print_warning(f"{label}: Python 実行条件を確認できません。uv の確認を続行します: {exc}")
        else:
            print_info(f"実行環境: Python {requirement}（pyproject.toml。uv が互換 Python を選択します）")
        if not check_uv_installed():
            print_error(f"{label}: uv がインストールされていません。")
            return False
        default_env = mcp_dir / ".venv"
        executable = Path("Scripts/python.exe") if sys.platform == "win32" else Path("bin/python")
        if default_env.exists() and not (default_env / executable).exists():
            print_info("別 OS の .venv をクリアして再作成します。")
            if not run_command(["uv", "venv", "--clear", ".venv"], cwd=mcp_dir):
                return False
        if not run_command(["uv", "sync", "--upgrade", "--no-install-project"], cwd=mcp_dir):
            print_error(f"{label}: uv sync --upgrade に失敗しました。")
            return False
        python_path = find_python_in_env(mcp_dir, backend_tools_ENV_CANDIDATES)
        if python_path is None:
            print_error(f"{label}: Python 仮想環境が見つかりません: {mcp_dir}")
            return False
        if not ensure_python_module_attribute(
            python_path,
            "click",
            "Choice",
            ["uv", "sync", "--no-install-project", "--reinstall-package", "click"],
            mcp_dir,
            label,
        ):
            return False
        print_success(f"{label}: Python 依存関係のインストールが完了しました。")

    # npm install (package.json があれば)
    if (mcp_dir / "package.json").exists():
        if not check_npm_installed():
            print_error(f"{label}: npm がインストールされていません。")
            return False
        if not run_command([npm_command(), "install"], cwd=mcp_dir):
            print_error(f"{label}: npm install に失敗しました。")
            return False
        print_success(f"{label}: npm パッケージのインストールが完了しました。")

    print_success(f"{label}: セットアップが完了しました。")
    print_info(f"  起動方法: cd {module['dir']} && {module.get('start', 'uv run tools_main.py')}")
    if "sse_url" in module:
        print_info(f"  SSE URL : {module['sse_url']}")
    return True


def setup_dependencies() -> bool:
    """登録済みの tools モジュールを順番にセットアップする"""
    all_ok = True
    for module in MCP_MODULES:
        if not setup_mcp_module(module):
            all_ok = False
            break
    return all_ok


def show_current_config(module: dict | None = None) -> None:
    """MCP 設定ファイルの現在の内容を表示する"""
    module = module or MODULE
    server_names = [module.get("server_name", module["name"])]
    for extra in module.get("extra_servers", []):
        if sys.platform not in extra.get("platforms", [sys.platform]):
            continue
        server_names.append(extra["server_name"])

    copilot_home = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot")))
    vscode_mcp   = get_vscode_mcp_path()
    opencode_mcp = get_opencode_config_path()
    antigravity_mcp = get_antigravity_mcp_config_path()

    targets = [
        ("グローバル ~/.claude.json (Claude Code)",               Path.home() / ".claude.json",            "mcpServers"),
        ("グローバル ~/.copilot/mcp-config.json (Copilot CLI)",    copilot_home / "mcp-config.json",        "mcpServers"),
        ("グローバル ~/.gemini/config/mcp_config.json (Antigravity)", antigravity_mcp,               "mcpServers"),
        ("グローバル ~/.config/opencode/opencode.json (OpenCode)", opencode_mcp,                            "mcp"),
        ("グローバル ~/.codex/config.toml (Codex CLI)",            Path.home() / ".codex" / "config.toml",  "mcpServers"),
        ("グローバル ~/.grok/config.toml (Grok CLI)",              get_grok_config_path(),                  "mcpServers"),
        ("グローバル Code/User/mcp.json (VS Code)",                vscode_mcp,                              "servers"),
    ]

    print_info("─── MCP 設定ファイルの現在の状態 ───")
    for label, path, top_key in targets:
        excluded = set()
        if path in (Path.home() / ".codex" / "config.toml", antigravity_mcp):
            excluded = CODE_CLI_MCP_EXCLUDE
        elif path == vscode_mcp:
            excluded = {"aidiy_code_agents", "aidiy_chat_llms"}
        expected = [sn for sn in server_names if sn not in excluded]
        if path.exists():
            try:
                if path.suffix.lower() == ".toml":
                    if tomllib is None:
                        print_warning(f"  [{label}] 設定確認をスキップ（TOML解析には Python 3.11 以上が必要）")
                        continue
                    data = tomllib.loads(path.read_text(encoding="utf-8-sig"))
                    top_key = "mcp_servers"
                else:
                    data = load_json_dict_file(path)
                servers = data.get(top_key)
                if not isinstance(servers, dict):
                    print_warning(f"  [{label}] ファイルあり、{top_key} なし／形式不正")
                    continue
                configured = sum(isinstance(servers.get(sn), dict) for sn in expected)
                missing = len(expected) - configured
                report = print_warning if missing else print_success
                report(f"  [{label}] 設定済み{configured}件／未設定{missing}件")
            except Exception:
                print_warning(f"  [{label}] 読み取りエラー: {path}")
        else:
            print_info(f"  [{label}] 未設定 (ファイルなし)")
    print()


def configure_clients(module: dict | None = None) -> bool:
    """backend_tools を各 CLI から使うための設定ファイルを書き込む（extra_servers も含む）。"""
    module = module or MODULE
    label = f"{module['name']} MCP 設定"
    print_header(label)
    print_info("Claude / GitHub Copilot / Antigravity / OpenCode / Codex / Grok / VS Code 用のグローバル設定ファイルを書き込みます。")
    print_info("Codex / Antigravity は Streamable HTTP の /mcp へ直接接続します。")
    print_info("Grok CLI は ~/.grok/config.toml へ type=sse で直接登録します。")

    servers: list[tuple[str, str]] = []
    main_sn  = module.get("server_name", module["name"])
    main_url = module.get("sse_url", "").strip()
    if main_url:
        servers.append((main_sn, main_url))
    else:
        print_error(f"  {main_sn}: sse_url が未定義です。スキップします。")
    for extra in module.get("extra_servers", []):
        if sys.platform not in extra.get("platforms", [sys.platform]):
            continue
        url = extra.get("sse_url", "").strip()
        if url:
            servers.append((extra["server_name"], url))
        else:
            print_error(f"  {extra['server_name']}: sse_url が未定義です。スキップします。")

    if not servers:
        print_warning(f"{label}: 書き込み対象サーバーが 1 つもありません。")
        return False

    print_info("書き込むサーバー:")
    for sn, url in servers:
        print_info(f"  ─ {sn} ({url})")

    all_ok = True
    # 以前のセットアップで追加されたローカル Windows 専用 MCP も除外する。
    if sys.platform != "win32":
        windows_only = {"aidiy_windows_control"}
        copilot_home = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot")))
        for path, top_key in (
            (Path.home() / ".claude.json", "mcpServers"),
            (copilot_home / "mcp-config.json", "mcpServers"),
            (get_antigravity_mcp_config_path(), "mcpServers"),
            (get_opencode_config_path(), "mcp"),
            (get_vscode_mcp_path(), "servers"),
        ):
            all_ok &= remove_json_mcp_servers(path, windows_only, top_key=top_key)
        all_ok &= remove_codex_mcp_servers(windows_only)
        all_ok &= remove_grok_mcp_servers(windows_only)

    # 1) AiDiy プロジェクト設定 (mcpServers)
    aidiy_mcp = CONFIG_DIR / "AiDiy_mcp.json"
    print_info(f"[AiDiy設定]   {aidiy_mcp}")
    if sys.platform != "win32":
        all_ok &= remove_json_mcp_servers(aidiy_mcp, {"aidiy_windows_control"})
    all_ok &= upsert_json_mcp_servers(aidiy_mcp, [(sn, {"type": "sse", "url": url}) for sn, url in servers])

    # 2) Claude Code (mcpServers)
    claude_global = Path.home() / ".claude.json"
    print_info(f"[Claude Code] {claude_global}")
    all_ok &= upsert_json_mcp_servers(claude_global, [(sn, {"type": "sse", "url": url}) for sn, url in servers])

    # 3) GitHub Copilot CLI (mcpServers)
    copilot_home = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot")))
    copilot_global = copilot_home / "mcp-config.json"
    print_info(f"[Copilot CLI] {copilot_global}")
    all_ok &= upsert_json_mcp_servers(copilot_global, [(sn, {"type": "sse", "url": url}) for sn, url in servers])

    code_cli_servers = [(sn, url) for sn, url in servers if sn not in CODE_CLI_MCP_EXCLUDE]
    code_cli_excluded = sorted(sn for sn, _ in servers if sn in CODE_CLI_MCP_EXCLUDE)

    # 4) Antigravity (mcpServers - Streamable HTTP)
    antigravity_mcp = get_antigravity_mcp_config_path()
    print_info(f"[Antigravity] {antigravity_mcp}")
    if code_cli_excluded:
        print_info(f"  Codex/Antigravity 除外: {', '.join(code_cli_excluded)}")
    all_ok &= remove_json_mcp_servers(antigravity_mcp, CODE_CLI_MCP_EXCLUDE)

    # 旧 stdio の起動キーや別形式の URL を除き、利用者のその他の設定は残す。
    all_ok &= upsert_json_mcp_servers(
        antigravity_mcp,
        [(sn, {"serverUrl": url.rstrip("/").removesuffix("/sse") + "/mcp"}) for sn, url in code_cli_servers],
        remove_keys=("command", "args", "env", "cwd", "type", "url", "httpUrl"),
    )

    # 5) OpenCode (tools)
    opencode_global = get_opencode_config_path()
    print_info(f"[OpenCode]    {opencode_global}")
    all_ok &= upsert_json_mcp_servers(
        opencode_global,
        [(sn, {"type": "remote", "url": url, "enabled": True}) for sn, url in servers],
        top_key="mcp",
    )

    # 6) Codex CLI (TOML, Streamable HTTP)
    codex_path = Path.home() / ".codex" / "config.toml"
    print_info(f"[Codex CLI]   {codex_path}")
    all_ok &= remove_codex_mcp_servers(CODE_CLI_MCP_EXCLUDE)
    codex_written: list[str] = []
    for sn, url in code_cli_servers:
        codex_module = {**module, "server_name": sn, "sse_url": url}
        if upsert_codex_backend_tools_config(codex_module):
            codex_written.append(sn)
        else:
            all_ok = False
    if codex_written:
        print_success(f"MCP設定を書き込みました: {codex_path} ({', '.join(codex_written)})")

    # 7) Grok CLI (TOML, native SSE)
    grok_path = get_grok_config_path()
    print_info(f"[Grok CLI]    {grok_path}")
    grok_written: list[str] = []
    for sn, url in servers:
        grok_module = {**module, "server_name": sn, "sse_url": url}
        if upsert_grok_backend_tools_config(grok_module):
            grok_written.append(sn)
        else:
            all_ok = False
    if grok_written:
        print_success(f"MCP設定を書き込みました: {grok_path} ({', '.join(grok_written)})")

    # 8) VS Code (servers)
    VSCODE_EXCLUDE = {"aidiy_code_agents", "aidiy_chat_llms"}
    vscode_servers = [(sn, url) for sn, url in servers if sn not in VSCODE_EXCLUDE]
    vscode_mcp = get_vscode_mcp_path()
    print_info(f"[VS Code]     {vscode_mcp}")
    print_info(f"  VS Code 除外: {', '.join(sorted(VSCODE_EXCLUDE))}")

    try:
        if vscode_mcp.exists():
            vscode_data = load_json_dict_file(vscode_mcp)
            vscode_dict = vscode_data.get("servers")
            if isinstance(vscode_dict, dict):
                removed = [sn for sn in VSCODE_EXCLUDE if sn in vscode_dict]
                if removed:
                    for sn in removed:
                        vscode_dict.pop(sn, None)
                    vscode_data["servers"] = vscode_dict
                    write_json_file(vscode_mcp, vscode_data)
                    print_info(f"  VS Code 既存設定から削除: {', '.join(sorted(removed))}")
    except Exception as e:
        print_warning(f"VS Code の除外対象削除中にエラーが発生しました: {e}")

    all_ok &= upsert_json_mcp_servers(
        vscode_mcp,
        [(sn, {"type": "sse", "url": url}) for sn, url in vscode_servers],
        top_key="servers",
    )

    # 9) VS Code チャットモデル (aidiy_chat_completions / OpenAI 互換 chat-completions)
    vscode_chat = get_vscode_chat_models_path()
    print_info(f"[VS Code Chat] {vscode_chat}")
    all_ok &= upsert_vscode_chat_completions(vscode_chat)

    if all_ok:
        print_success(f"{label}: 設定ファイルの書き込みが完了しました。")
    else:
        print_warning(f"{label}: 一部設定ファイルの書き込みに失敗しました。")
    return all_ok


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    """Tools をセットアップする。

    choices["mcp_config"] が True の場合のみ各 CLI への MCP 設定を書き込む。
    """
    choices = choices or {}
    ok = setup_dependencies()
    if not ok:
        return False

    print()
    show_current_config()

    if choices.get("mcp_config", True):
        if not configure_clients():
            return False
    else:
        print_warning("Tools の MCP 設定ファイル書き込みをスキップしました。")
    return True


def main():
    global AUTO_MODE
    print_header("Tools セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Tools のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。以降の質問はデフォルト値で自動回答します。")

    mcp_config = ask_yes_no("Tools の MCP 設定を各クライアントのグローバル設定へ書き込みますか？", default="y")
    ok = setup({"mcp_config": mcp_config})
    if ok:
        print_success("Tools のセットアップが完了しました。")
    else:
        print_error("Tools のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
