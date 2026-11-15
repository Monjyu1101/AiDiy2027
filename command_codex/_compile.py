# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Codex CLI エンジン（command_codex）コンパイルスクリプト

このフォルダ (command_codex) の `codex-rs/` に置いた OpenAI Codex の Rust ワークスペースから、
CLI 本体 `codex` を cargo でビルドします。同梱元の LICENSE / NOTICE（Apache-2.0）は `codex-rs/` 内にそのまま保持します。

- Windows は MSVC / Visual Studio を使わず、LLVM 系の `x86_64-pc-windows-gnullvm`
  （ARM64 は `aarch64-pc-windows-gnullvm`）でビルドします。C のコンパイル・リンクには llvm-mingw を使います。
  未導入の Rust（rustup）と llvm-mingw は本スクリプトが公式配布から導入します（Windows x64）。
- Linux / macOS は rustup の既定ホストでビルドします。
- Rust の版は `rust-toolchain.toml` に従い、未導入なら初回に rustup が自動取得します（ネットワーク使用）。
- 依存は `Cargo.lock` に固定（`--locked`）。初回は crates.io / git から依存を取得します。
- cargo の成果物 `target/<ターゲット>/<release|debug>/codex(.exe)` を、AiDiy 用の名前で
  `~/.aidiy/bin/aidiy_codex(.exe)` に配置し、`~/.aidiy/bin` を PATH に登録します。
  まず同じフォルダの `aidiy_codex_temp(.exe)` を完成させ、最後に本体と入れ替えます。
  入れ替え失敗時は一時ファイルを残すため、本体を終了して手動で入れ替えできます。
  Code Mode ホストも配置します。Windows は同じ版の公式 npm 配布物を SHA-512 検証して利用し、
  Linux / macOS は同梱ソースから本体と一緒にコンパイルします。
  プロジェクトの外に置くため、git clone やフォルダのコピーの影響を受けません。
  release（既定）は thin LTO のため時間がかかります。動作確認だけなら `--debug` を使います。
- 並列ジョブ数は Cargo の自動判定に任せます。制限したいときだけ `--jobs N` を指定します。
- `--detach` は独立プロセスで開始してすぐ戻ります（呼び出し元の Diag を閉じても続行）。
  状態は `~/.aidiy/cache/codex/aidiy_codex_compile.json`、ログは同じフォルダの `aidiy_codex_compile.log` に残ります。
- ビルド作業フォルダ（cargo の target）は `~/.aidiy/cache/codex/target` に置き、clone・コピーした別環境とも共有します
  （再コンパイルは差分だけで済みます）。

使い方:
    python command_codex/_compile.py            # 確認後に release ビルド
    python command_codex/_compile.py --debug    # 開発用（速いが大きい）
    python command_codex/_compile.py --check    # 前提確認だけ（ビルドしない）
    python command_codex/_compile.py --yes      # 確認なしで実行
    python command_codex/_compile.py --yes --detach  # 独立プロセスで開始（Diag のボタンと同じ）
    python command_codex/_compile.py --status   # コンパイル状態を表示
    python command_codex/_compile.py --cancel   # 実行中のコンパイルを中止（全体 cleanup でも実行）

公開 API:
    compile_codex(release=True, jobs=None) -> Path | None
    cancel_compile(reason="クリーンアップ") -> bool
"""

import argparse
import filecmp
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ============================================================
# 設定
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
CODEX_DIR = THIS_DIR
# Codex CLI の部品群（同梱元の Rust ワークスペース）。AiDiy の部品（本スクリプト・aidiy/）とは分けて一段下に置く。
WORKSPACE_DIR = CODEX_DIR / "codex-rs"
PROJECT_ROOT = THIS_DIR.parent
PACKAGE = "codex-cli"
BINARY = "codex"
# AiDiy で使う成果物名と配置先。cargo の成果物 codex(.exe) をこの名前でホーム配下へ置く
# （git clone・フォルダコピーの影響を受けず、複数の AiDiy から共有できる）。
OBJECT_NAME = "aidiy_codex"
INSTALL_DIR = Path.home() / ".aidiy" / "bin"
TOOLCHAIN_FILE = WORKSPACE_DIR / "rust-toolchain.toml"
# ビルド作業フォルダ・状態・ログは利用者のホームに置く（clone・コピーした環境とも共有。プロジェクトに残さない）。
BUILD_DIR = Path.home() / ".aidiy" / "cache" / "codex"
TARGET_DIR = BUILD_DIR / "target"
STATUS_FILE = BUILD_DIR / "aidiy_codex_compile.json"
LOG_FILE = BUILD_DIR / "aidiy_codex_compile.log"
# 依存のビルド・LTO で一時的に多くの容量を使う。目安を下回るときは警告する。
MIN_FREE_GB = 15
IS_WINDOWS = sys.platform == "win32"
EXE = ".exe" if IS_WINDOWS else ""


# 端末以外（ログファイル）や NO_COLOR 指定時は色の制御文字を出さない。
_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


class Colors:
    HEADER = '\033[97m' if _COLOR else ''
    OKBLUE = '\033[94m' if _COLOR else ''
    OKGREEN = '\033[92m' if _COLOR else ''
    WARNING = '\033[93m' if _COLOR else ''
    FAIL = '\033[91m' if _COLOR else ''
    ENDC = '\033[0m' if _COLOR else ''


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


def ask_yes_no(prompt, default="n") -> bool:
    bracket = "[y]/n" if default.lower() == "y" else "y/[n]"
    try:
        answer = input(f"\n{prompt} ({bracket}): ").strip().lower()
    except EOFError:
        answer = ""
    if not answer:
        return default.lower() == "y"
    return answer.startswith("y")


# ============================================================
# 前提確認
# ============================================================
def windows_target() -> str:
    """Windows の CPU に合わせた MSVC 不要のターゲット。"""
    machine = platform.machine().lower()
    return "aarch64-pc-windows-gnullvm" if machine in ("arm64", "aarch64") else "x86_64-pc-windows-gnullvm"


def find_cargo_bin() -> Path | None:
    """rustup の標準配置（~/.cargo/bin）を優先し、なければ PATH から探す。"""
    cargo_home = Path(os.environ.get("CARGO_HOME") or Path.home() / ".cargo")
    candidate = cargo_home / "bin" / f"cargo{EXE}"
    if candidate.is_file():
        return candidate.parent
    found = shutil.which("cargo")
    return Path(found).parent if found else None


def find_llvm_mingw_bin(target: str) -> Path | None:
    """aidiy_diag の導入先（%LOCALAPPDATA%\\Programs\\llvm-mingw）を優先し、なければ PATH から探す。"""
    compiler = f"{target.replace('-pc-windows-gnullvm', '-w64-mingw32')}-clang{EXE}"
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidate = Path(local) / "Programs" / "llvm-mingw" / "bin" / compiler
        if candidate.is_file():
            return candidate.parent
    found = shutil.which(compiler)
    return Path(found).parent if found else None


def existing_parent(path: Path) -> Path:
    """まだ作られていないフォルダでも空き容量を調べられるよう、存在する一番近い親を返す。"""
    for candidate in (path, *path.parents):
        if candidate.exists():
            return candidate
    return path


def free_gb(path: Path) -> float:
    try:
        return shutil.disk_usage(path).free / 1024 ** 3
    except OSError:
        return -1


def toolchain_channel() -> str:
    """rust-toolchain.toml の channel（表示用）。"""
    try:
        for line in TOOLCHAIN_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("channel"):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return "不明"


def build_environment(cargo_bin: Path, llvm_bin: Path | None, target: str | None) -> dict:
    """子プロセスの環境。Windows では C コンパイラ・アーカイバ・リンカーを llvm-mingw に固定する。"""
    env = dict(os.environ)
    paths = [str(cargo_bin)] + ([str(llvm_bin)] if llvm_bin else [])
    env["PATH"] = os.pathsep.join(paths + [env.get("PATH", "")])
    env["CARGO_TARGET_DIR"] = str(TARGET_DIR)
    if IS_WINDOWS and target and llvm_bin:
        triple = target.replace("-", "_")
        prefix = target.replace("-pc-windows-gnullvm", "-w64-mingw32")
        env[f"CC_{triple}"] = str(llvm_bin / f"{prefix}-clang{EXE}")
        env[f"CXX_{triple}"] = str(llvm_bin / f"{prefix}-clang++{EXE}")
        env[f"AR_{triple}"] = str(llvm_bin / f"llvm-ar{EXE}")
        env[f"CARGO_TARGET_{triple.upper()}_LINKER"] = str(llvm_bin / f"{prefix}-clang{EXE}")
        # Windows のリソース（バージョン情報）も MSVC の rc.exe ではなく llvm-mingw で作る。
        # mxc-sdk は RC_PATH、winresource 系は WINDRES を参照する（利用者が指定済みならそれを使う）。
        if (llvm_bin / f"llvm-rc{EXE}").is_file():
            env.setdefault("RC_PATH", str(utf8_rc_wrapper(llvm_bin / f"llvm-rc{EXE}")))
        if (llvm_bin / f"{prefix}-windres{EXE}").is_file():
            env.setdefault("WINDRES", str(llvm_bin / f"{prefix}-windres{EXE}"))
    if IS_WINDOWS:
        env.update(long_path_git_environment())
    return env


def replace_file(source: Path, output: Path, strip: Path | None = None) -> None:
    """一時ファイルに用意してから rename で置き換える（途中で失敗しても既存のファイルを壊さない）。"""
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        if strip:
            # 配置用はデバッグ情報を除いて小さくする（ビルド作業フォルダの元ファイルは調査用に残す）。
            subprocess.run([str(strip), "--strip-all", "-o", str(temporary), str(source)], check=True,
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=600)
        else:
            shutil.copy2(source, temporary)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_install(target: str | None = None) -> bool:
    """ビルド前に、exe 以外の配置（~/.aidiy/bin・libunwind.dll・設定 JSON・PATH 登録）を済ませる。

    ビルド後は exe を置くだけで終わるようにする（放置した後に残る処理・プロセスを少なくする）。
    プロジェクトの外（利用者のホーム）に置くため、git clone やフォルダのコピーの影響を受けない。
    Windows（gnullvm）は llvm-mingw の libunwind.dll に依存するため、同じフォルダへ一緒に置き、
    llvm-mingw が PATH に無くても単体で起動できるようにする。
    """
    try:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print_error(f"配置先を作れません: {INSTALL_DIR}（{e}）")
        return False
    if IS_WINDOWS:
        try:
            spec = importlib.util.spec_from_file_location("aidiy_codex_runtime_tools", THIS_DIR / "aidiy" / "runtime_tools.py")
            runtime_tools = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(runtime_tools)
            runtime_tools.install_windows_host(INSTALL_DIR, BUILD_DIR, DEFAULT_CLIENT_VERSION, target, WORKSPACE_DIR)
        except Exception as e:
            print_error(f"Code Mode ホストを配置できません: {e}")
            return False
    llvm_bin = find_llvm_mingw_bin(target) if IS_WINDOWS and target else None
    if llvm_bin:
        triple = target.replace("-pc-windows-gnullvm", "-w64-mingw32")
        runtime = llvm_bin.parent / triple / "bin" / "libunwind.dll"
        installed = INSTALL_DIR / runtime.name
        if not runtime.is_file():
            print_warning(f"libunwind.dll が見つかりません: {runtime}（llvm-mingw が PATH に無いと起動できません）")
        elif installed.is_file() and filecmp.cmp(runtime, installed, shallow=False):
            print_info(f"libunwind.dll は配置済みです: {installed}")
        else:
            try:
                replace_file(runtime, installed)
                print_info(f"libunwind.dll を配置しました: {installed}")
            except OSError as e:
                print_warning(f"libunwind.dll を配置できません（aidiy_codex を実行中の場合は終了してください）: {e}")
    write_settings_file()
    try:
        path_helper = load_path_helper()
        if not path_helper.ensure_launcher_path(INSTALL_DIR):
            print_warning(f"PATH に登録できませんでした。{INSTALL_DIR} をユーザー PATH に追加してください。")
    except Exception as e:  # PATH 登録の失敗はビルドを止めない
        print_warning(f"PATH の登録を確認できませんでした: {e}")
    return True


def install_object(built: Path, target: str | None = None) -> Path | None:
    """aidiy_codex_temp(.exe) を完成させてから本体と交換し、交換失敗時は手動配置用に残す。"""
    output = INSTALL_DIR / f"{OBJECT_NAME}{EXE}"
    temporary = INSTALL_DIR / f"{OBJECT_NAME}_temp{EXE}"
    llvm_bin = find_llvm_mingw_bin(target) if IS_WINDOWS and target else None
    strip = llvm_bin / f"llvm-strip{EXE}" if llvm_bin and (llvm_bin / f"llvm-strip{EXE}").is_file() else None
    try:
        # 不完全なコピー・strip 出力を公開せず、完成した実行ファイルだけを一時名で配置する。
        replace_file(built, temporary, strip)
    except (OSError, subprocess.SubprocessError) as e:
        print_error(f"{temporary} を生成できません: {e}")
        return None
    print_info(f"入れ替え用の実行ファイルを生成しました: {temporary}")
    try:
        os.replace(temporary, output)
    except OSError as e:
        print_error(f"{output} を入れ替えできません: {e}")
        print_warning(f"生成済みファイルを保持しました: {temporary}")
        print_info(f"aidiy_codex を終了してから、{temporary} を {output} に手動で入れ替えてください。")
        return None
    print_success(f"配置しました: {output}" + ("（デバッグ情報を除去）" if strip else ""))
    return output


# aidiy_codex の設定（実行ファイルの隣）。aidiy_root は AiDiy のキー（_config/AiDiy_key.json）を読む場所、
# client_version はサーバーへ送る版番号（codex-rs/login/src/aidiy_settings.rs）。手修正できる。
SETTINGS_FILE_NAME = "aidiy_codex_settings.json"
DEFAULT_CLIENT_VERSION = "0.169.0"
def write_settings_file(install_dir: Path = INSTALL_DIR, project_root: Path = PROJECT_ROOT) -> Path:
    """実行ファイルの隣の設定に、無い項目（aidiy_root / client_version）だけを書き足す。

    手修正した値・他の項目は上書きしない。JSON として読めない設定は変更しない。
    """
    path = install_dir / SETTINGS_FILE_NAME
    settings: dict = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as e:
            print_warning(f"aidiy_codex の設定を読めないため変更しません: {path}（{e}）")
            return path
        if not isinstance(loaded, dict):
            print_warning(f"aidiy_codex の設定が JSON オブジェクトではないため変更しません: {path}")
            return path
        settings = loaded
    added = []
    if "aidiy_root" not in settings:
        settings["aidiy_root"] = str(project_root)
        added.append("aidiy_root")
    if "client_version" not in settings:
        settings["client_version"] = DEFAULT_CLIENT_VERSION
        added.append("client_version")
    if added:
        temporary = path.with_name(f"{path.name}.tmp.{os.getpid()}")
        try:
            temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
            os.replace(temporary, path)
            print_info(f"aidiy_codex の設定を書き出しました（{', '.join(added)}）: {path}")
        except OSError as e:
            temporary.unlink(missing_ok=True)
            print_warning(f"aidiy_codex の設定を書き出せませんでした: {path}（{e}）")
            return path
    else:
        print_info(f"aidiy_codex の設定は既存の値を使います: {path}")
    return path


def load_path_helper():
    """AiDiy 共通の PATH 登録処理（scripts/_setup_path.py）。Windows はユーザー PATH に永続登録する。"""
    spec = importlib.util.spec_from_file_location("aidiy_codex_setup_path", PROJECT_ROOT / "scripts" / "_setup_path.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def utf8_rc_wrapper(llvm_rc: Path) -> Path:
    """llvm-rc を UTF-8（/C 65001）で呼ぶ呼び出し用ファイルをビルド作業フォルダに作る。

    依存（mxc-sdk）は RC_PATH の実行ファイルを rc.exe と同じ引数で呼び、文字コードを指定しない。
    llvm-rc は既定で非 ASCII（著作権記号など）を読めないため、引数を補う。
    """
    wrapper = TARGET_DIR / ".aidiy-tools" / "llvm-rc-utf8.cmd"
    wrapper.parent.mkdir(parents=True, exist_ok=True)
    lines = [f'@"{llvm_rc}" /C 65001 %*', "@exit /b %errorlevel%"]
    wrapper.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8", newline="")
    return wrapper


def long_path_git_environment() -> dict:
    """Windows の 260 文字制限を超える git 依存（rusty_v8 のサブモジュール等）を取得できるようにする。

    利用者の git 設定は変更しない。このビルド専用の HOME に、元のグローバル設定を include したうえで
    core.longpaths を有効にした .gitconfig を置く（cargo 内蔵の libgit2 と git CLI の両方が読む）。
    CARGO_HOME / rustup は USERPROFILE を使うため、HOME の変更の影響を受けない。
    """
    git_home = TARGET_DIR / ".aidiy-git-home"
    git_home.mkdir(parents=True, exist_ok=True)
    lines = []
    original = Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or Path.home()) / ".gitconfig"
    if original.is_file() and original.resolve() != (git_home / ".gitconfig").resolve():
        lines += ["[include]", f"\tpath = {original.as_posix()}"]
    lines += ["[core]", "\tlongpaths = true"]
    (git_home / ".gitconfig").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"HOME": str(git_home), "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.longpaths", "GIT_CONFIG_VALUE_0": "true"}


def check_prerequisites() -> tuple[dict | None, str | None]:
    """ビルドに必要なツールを確認する。戻り値: (環境, ターゲット) / 不足時は (None, None)。"""
    ok = True
    if not (WORKSPACE_DIR / "Cargo.toml").is_file() or not (WORKSPACE_DIR / "Cargo.lock").is_file():
        print_error(f"Cargo.toml / Cargo.lock が見つかりません: {WORKSPACE_DIR}")
        return None, None
    if not (WORKSPACE_DIR / "cli" / "Cargo.toml").is_file():
        print_error("CLI 本体（cli/Cargo.toml）が見つかりません。")
        return None, None

    cargo_bin = find_cargo_bin()
    if cargo_bin:
        print_info(f"cargo: {cargo_bin / ('cargo' + EXE)}")
        if not (cargo_bin / f"rustup{EXE}").is_file() and not shutil.which("rustup"):
            print_warning("rustup が見つかりません。rust-toolchain.toml の版を自動取得できない場合があります。")
    else:
        print_error("cargo が見つかりません。通常実行時に Rust を自動導入します（--check では導入しません）。")
        ok = False

    target = windows_target() if IS_WINDOWS else None
    llvm_bin = None
    if IS_WINDOWS:
        llvm_bin = find_llvm_mingw_bin(target)
        if llvm_bin:
            print_info(f"llvm-mingw: {llvm_bin}")
        else:
            print_error("llvm-mingw が見つかりません。Windows x64 は通常実行時に自動導入します（--check では導入しません）。")
            ok = False
        print_info(f"ターゲット: {target}（MSVC 不要）")
    else:
        print_info("ターゲット: rustup の既定ホスト")
    print_info(f"Rust の版: {toolchain_channel()}（rust-toolchain.toml）")

    # ビルド作業フォルダ（~/.aidiy/cache/codex）はプロジェクトと別のドライブにありうるため、そちらの空きを見る。
    gb = free_gb(existing_parent(BUILD_DIR))
    if 0 <= gb < MIN_FREE_GB:
        print_warning(f"空き容量が {gb:.1f}GB です。ビルドには {MIN_FREE_GB}GB 程度の空きを推奨します。")
    elif gb >= 0:
        print_info(f"空き容量: {gb:.1f}GB")

    if not ok:
        return None, None
    return build_environment(cargo_bin, llvm_bin, target), target


def run(command, env, label) -> bool:
    print_info(f"実行中: {' '.join(command)}")
    # Windows の CreateProcess は子に渡す PATH ではなく自プロセスの PATH で探すため、先にフルパスへ解決する。
    executable = shutil.which(command[0], path=env.get("PATH"))
    if not executable:
        print_error(f"{label}に必要な {command[0]} が見つかりません。")
        return False
    command = [executable, *command[1:]]
    try:
        subprocess.run(command, cwd=WORKSPACE_DIR, env=env, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"{label}に失敗しました（終了コード {e.returncode}）。")
    except OSError as e:
        print_error(f"{label}を実行できません: {e}")
    return False


# ============================================================
# 状態ファイル（Diag の「コンパイル中」表示・独立プロセスの確認用）
# ============================================================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_status() -> dict:
    try:
        value = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_status(**values) -> None:
    """一時ファイルに書いてから置き換え、読み手が途中の内容を読まないようにする。"""
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_FILE.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(values, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, STATUS_FILE)


def pid_alive(pid) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if IS_WINDOWS:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def running_compile() -> dict | None:
    status = read_status()
    return status if status.get("状態") == "コンパイル中" and pid_alive(status.get("pid")) else None


def load_process_helper():
    """AiDiy 共通のプロセス照合・強制終了処理（scripts/_cleanup_processes.py）。"""
    spec = importlib.util.spec_from_file_location("aidiy_codex_cleanup_processes",
                                                  PROJECT_ROOT / "scripts" / "_cleanup_processes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cancel_compile(reason: str = "クリーンアップ") -> bool:
    """実行中のコンパイル（本スクリプトと配下の cargo / rustc）を中止する。

    状態ファイルの pid が本スクリプト（_compile.py）を実行中の場合だけ、そのプロセスツリーを終了する。
    PID が再利用された別プロセスは対象にしない。実行中でない・中止できた場合は True。
    中止だけではビルド作業フォルダ（~/.aidiy/cache/codex/target）を残す（全体 cleanup は選択に応じて別に削除する）。
    """
    status = running_compile()
    if not status:
        print_info("実行中の aidiy_codex のコンパイルはありません。")
        return True
    pid = status["pid"]
    print_warning(f"aidiy_codex のコンパイルが実行中です（pid {pid}、開始 {status.get('開始日時')}）。中止します。")

    def matches(process: dict) -> bool:
        return process.get("ProcessId") == pid and "_compile.py" in str(process.get("CommandLine") or "")

    try:
        stopped = load_process_helper().stop_matching(matches, print_info, print_error, "aidiy_codex のコンパイル")
    except Exception as e:  # 補助処理を読めない場合も、止めたことにはしない
        print_error(f"aidiy_codex のコンパイルを中止できません: {e}")
        return False
    if not stopped:
        return False
    # 強制終了したプロセスは自分で状態を書けないため、ここで「中断」にする（その間に完了していれば上書きしない）。
    current = read_status()
    if current.get("状態") == "コンパイル中" and current.get("pid") == pid:
        write_status(**{**current, "状態": "中断", "終了日時": now_iso(), "成果物": None,
                        "メッセージ": f"{reason}でコンパイルを中止しました。"})
    print_success("aidiy_codex のコンパイルを中止しました。")
    return True


# ============================================================
# ビルド本体
# ============================================================
def ensure_prerequisites() -> tuple[dict | None, str | None]:
    """確認に同意した compile 経路のみ不足ツールを導入。--check からは呼ばない。"""
    for relative in ("Cargo.toml", "Cargo.lock", "cli/Cargo.toml"):
        if not (WORKSPACE_DIR / relative).is_file():
            print_error(f"ソースが不足しています: {relative}")
            return None, None
    cargo = find_cargo_bin()
    target = windows_target() if IS_WINDOWS else None
    llvm = find_llvm_mingw_bin(target) if target else None
    missing = ([] if cargo else ["rust"]) + (["llvm-mingw"] if target and not llvm else [])
    # Linux/macOS では llvm-mingw は不要。OS 管理の開発ツールは勝手に sudo/brew で変更しない。
    if not IS_WINDOWS:
        required = ["cc", "c++"] + (["pkg-config"] if sys.platform == "linux" else [])
        absent = [tool for tool in required if not shutil.which(tool)]
        if sys.platform == "darwin" and not absent:
            # /usr/bin/cc は未導入でも stub が存在するため、実コンパイラを確認する。
            try:
                checked = subprocess.run(["xcrun", "--find", "clang"], capture_output=True, text=True, timeout=15)
                if checked.returncode or not Path(checked.stdout.strip()).is_file():
                    absent.append("Xcode Command Line Tools")
            except (OSError, subprocess.SubprocessError):
                absent.append("Xcode Command Line Tools")
        if absent:
            hint = "Xcode Command Line Tools" if sys.platform == "darwin" else "C/C++ 開発ツールと pkg-config（例: build-essential、pkg-config）"
            print_error(f"{', '.join(absent)} がありません。OS の手順で {hint} を導入してください。")
            return None, None
    if missing:
        # 大容量取得前に止める。既存ツールは消さず、空きを確保してから再実行できる。
        gb = free_gb(existing_parent(BUILD_DIR))
        if 0 <= gb < MIN_FREE_GB:
            print_error(f"開発ツール導入前に停止しました。ビルド先の空き {gb:.1f}GB、推奨 {MIN_FREE_GB}GB 以上を確保してください。")
            return None, None
        spec = importlib.util.spec_from_file_location("aidiy_codex_setup_tools", THIS_DIR / "aidiy" / "setup_tools.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        try:
            for tool in missing:
                print_info(f"不足する開発ツールを導入します: {tool}")
                if IS_WINDOWS:
                    helper.install_windows_tool(tool)
                else:
                    helper.install_unix_rust()
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            print_error(f"開発ツールの導入に失敗しました: {error}。途中の導入物は削除していません。状態を確認して再実行してください。")
            return None, None
    return check_prerequisites()


def compile_codex(release: bool = True, jobs: int | None = None) -> Path | None:
    """codex をビルドし、aidiy_codex(.exe) として配置したパスを返す。失敗時は None。"""
    env, target = ensure_prerequisites()
    if env is None:
        return None

    # rust-toolchain.toml の版を明示的に導入し、ターゲットの標準ライブラリを追加する（導入済みなら何もしない）。
    if shutil.which("rustup", path=env["PATH"]):
        if not run(["rustup", "toolchain", "install", toolchain_channel()], env, "Rust ツールチェーンの導入"):
            return None
        if target and not run(["rustup", "target", "add", target], env, "ターゲットの追加"):
            return None
    # exe 以外の配置はビルド前に済ませる（ビルド後は exe を置いて終わる）。
    if not prepare_install(target):
        return None

    command =["cargo", "build", "--locked", "-p", PACKAGE, "--bin", BINARY]
    if not IS_WINDOWS:
        command += ["-p", "codex-code-mode-host", "--bin", "codex-code-mode-host"]
    if release:
        command.append("--release")
    if target:
        command += ["--target", target]
    # AiDiy: 未指定なら Cargo 自身の自動判定。メモリ量から独自に上限を付けない。
    if jobs is not None:
        if jobs < 1:
            raise ValueError("--jobs は 1 以上を指定してください。")
        command += ["--jobs", str(jobs)]
        print_info(f"並列ジョブ数: {jobs}（明示指定）")
    else:
        print_info("並列ジョブ数: 自動（Cargo に任せる）")

    started = time.monotonic()
    if not run(command, env, "ビルド"):
        return None
    minutes = (time.monotonic() - started) / 60

    profile = "release" if release else "debug"
    built = TARGET_DIR / (target or "") / profile / f"{BINARY}{EXE}"
    if not built.is_file():
        print_error(f"ビルドは終了しましたが、成果物が見つかりません: {built}")
        return None
    if not IS_WINDOWS:
        try:
            replace_file(built.with_name("codex-code-mode-host"), INSTALL_DIR / "codex-code-mode-host")
        except OSError as e:
            print_error(f"Code Mode ホストを配置できません: {e}")
            return None
    output = install_object(built, target)
    if output is None:
        return None
    size_mb = output.stat().st_size / 1024 ** 2
    print_success(f"ビルドが完了しました（{minutes:.1f} 分）: {output}（{size_mb:.1f}MB）")
    return output


def compile_with_status(release: bool, jobs: int | None) -> bool:
    """状態ファイルを更新しながらビルドする。中断・異常終了でも結果を残す。"""
    previous = read_status()
    base = {"pid": os.getpid(), "種類": "release" if release else "debug",
            "開始日時": previous.get("開始日時") if previous.get("pid") == os.getpid() else now_iso(),
            "ログ": previous.get("ログ") if previous.get("pid") == os.getpid() else None}
    write_status(状態="コンパイル中", **base)
    output, state, message = None, "失敗", "ビルドに失敗しました。ログを確認してください。"
    try:
        output = compile_codex(release=release, jobs=jobs)
        if output is not None:
            state, message = "完了", "コンパイルが完了しました。"
    except KeyboardInterrupt:
        state, message = "中断", "ビルドが中断されました。"
        raise
    finally:
        write_status(状態=state, **base, 終了日時=now_iso(), 成果物=str(output) if output else None, メッセージ=message)
    return output is not None


def start_detached(release: bool, jobs: int | None) -> int:
    """Diag 等から呼ぶ。ビルドを独立プロセスで開始してすぐ戻る（呼び出し元を閉じても続行する）。"""
    running = running_compile()
    if running:
        print_warning(f"すでにコンパイル中です（pid {running['pid']}、開始 {running.get('開始日時')}）。")
        return 2
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    args = [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "--yes"]
    if not release:
        args.append("--debug")
    if jobs:
        args += ["--jobs", str(jobs)]
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1", "NO_COLOR": "1"}
    log = open(LOG_FILE, "w", encoding="utf-8")
    try:
        options = {"cwd": CODEX_DIR, "env": env, "stdin": subprocess.DEVNULL, "stdout": log, "stderr": subprocess.STDOUT, "close_fds": True}
        if IS_WINDOWS:
            # 窓を出さず、呼び出し元のプロセスグループ・ジョブから切り離す（ジョブが許可しない場合は切り離しなし）。
            flags = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
            try:
                child = subprocess.Popen(args, creationflags=flags | 0x01000000, **options)  # CREATE_BREAKAWAY_FROM_JOB
            except OSError:
                child = subprocess.Popen(args, creationflags=flags, **options)
        else:
            child = subprocess.Popen(args, start_new_session=True, **options)
    finally:
        log.close()
    # 子が自分の状態を書く前でも、呼び出し元がすぐ「コンパイル中」と表示できるようにする。
    write_status(状態="コンパイル中", pid=child.pid, 種類="release" if release else "debug", 開始日時=now_iso(), ログ=str(LOG_FILE))
    print_success(f"コンパイルを独立プロセスで開始しました（pid {child.pid}）。ログ: {LOG_FILE}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="command_codex の Codex CLI を aidiy_codex としてビルドします。")
    parser.add_argument("--debug", action="store_true", help="開発用ビルド（release より速いが大きい）")
    parser.add_argument("--jobs", type=int, default=None, help="並列ジョブ数（省略時は Cargo の自動判定）")
    parser.add_argument("--check", action="store_true", help="前提確認だけ行い、ビルドしない")
    parser.add_argument("--status", action="store_true", help="コンパイル状態（状態ファイル）を表示する")
    parser.add_argument("--detach", action="store_true", help="独立プロセスで開始してすぐ戻る（ログは ~/.aidiy/cache/codex に保存）")
    parser.add_argument("--yes", action="store_true", help="不足ツールの導入を含め、確認なしで実行する")
    parser.add_argument("--cancel", action="store_true", help="実行中のコンパイルを中止する（全体 cleanup からも呼ばれる）")
    args = parser.parse_args()
    if args.jobs is not None and args.jobs < 1:
        parser.error("--jobs は 1 以上を指定してください。")

    if args.cancel:
        sys.exit(0 if cancel_compile(reason="--cancel の指定") else 1)

    if args.status:
        status = read_status()
        if status.get("状態") == "コンパイル中" and not pid_alive(status.get("pid")):
            status["状態"] = "中断"
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return

    print_header("Codex CLI コンパイル（aidiy_codex）")
    print_info(f"作業ディレクトリ: {WORKSPACE_DIR}")
    if args.check:
        env, _ = check_prerequisites()
        sys.exit(0 if env is not None else 1)

    profile = "debug" if args.debug else "release"
    if not args.yes and not ask_yes_no(f"aidiy_codex を {profile} でビルドしますか?（不足する Rust・Windows LLVM の公式導入と依存取得を含みます。初回は数十分かかります）"):
        print_warning("ビルドをキャンセルしました。")
        return
    if args.detach:
        sys.exit(start_detached(release=not args.debug, jobs=args.jobs))
    running = running_compile()
    if running and running.get("pid") != os.getpid():
        print_error(f"別のコンパイルが実行中です（pid {running['pid']}）。完了を待ってください。")
        sys.exit(2)
    if not compile_with_status(release=not args.debug, jobs=args.jobs):
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print_warning("ビルドが中断されました。")
        sys.exit(130)
