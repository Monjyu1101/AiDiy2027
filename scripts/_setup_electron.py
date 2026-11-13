# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027



"""Diag / Avatar / IDE / Discord / Slack 共通の Electron 事前セットアップと ZIP キャッシュ。"""

import json
import os
import platform
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
import zipfile
from pathlib import Path, PurePosixPath


CACHE_DIR = Path(__file__).resolve().parents[1] / ".aidiy_cache" / "electron"
DOWNLOAD_TIMEOUT = 30


def _electron_platform_arch() -> tuple[str, str]:
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        arch = "arm64"
    elif machine in ("x86", "i386", "i686"):
        arch = "ia32"
    elif machine in ("amd64", "x86_64", "x64"):
        arch = "x64"
    else:
        raise ValueError(f"Electron が対応していない CPU です: {machine}")
    if sys.platform not in ("win32", "darwin", "linux"):
        raise ValueError(f"Electron が対応していない OS です: {sys.platform}")
    plat = sys.platform
    return plat, arch


def electron_executable_name() -> str:
    if sys.platform == "win32":
        return "electron.exe"
    if sys.platform == "darwin":
        return "Electron.app/Contents/MacOS/Electron"
    return "electron"


def get_electron_version(frontend_dir: Path) -> str:
    package = frontend_dir / "node_modules" / "electron" / "package.json"
    version = json.loads(package.read_text(encoding="utf-8"))["version"]
    if not isinstance(version, str) or not version:
        raise ValueError("Electron の導入済みバージョンがありません。")
    return version


def _dist_ready(dist: Path, version: str) -> bool:
    try:
        return (
            (dist / electron_executable_name()).is_file()
            and (dist / "version").read_text(encoding="utf-8").strip().removeprefix("v") == version
        )
    except OSError:
        return False


def electron_binary_ready(frontend_dir: Path) -> bool:
    electron_dir = frontend_dir / "node_modules" / "electron"
    try:
        return (
            (electron_dir / "path.txt").read_text(encoding="utf-8") == electron_executable_name()
            and _dist_ready(electron_dir / "dist", get_electron_version(frontend_dir))
        )
    except (OSError, KeyError, ValueError):
        return False


def _archive_ready(archive: Path, version: str) -> bool:
    try:
        with zipfile.ZipFile(archive) as zipped:
            return (
                electron_executable_name() in zipped.namelist()
                and zipped.read("version").decode("utf-8").strip().removeprefix("v") == version
            )
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return False


def _download_archive(archive: Path, version: str, label: str, info) -> None:
    url = f"https://github.com/electron/electron/releases/download/v{version}/{archive.name}"
    info(f"{label}: Electron をダウンロードします: {archive.name}")
    # 未完了の ZIP は共有キャッシュとして公開せず、正常完了後だけ保存する。
    with tempfile.TemporaryDirectory(prefix="download-", dir=archive.parent) as temporary:
        partial = Path(temporary) / archive.name
        started = last_report = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT) as response, partial.open("wb") as output:
                total = int(response.headers.get("Content-Length", 0))
                downloaded = 0
                while block := response.read(1024 * 1024):
                    output.write(block)
                    downloaded += len(block)
                    now = time.monotonic()
                    if now - last_report >= 2:
                        size = f"{downloaded / 1024 / 1024:.1f} MB"
                        if total:
                            size += f" / {total / 1024 / 1024:.1f} MB ({downloaded * 100 // total}%)"
                        speed = downloaded / 1024 / 1024 / max(now - started, 0.001)
                        info(f"  ダウンロード中: {size}, {speed:.1f} MB/秒")
                        last_report = now
            if total and downloaded != total:
                raise OSError("Electron ZIP のダウンロードが完了していません。")
        except (ssl.SSLCertVerificationError, urllib.error.URLError) as exc:
            reason = getattr(exc, "reason", exc)
            if not isinstance(reason, ssl.SSLCertVerificationError):
                raise
            curl = shutil.which("curl")
            if not curl:
                raise OSError("Python の証明書を確認できません。macOS は Python の Install Certificates.command、Linux は CA 証明書を確認してください。curl の導入後も再実行できます。") from exc
            info(f"{label}: Python の証明書確認に失敗したため、curl の証明書検証で取得します。")
            subprocess.run([curl, "--disable", "--fail", "--location", "--show-error", "--progress-bar",
                            "--proto", "=https", "--proto-redir", "=https",
                            "--connect-timeout", str(DOWNLOAD_TIMEOUT), "--max-time", "600",
                            "--speed-limit", "1024", "--speed-time", str(DOWNLOAD_TIMEOUT),
                            "--output", str(partial), url], check=True, timeout=610,
                           **({"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}))
        if not _archive_ready(partial, version):
            raise ValueError("Electron ZIP の実行ファイル・バージョンを確認できません。")
        partial.replace(archive)
    info(f"{label}: ダウンロード完了。ZIP を共有キャッシュに保存しました。")


def _extract_archive(archive: Path, destination: Path) -> None:
    """unzip の有無によらず、Mac のリンクと POSIX の実行権限を維持する。"""
    root = destination.resolve()
    links, directories = [], []
    with zipfile.ZipFile(archive) as zipped:
        for entry in zipped.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts or "\\" in entry.filename or ":" in entry.filename:
                raise ValueError("Electron ZIP に不正な展開先が含まれています。")
            target = root.joinpath(*name.parts)
            if not target.resolve().is_relative_to(root):
                raise ValueError("Electron ZIP の展開先が範囲外です。")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                links.append((target, zipped.read(entry).decode("utf-8")))
            elif entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                directories.append((target, stat.S_IMODE(mode) & 0o777))
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(entry) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if sys.platform != "win32":
                    target.chmod((stat.S_IMODE(mode) & 0o777) or 0o644)
        for target, value in links:
            link = PurePosixPath(value)
            if link.is_absolute() or "\\" in value or ":" in value or not (target.parent / value).resolve().is_relative_to(root):
                raise ValueError("Electron ZIP に範囲外のリンクが含まれています。")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(value)
        if sys.platform != "win32":
            for target, mode in reversed(directories):
                target.chmod(mode or 0o755)


def _place_dist(source: Path, frontend_dir: Path, *, move: bool = False) -> None:
    electron_dir = frontend_dir / "node_modules" / "electron"
    dist = electron_dir / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    if move:
        shutil.move(str(source), str(dist))
    else:
        shutil.copytree(source, dist, symlinks=True)
    if sys.platform != "win32":
        (dist / electron_executable_name()).chmod(0o755)
    (electron_dir / "path.txt").write_bytes(electron_executable_name().encode("utf-8"))


def prepare_electron_binary(frontend_dir: Path, label: str, *, allow_download: bool = True, info=print, error=print, continue_on_error=False, copy_warnings=None) -> bool:
    """配置済み → 他方の dist → 共有 ZIP → GitHub の順で準備し、ZIP は保持する。

    allow_download=False のときは導入済み npm パッケージと同じ版のローカル資産だけを使う。
    """
    def place(source, *, move=False):
        try:
            _place_dist(source, frontend_dir, move=move)
            return True
        except FileNotFoundError:
            # 入力欠損は単なる使用中ファイルのコピー警告とは区別する。
            raise
        except OSError as exc:
            if not continue_on_error:
                raise
            message = f"{label}: Electron のコピー・配置に失敗しました（配置未確認）: {exc}"
            info(f"[WARN] {message}")
            if copy_warnings is not None:
                copy_warnings.append(message)
            return False

    try:
        version = get_electron_version(frontend_dir)
        if electron_binary_ready(frontend_dir):
            info(f"{label}: Electron v{version} の配置を確認しました。")
            return True

        if continue_on_error:
            info(f"[WARN] {label}: 続行指定のため、使用中でも Electron の配置を試行します。失敗は記録して次の処理へ進みます。")
        elif _runtime_in_use(frontend_dir):
            error(f"{label}: Electron が使用中のため修復・置換できません。Code / IDE 等を閉じて再実行してください。")
            return False

        # npm 更新後も dist が一致する場合は path.txt の修復だけでよい。
        electron_dir = frontend_dir / "node_modules" / "electron"
        if _dist_ready(electron_dir / "dist", version):
            (electron_dir / "path.txt").write_bytes(electron_executable_name().encode("utf-8"))
            return True

        project_root = frontend_dir.parent.parent if frontend_dir.parent.name in ('frontend_ide', 'frontend_channels') else frontend_dir.parent
        for name in ("frontend_diag", "frontend_avatar", "frontend_ide/host", "frontend_ide/viewer", "frontend_channels/discord", "frontend_channels/slack"):
            peer = project_root / name
            if peer.resolve() == frontend_dir.resolve():
                continue
            source = peer / "node_modules" / "electron" / "dist"
            if _dist_ready(source, version):
                info(f"{label}: {name} の Electron v{version} を再利用します。")
                if not place(source):
                    return False
                return electron_binary_ready(frontend_dir)

        plat, arch = _electron_platform_arch()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        archive = CACHE_DIR / f"electron-v{version}-{plat}-{arch}.zip"
        if _archive_ready(archive, version):
            info(f"{label}: 保存済み ZIP を再利用します: {archive.name}")
        else:
            if not allow_download:
                error(f"{label}: Electron v{version} に一致する配置済みバイナリ・共有 ZIP がありません。")
                return False
            # 既存 ZIP は先に削除せず、取得・検証が成功した時だけ置き換える。
            _download_archive(archive, version, label, info)

        with tempfile.TemporaryDirectory(prefix="extract-", dir=CACHE_DIR) as temporary:
            extracted = Path(temporary) / "dist"
            extracted.mkdir()
            _extract_archive(archive, extracted)
            if not _dist_ready(extracted, version):
                raise ValueError("展開した Electron の実行ファイル・バージョンを確認できません。")
            if not place(extracted, move=True):
                return False
        info(f"{label}: Electron v{version} の配置が完了しました。")
        return electron_binary_ready(frontend_dir)
    except (OSError, KeyError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as exc:
        error(f"{label}: Electron の準備に失敗しました: {exc}")
        return False


def _runtime_in_use(frontend_dir: Path) -> bool:
    """Windowsの正確な実行パスだけで、更新対象を使用中か確認する。停止はしない。"""
    if sys.platform != "win32":
        return False
    import ntpath
    from _cleanup_processes import list_processes, process_arguments
    roots = [frontend_dir]
    if frontend_dir.name == "frontend_ide":
        roots += [frontend_dir / "host", frontend_dir / "viewer"]
    executables = {ntpath.normcase(str(root.resolve() / "node_modules" / "electron" / "dist" / "electron.exe")) for root in roots}
    for process in list_processes():
        if frontend_dir.name == "frontend_ide":
            from _setup_processes import process_role
            if process_role(process, frontend_dir.parent, windows=True) in ("code", "ide", "navi", "console", "live"):
                return True
        executable = process.get("ExecutablePath") or ""
        if not executable:
            try:
                args = process_arguments(process.get("CommandLine") or "", True)
            except ValueError:
                # 解析できない場合も、Electron 名なら下の判定で所属不明として止める。
                args = []
            executable = args[0] if args else ""
        if ntpath.normcase(executable) in executables:
            return True
        if not executable and (process.get("Name") or "").lower() == "electron.exe":
            raise ValueError("実行中 Electron の所属を確認できません")
    return False


def _locked_dependencies_ready(frontend_dir: Path) -> bool:
    """npm ciの代替として使える既存依存か確認。欠損・版違いは成功扱いしない。"""
    try:
        package = json.loads((frontend_dir / "package.json").read_text(encoding="utf-8"))
        locked = json.loads((frontend_dir / "package-lock.json").read_text(encoding="utf-8"))["packages"]
        for key in ("dependencies", "devDependencies", "optionalDependencies"):
            if package.get(key, {}) != locked[""].get(key, {}):
                return False
        if not locked or len(locked) < 2:
            return False
        for name, metadata in locked.items():
            if not name:
                continue
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or not name.startswith("node_modules/") or metadata.get("link"):
                return False
            target = frontend_dir / name / "package.json"
            if not target.exists() and metadata.get("optional"):
                plat, arch = _electron_platform_arch()
                def excluded(values, current):
                    return bool(values) and (f"!{current}" in values or (any(not v.startswith("!") for v in values) and current not in values))
                if excluded(metadata.get("os", []), plat) or excluded(metadata.get("cpu", []), arch):
                    continue
                return False
            installed = json.loads(target.read_text(encoding="utf-8"))
            if not metadata.get("version") or installed.get("version") != metadata["version"]:
                return False
            # package.jsonだけ残った不完全な導入も検出する。
            main = installed.get("main")
            if main and not (target.parent / main).exists() and not (target.parent / (main + ".js")).exists():
                return False
        if "node-pty" in package.get("dependencies", {}):
            plat, arch = _electron_platform_arch()
            native = frontend_dir / "node_modules" / "node-pty"
            filenames = ("conpty.node", "conpty_console_list.node") if plat == "win32" else ("pty.node",)
            if not any(all((native / folder / name).is_file() for name in filenames) for folder in (
                "build/Release", "build/Debug", f"prebuilds/{plat}-{arch}",
            )):
                return False
        return True
    except (OSError, KeyError, ValueError, TypeError):
        return False


def frontend_dependency_guard(frontend_dir: Path, label: str, *, info=print, warning=print, error=print, desktop=True, continue_on_error=False):
    """None=通常導入、True=使用中の整合した依存を再利用、False=更新を安全に中止。"""
    if continue_on_error:
        warning(f"{label}: 続行指定のため、使用中の依存も更新を試行します。画面の継続動作は保証されません。")
        return None
    try:
        if not _runtime_in_use(frontend_dir):
            return None
        binary_ready = not desktop or electron_binary_ready(frontend_dir)
        if desktop and sys.platform == "win32":
            # exe/versionだけ残る途中失敗を正常なruntimeと誤認しない。
            dist = frontend_dir / "node_modules" / "electron" / "dist"
            binary_ready = binary_ready and all((dist / name).is_file() for name in (
                "dxcompiler.dll", "ffmpeg.dll", "icudtl.dat", "resources.pak",
            ))
        if not _locked_dependencies_ready(frontend_dir) or not binary_ready:
            error(f"{label}: 使用中の Electron / 共有依存に欠損・版違いがあります。Code / IDE を閉じてセットアップを再実行してください。依存更新は実施していません。")
            return False
        warning(f"{label}: Code / IDE 等が使用中のため、整合を確認した既存依存を再利用します。npm 導入・更新は保留です。更新する場合は画面を閉じてセットアップを再実行してください。")
        return True
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        error(f"{label}: 使用中プロセスを確認できないため依存更新を中止します: {exc}")
        return False


def setup_dependencies(frontend_dir: Path, npm: str, label: str, run_command, *, info=print, warning=print, error=print, update=True, desktop=True, continue_on_error=False, copy_warnings=None, locked=False) -> bool:
    """npm での重複取得を避け、依存導入後に Electron を一度だけ準備する。"""
    guarded = frontend_dependency_guard(frontend_dir, label, info=info, warning=warning, error=error, desktop=desktop, continue_on_error=continue_on_error)
    if guarded is not None:
        return guarded
    # Discord の optional Opus peer は npm install で prune されるため、
    # 配布 lock を固定する経路では ci を使い、依存更新と混在させない。
    if locked and update:
        raise ValueError("locked と update は同時に指定できません。")
    install_action = "ci" if locked else "install"
    env = {**os.environ, "ELECTRON_SKIP_BINARY_DOWNLOAD": "1"}
    recovery_needed = False
    if continue_on_error:
        # 各段階を一度だけ試す。失敗を成功にせず、後続の独立した処理は実行する。
        failed = False
        flags = [] if update else ["--include=dev", "--no-fund", "--no-audit"]
        for action in ((install_action, "update") if update else (install_action,)):
            try:
                ok = run_command([npm, action, *flags], cwd=frontend_dir, env=env)
            except (OSError, subprocess.SubprocessError) as exc:
                warning(f"{label}: npm {action}: {exc}")
                ok = False
            if not ok:
                warning(f"{label}: npm {action} に失敗しました。続行指定のため次の処理を試行します。")
                failed = True
        warnings = copy_warnings if copy_warnings is not None else []
        warning_count = len(warnings)
        if desktop and not prepare_electron_binary(frontend_dir, label, info=info, error=error, continue_on_error=True, copy_warnings=warnings):
            if len(warnings) == warning_count:
                error(f"{label}: Electron の準備に失敗しました。失敗を記録して続行します。")
                failed = True
        return not failed
    # pull後は範囲内最新版へ更新しない。locked 指定時は配布 lock から再導入する。
    flags = [] if update else ["--include=dev", "--no-fund", "--no-audit"]
    for action in ((install_action, "update") if update else (install_action,)):
        command = [npm, action, *flags]
        if not run_command(command, cwd=frontend_dir, env=env):
            warning(f"{label}: npm {action} を --ignore-scripts で再試行します。")
            recovery_needed = True
            if not run_command([*command, "--ignore-scripts"], cwd=frontend_dir, env=env):
                return False
    if desktop and not prepare_electron_binary(frontend_dir, label, info=info, error=error):
        return False
    if recovery_needed:
        if not run_command([npm, "rebuild"], cwd=frontend_dir, env=env):
            return False
        if desktop and not electron_binary_ready(frontend_dir):
            error(f"{label}: Electron バイナリを確認できません。")
            return False
    return True

