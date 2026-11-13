# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""この作業コピーのDiag本体・残留Electronを照合して停止する。"""
import importlib.util
from pathlib import Path, PureWindowsPath
import re
import sys

_spec = importlib.util.spec_from_file_location(
    'diag_cleanup_processes', Path(__file__).resolve().parents[3] / 'scripts' / '_cleanup_processes.py')
common = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(common)


def _uncertain_process():
    # ps の表示文字列から引数境界や相対パスの cwd を推測して停止しない。
    raise ValueError('Diag候補の所属を確認できません（引数境界または作業フォルダが不明）。Diagを手動で終了してから再実行してください。')


def _electron_executables(root):
    distribution = root / 'node_modules/electron/dist'
    executables = [distribution / 'electron', distribution / 'Electron.app/Contents/MacOS/Electron']
    for suffix in ('', ' (GPU)', ' (Renderer)', ' (Plugin)'):
        name = f'Electron Helper{suffix}'
        executables.append(distribution / f'Electron.app/Contents/Frameworks/{name}.app/Contents/MacOS/{name}')
    return tuple(map(str, executables))


def _check_posix_electron_arguments(process, root, args):
    """空白を含む実行パス・comm が ps で平坦化された候補は削除前に止める。"""
    if process.get('ExecutablePath'):
        return
    command = process.get('CommandLine') or ''
    for executable in _electron_executables(root):
        if not any(char.isspace() for char in executable):
            continue
        if (command == executable or command.startswith(executable + ' ')) and (not args or args[0] != executable):
            _uncertain_process()
        # macOS の comm が実行パスまたは空白入りの名前の場合、共通 ps 列分割で
        # 残りの comm が CommandLine の先頭へ入る。これも不在とは判断しない。
        for comm in (executable, Path(executable).name):
            parts = comm.split(None, 1)
            prefix = parts[1] + ' ' + executable if len(parts) == 2 else ''
            if (len(parts) == 2 and process.get('Name') == Path(parts[0]).name
                    and command.startswith(prefix)
                    and (len(command) == len(prefix) or command[len(prefix)].isspace())):
                _uncertain_process()


def is_diag(process, root, windows):
    root = Path(root).resolve()
    if _is_diag_at_root(process, root, windows):
        return True
    # 改名直後の旧Node/Electronも同じ作業コピーだけ停止する。別rootやリンクは対象外。
    legacy = root.parent / 'backend_diag'
    if (root.name == 'frontend_diag' and not legacy.is_symlink()
            and not getattr(legacy, 'is_junction', lambda: False)()):
        return _is_diag_at_root(process, legacy, windows)
    return False


def _is_diag_at_root(process, root, windows):
    def normalize(value):
        value = str(value).replace('\\', '/').rstrip('/')
        return value.casefold() if windows else value

    root = Path(root).resolve()
    command = process.get('CommandLine') or ''
    parse_failed = False
    try:
        args = common.process_arguments(command, windows)
    except ValueError:
        # POSIX の実パス内の引用符も ps ではエスケープされない。分割結果は
        # 曖昧候補の中止にだけ使い、所有確認済みの停止対象には決して使わない。
        parse_failed = True
        args = command.split() if not windows else []
    if not windows:
        _check_posix_electron_arguments(process, root, args)
    executable = process.get('ExecutablePath') or (args[0] if args else '')
    binary = normalize(executable)
    distribution = normalize(root / 'node_modules' / 'electron' / 'dist') + '/'
    # 親を失ったGPU・renderer・utilityも、このDiag専用の実行ファイルで識別する。
    # macOS の Electron / Electron Helper は大文字名。名前だけを正規化し、
    # POSIX の作業コピー・実行ファイルのパス照合は大文字小文字を区別する。
    if binary.startswith(distribution) and binary.rsplit('/', 1)[-1].casefold() in (
            'electron.exe', 'electron', 'electron helper', 'electron helper (gpu)',
            'electron helper (renderer)', 'electron helper (plugin)'):
        if parse_failed and not process.get('ExecutablePath'):
            _uncertain_process()
        # 生の ps から切り出した「.../Frameworks/Electron」などを、空白入り
        # Helper の本物の実行パスと取り違えない。OS の実行パス情報があれば従来どおり。
        if not windows and not process.get('ExecutablePath') and binary not in _electron_executables(root):
            return False
        return True
    name = normalize(process.get('Name') or '').rsplit('/', 1)[-1].casefold()
    if name not in ('node', 'node.exe', 'electron', 'electron.exe') or not args:
        return False
    entries = {normalize(root / 'diag_main.mjs'), normalize(root / 'memo_main.mjs'), normalize(root / 'diag' / '起動' / 'electron-main.cjs')}
    index = 1
    while index < len(args):
        arg = args[index]
        if arg in ('--eval', '--print') or arg.startswith(('-e', '-p', '--eval=', '--print=')):
            return False
        if arg in ('-r', '--require', '--import'):
            index += 2
            continue
        if arg == '--':
            index += 1
            break
        if not arg.startswith('-'):
            break
        index += 1
    if index >= len(args):
        return False
    script = normalize(args[index])
    if script in entries:
        if parse_failed:
            _uncertain_process()
        return True
    if not windows and any(entry.startswith(script) and len(entry) > len(script)
                           and entry[len(script)].isspace()
                           and re.search(re.escape(entry) + r'(?:\s|$)', command) for entry in entries):
        _uncertain_process()
    # README の直接 node 起動は相対パスを使えるが、OS のコマンドラインだけでは
    # cwd と作業コピーを照合できない。別コピーを含めて推測で停止せず削除を中止する。
    if not Path(script).is_absolute() and not PureWindowsPath(script).is_absolute():
        relative = script.removeprefix('./')
        if (relative in ('diag_main.mjs', 'memo_main.mjs', 'diag/起動/electron-main.cjs')
                or any(relative == f'{folder}/{entry}' or relative.endswith(f'/{folder}/{entry}')
                       for folder in ('frontend_diag', 'backend_diag')
                       for entry in ('diag_main.mjs', 'memo_main.mjs', 'diag/起動/electron-main.cjs'))):
            _uncertain_process()
    # 他のスクリプトの引数にDiagのパスが含まれるだけなら対象外。
    return False


def is_memo(process, root, windows):
    if not is_diag(process, root, windows):
        return False
    args = common.process_arguments(process.get('CommandLine') or '', windows)
    return any(arg in ('--memo-only', '--aidiy-memo-only') or
               arg.replace('\\', '/').endswith('/memo_main.mjs') for arg in args[1:])


def stop_memo(root):
    # Diagと共用する残留Electronも含め、最後に両方の不在を確認する。
    return common.stop_matching(
        lambda process: is_diag(process, root, sys.platform == 'win32'),
        print, print, 'AiDiy Memo（Diag共用プロセスを含む）')


def stop(root):
    return common.stop_matching(
        lambda process: is_diag(process, root, sys.platform == 'win32') and
                        not is_memo(process, root, sys.platform == 'win32'),
        print, print, 'AiDiy Diag')
