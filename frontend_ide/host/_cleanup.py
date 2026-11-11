# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""フロントエンド(vscode) クリーンアップスクリプト

vscode 拡張機能をアンインストールし、依存関係と生成物を削除します。

公開 API:
    cleanup(choices=None) -> bool
"""

import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import msvcrt


THIS_DIR = Path(__file__).resolve().parent
FRONTEND_VSCODE_DIR = THIS_DIR

sys.path.insert(0, str(THIS_DIR.parent.parent / "scripts"))
from _setup_path import launcher_directory, remove_launcher_path

sys.path.insert(0, str(THIS_DIR / "scripts"))
from vscode_extensions import aidiy_extension_ids, uninstall_aidiy_extensions
from standalone_processes import stop_standalone

AUTO_MODE = False


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"


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
    if not path.is_dir():
        return False
    try:
        resolved = path.resolve()
        root = FRONTEND_VSCODE_DIR.resolve()
        if resolved == root or not resolved.is_relative_to(root):
            raise ValueError(f"削除対象が frontend_ide/host の外を参照しています: {resolved}")
        for attempt in range(5):
            try:
                shutil.rmtree(path, onerror=handle_remove_readonly)
                break
            except PermissionError as exc:
                if getattr(exc, 'winerror', None) not in (32, 33) or attempt == 4:
                    raise
                time.sleep(0.2)
        print_success(f"{description} を削除しました: {path}")
        return True
    except Exception as exc:
        print_error(f"{description} の削除に失敗しました: {path}")
        print_error(f"  理由: {exc}")
        return False


def remove_file(path: Path, description: str) -> bool:
    if not path.is_file():
        return False
    try:
        if not os.access(path, os.W_OK):
            os.chmod(path, stat.S_IWRITE)
        path.unlink()
        print_success(f"{description} を削除しました: {path}")
        return True
    except Exception as exc:
        print_error(f"{description} の削除に失敗しました: {path}")
        print_error(f"  理由: {exc}")
        return False


def _is_working_vscode_cli(command: str) -> bool:
    try:
        result = subprocess.run(
            [command, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def find_vscode_cli() -> str | None:
    """稼働中の Remote CLI、PATH、標準配置先の順に VS Code CLI を探す。"""
    candidates: list[Path] = []

    vscode_cwd = os.environ.get("VSCODE_CWD")
    if vscode_cwd:
        candidates.append(Path(vscode_cwd) / "bin" / "remote-cli" / "code")

    command_names = (
        ("code.cmd", "code-insiders.cmd", "code", "code-insiders")
        if sys.platform == "win32"
        else ("code", "code-insiders")
    )
    for command_name in command_names:
        path = shutil.which(command_name)
        if path:
            candidates.append(Path(path))

    if sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.extend(
                (
                    Path(local_app_data)
                    / "Programs"
                    / "Microsoft VS Code"
                    / "bin"
                    / "code.cmd",
                    Path(local_app_data)
                    / "Programs"
                    / "Microsoft VS Code Insiders"
                    / "bin"
                    / "code-insiders.cmd",
                )
            )
        for env_name in ("PROGRAMFILES", "PROGRAMFILES(X86)"):
            base = os.environ.get(env_name)
            if base:
                candidates.extend(
                    (
                        Path(base) / "Microsoft VS Code" / "bin" / "code.cmd",
                        Path(base)
                        / "Microsoft VS Code Insiders"
                        / "bin"
                        / "code-insiders.cmd",
                    )
                )
    elif sys.platform == "darwin":
        candidates.extend(
            (
                Path("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
                Path(
                    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"
                ),
            )
        )

    checked: set[str] = set()
    for candidate in candidates:
        candidate_text = str(candidate)
        if candidate_text in checked:
            continue
        checked.add(candidate_text)
        if candidate.is_file() and _is_working_vscode_cli(candidate_text):
            return candidate_text
    return None


def get_installed_extensions(vscode_cli: str) -> set[str] | None:
    try:
        result = subprocess.run(
            [vscode_cli, "--list-extensions"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        return {line.strip().lower() for line in result.stdout.splitlines() if line.strip()}
    except (OSError, subprocess.SubprocessError) as exc:
        print_warning(f"vscode 拡張機能一覧の確認に失敗しました: {exc}")
        return None


def uninstall_extension(module: str | None = None) -> tuple[bool, int]:
    vscode_cli = find_vscode_cli()
    if vscode_cli is None:
        print_warning("vscode CLI (code) が見つからないため、拡張機能の解除を確認できません。")
        return False, 0

    label = module.title() if module else 'Code / Live・旧版'
    remote_cli = Path(vscode_cli).parent.name == "remote-cli"
    if remote_cli:
        print_info(f"Remote CLI で接続先の AiDiy {label} を解除します。")
        print_info("接続元の旧 AiDiy Live は確認できません。残っている場合は接続元で code --uninstall-extension aidiy.aidiy-live を実行してください。")

    try:
        def installed_for_module():
            installed = get_installed_extensions(vscode_cli)
            if installed is None or module is None:
                return installed
            return {name for name in aidiy_extension_ids(installed)
                    if name.partition('.')[2] == f'aidiy-{module}'}

        def uninstall(name):
            print_info(f"実行中: {vscode_cli} --uninstall-extension {name}")
            subprocess.run([vscode_cli, "--uninstall-extension", name], check=True, text=True, timeout=60)
            return True
        ok, count = uninstall_aidiy_extensions(
            installed_for_module, uninstall, print_info, print_warning,
        )
        if ok and count:
            print_info("  vscode 本体は停止していません。反映にはウィンドウ再読み込みが必要です。")
        return ok, count
    except subprocess.CalledProcessError as exc:
        print_warning(f"vscode 拡張機能の解除に失敗しました: {exc}")
        return False, 0
    except Exception as exc:
        print_warning(f"vscode 拡張機能の確認に失敗しました: {exc}")
        return False, 0


def stop_standalone_processes(module: str | None = None) -> bool:
    return stop_standalone(FRONTEND_VSCODE_DIR.resolve(), print_info, print_warning, module)


def cleanup_app(module: str, *, report: bool = True) -> bool:
    """Code / Liveをそれぞれ解除し、共有依存物は残す。"""
    if module not in ('code', 'live'):
        raise ValueError(f'未対応のアプリです: {module}')
    label = module.title()
    if report:
        print_header(f"{label} のクリーンアップ")
        print_info(f"{label} のVS Code拡張・単独起動ランチャー・専用生成物を解除します。")

    extension_ok, deleted_count = uninstall_extension(module)
    if not extension_ok:
        print_warning("拡張機能の解除を確認できないため、ランチャーと生成物の削除を中止します。")
        return False
    if not stop_standalone_processes(module):
        return False
    cleanup_ok = extension_ok
    launcher_dir = launcher_directory(f'aidiy_{module}')
    for launcher_name in (f'aidiy_{module}.cmd', f'aidiy_{module}'):
        launcher_path = launcher_dir / launcher_name
        if launcher_path.is_file():
            if remove_file(launcher_path, f"{launcher_path.name} ({label})"):
                deleted_count += 1
            else:
                cleanup_ok = False
    directories = [f'dist/aidiy_{module}', f'out/aidiy_{module}']
    if module == 'live':
        directories.append('aidiy_live/dist')
    for directory_name in directories:
        directory_path = FRONTEND_VSCODE_DIR / directory_name
        existed = directory_path.is_dir()
        if remove_directory(
            directory_path,
            f"{directory_name} ({label})",
        ):
            deleted_count += 1
        elif existed:
            cleanup_ok = False

    for vsix_path in sorted(FRONTEND_VSCODE_DIR.glob(f"aidiy-{module}-*.vsix")):
        existed = vsix_path.is_file()
        if remove_file(vsix_path, f"VSIX ({label})"):
            deleted_count += 1
        elif existed:
            cleanup_ok = False

    if not cleanup_ok:
        print_warning(f"{label}: 一部のクリーンアップを完了できませんでした")
    elif report and deleted_count > 0:
        print_success(f"{label} のクリーンアップ完了 ({deleted_count}個削除)")
    elif report:
        print_info(f"{label}: 削除対象はありませんでした")
    return remove_launcher_path(launcher_dir) and cleanup_ok


def cleanup_shared(*, report: bool = True) -> bool:
    """個別解除後に旧版登録と共有通信基盤を片付ける。"""
    if report:
        print_info('共有通信基盤の依存関係・生成物と旧版登録を解除します。')
    extension_ok, _ = uninstall_extension()
    if not extension_ok or not stop_standalone_processes():
        return False
    ok = True
    for name in ('node_modules', 'dist', 'aidiy_live/dist', 'out', '__pycache__', 'scripts/__pycache__', '.pytest_cache'):
        path = FRONTEND_VSCODE_DIR / name
        existed = path.is_dir()
        removed = remove_directory(path, f'{name} (共有通信基盤)')
        if existed and not removed:
            ok = False
    for path in sorted(FRONTEND_VSCODE_DIR.glob('*.vsix')):
        if not remove_file(path, 'VSIX (共有通信基盤)'):
            ok = False
    return remove_launcher_path() and ok


def cleanup(choices: dict | None = None) -> bool:
    if choices is not None and choices.get('ide') is False:
        return True
    results = [cleanup_app(module) for module in ('code', 'live')]
    if not all(results):
        print_warning('Code / Live の解除が完了していないため、共有依存物を残します。')
        return False
    print_header('共通基盤のクリーンアップ')
    return cleanup_shared()


def main():
    global AUTO_MODE
    print_header("Code / Live のクリーンアップ")
    run_cleanup, AUTO_MODE = ask_start_mode("クリーンアップを実行しますか？", default="n")
    if not run_cleanup:
        print_info("クリーンアップをキャンセルしました")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not cleanup():
        sys.exit(1)
    print_success("クリーンアップが完了しました")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("クリーンアップが中断されました")
        sys.exit(1)
