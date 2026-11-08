# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Navigator / Console / Code / Live / IDE / Task / Team / Browserの依存・拡張・ランチャーをまとめて準備する。"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "scripts"))
from _setup_electron import frontend_dependency_guard
from _runtime_requirements import check_project_node_runtime

def prepare(*, continue_on_error=False):
    ok, detail = check_project_node_runtime(ROOT, dependency="vite", fallback="^20.19.0 || >=22.12.0")
    if detail.startswith("[WARN]"):
        print(detail)
    if not ok:
        print(detail)
        return False

    npm = shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
    if not npm:
        print("[NG] npm が見つかりません。対応する Node.js と同梱の npm を導入してください。")
        return False
    try:
        reuse = frontend_dependency_guard(ROOT, 'Navigator / Console / Code / Live / IDE / Task / Team / Browser 共通UI', desktop=False, **({'continue_on_error': True} if continue_on_error else {}))
        if reuse is not None:
            return reuse
        subprocess.run([npm, 'ci', '--include=dev', '--no-fund', '--no-audit'], cwd=ROOT, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False

def load_setup_module(name):
    spec = importlib.util.spec_from_file_location('ide_setup_' + name.replace('/', '_'), ROOT.parent / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def register_launchers(host, *, continue_on_error=False):
    """依存準備後に8コマンドを連続表示し、共有PATHの案内は一度だけ行う。"""
    launcher = load_setup_module('frontend_ide/viewer/launcher.py')
    print("\n起動コマンドの登録:")
    failures = []
    actions = [('Navigator', lambda: launcher.install_launcher(ROOT / 'aidiy_navi', 'navi', register_path=False)),
               ('Console', lambda: launcher.install_launcher(ROOT / 'aidiy_console', 'console', register_path=False)),
               ('Code / Live', lambda: host.install_standalone_launcher(register_path=False))]
    for kind, folder in (('ide', 'viewer'), ('task', 'aidiy_task'), ('team', 'aidiy_team'), ('browser', 'aidiy_browser')):
        actions.append((kind, lambda kind=kind, folder=folder: launcher.install_launcher(ROOT / folder, kind, register_path=False)))
    for kind in ('navi', 'console', 'code', 'live', 'ide', 'task', 'team', 'browser'):
        actions.append(('PATH ' + kind, lambda kind=kind: launcher.ensure_launcher_path(launcher.launcher_path(kind).parent)))
    for label, action in actions:
        try:
            if action() is not False:
                continue
        except OSError as exc:
            print(f"[NG] 起動コマンド {label} の登録に失敗しました: {exc}")
        failures.append(label)
        if not continue_on_error:
            return False
        print(f"[WARN] {label}: 残りの起動コマンド登録を試行します。")
    if failures:
        return False
    return True


def setup(choices=None):
    if choices is not None and choices.get("ide") is False:
        return True
    print("\n" + "=" * 60)
    print("Navigator / Console / Code / Live / IDE / Task / Team / Browser セットアップ")
    print("=" * 60 + "\n")
    print("対象: Node.js / Vue 3 / Vite / TypeScript / Electron / VS Code / VSIX")
    choices = choices if choices is not None else {}
    warnings = choices.setdefault("_setup_warnings", [])
    warning_count = len(warnings)
    child_choices = {**choices, "ide": True, "_defer_ide_launchers": True}
    # hostからprepareだけを呼ぶため再帰しない。
    host = None
    continue_on_error = bool(choices and choices.get("continue_on_error"))
    failed = False
    for name in ('frontend_ide/aidiy_navi', 'frontend_ide/aidiy_console', 'frontend_ide/host', 'frontend_ide/viewer', 'frontend_ide/aidiy_task', 'frontend_ide/aidiy_team', 'frontend_ide/aidiy_browser'):
        module = load_setup_module(name + '/_setup.py')
        if name == 'frontend_ide/host':
            host = module
        try:
            completed = module.setup(child_choices)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            if not continue_on_error:
                raise
            print(f"[NG] {name}: {exc}。残りのセットアップを試行します。")
            completed = False
        if not completed:
            failed = True
            if not continue_on_error:
                return False
    if not register_launchers(host, **({'continue_on_error': True} if continue_on_error else {})):
        failed = True
    if failed:
        print("[NG] IDE 系セットアップに失敗した項目があります。")
        return False
    if len(warnings) > warning_count:
        print("[WARN] IDE 系セットアップは Electron コピーの警告付きで完了しました。")
        return True
    print("Navigator / Console / Code / Live / IDE / Task / Team / Browser セットアップ完了")
    names = ('Navigator', 'Console', 'Code', 'Live', 'IDE', 'Task', 'Team', 'Browser')
    width = max(map(len, names))
    for name in names:
        print(f"{name:<{width}} 起動: aidiy_{'navi' if name == 'Navigator' else name.lower()}")
    return True

if __name__ == '__main__':
    sys.exit(0 if setup() else 1)
