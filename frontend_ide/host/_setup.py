# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Code / Live セットアップスクリプト

Node.js 依存関係と Electron バイナリを事前に導入して VSIX を配置し、
単独起動用ランチャーも作成します。Electron は scripts/_setup_electron.py の
共通処理で準備し、配置済みバイナリと共有 ZIP を再利用します。

公開 API:
    setup(choices=None) -> bool
"""

import copy
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

if sys.platform == "win32":
    import msvcrt


THIS_DIR = Path(__file__).resolve().parent
FRONTEND_VSCODE_DIR = THIS_DIR
FRONTEND_COMMAND = "npm"

# 単体実行とルートセットアップの両方から共通処理を参照する。
sys.path.insert(0, str(THIS_DIR.parent.parent / "scripts"))
from _setup_electron import setup_dependencies
from _runtime_requirements import check_project_node_runtime, check_vscode_runtime
from _setup_path import ensure_launcher_path, windows_launcher_command, launcher_owner_comment

sys.path.insert(0, str(THIS_DIR / "scripts"))
from vscode_extensions import uninstall_aidiy_extensions

AUTO_MODE = False


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"


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


def run_command(command, cwd=None, env=None) -> bool:
    try:
        print_info(f"実行中: {' '.join(str(part) for part in command)}")
        subprocess.run(command, cwd=cwd, check=True, text=True, env=env)
        return True
    except subprocess.CalledProcessError as exc:
        print_error(f"コマンド実行エラー: {exc}")
        return False
    except Exception as exc:
        print_error(f"予期しないエラー: {exc}")
        return False


def npm_command() -> str:
    return f"{FRONTEND_COMMAND}.cmd" if sys.platform == "win32" else FRONTEND_COMMAND


def _is_working_vscode_cli(command: str) -> bool:
    """ファイルの存在だけでなく、実際に応答できる VS Code CLI か確認する。"""
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

    # Codespaces / IDE Container / Remote SSH の統合ターミナルでは、PATH 上の
    # `code` が利用不能でも、稼働中サーバーの Remote CLI を利用できる。
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


def get_extension_metadata(package_root: Path | None = None) -> tuple[str, str, Path] | None:
    package_json = (package_root or FRONTEND_VSCODE_DIR) / "package.json"
    try:
        package = json.loads(package_json.read_text(encoding="utf-8"))
        extension_id = f"{package['publisher']}.{package['name']}"
        version = str(package["version"])
        vsix_path = (
            FRONTEND_VSCODE_DIR
            / "dist"
            / f"{package['name']}-{version}.vsix"
        )
        return extension_id, version, vsix_path
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        print_error(f"package.json の読み込みに失敗しました: {exc}")
        return None


def get_installed_extensions(vscode_cli: str, show_versions: bool = False) -> set[str] | None:
    command = [vscode_cli, "--list-extensions"]
    if show_versions:
        command.append("--show-versions")
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        return {line.strip().lower() for line in result.stdout.splitlines() if line.strip()}
    except (OSError, subprocess.SubprocessError) as exc:
        print_error(f"vscode 拡張機能一覧の確認に失敗しました: {exc}")
        return None


def install_standalone_launcher(*, register_path: bool = True) -> bool:
    """aidiy_code / aidiy_live の単独起動コマンドを配置する。"""
    launcher_dir = Path.home() / ".local" / "bin"
    scripts = {name: FRONTEND_VSCODE_DIR / name / "launch.mjs" for name in ("aidiy_code", "aidiy_live")}
    for script_path in scripts.values():
        if not script_path.is_file():
            print_error(f"起動スクリプトが見つかりません: {script_path}")
            return False
    try:
        launcher_dir.mkdir(parents=True, exist_ok=True)
        for name, script_path in scripts.items():
            launcher_path = launcher_dir / (f"{name}.cmd" if sys.platform == "win32" else name)
            if sys.platform == "win32":
                content = ("@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n"
                           + launcher_owner_comment(script_path) + "\n"
                           + windows_launcher_command(['node.exe', str(script_path)])
                           + "\nexit /b %ERRORLEVEL%\n")
            else:
                content = f'#!/usr/bin/env sh\nexec node {shlex.quote(str(script_path))} "$@"\n'
            launcher_path.write_bytes(content.replace("\n", "\r\n").encode("utf-8") if sys.platform == "win32" else content.encode("utf-8"))
            if sys.platform != "win32":
                launcher_path.chmod(0o755)
            print_success(f"{launcher_path.name} を登録しました: {launcher_path}")
        # この配置先から作った旧名だけを解除する。他の作業コピーのランチャーは残す。
        old_script = FRONTEND_VSCODE_DIR / "scripts" / "launch-standalone.mjs"
        for name in ("aidiy_vscode.cmd", "aidiy_vscode"):
            legacy = launcher_dir / name
            if legacy.is_file() and str(old_script) in legacy.read_text(encoding="utf-8"):
                legacy.unlink()
                print_info(f"旧コマンドを解除しました: {legacy}")
    except OSError as exc:
        print_error(f"aidiy_code / aidiy_live を登録できません: {launcher_dir} ({exc})")
        return False
    return ensure_launcher_path(launcher_dir) if register_path else True


def stage_extension_package(source: Path, destination: Path, root: Path) -> None:
    """配布元を変更せず、秘密を含まない配置元だけを一時 VSIX へ追加する。"""
    marker = "extension/aidiy-installation.json"
    payload = json.dumps({"version": 1, "root": str(root.resolve())}, ensure_ascii=False).encode("utf-8")
    if len(payload) > 16384:
        raise ValueError("AiDiy 配置元のパスが長すぎます。")
    with zipfile.ZipFile(source) as original:
        entries = original.infolist()
        # 展開せずに検証する。破損・重複・巨大な archive は既存拡張解除の前に拒否。
        if len(entries) > 20000 or sum(item.file_size for item in entries) > 512 * 1024 * 1024:
            raise ValueError("VSIX のサイズが上限を超えています。")
        names = set()
        for item in entries:
            name = item.filename
            if (not name or "\\" in name or name.startswith("/")
                    or ".." in PurePosixPath(name).parts or ":" in name or item.flag_bits & 1):
                raise ValueError("VSIX のエントリが不正です。")
            if name in names and name != marker:
                raise ValueError("VSIX のエントリが重複しています。")
            names.add(name)
        required = {"[Content_Types].xml", "extension.vsixmanifest", "extension/package.json"}
        if not required.issubset(names) or any(original.getinfo(name).is_dir() for name in required):
            raise ValueError("VSIX の必須エントリがありません。")
        if original.testzip() is not None:
            raise ValueError("VSIX が破損しています。")
        with zipfile.ZipFile(destination, "w") as staged:
            staged.comment = original.comment
            for item in entries:
                if item.filename == marker:
                    continue
                # ZipInfo を引き継ぎ、日時・圧縮方式・権限・extra/comment を保持する。
                with original.open(item) as reader, staged.open(copy.copy(item), "w") as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
            staged.writestr(marker, payload, compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(destination) as staged:
        if staged.testzip() is not None or staged.read(marker) != payload:
            raise ValueError("配置元付き VSIX の検証に失敗しました。")


def install_extensions(vscode_cli: str) -> bool:
    """aidiy- 拡張を除去してから Code / Live を配置し、両 ID を確認する。"""
    ok, detail = check_vscode_runtime(vscode_cli)
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False
    expected = set()
    packages = []
    for package_root in (FRONTEND_VSCODE_DIR, FRONTEND_VSCODE_DIR / "aidiy_live"):
        metadata = get_extension_metadata(package_root)
        if metadata is None:
            return False
        extension_id, version, vsix_path = metadata
        if not vsix_path.is_file():
            print_error(f"VSIX が見つかりません: {vsix_path}")
            return False
        packages.append(vsix_path)
        expected.add(f"{extension_id}@{version}".lower())
    try:
        with tempfile.TemporaryDirectory(prefix="aidiy-vsix-") as temporary:
            staged = []
            for package in packages:
                target = Path(temporary) / package.name
                stage_extension_package(package, target, FRONTEND_VSCODE_DIR.parent.parent)
                staged.append(target)
            # 両方の配置元付き VSIX を検証してから既存拡張を解除する。
            removed, _ = uninstall_aidiy_extensions(
                lambda: get_installed_extensions(vscode_cli),
                lambda extension_id: run_command([vscode_cli, "--uninstall-extension", extension_id], cwd=FRONTEND_VSCODE_DIR),
                print_info, print_error,
            )
            if not removed:
                return False
            for vsix_path in staged:
                if not run_command([vscode_cli, "--install-extension", str(vsix_path), "--force"], cwd=FRONTEND_VSCODE_DIR):
                    return False
            installed = get_installed_extensions(vscode_cli, show_versions=True)
            if installed is None or not expected.issubset(installed):
                print_error(f"拡張機能の配置を確認できません: {', '.join(sorted(expected))}")
                return False
            print_success('Code / Live: VS Code 拡張を配置しました。')
            return True
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, NotImplementedError) as exc:
        print_error(f"配置元付き VSIX を準備できません: {exc}")
        return False


def setup(choices: dict | None = None) -> bool:
    label = "Code / Live"
    if not (choices and choices.get("ide")):
        print_header(f"{label} セットアップ")
    print_info(f"作業ディレクトリ: {FRONTEND_VSCODE_DIR}")
    print_info("対象: Node.js / Vue 3 / TypeScript / Electron / VS Code / VSIX")

    package_json = FRONTEND_VSCODE_DIR / "package.json"
    if not package_json.is_file():
        print_error(f"{label}: package.json が見つかりません: {package_json}")
        return False

    ok, detail = check_project_node_runtime(FRONTEND_VSCODE_DIR, dependency="electron", fallback=">=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False

    npm_path = shutil.which(npm_command()) or shutil.which(FRONTEND_COMMAND)
    if npm_path is None:
        print_error(f"{label}: npm がインストールされていません。")
        print_info("  Node.js をインストールしてください: https://nodejs.org/")
        return False

    choices = choices if choices is not None else {}
    copy_warnings = choices.setdefault("_setup_warnings", [])
    warning_count = len(copy_warnings)
    continue_on_error = bool(choices.get("continue_on_error"))
    failed = False
    if not setup_dependencies(
        FRONTEND_VSCODE_DIR, npm_path, label, run_command,
        info=print_info, warning=print_warning, error=print_error,
        continue_on_error=continue_on_error, copy_warnings=copy_warnings,
    ):
        failed = True
        if not continue_on_error:
            return False
    # Vue画面はCode / Live / IDEで共通。配布生成前に専用依存を用意する。
    vue_setup = FRONTEND_VSCODE_DIR.parent.parent / 'frontend_ide' / '_setup.py'
    if not run_command([sys.executable, '-c', "import runpy; raise SystemExit(0 if runpy.run_path(" + repr(str(vue_setup)) + ")[\"prepare\"](continue_on_error=" + repr(continue_on_error) + ") else 1)"], cwd=FRONTEND_VSCODE_DIR):
        failed = True
        if not continue_on_error:
            return False
    assets_ok = setup_assets(npm_path, choices=choices, copy_warning_count=warning_count)
    if failed:
        print_error("Code / Live: 依存準備に失敗した項目があります。")
    if len(copy_warnings) > warning_count:
        print_warning("Code / Live: Electron コピーの警告があります。更新完了は未確認です。")
    return assets_ok and not failed



def setup_assets(npm_path: str, *, choices=None, copy_warning_count=None) -> bool:
    """導入済み依存から共通UI・Code/Live拡張を必ず再生成し、既存配置処理を使う。"""
    label = "Code / Live"
    continue_on_error = bool(choices and choices.get("continue_on_error"))
    failed = False
    vscode_cli = find_vscode_cli()
    if vscode_cli is None:
        print_warning("VS Code CLI が見つからないため、単独画面だけをセットアップします。")
        built = run_command([npm_path, "run", "compile"], cwd=FRONTEND_VSCODE_DIR)
    else:
        built = run_command([npm_path, "run", "package"], cwd=FRONTEND_VSCODE_DIR)
    if not built:
        print_error(f"{label}: 配布物の生成に失敗しました。")
        failed = True
        if not continue_on_error:
            return False
    # 生成失敗時の古い VSIX は配置しない。独立したランチャー登録は試行できる。
    if built and vscode_cli is not None and not install_extensions(vscode_cli):
        failed = True
        if not continue_on_error:
            return False
    if not (choices and choices.get("_defer_ide_launchers")):
        if not install_standalone_launcher():
            failed = True
    if failed:
        print_error(f"{label}: セットアップに失敗した項目があります。")
        return False
    if copy_warning_count is not None and len((choices or {}).get("_setup_warnings", [])) > copy_warning_count:
        print_warning(f"{label}: 生成・登録は完了しましたが Electron コピーの警告があります。")
        return True
    if vscode_cli is not None:
        print_success(f"{label}: VS Code 拡張のセットアップが完了しました。")
        print_info("  vscode 本体や AiDiy の常駐サービスは停止していません。")
        print_info("  vscode に反映されない場合は、ウィンドウを再読み込みしてください。")
    if not (choices and choices.get("ide")):
        print_success(f"{label}: aidiy_code / aidiy_live で起動できます。")
    return True



def main():
    global AUTO_MODE
    if sys.argv[1:] == ["--launchers-only"]:
        raise SystemExit(0 if install_standalone_launcher() else 1)
    if sys.argv[1:] == ["--extensions-only"]:
        vscode_cli = find_vscode_cli()
        if vscode_cli is None:
            print_error('VS Code CLI が見つかりません。')
            raise SystemExit(1)
        raise SystemExit(0 if install_extensions(vscode_cli) else 1)
    print_header("Code / Live セットアップ")
    run_setup, AUTO_MODE = ask_start_mode(
        "Code / Live のセットアップを実行しますか?", default="n"
    )
    if not run_setup:
        print_warning("セットアップをキャンセルしました。")
        return
    if AUTO_MODE:
        print_info("AUTOモードで実行します。")
    if not setup():
        print_error("Code / Live のセットアップに失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("セットアップが中断されました。")
        sys.exit(130)
