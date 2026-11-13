# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AiDiy IDE（frontend_ide/viewer）の依存導入と aidiy_ide ランチャー登録。

ルートの `_setup.py` から呼ばれるほか、単独でも実行できる:
    python frontend_ide/viewer/_setup.py
コード表示の Monaco Editor と、Word / Excel / PowerPoint / PDF の表示ライブラリを自前で導入する。

公開 API:
    setup(choices: dict | None = None) -> bool
"""
import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
# 全体処理で他フォルダの同名 launcher がキャッシュされても取り違えない。
_launcher_spec = importlib.util.spec_from_file_location('aidiy_frontend_ide_viewer_launcher', THIS_DIR / 'launcher.py')
_launcher = importlib.util.module_from_spec(_launcher_spec)
_launcher_spec.loader.exec_module(_launcher)
install_launcher = _launcher.install_launcher
sys.path.insert(0, str(THIS_DIR.parents[1] / 'scripts'))
from _setup_electron import prepare_electron_binary, frontend_dependency_guard
from _runtime_requirements import check_project_node_runtime


def common_ui_dependencies_ready(root):
    """中断した npm 導入の空ディレクトリを準備済みと誤認しない。"""
    modules = root / 'node_modules'
    runtime = ('vue', '@xterm/xterm', '@xterm/addon-fit', 'node-pty', 'ws')
    build_files = ('vite/package.json', 'vite/dist/node/index.js',
                   '@vitejs/plugin-vue/package.json', 'esbuild/package.json')
    return (all((modules / name).is_dir() for name in runtime)
            and all((modules / name).is_file() for name in build_files))


class Colors:
    HEADER = "\033[97m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
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
    print(f"[WARN] {message}")


def print_info(message):
    print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def setup(choices=None) -> bool:
    if not (choices and choices.get("ide")):
        print_header("IDE セットアップ")
    print_info(f"作業ディレクトリ: {THIS_DIR}")
    print_info("対象: Node.js / Electron / Monaco Editor / docx-preview / SheetJS / PptxViewJS / PDF.js")
    ok, detail = check_project_node_runtime(THIS_DIR, fallback=">=22.13")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print_error(detail)
        return False

    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not npm:
        print_error("Node.js 22.13 以降と npm を導入してください。")
        return False
    if choices and choices.get("continue_on_error"):
        return _setup_best_effort(npm, choices)
    # ロックファイルがあれば再現性のある npm ci、初回だけ npm install で作る。
    command = "ci" if (THIS_DIR / "package-lock.json").exists() else "install"
    try:
        # 起動中のElectronを壊さず、依存が一致するときだけ配置済み資産を使う。
        reuse = frontend_dependency_guard(
            THIS_DIR, 'IDE', info=print_info, warning=print_warning, error=print_error,
        )
        if reuse is False:
            return False
        if reuse is not True:
            print_info(f"実行中: {npm} {command} --no-fund --no-audit")
            # postinstall での Node.js による取得を避け、他の画面と共通の準備処理を使う。
            env = {**os.environ, 'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}
            browser_only = env.get('CODESPACES') == 'true' or (sys.platform.startswith('linux') and not env.get('DISPLAY') and not env.get('WAYLAND_DISPLAY'))
            if browser_only:
                print_info("Web 起動環境のため Electron 本体のダウンロードは省略します。")
            subprocess.run([npm, command, "--include=dev", "--no-fund", "--no-audit"], cwd=THIS_DIR, env=env, check=True)
            # ロック済みの旧版バイナリを取得する前に、宣言範囲内の最新版へ更新する。
            print_info(f"実行中: {npm} update electron --include=dev --no-fund --no-audit")
            updated = True
            try:
                subprocess.run([npm, "update", "electron", "--include=dev", "--no-fund", "--no-audit"], cwd=THIS_DIR, env=env, check=True)
            except (OSError, subprocess.CalledProcessError) as exc:
                updated = False
                print_info(f"Electron の更新に失敗しました（最新版は未確認）: {exc}")
            if not browser_only and os.environ.get('ELECTRON_SKIP_BINARY_DOWNLOAD') != '1':
                if not updated:
                    print_info("導入済みバージョンに一致する配置済み本体・共有 ZIP から復旧します（ダウンロードなし）。")
                if not prepare_electron_binary(THIS_DIR, 'IDE', allow_download=updated, info=print_info, error=print_error):
                    return False
        vue = THIS_DIR.parent.parent / 'frontend_ide'
        if not common_ui_dependencies_ready(vue):
            vue_reuse = frontend_dependency_guard(
                vue, 'Console / Code / Live / IDE 共通UI', desktop=False,
                info=print_info, warning=print_warning, error=print_error,
            )
            if vue_reuse is False:
                return False
            if vue_reuse is not True:
                subprocess.run([npm, 'ci', '--include=dev', '--no-fund', '--no-audit'], cwd=vue, check=True)
        subprocess.run([npm, 'run', 'build'], cwd=vue, check=True)
        if not (choices and choices.get("_defer_ide_launchers")):
            install_launcher(THIS_DIR)
    except (OSError, subprocess.CalledProcessError):
        print_error("IDE の依存導入または aidiy_ide の登録に失敗しました。")
        return False
    if not (choices and choices.get("ide")):
        print_success("IDE: aidiy_ide で起動できます。")
    return True


def _setup_best_effort(npm, choices):
    """明示された続行指定で、失敗を記録し独立した残りの配置も一度ずつ試す。"""
    failures = []
    copy_warnings = choices.setdefault("_setup_warnings", [])
    warning_count = len(copy_warnings)

    def attempt(label, action):
        try:
            if action() is not False:
                return True
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            print_error(f"IDE: {label}: {exc}")
        failures.append(label)
        print_error(f"IDE: {label} に失敗しました。残りのセットアップを試行します。")
        return False

    env = {**os.environ, 'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}
    browser_only = env.get('CODESPACES') == 'true' or (sys.platform.startswith('linux') and not env.get('DISPLAY') and not env.get('WAYLAND_DISPLAY'))
    command = "ci" if (THIS_DIR / "package-lock.json").exists() else "install"
    # ガードは使用中を警告するだけで、続行選択時は導入を保留しない。
    attempt('使用中確認', lambda: frontend_dependency_guard(
        THIS_DIR, 'IDE', info=print_info, warning=print_warning, error=print_error,
        continue_on_error=True,
    ))
    attempt('依存導入', lambda: subprocess.run([npm, command, '--include=dev', '--no-fund', '--no-audit'], cwd=THIS_DIR, env=env, check=True))
    updated = attempt('Electron 更新', lambda: subprocess.run([npm, 'update', 'electron', '--include=dev', '--no-fund', '--no-audit'], cwd=THIS_DIR, env=env, check=True))
    if not browser_only and os.environ.get('ELECTRON_SKIP_BINARY_DOWNLOAD') != '1':
        def place_electron():
            before = len(copy_warnings)
            ready = prepare_electron_binary(
                THIS_DIR, 'IDE', allow_download=updated, info=print_info, error=print_error,
                continue_on_error=True, copy_warnings=copy_warnings,
            )
            return ready or len(copy_warnings) > before
        attempt('Electron 配置', place_electron)
    vue = THIS_DIR.parent.parent / 'frontend_ide'
    if not common_ui_dependencies_ready(vue):
        attempt('共通UI使用中確認', lambda: frontend_dependency_guard(
            vue, 'Console / Code / Live / IDE 共通UI', desktop=False,
            info=print_info, warning=print_warning, error=print_error, continue_on_error=True,
        ))
        attempt('共通UI依存', lambda: subprocess.run([npm, 'ci', '--include=dev', '--no-fund', '--no-audit'], cwd=vue, check=True))
    attempt('共通UI生成', lambda: subprocess.run([npm, 'run', 'build'], cwd=vue, check=True))
    if not choices.get('_defer_ide_launchers'):
        attempt('ランチャー登録', lambda: install_launcher(THIS_DIR))
    if failures:
        print_error('IDE: 失敗した項目: ' + '、'.join(failures))
        return False
    if len(copy_warnings) > warning_count:
        print_warning('IDE: Electron コピーの警告付きで終了しました。更新完了は未確認です。')
        return True
    if not choices.get('ide'):
        print_success('IDE: aidiy_ide で起動できます。')
    return True


if __name__ == "__main__":
    sys.exit(0 if setup() else 1)
