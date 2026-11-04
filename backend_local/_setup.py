# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Local セットアップスクリプト

ローカル LLM (OpenAI 互換 Gemma サーバー) の依存関係 (uv sync --upgrade) を導入します。
モデルの事前ダウンロードは時間がかかるため、`run_model_download(choices)` として
分離しており、ルートからは全体処理の最後に呼び出されます。

公開 API:
    setup(choices=None) -> bool
    run_model_download(choices=None) -> None       # ブロッキング実行（投入先プロセス本体）
    launch_model_download(choices=None) -> bool    # 別プロセスで非ブロッキング投入
"""

import json
import os
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
sys.path.insert(0, str(THIS_DIR.parent / "scripts"))
from _runtime_requirements import python_requirement
BACKEND_LOCAL_DIR = THIS_DIR
PROJECT_ROOT = THIS_DIR.parent
BACKEND_SERVER_DIR = PROJECT_ROOT / "backend_server"
CONFIG_DIR = PROJECT_ROOT / "_config"
BACKEND_LOCAL_ENV = ".venv"

AUTO_MODE = False

# VS Code chatLanguageModels.json 用設定 — aidiy_local (backend_local)
LOCAL_CHAT_PROVIDER_NAME = "aidiy_local"
LOCAL_CHAT_URL = "http://127.0.0.1:8096/v1/chat/completions"
LOCAL_CHAT_MODEL_IDS_FALLBACK = [
    "google/gemma-4-E2B-it",
    "google/gemma-4-E4B-it",
    "google/gemma-4-E2B-it-qat-mobile-transformers",
    "google/gemma-4-E4B-it-qat-mobile-transformers",
]
VSCODE_LOCAL_MAX_INPUT_TOKENS = 128000
VSCODE_LOCAL_MAX_OUTPUT_TOKENS = 16000


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


def ask_download_mode(prompt, default="n"):
    """モデルDL選択。戻り値: "no"(取得しない) / "one"(設定モデル) / "all"(候補一括)。"""
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


# ============================================================
# VS Code chatLanguageModels.json ヘルパー
# ============================================================
def get_vscode_chat_models_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "Code" / "User" / "chatLanguageModels.json"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Code" / "User" / "chatLanguageModels.json"
    return Path.home() / ".config" / "Code" / "User" / "chatLanguageModels.json"


def _load_json_list_file(path: Path) -> list:
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_json_list_file(path: Path, data: list) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        return True
    except Exception as e:
        print_error(f"JSON書き込みエラー: {path} ({e})")
        return False


def _load_local_chat_model_ids() -> list:
    local_path = CONFIG_DIR.parent / "_AIDIY" / "aidiy_diag" / "chat_models_info.json"
    try:
        with open(local_path, encoding="utf-8") as f:
            data = json.load(f)
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


def _upsert_provider(providers: list, provider: dict) -> list:
    name = provider["name"]
    for i, entry in enumerate(providers):
        if isinstance(entry, dict) and entry.get("name") == name:
            providers[i] = provider
            return providers
    providers.append(provider)
    return providers


def upsert_vscode_local_chat() -> bool:
    path = get_vscode_chat_models_path()
    try:
        providers = _load_json_list_file(path)
        if not providers:
            providers = [{"name": "Ollama", "vendor": "ollama", "url": "http://127.0.0.1:11434"}]
        providers = _upsert_provider(providers, _build_local_chat_provider())
        if not _write_json_list_file(path, providers):
            return False
        print_success(f"VS Code チャットモデル設定を書き込みました: {path} ({LOCAL_CHAT_PROVIDER_NAME})")
        return True
    except json.JSONDecodeError as e:
        print_error(f"JSON解析エラー: {path} ({e})")
        return False
    except Exception as e:
        print_error(f"VS Code チャットモデル設定更新エラー: {path} ({e})")
        return False


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
    return shutil.which("uv") is not None


# ============================================================
# モデル事前ダウンロード
# ============================================================
def copy_preloaded_backend_local_models(label: str) -> None:
    """事前配置された ../models を backend_local/temp/models へ取り込む。"""
    target_dir = BACKEND_LOCAL_DIR / "temp" / "models"
    source_dir = PROJECT_ROOT.parent / "models"

    if target_dir.exists():
        return
    if not source_dir.is_dir():
        return

    try:
        print_info(f"{label}: 事前ダウンロード済みモデル候補を検出しました: {source_dir}")
        print_info(f"{label}: {target_dir} へコピーします（初回のみ）。")
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source_dir, target_dir, symlinks=True)
        print_success(f"{label}: 事前ダウンロード済みモデルをコピーしました。")
    except Exception as e:
        print_warning(f"{label}: 事前ダウンロード済みモデルのコピーに失敗しました: {e}")
        print_info(f"{label}: 通常のモデルダウンロード処理を続行します。")


def run_model_download(choices: dict | None = None) -> None:
    """backend_local のモデル事前ダウンロードを行う（全体処理の最後に実行される想定）。"""
    choices = choices or {}
    label = "Local"

    mode = choices.get("local_download", "no")
    # 後方互換: 旧 bool 値も許容
    if mode is True:
        mode = "one"
    elif mode is False:
        mode = "no"

    if mode not in ("one", "all"):
        print_info(f"{label}: 事前ダウンロードはスキップしました（使用時にロードされます）。")
        return

    print_header(f"{label} モデル事前ダウンロード")
    print_info("モデルの取得は時間がかかるため、セットアップ処理の最後に実行します。")
    print_info("ほかのセットアップ済み機能は、この処理中でも別ターミナルから利用開始できます。")

    copy_preloaded_backend_local_models(label)

    cmd = ["uv", "run", "python", "download_model.py"]
    if mode == "all":
        cmd.append("--all")
        print_info(f"{label}: 候補モデルを temp/models へ一括ダウンロードします（多数 GB・かなり時間がかかります）...")
    else:
        print_info(f"{label}: 設定モデルを temp/models へ事前ダウンロードします（数 GB・時間がかかります）...")
    print_info("  トークンは AiDiy_key.json の huggingface_key_read を使用します。")
    if not run_command(cmd, cwd=BACKEND_LOCAL_DIR):
        print_warning(f"{label}: モデル事前ダウンロードに失敗しました（起動時に再取得されます）。")
        print_info("  AiDiy_key.json の huggingface_key_read を確認し、手動で再実行できます:")
        print_info("    cd backend_local && uv run python download_model.py   （または --all）")
    else:
        print_success(f"{label}: モデルの事前ダウンロードが完了しました。")


def launch_model_download(choices: dict | None = None) -> bool:
    """モデル事前ダウンロードを別プロセスで投入する（非ブロッキング）。

    この `_setup.py` 自身を `--download-models <mode>` 付きで起動し、
    その先で run_model_download() を実行する。投入できた場合 True、
    取得不要でスキップした場合 False を返す。
    """
    choices = choices or {}
    label = "Local"

    mode = choices.get("local_download", "no")
    # 後方互換: 旧 bool 値も許容
    if mode is True:
        mode = "one"
    elif mode is False:
        mode = "no"

    if mode not in ("one", "all"):
        print_info(f"{label}: 事前ダウンロードはスキップしました（使用時にロードされます）。")
        return False

    script_path = Path(__file__).resolve()
    command = [sys.executable, str(script_path), "--download-models", mode]

    print_header(f"{label} モデル事前ダウンロード（別プロセス投入）")
    print_info("モデルの取得には時間がかかるため、別プロセスで投入します。")
    print_info("この処理の完了を待たずにセットアップは終了できます。")
    print_info(f"  コマンド: {' '.join(command)}")

    try:
        if sys.platform == "win32":
            creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            subprocess.Popen(command, cwd=str(BACKEND_LOCAL_DIR), creationflags=creationflags)
            print_success(f"{label}: 別プロセス（新しいコンソール）でモデルダウンロードを投入しました。")
            print_info("  進捗は新しく開いたコンソールウィンドウで確認できます。")
        else:
            log_path = BACKEND_LOCAL_DIR / "model_download.log"
            log_file = open(log_path, "ab")
            subprocess.Popen(
                command,
                cwd=str(BACKEND_LOCAL_DIR),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            print_success(f"{label}: 別プロセスでモデルダウンロードを投入しました。")
            print_info(f"  進捗ログ: {log_path}")
        return True
    except Exception as e:
        print_warning(f"{label}: モデルダウンロードの別プロセス投入に失敗しました: {e}")
        print_info("  手動で実行できます: cd backend_local && uv run python download_model.py   （または --all）")
        return False


# ============================================================
# セットアップ本体
# ============================================================
def setup(choices: dict | None = None) -> bool:
    choices = choices or {}
    label = "Local"
    print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {BACKEND_LOCAL_DIR}")
    print_info("対象: Python / uv / FastAPI / PyTorch / Transformers / Gemma")

    if not BACKEND_LOCAL_DIR.exists():
        print_error(f"{label}: フォルダが見つかりません: {BACKEND_LOCAL_DIR}")
        return False

    if not check_uv_installed():
        print_error(f"{label}: uv がインストールされていません。")
        print_info("  PowerShell: irm https://astral.sh/uv/install.ps1 | iex")
        print_info("  または: pip install uv")
        return False

    req_file = BACKEND_LOCAL_DIR / "pyproject.toml"
    if not req_file.exists():
        print_error(f"{label}: pyproject.toml が見つかりません: {req_file}")
        return False

    try:
        requirement = python_requirement(BACKEND_LOCAL_DIR)
    except (OSError, ValueError) as exc:
        print_warning(f"{label}: Python 実行条件を確認できません。uv の確認を続行します: {exc}")
    else:
        print_info(f"実行環境: Python {requirement}（pyproject.toml。uv が互換 Python を選択します）")

    venv_dir = BACKEND_LOCAL_DIR / BACKEND_LOCAL_ENV
    if venv_dir.exists():
        print_success(f"{label}: 既存の仮想環境を検出しました: {venv_dir}")

    print_info(f"{label}: uv sync --upgrade を実行します（torch を含むため初回は時間がかかります）...")
    if not run_command(["uv", "sync", "--upgrade"], cwd=BACKEND_LOCAL_DIR):
        print_error(f"{label}: uv sync --upgrade に失敗しました。")
        return False

    print_success(f"{label}: 依存関係のセットアップが完了しました。")
    print_info("  モデルがゲート対象の場合は、HuggingFace でライセンス同意のうえ、")
    print_info("  AiDiy_key.json の huggingface_key_read にアクセストークンを設定してください。")
    print_info(f"{label}: モデル事前ダウンロードはセットアップ処理の最後に実行します。")

    upsert_vscode_local_chat()

    return True


def main():
    global AUTO_MODE

    # 別プロセスで投入された場合: 引数で指定されたモデルDLのみを実行して終了する
    if "--download-models" in sys.argv:
        idx = sys.argv.index("--download-models")
        mode = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "one"
        run_model_download({"local_download": mode})
        return

    print_header("Local セットアップ")
    run_setup, AUTO_MODE = ask_start_mode("Local のセットアップを実行しますか?", default="n")
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")

    download = ask_download_mode(
        "モデルを事前ダウンロードしますか？（n=しない / y=設定モデル / a=候補一括 ※劇遅注意）",
        default="n",
    )
    choices = {"local_download": download}
    if not setup(choices):
        print_error("Local のセットアップに失敗しました。")
        sys.exit(1)
    run_model_download(choices)
    print_success("Local のセットアップが完了しました。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
