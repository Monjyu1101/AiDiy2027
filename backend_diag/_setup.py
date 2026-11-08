# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""aidiy_diag ランチャーを配置し、共有 Electron セットアップを使う。"""
import os
import hashlib
from pathlib import Path
import shlex
import sys
import shutil
import subprocess
import importlib.util

THIS_DIR = Path(__file__).resolve().parent


class Colors:
    HEADER = '\033[97m'
    OKGREEN = '\033[92m'
    ENDC = '\033[0m'


def print_header(message):
    print(f"\n{Colors.HEADER}{'=' * 60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{message}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 60}{Colors.ENDC}\n")


def print_info(message):
    print(f"{Colors.OKGREEN}[INFO] {message}{Colors.ENDC}")


def launcher_content(script, windows=None):
    windows = sys.platform == 'win32' if windows is None else windows
    marker = 'aidiy_diag-owner:' + hashlib.sha256(str(script).encode('utf-8')).hexdigest()
    if windows:
        return ('@echo off\r\nsetlocal DisableDelayedExpansion\r\n' + f'rem {marker}\r\n'
                'where node.exe >nul 2>nul\r\n'
                'if errorlevel 1 (echo Node.js 18+ is required: https://nodejs.org/ & exit /b 1)\r\n'
                + _path_helper.windows_launcher_command(['node.exe', str(script)]) + '\r\nexit /b %ERRORLEVEL%\r\n')
    return ('#!/usr/bin/env sh\n' + f'# {marker}\n'
            'command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required: https://nodejs.org/" >&2; exit 1; }\n'
            f'exec node {shlex.quote(str(script))} "$@"\n')


_path_spec = importlib.util.spec_from_file_location('aidiy_diag_setup_path', THIS_DIR.parent / 'scripts' / '_setup_path.py')
_path_helper = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_path_helper)
ensure_launcher_path = _path_helper.ensure_launcher_path


def setup(choices=None, *, desktop=True):
    if choices is not None and choices.get('diag') is False:
        return True
    print_header('Diag セットアップ')
    print_info(f'作業ディレクトリ: {THIS_DIR}')
    print_info('対象: Node.js / Electron / Vue 3')
    directory = _path_helper.launcher_directory('aidiy_diag')
    launcher = directory / ('aidiy_diag.cmd' if sys.platform == 'win32' else 'aidiy_diag')
    try:
        directory.mkdir(parents=True, exist_ok=True)
        launcher.write_bytes(launcher_content(THIS_DIR / 'diag_main.mjs').encode('utf-8'))
        if sys.platform != 'win32':
            launcher.chmod(0o755)
    except OSError as exc:
        print(f'aidiy_diag を登録できません: {exc}')
        return False
    print(f'aidiy_diag を登録しました: {launcher}')
    if not ensure_launcher_path(directory):
        return False
    print('起動: aidiy_diag（Electron） / aidiy_diag --browser（ブラウザ）')
    return setup_desktop(continue_on_error=bool((choices or {}).get("continue_on_error")), copy_warnings=choices.setdefault("_setup_warnings", []) if choices is not None else None) if desktop else True


def setup_ui_dependencies(npm=None):
    """Diag 画面のビルド・検証に使う開発用依存（@vue/compiler-sfc / esbuild / typescript / vue）を ui/ に導入する。

    実行時には不要（配布済みの static/ を使う）。`npm ci` でロックファイルどおりに入れる。
    """
    ui = THIS_DIR / 'ui'
    if not (ui / 'package.json').is_file():
        return True
    npm = npm or shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
    if not npm:
        print(f'Diag UI の依存導入には npm が必要です。導入後に python "{THIS_DIR / "_setup.py"}" を再実行してください。')
        return False
    print_info('Diag UI の開発用依存（@vue/compiler-sfc など）を導入します: npm ci')
    try:
        subprocess.run([npm, 'ci', '--include=dev', '--no-fund', '--no-audit'], cwd=ui, check=True)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f'Diag UI の依存導入に失敗しました（npm ci）: {exc}')
        return False
    return True


def setup_desktop(*, continue_on_error=False, copy_warnings=None):
    if os.environ.get('CODESPACES') == 'true' or (sys.platform.startswith('linux') and not (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY'))):
        # Electronを省略しても、ブラウザ版のサーバーにはNode.jsが必要。
        sys.path.insert(0, str(THIS_DIR.parent / 'scripts'))
        from _runtime_requirements import check_node_runtime
        ok, detail = check_node_runtime('>=18')
        if not ok:
            print(f'{detail} Node.jsを導入・修復してから python "{THIS_DIR / "_setup.py"}" を再実行してください。')
            return False
        if detail.startswith('[WARN]'):
            print(detail)
        print('GUI なし / Codespaces: ブラウザ起動を使用します。Electron 導入をスキップします。')
        return setup_ui_dependencies()
    npm = shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
    if not shutil.which('node.exe' if sys.platform == 'win32' else 'node') or not npm:
        print(f'Electron の準備には Node.js と npm が必要です。導入後に python "{THIS_DIR / "_setup.py"}" を再実行してください。')
        return False
    sys.path.insert(0, str(THIS_DIR.parent / 'scripts'))
    from _runtime_requirements import check_project_node_runtime
    ok, detail = check_project_node_runtime(THIS_DIR, dependency='electron', fallback='>=22.12.0')
    if not ok:
        print(detail)
        return False
    if detail.startswith('[WARN]'):
        print(detail)
    spec = importlib.util.spec_from_file_location('aidiy_diag_shared_electron', THIS_DIR.parent / 'scripts' / '_setup_electron.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    def run(command, **kwargs):
        try:
            subprocess.run(command, check=True, **kwargs)
            return True
        except (OSError, subprocess.SubprocessError):
            return False
    electron_ok = helper.setup_dependencies(THIS_DIR, npm, 'Diag', run, continue_on_error=continue_on_error, copy_warnings=copy_warnings)
    # Electron の準備に失敗しても UI の依存導入は試し、結果は両方を反映する。
    return setup_ui_dependencies(npm) and electron_ok


if __name__ == '__main__':
    raise SystemExit(0 if setup() else 1)
