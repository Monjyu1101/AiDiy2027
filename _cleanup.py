# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2026 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2026
# -------------------------------------------------------------------------

"""プロジェクトクリーンアップスクリプト（まとめ役）

各フォルダの `_cleanup.py` を import し、不要なキャッシュ・ビルド成果物・
仮想環境などを対話的に一括削除します。クリーンアップを実行する場合は、削除開始前に
全常駐サービス（Discord Bot を含む）を各フォルダの `_start.py` が公開する `kill_ports()` で停止し、
Code / Live / Console / IDE の単独実行と tools の MCP 接続プロセスも強制終了・確認します。
setup / start の Code / IDE / Discord 継続方針とは異なります。ルート固有の
処理（全階層の temp / _temp / .temp / tmp / test / _test / .test とルート .aidiy_backup の削除、グローバル npm ツールの
アンインストール）のみこのスクリプトが直接担当し、フォルダ固有の処理は
各フォルダの `_cleanup.py` に委譲します。

フォルダ別スクリプト:
- backend_diag/_cleanup.py     cleanup(choices)（配布画面は保持）
- backend_local/_cleanup.py    cleanup(choices)
- backend_tools/_cleanup.py    cleanup(choices)（グローバル MCP 設定も解除）
- backend_server/_cleanup.py   cleanup(choices)
- backend_taskteam/_cleanup.py cleanup(choices)
- frontend_web/_cleanup.py     cleanup(choices)
- frontend_avatar/_cleanup.py  cleanup(choices)
- command_hermes/_cleanup.py   cleanup(choices)（ランチャー/PATH も解除）
- frontend_ide/_cleanup.py   cleanup(choices)（IDE群の拡張・ランチャー・依存物・共通UIを解除）
- frontend_channels/_cleanup.py cleanup(choices)（Bot 停止・依存物削除）
- frontend_channels/slack/_cleanup.py cleanup(choices)（Slack Bot 停止・依存物削除）

Usage:
    python _cleanup.py
"""

import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

if sys.platform == "win32":
    import msvcrt

# ============================================================
# プロジェクト設定
# ============================================================
BASE_DIR = Path(__file__).resolve().parent

_path_spec = importlib.util.spec_from_file_location("aidiy_cleanup_path", BASE_DIR / "scripts" / "_setup_path.py")
_path_helper = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_path_helper)
remove_launcher_path = _path_helper.remove_launcher_path

BACKEND_PATH = "backend_server"
BACKEND_ENV_LIST = [".venv", "venv"]
BACKEND_TASKTEAM_PATH = "backend_taskteam"
BACKEND_TASKTEAM_ENV_LIST = [".venv", "venv"]
BACKEND_TOOLS_PATH = "backend_tools"
BACKEND_TOOLS_ENV_LIST = [".venv", "venv"]
BACKEND_LOCAL_PATH = "backend_local"
BACKEND_LOCAL_ENV_LIST = [".venv", "venv"]
BACKEND_HERMES_PATH = "command_hermes"
BACKEND_HERMES_ENV_LIST = [".venv", "venv"]

BACKUP_PATH = ".aidiy_backup"
TEMP_DIR_NAMES = frozenset(("temp", "_temp", ".temp", "tmp"))
# 試験用の作業フォルダ。正式なテスト（tests/ など）は名前が違うため対象外。
TEST_DIR_NAMES = frozenset(("test", "_test", ".test"))
# test は依存パッケージ内で正規の構成要素にもなるため、この配下では test 系を削除しない。
DEPENDENCY_DIR_NAMES = frozenset(("node_modules", ".venv", "venv", "site-packages"))
TEMP_TARGET_LABEL = "temp / _temp / .temp / tmp / test / _test / .test"
CLEANUP_STOP_REQUEST_PATH = BASE_DIR / ".cleanup_stop_request.json"

DATABASE_TYPE = "sqlite"
SQLITE_DB_REL_PATH = Path("_data/AiDiy/database.db")

AUTO_MODE = False

NPM_PACKAGES = [
    "@anthropic-ai/claude-code",
    "@github/copilot",
    "@openai/codex",
    "@opencode/cli",
    "opencode-ai",  # 旧パッケージ名（OpenCode 1.x）
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


def _load_folder_module(folder: str):
    name = f"aidiy_{folder}_cleanup"
    path = BASE_DIR / folder / "_cleanup.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_folder_start_module(folder: str):
    """選択対象の既存プロセス停止に使う `_start.py` を読み込む。"""
    name = f"aidiy_{folder}_start_for_cleanup"
    path = BASE_DIR / folder / "_start.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _remove_folder_import_cache(folder: str) -> bool:
    """`_start.py` / `_cleanup.py` の import で生成された `__pycache__` を消す。

    各フォルダの `cleanup()` は自分自身が import された後に走るため、
    ローダーが書き出したバイトコードが残る場合がある。呼び出し後に掃除する。
    """
    pycache_dir = BASE_DIR / folder / "__pycache__"
    if not pycache_dir.is_dir():
        return True
    try:
        shutil.rmtree(pycache_dir, onerror=handle_remove_readonly)
        print_success(f"__pycache__ ({folder}) を削除しました: {pycache_dir}")
        return True
    except Exception as e:
        print_warning(f"__pycache__ ({folder}) の削除に失敗しました: {e}")
        return False


def _remove_root_python_caches() -> bool:
    """保存版・Git・リンク先を除き、全階層のPythonキャッシュを最後に掃除する。"""
    root = BASE_DIR.resolve(strict=True)
    ok = True
    def scan_error(error):
        raise error
    try:
        for current, directories, _files in os.walk(root, followlinks=False, onerror=scan_error):
            for name in list(directories):
                path = Path(current) / name
                if name.lower() in {'.git', '.git_local', BACKUP_PATH, '.backup_local', '.aidiy_cache'} or _is_directory_link(path):
                    directories.remove(name)
                    continue
                if name.lower() not in {'__pycache__', '.pytest_cache'}:
                    continue
                directories.remove(name)
                resolved = path.resolve(strict=True)
                if resolved != path or not resolved.is_relative_to(root) or resolved == root:
                    raise ValueError(f'キャッシュの削除対象がプロジェクト外です: {path}')
                if not remove_directory(path, 'Pythonキャッシュ'):
                    ok = False
    except (OSError, RuntimeError, ValueError) as exc:
        print_error(f'Pythonキャッシュの整理に失敗しました: {exc}')
        return False
    return ok


def _run_folder_cleanup(folder: str, choices: dict) -> bool:
    """フォルダ別 cleanup を実行し、明示的な False だけを失敗として返す。"""
    try:
        result = _load_folder_module(folder).cleanup(choices)
    finally:
        cache_ok = _remove_folder_import_cache(folder)
    return result is not False and cache_ok is not False


SERVICE_CLEANUP_TARGETS = (
    ("local", "backend_local", "バックエンド(local)", ("バックエンド(local)",)),
    ("tools", "backend_tools", "バックエンド(tools)", ("バックエンド(tools)",)),
    (
        "backend",
        "backend_server",
        "バックエンド(core,apps)",
        ("バックエンド(core)", "バックエンド(apps)"),
    ),
    (
        "taskteam",
        "backend_taskteam",
        "バックエンド(task,team)",
        ("バックエンド(task,team)",),
    ),
    ("web", "frontend_web", "フロントエンド(Web)", ("フロントエンド(Web)",)),
    (
        "avatar",
        "frontend_avatar",
        "フロントエンド(Avatar)",
        ("フロントエンド(Avatar)",),
    ),
    ("ide", "frontend_ide/aidiy_navi", "フロントエンド(Navigator)", ("フロントエンド(navi)",)),
    ("ide", "frontend_ide/aidiy_console", "フロントエンド(console)", ("フロントエンド(console)",)),
    ("ide", "frontend_ide/viewer", "フロントエンド(IDE)", ("フロントエンド(IDE)",)),
    ("discord", "frontend_channels", "フロントエンド(Discord)", ("フロントエンド(Discord)",)),
    ("slack", "frontend_channels/slack", "フロントエンド(Slack)", ("フロントエンド(Slack)",)),
)
# 外部チャンネルの Bot。全体停止では keep_discord で Discord と同じく継続を選べる。
CHANNEL_FOLDERS = ("frontend_channels", "frontend_channels/slack")

# `_start.py` / `_cleanup.py` を import するフォルダ（= `__pycache__` が生成される）。
IMPORT_CACHE_FOLDERS = tuple(
    folder for _choice_key, folder, _description, _service_names in SERVICE_CLEANUP_TARGETS
) + ("backend_diag", BACKEND_HERMES_PATH, "frontend_ide", "frontend_ide/host")

# フォルダ別 `_cleanup.py` の担当外になる、ルート側の Python キャッシュ。
ROOT_CACHE_SCAN_PATHS = ("scripts",)


@contextmanager
def cleanup_stop_request(choices: dict, services: list[str] | None = None):
    """ルート監視へ停止を通知する。省略時は全サービス、単独cleanupは対象名を渡す。"""
    _ = choices  # 呼び出し側との互換性を維持する。停止対象は常に全サービス。
    if services is None:
        services = [
            service_name
            for _choice_key, _folder, _description, service_names in SERVICE_CLEANUP_TARGETS
            if _folder not in ("frontend_ide/aidiy_console", "frontend_ide/viewer", *CHANNEL_FOLDERS)
            for service_name in service_names
        ] + ["バックエンド(Diag)", "フロントエンド(console)", "フロントエンド(code)", "フロントエンド(live)", "フロントエンド(IDE)", "フロントエンド(Discord)", "フロントエンド(Slack)"]
    payload = {
        "owner_pid": os.getpid(),
        "services": services,
        "created_at": time.time(),
    }
    temporary_path = CLEANUP_STOP_REQUEST_PATH.with_suffix(
        f"{CLEANUP_STOP_REQUEST_PATH.suffix}.{os.getpid()}.tmp",
    )
    try:
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary_path, CLEANUP_STOP_REQUEST_PATH)
    finally:
        temporary_path.unlink(missing_ok=True)
    try:
        yield
    finally:
        try:
            current = json.loads(CLEANUP_STOP_REQUEST_PATH.read_text(encoding="utf-8"))
            if current.get("owner_pid") == os.getpid():
                CLEANUP_STOP_REQUEST_PATH.unlink(missing_ok=True)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass


def stop_all_services(
    choices: dict | None = None,
    *,
    title: str = "クリーンアップ前の既存プロセス整理",
    strict: bool = True,
    keep_code: bool = False,
    keep_dev: bool = False,
    keep_discord: bool = False,
    keep_diag: bool = True,
) -> bool:
    """起動中の常駐サービス・単独実行・MCP 接続を強制終了する。

    `_cleanup.py` のファイル削除前に実行する停止手順。setup / start の共通停止とは別。
    1 件失敗しても残りの停止は続け、最後に `strict` なら RuntimeError、そうでなければ
    警告だけ出して False を返す。`keep_code` なら aidiy_code の単独実行とその配下
    （hermes が使う tools の MCP 接続など）は止めず、aidiy_live は停止対象とする。
    `keep_dev` / `keep_discord` は互換オプションで、Console・IDE / Discord 本体とその配下も停止しない。
    keep_diag=True は Diag を維持する互換オプション。全体cleanupはkeep_diag=Falseで停止する。
    """
    _ = choices  # 呼び出し側との互換性を維持する。停止対象は常に全サービス。
    print_header(title)
    failures: list[str] = []

    def run_stop(description: str, action) -> None:
        try:
            if action() is False:
                failures.append(description)
        except Exception as e:
            print_warning(f"{description} の停止に失敗しました: {e}")
            failures.append(description)

    if not keep_diag:
        print_info("バックエンド(Diag) の本体・残留Electronを停止します")
        run_stop("Diag", lambda: _load_folder_module("backend_diag").stop_processes())

    for _choice_key, folder, description, _service_names in SERVICE_CLEANUP_TARGETS:
        if folder in ("frontend_ide/aidiy_console", "frontend_ide/viewer", *CHANNEL_FOLDERS):
            continue
        print_info(f"{description} の既存プロセスを停止します")
        run_stop(description, lambda folder=folder: _load_folder_start_module(folder).kill_ports())

    if keep_dev:
        print_info("フロントエンド(console) は継続します")
    else:
        print_info("フロントエンド(console) の既存プロセスを停止します")
        run_stop("Console の単独実行", lambda: _load_folder_start_module("frontend_ide/aidiy_console").kill_ports())
    if keep_code:
        # aidiy_live は通常 core 無しに動作できないため、core と一緒に止めてよい。
        print_info("フロントエンド(Code / Live) aidiy_code は継続します")
        print_info("フロントエンド(Code / Live) Live 実行を停止します")
        run_stop("Live の単独実行", lambda: _load_folder_start_module("frontend_ide/host").kill_ports("live"))
    else:
        print_info("フロントエンド(Code / Live) の Code / Live 単独実行を停止します")
        run_stop(
            "Code / Live の単独実行",
            lambda: _load_folder_module("frontend_ide/host").stop_standalone_processes(),
        )
    for folder, description, keep in (("frontend_ide/viewer", "フロントエンド(IDE)", keep_dev),
                                      ("frontend_channels", "フロントエンド(Discord)", keep_discord),
                                      ("frontend_channels/slack", "フロントエンド(Slack)", keep_discord)):
        if keep:
            print_info(f"{description} は継続します")
        else:
            print_info(f"{description} の既存プロセスを停止します")
            run_stop(description, lambda folder=folder: _load_folder_start_module(folder).kill_ports())
    print_info("バックエンド(tools) の Python / MCP 接続を停止します")
    if keep_code or keep_dev or keep_discord:
        try:
            protected_pids: set[int] = set()
            if keep_code:
                protected_pids.update(_load_folder_start_module("frontend_ide/host").process_tree_pids("code"))
            if keep_dev:
                protected_pids.update(_load_folder_start_module("frontend_ide/aidiy_console").process_tree_pids())
                protected_pids.update(_load_folder_start_module("frontend_ide/viewer").process_tree_pids())
            if keep_discord:
                protected_pids.update(_load_folder_start_module("frontend_channels").process_tree_pids())
                protected_pids.update(_load_folder_start_module("frontend_channels/slack").process_tree_pids())
        except Exception as e:
            # 継続対象の配下を判別できないときは、巻き込まないよう MCP 接続を止めない。
            print_warning(f"継続対象の配下を確認できないため、tools の MCP 接続は停止しません: {e}")
            failures.append("tools の Python / MCP 接続")
        else:
            if protected_pids:
                print_info(f"継続対象の配下は停止対象から外します: {len(protected_pids)} 件")
            run_stop(
                "tools の Python / MCP 接続",
                lambda: _load_folder_module("backend_tools").stop_tools_processes(exclude_pids=frozenset(protected_pids)),
            )
    else:
        run_stop(
            "tools の Python / MCP 接続",
            lambda: _load_folder_module("backend_tools").stop_tools_processes(),
        )

    # OS側のポート解放を短時間待つ。
    time.sleep(1)

    if not failures:
        return True
    message = f"{'、'.join(failures)} を終了できませんでした"
    if strict:
        raise RuntimeError(f"{message}。クリーンアップを中止します。")
    print_warning(message)
    return False


# 以前の内部名を参照するテスト・補助コードとの互換性を保つ。
stop_selected_services = stop_all_services


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
    bracket = "[y]/n/a=auto" if default.lower() == "y" else "y/[n]/a=auto"
    print(f"\n{prompt} ({bracket}): ", end="", flush=True)
    default_key = b"y" if default.lower() == "y" else b"n"
    key = _read_single_key((b"y", b"Y", b"n", b"N", b"a", b"A"), default_key)
    if key in (b"a", b"A"):
        return True, True
    if key in (b"y", b"Y"):
        return True, False
    return False, False


# ============================================================
# ルート固有の削除処理
# ============================================================
def handle_remove_readonly(func, path, exc_info):
    del exc_info
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_directory(path: Path, description: str) -> bool:
    if path.exists() and path.is_dir():
        try:
            shutil.rmtree(path, onerror=handle_remove_readonly)
            print_success(f"{description} を削除しました: {path}")
            return True
        except Exception as e:
            print_error(f"{description} の削除に失敗しました: {path}")
            print_error(f"  理由: {e}")
            print_warning("  ヒント: 管理者権限で実行するか、手動で削除してください")
            return False
    return False


def _is_directory_link(path: Path) -> bool:
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def find_temp_directories(base_dir: Path) -> list[Path]:
    """全階層の一時・試験用ディレクトリを集める。Git 管理情報・保存版・リンク先は巡回しない。

    temp 系は依存フォルダの中も含めて全階層、test 系は依存フォルダ（node_modules / venv 等）の
    外側だけを対象にする。名前は大文字・小文字を区別せず完全一致で判定する。
    """
    root = base_dir.resolve(strict=True)
    if not root.is_dir():
        raise NotADirectoryError(root)
    # .aidiy_backup は保持選択を尊重し、専用の確認済み cleanup_backup だけで削除する。
    targets: list[Path] = []

    def scan_error(error):
        raise error

    for current, directories, _files in os.walk(root, followlinks=False, onerror=scan_error):
        current_path = Path(current)
        in_dependency = any(
            part.lower() in DEPENDENCY_DIR_NAMES for part in current_path.relative_to(root).parts
        )
        for name in list(directories):
            path = current_path / name
            lower = name.lower()
            if lower in {".git", ".git_local", BACKUP_PATH, ".backup_local", ".aidiy_cache"} or _is_directory_link(path):
                directories.remove(name)
                continue
            if lower in TEMP_DIR_NAMES or (lower in TEST_DIR_NAMES and not in_dependency):
                # 親フォルダごと削除するため、その内側は重複して列挙しない。
                directories.remove(name)
                targets.append(path)
    return sorted(targets)


def cleanup_temp_directories(base_dir: Path) -> bool:
    """実体パスを削除直前にも検証し、プロジェクト内の一時・試験用ディレクトリを削除する。"""
    print_header(f"全階層の {TEMP_TARGET_LABEL} フォルダのクリーンアップ")
    try:
        root = base_dir.resolve(strict=True)
        targets = find_temp_directories(root)
    except (OSError, RuntimeError) as e:
        print_error(f"一時・試験用フォルダの検索に失敗しました: {e}")
        return False

    ok = True
    for path in targets:
        try:
            resolved = path.resolve(strict=True)
            if (_is_directory_link(path) or resolved != path
                    or resolved == root or not resolved.is_relative_to(root)):
                raise ValueError(f"削除対象がプロジェクト内の通常フォルダではありません: {path}")
            if not remove_directory(path, f"一時・試験用フォルダ ({path.relative_to(root)})"):
                ok = False
        except FileNotFoundError:
            continue
        except (OSError, RuntimeError, ValueError) as e:
            print_error(f"一時・試験用フォルダの削除に失敗しました: {e}")
            ok = False
    return ok


def cleanup_backup(base_dir: Path, choices: dict) -> bool:
    backup_dir = base_dir / BACKUP_PATH
    if not backup_dir.exists():
        return True
    print_header(".aidiy_backup フォルダのクリーンアップ")
    if choices.get("backup") is True:
        return remove_directory(backup_dir, ".aidiy_backup")
    elif choices.get("backup") is False:
        print_info(".aidiy_backup フォルダはそのまま残します")
    return True


def uninstall_global_npm_tools() -> bool:
    print_header("グローバルnpmツールのアンインストール")

    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    uninstalled_count = 0
    ok = True
    for i, package in enumerate(NPM_PACKAGES, 1):
        cmd = [npm_cmd, "uninstall", "-g", package]
        print_info(f"実行中: {' '.join(cmd)}")
        try:
            subprocess.run(cmd, check=True, capture_output=False, text=True)
            print_success(f"  [{i}/{len(NPM_PACKAGES)}] {package} をアンインストールしました")
            uninstalled_count += 1
        except subprocess.CalledProcessError as e:
            ok = False
            print_error(f"  [{i}/{len(NPM_PACKAGES)}] {package} のアンインストールに失敗しました: {e}")
        except OSError:
            ok = False
            print_error(f"  {npm_cmd} を実行できません。グローバルnpmツールの削除には Node.js / npm が必要です。")
            break

    if uninstalled_count > 0:
        print_success(f"グローバルnpmツールのアンインストール完了 ({uninstalled_count}個削除)")
    elif ok:
        print_info("アンインストール対象はありませんでした")
    return ok


# ============================================================
# 選択収集
# ============================================================
def collect_cleanup_choices(base_dir: Path) -> dict | None:
    """全ての y/n を最初にまとめて聞く。キャンセル時は None を返す。"""
    global AUTO_MODE

    run_cleanup, AUTO_MODE = ask_start_mode("クリーンアップを実行しますか？", default="n")
    if not run_cleanup:
        return None

    if AUTO_MODE:
        print_info("AUTOモードで実行します。以降の質問はデフォルト値で自動回答します。")

    print_header("クリーンアップ内容の選択")
    print_info("最初に実行項目をまとめて選択してください。処理はまとめて一括実行されます。")
    print_info("削除開始前に、この配置先の AiDiy サービス・単独実行を停止します（Code / IDE も対象）。")
    print_info(f"全階層の {TEMP_TARGET_LABEL} はフォルダ選択に関係なく、最後にまとめて削除します（ダウンロード済みモデルを含む）。")

    choices: dict = {
        "npm_uninstall":  False,
        "backup":         None,
        "tools":            False,
        "tools_envs":       {},
        "tools_node_modules": None,
        "tools_temp":       None,  # 一時フォルダは最後の全階層処理でまとめて削除する。
        "backend":        False,
        "backend_envs":   {},
        "backend_logs":   None,
        "backend_temp":   None,
        "backend_sqlite": None,
        "taskteam":       False,
        "taskteam_envs":  {},
        "taskteam_temp":  None,
        "local":          False,
        "local_envs":     {},
        "local_temp":     None,
        "web":            False,
        "avatar":         False,
        "hermes":         False,
        "ide":            False,
        "discord":        False,
        "slack":          False,
        "hermes_envs":    {},
        "hermes_temp":    None,
    }

    if (base_dir / BACKUP_PATH).exists():
        choices["backup"] = ask_yes_no(".aidiy_backup フォルダを削除しますか？", default="y")

    choices["diag"] = ask_yes_no("バックエンド(Diag)のランチャー・依存関係を解除しますか？", default="y")
    choices["npm_uninstall"] = ask_yes_no(
        "グローバルnpmツール(AI CLIツール)をアンインストールしますか？", default="n",
    )

    choices["local"] = ask_yes_no("バックエンド(local) をクリーンアップしますか？", default="y")
    if choices["local"]:
        backend_local_dir = base_dir / BACKEND_LOCAL_PATH
        if backend_local_dir.exists():
            for env_name in BACKEND_LOCAL_ENV_LIST:
                if (backend_local_dir / env_name).exists():
                    choices["local_envs"][env_name] = ask_yes_no(
                        f"  {BACKEND_LOCAL_PATH}/{env_name} を削除しますか？", default="y",
                    )

    choices["tools"] = ask_yes_no("バックエンド(tools) をクリーンアップしますか？", default="y")
    if choices["tools"]:
        backend_tools_dir = base_dir / BACKEND_TOOLS_PATH
        if backend_tools_dir.exists():
            for env_name in BACKEND_TOOLS_ENV_LIST:
                if (backend_tools_dir / env_name).exists():
                    choices["tools_envs"][env_name] = ask_yes_no(
                        f"  {BACKEND_TOOLS_PATH}/{env_name} を削除しますか？", default="y",
                    )
            if (backend_tools_dir / "node_modules").exists():
                choices["tools_node_modules"] = ask_yes_no(
                    f"  {BACKEND_TOOLS_PATH}/node_modules を削除しますか？", default="y",
                )

    choices["backend"] = ask_yes_no("バックエンド(core,apps)をクリーンアップしますか？", default="y")
    if choices["backend"]:
        backend_dir = base_dir / BACKEND_PATH
        if backend_dir.exists():
            for env_name in BACKEND_ENV_LIST:
                if (backend_dir / env_name).exists():
                    choices["backend_envs"][env_name] = ask_yes_no(
                        f"  {BACKEND_PATH}/{env_name} を削除しますか？", default="y",
                    )
            if (
                DATABASE_TYPE.lower() == "sqlite"
                and (base_dir / SQLITE_DB_REL_PATH).exists()
            ):
                choices["backend_sqlite"] = ask_yes_no("  SQLite データベースを削除しますか？", default="n")

    choices["taskteam"] = ask_yes_no("バックエンド(task,team)をクリーンアップしますか？", default="y")
    if choices["taskteam"]:
        taskteam_dir = base_dir / BACKEND_TASKTEAM_PATH
        if taskteam_dir.exists():
            for env_name in BACKEND_TASKTEAM_ENV_LIST:
                if (taskteam_dir / env_name).exists():
                    choices["taskteam_envs"][env_name] = ask_yes_no(
                        f"  {BACKEND_TASKTEAM_PATH}/{env_name} を削除しますか？", default="y",
                    )

    choices["web"] = ask_yes_no("フロントエンド(Web)をクリーンアップしますか？", default="y")
    choices["avatar"] = ask_yes_no("フロントエンド(Avatar)をクリーンアップしますか？", default="y")

    choices["hermes"] = ask_yes_no("コマンド(hermes)をクリーンアップしますか？", default="y")
    if choices["hermes"]:
        hermes_dir = base_dir / BACKEND_HERMES_PATH
        if hermes_dir.exists():
            for env_name in BACKEND_HERMES_ENV_LIST:
                if (hermes_dir / env_name).exists():
                    choices["hermes_envs"][env_name] = ask_yes_no(
                        f"  {BACKEND_HERMES_PATH}/{env_name} を削除しますか？", default="y",
                    )

    choices["ide"] = ask_yes_no("IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)をクリーンアップしますか？", default="y")
    choices["discord"] = ask_yes_no("フロントエンド(Discord)をクリーンアップしますか？", default="y")
    choices["slack"] = ask_yes_no("フロントエンド(Slack)をクリーンアップしますか？", default="y")

    return choices


# ============================================================
# メイン
# ============================================================
def execute_cleanup(base_dir: Path, choices: dict) -> bool:
    """選択済みの処理を、プロセス停止から順番に実行する。"""
    print_header("一括実行開始")
    cleanup_errors: list[str] = []

    stop_all_services(choices, keep_diag=False)

    print()
    if cleanup_backup(base_dir, choices) is False:
        cleanup_errors.append(".aidiy_backup")

    print()
    if choices.get("diag"):
        if not _run_folder_cleanup("backend_diag", choices):
            cleanup_errors.append("バックエンド(Diag)")

    if choices["npm_uninstall"]:
        if uninstall_global_npm_tools() is False:
            cleanup_errors.append("グローバルnpmツール")
    else:
        print_info("グローバルnpmツールのアンインストールをスキップしました")

    print()
    if choices["local"]:
        if not _run_folder_cleanup("backend_local", choices):
            cleanup_errors.append("バックエンド(local)")
    else:
        print_info("バックエンド(local) のクリーンアップをスキップしました")

    print()
    if choices["tools"]:
        if not _run_folder_cleanup("backend_tools", choices):
            cleanup_errors.append("バックエンド(tools)")
    else:
        print_info("バックエンド(tools) のクリーンアップをスキップしました")

    print()
    if choices["backend"]:
        if not _run_folder_cleanup("backend_server", choices):
            cleanup_errors.append("バックエンド(core,apps)")
    else:
        print_info("バックエンド(core,apps)のクリーンアップをスキップしました")

    print()
    if choices["taskteam"]:
        if not _run_folder_cleanup("backend_taskteam", choices):
            cleanup_errors.append("バックエンド(task,team)")
    else:
        print_info("バックエンド(task,team)のクリーンアップをスキップしました")

    print()
    if choices["web"]:
        if not _run_folder_cleanup("frontend_web", choices):
            cleanup_errors.append("フロントエンド(Web)")
    else:
        print_info("フロントエンド(Web)のクリーンアップをスキップしました")

    print()
    if choices["avatar"]:
        if not _run_folder_cleanup("frontend_avatar", choices):
            cleanup_errors.append("フロントエンド(Avatar)")
    else:
        print_info("フロントエンド(Avatar)のクリーンアップをスキップしました")

    print()
    if choices["hermes"]:
        if not _run_folder_cleanup("command_hermes", choices):
            cleanup_errors.append("コマンド(hermes)")
    else:
        print_info("コマンド(hermes) のクリーンアップをスキップしました")

    print()
    if choices.get("ide"):
        if not _run_folder_cleanup("frontend_ide", choices):
            cleanup_errors.append("IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)")
    else:
        print_info("IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)のクリーンアップをスキップしました")

    print()
    if choices.get("discord"):
        if not _run_folder_cleanup("frontend_channels", choices):
            cleanup_errors.append("フロントエンド(Discord)")
    else:
        print_info("フロントエンド(Discord)のクリーンアップをスキップしました")

    print()
    if choices.get("slack"):
        if not _run_folder_cleanup("frontend_channels/slack", choices):
            cleanup_errors.append("フロントエンド(Slack)")
    else:
        print_info("フロントエンド(Slack)のクリーンアップをスキップしました")

    # Diag の解除時点では他のランチャーが残るため、全項目の解除後に再確認する。
    if not remove_launcher_path():
        cleanup_errors.append("ランチャー PATH 登録の解除")

    print()
    if not cleanup_temp_directories(base_dir):
        cleanup_errors.append(f"全階層の {TEMP_TARGET_LABEL}")

    print()
    # スキップしたフォルダにも `_start.py` の import キャッシュが残るため、最後に掃う。
    for folder in IMPORT_CACHE_FOLDERS:
        if _remove_folder_import_cache(folder) is False:
            cleanup_errors.append(f"Pythonキャッシュ ({folder})")
    if not _remove_root_python_caches():
        cleanup_errors.append("全階層のPythonキャッシュ")

    print()
    print_header("クリーンアップ完了")
    if cleanup_errors:
        print_warning("一部のクリーンアップを完了できませんでした:")
        for location in cleanup_errors:
            print_warning(f"  - {location}")
    else:
        print_success("プロジェクトのクリーンアップが完了しました")
        print_info("他の担当者にプロジェクトを渡す準備ができました")
    print()
    if cleanup_errors:
        print_warning("クリーンアップはエラー付きで終了しました。5秒後に終了します...")
    else:
        print_info("クリーンアップは正常終了しました。5秒後に終了します...")
    time.sleep(5)
    return not cleanup_errors


def main():
    print_header("プロジェクト クリーンアップ")

    base_dir = BASE_DIR
    print_info(f"プロジェクトディレクトリ: {base_dir}")
    print_info("Python実行環境、Node.js / Vue 3依存、Electron、VS Code拡張は各モジュールの選択に従って整理します。")
    print_info("削除のために対象ランタイムの新版・仮想環境を要求しません。npm / VS Code CLI は選択した外部登録の解除時だけ使用します。")
    print_info("クリーンアップ対象:")
    print_info("  0. ルート .aidiy_backup フォルダ")
    print_info("  1. バックエンド(Diag)")
    print_info("  2. バックエンド(local)")
    print_info("  3. バックエンド(tools)")
    print_info("  4. バックエンド(core,apps)")
    print_info("  5. バックエンド(task,team)")
    print_info("  6. フロントエンド(Web)")
    print_info("  7. フロントエンド(Avatar)")
    print_info("  8. コマンド(hermes)")
    print_info("  9. IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)")
    print_info(" 10. フロントエンド(Discord)")
    print_info(" 11. フロントエンド(Slack)")
    print_info("外部チャンネル: Discord / Slack")
    print_info(f" 12. 全階層の {TEMP_TARGET_LABEL} フォルダ（最後にまとめて削除）")
    print()

    choices = collect_cleanup_choices(base_dir)
    if choices is None:
        print_info("クリーンアップをキャンセルしました")
        return

    with cleanup_stop_request(choices):
        cleanup_ok = execute_cleanup(base_dir, choices)
    if not cleanup_ok:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("クリーンアップが中断されました")
        sys.exit(1)
    except Exception as e:
        print_error(f"予期しないエラーが発生しました: {e}")
        sys.exit(1)
