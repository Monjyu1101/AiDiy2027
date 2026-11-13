# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""setup前に、この配置先のAiDiyだけを停止する。Code / IDE / Discord / Slackと起動元は保護する。"""
from contextlib import contextmanager
import json
import shlex
import ntpath
import posixpath
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from _cleanup_processes import list_processes, process_arguments
from _opencode_service import stop_opencode_service

COMPONENTS = ('backend_diag', 'backend_local', 'backend_tools', 'backend_server',
              'backend_taskteam', 'frontend_web', 'frontend_avatar', 'frontend_channels',
              'command_hermes', 'frontend_ide')
# frontend_channels 配下の Discord と Slack をまとめて保護する。
KEEP = frozenset(('code', 'ide', 'frontend_channels'))


def process_role(process, root, windows=False):
    """実行入口/実行環境の完全な所属を照合。引数の途中のパスやポートは使わない。"""
    path = ntpath if windows else posixpath
    norm = lambda value: path.normcase(path.normpath(str(value)))
    root = norm(root)
    try:
        args = process_arguments(process.get('CommandLine') or '', windows)
    except ValueError:
        return None
    if not args:
        return None
    executable = process.get('ExecutablePath') or args[0]
    name = path.basename(executable).casefold()
    reported_name = (process.get('Name') or '').casefold()
    python = name.startswith('python') or reported_name.startswith('python')
    node = name in ('node', 'node.exe') or reported_name in ('node', 'node.exe')
    electron = name.startswith('electron') or reported_name.startswith('electron')
    if not (python or node or electron or name in ('uv', 'uv.exe')):
        return None
    cwd = process.get('WorkingDirectory') or ''

    def absolute(value):
        if path.isabs(value):
            return norm(value)
        return norm(path.join(cwd, value)) if cwd else ''

    def relative(value):
        value = absolute(value)
        try:
            if value and path.commonpath((root, value)) == root:
                return path.relpath(value, root).replace('\\', '/')
        except ValueError:
            pass
        return ''

    # 実行コードの引数ではなく、実行ファイルだけで所属する環境を判定できる。
    binary = relative(executable) or relative(args[0])
    parts = binary.split('/')
    if len(parts) > 2 and parts[0] in COMPONENTS:
        if python and parts[1].startswith(('.venv', 'venv')):
            return parts[0]
        if electron and '/node_modules/electron/dist/' in '/' + binary:
            # IDEのElectronはCode/Live/Consoleと共用。入口/親子関係不明なら保護。
            if parts[0] != 'frontend_ide':
                if parts[0] == 'backend_diag' and '--aidiy-memo-only' in args:
                    return 'memo'
                return parts[0]
            for arg in args:
                if not arg.startswith('--user-data-dir='):
                    continue
                profile = path.basename(arg.split('=', 1)[1]).casefold()
                for kind in ('code', 'live', 'console', 'term', 'task', 'team', 'browser', 'navi', 'cpu'):
                    if profile == f'aidiy_{kind}_vue' or profile.startswith(f'aidiy-{kind}-profile-'):
                        return 'console' if kind == 'term' else kind

    index = 1
    while index < len(args):
        arg = args[index]
        if arg in ('-e', '-p', '-c', '--eval', '--print', '-m') or arg.startswith(('--eval=', '--print=')) or (len(arg) > 2 and arg[:2] in ('-e', '-p', '-c')):
            # module実行はcwdが特定できる場合だけ所属を確認する。
            if arg == '-m' and python and cwd:
                directory = relative(cwd)
                if directory.split('/')[0] in COMPONENTS:
                    return directory.split('/')[0]
            return None
        if arg in ('-r', '--require', '--import', '--loader'):
            index += 2
            continue
        if arg == '--':
            index += 1
            break
        if not arg.startswith('-'):
            break
        index += 1
    if index >= len(args):
        return None
    entry = relative(args[index])
    if entry == '_start.py':
        return 'supervisor'
    if not entry or entry.split('/')[0] not in COMPONENTS:
        return None
    component = entry.split('/')[0]
    if component == 'backend_diag' and (entry == 'backend_diag/memo_main.mjs' or
            '--memo-only' in args[index + 1:] or '--aidiy-memo-only' in args[index + 1:]):
        return 'memo'
    if component == 'frontend_ide':
        if entry in ('frontend_ide/launch.mjs', 'frontend_ide/desktop.cjs'):
            tail = args[index + 1:]
            selected = 'ide'
            for position, arg in enumerate(tail):
                if arg == '--app' and position + 1 < len(tail):
                    selected = tail[position + 1]
                elif arg.startswith('--app='):
                    selected = arg.split('=', 1)[1]
            selected = 'console' if selected == 'term' else selected
            return selected if selected in ('code', 'live', 'ide', 'console', 'task', 'team', 'browser', 'navi', 'cpu') else None
        for kind in ('code', 'live', 'console', 'term', 'ide', 'task', 'team', 'browser', 'navi', 'cpu'):
            if f'/aidiy_{kind}/' in '/' + entry:
                return 'console' if kind == 'term' else kind
        if entry.startswith('frontend_ide/viewer/'):
            return 'ide'
        # 共用runtimeは所有元の親プロセスから判別し、単体では止めない。
        return None
    return component


def descendants(pids, processes):
    result = set(pids)
    while True:
        children = {p['ProcessId'] for p in processes if p.get('ParentProcessId') in result} - result
        if not children:
            return result
        result.update(children)


def select_targets(processes, root, windows=False, current_pid=None):
    roles = {p['ProcessId']: process_role(p, root, windows) for p in processes}
    by_pid = {p['ProcessId']: p for p in processes}
    # 相対入口の監視親は、起動時の所有記録＋プロセス作成日時まで一致した場合のみ。
    for process in processes:
        if roles[process['ProcessId']] is None and registered_supervisor(process, root):
            roles[process['ProcessId']] = 'supervisor'
    # Code/IDE/Discord/Slackの補助/MCP子孫を保護。ただし独立アプリLive等は保護の境界にする。
    boundaries = {'live', 'console', 'task', 'team', 'browser', 'navi', 'cpu', 'frontend_avatar', 'backend_diag', 'memo', 'supervisor'}
    protected = {pid for pid, role in roles.items() if role in KEEP}
    while True:
        children = {p['ProcessId'] for p in processes if p.get('ParentProcessId') in protected
                    and roles.get(p['ProcessId']) not in boundaries} - protected
        if not children:
            break
        protected.update(children)
    pid = os.getpid() if current_pid is None else current_pid
    ancestors = set()
    while pid and pid not in ancestors:
        ancestors.add(pid)
        pid = by_pid.get(pid, {}).get('ParentProcessId', 0)
    protected.update(ancestors)
    protected.update(descendants({os.getpid() if current_pid is None else current_pid}, processes))
    roots = {pid for pid, role in roles.items() if role and role not in KEEP} - protected
    targets = descendants(roots, processes) - protected
    return {pid: by_pid[pid] for pid in targets}


def snapshot():
    processes = list_processes()
    if sys.platform == 'darwin':
        # commに空白を含むElectron Helperを、引数と分けて取得する。
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,args='], check=True,
                                capture_output=True, encoding='utf-8', timeout=15)
        commands = {}
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 2)
            if len(fields) == 3:
                commands[int(fields[0])] = (int(fields[1]), fields[2])
        result = subprocess.run(['ps', '-axo', 'pid=,comm='], check=True,
                                capture_output=True, encoding='utf-8', timeout=15)
        processes = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) != 2 or int(fields[0]) not in commands:
                continue
            pid, executable = int(fields[0]), fields[1]
            parent, command = commands[pid]
            processes.append(dict(ProcessId=pid, ParentProcessId=parent,
                                  Name=os.path.basename(executable), ExecutablePath=executable,
                                  CommandLine=command))
    # POSIXの相対入口を識別する。取得不能なプロセスをcwdの推測では判定しない。
    if sys.platform.startswith('linux'):
        for process in processes:
            try:
                process['WorkingDirectory'] = os.readlink(f"/proc/{process['ProcessId']}/cwd")
                argv = Path(f"/proc/{process['ProcessId']}/cmdline").read_bytes().split(b'\0')
                process['CommandLine'] = shlex.join([os.fsdecode(arg) for arg in argv if arg])
            except OSError:
                pass
    return processes


def owner_identity(process):
    return {key: process.get(key, '') for key in ('ProcessId', 'Name', 'ExecutablePath', 'CommandLine', 'CreationDate')}


def owner_path(root, pid):
    return Path(root) / '_data' / 'AiDiy' / 'start_processes' / f'{int(pid)}.json'


def registered_supervisor(process, root):
    # PID再利用を識別できない一覧では記録を信用しない。
    if not process.get('CreationDate'):
        return False
    try:
        saved = json.loads(owner_path(root, process['ProcessId']).read_text(encoding='utf-8'))
        return saved == owner_identity(process)
    except (OSError, ValueError, TypeError):
        return False


@contextmanager
def register_start_owner(root):
    """Windowsの相対 _start.py も後続setup/startで安全に識別できる所有記録。"""
    path = None
    try:
        if sys.platform == 'win32':
            process = next((p for p in snapshot() if p['ProcessId'] == os.getpid()), None)
            if process and process.get('CreationDate'):
                path = owner_path(root, os.getpid())
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(owner_identity(process)), encoding='utf-8')
    except (OSError, ValueError, subprocess.SubprocessError):
        # 所有記録不可でも起動は可能。後続停止は推測で行わない。
        path = None
    try:
        yield
    finally:
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def ambiguous_supervisors(processes, root, windows):
    """旧版等の所属不明な相対監視が対象を再起動し得る場合は中止する。"""
    if not windows:
        return []
    unknown = []
    roles = {p['ProcessId']: process_role(p, root, windows) for p in processes}
    for process in processes:
        if roles[process['ProcessId']] or registered_supervisor(process, root):
            continue
        try:
            args = process_arguments(process.get('CommandLine') or '', windows)
        except ValueError:
            continue
        if ((process.get('Name') or '').casefold().startswith('python') and
                any(arg in ('_start.py', './_start.py', '.\\_start.py') for arg in args[1:]) and
                any(roles.get(pid) and roles[pid] not in KEEP
                    for pid in descendants({process['ProcessId']}, processes))):
            unknown.append(process['ProcessId'])
    return unknown


def identity(process):
    # 親を先に停止するとPPIDは変わるため、実行内容だけを照合する。
    return tuple(process.get(key, '') for key in ('ProcessId', 'Name', 'ExecutablePath', 'CommandLine', 'WorkingDirectory', 'CreationDate'))


def stop_setup_processes(root, info=print, error=print):
    """AiDiy の停止（setup / start 共通）。停止に成功したら、最後に OpenCode の常駐サービスも止める。"""
    if not _stop_aidiy_processes(root, info, error):
        return False
    # OpenCode のサービスは利用者全体で共有される。止められなくても setup / start は止めない。
    stop_opencode_service(info, info)
    return True


def _stop_aidiy_processes(root, info=print, error=print):
    """保護集合を先に確定し、個別PIDで停止。Windowsでも/Tによる巻き込みを避ける。"""
    windows = sys.platform == 'win32'
    try:
        processes = snapshot()
        if ambiguous_supervisors(processes, root, windows):
            error('所属を確認できない旧版の相対 _start.py が対象を監視しています。先にその監視を終了してから再実行してください。')
            return False
        targets = select_targets(processes, root, windows)
        by_pid = {p['ProcessId']: p for p in processes}
        ancestor = by_pid.get(os.getpid(), {}).get('ParentProcessId', 0)
        seen = set()
        while targets and ancestor and ancestor not in seen:
            seen.add(ancestor)
            process = by_pid.get(ancestor, {})
            if process_role(process, root, windows) == 'supervisor' or registered_supervisor(process, root):
                error('停止対象を監視する_start.pyが起動元です。別の端末で実行してください。')
                return False
            ancestor = process.get('ParentProcessId', 0)
        if not targets:
            info('この配置先で確認できる停止対象の AiDiy プロセスはありません（Code / IDE / Discord / Slack は継続）。')
            return True
        # 監視親を先に止め、自動再起動を防ぐ。Code/IDE/Discord/Slack子孫は個別に除外済み。
        def depth(process):
            seen = set()
            while process.get('ParentProcessId') in targets and process['ProcessId'] not in seen:
                seen.add(process['ProcessId'])
                process = targets[process['ParentProcessId']]
            return len(seen)
        def stop_order(process):
            # 監視親の後にDiag、Memo。共用Electron内の付箋はDiagと同時に終了する。
            role = 'supervisor' if registered_supervisor(process, root) else process_role(process, root, windows)
            parent = process
            seen = set()
            while role not in ('supervisor', 'backend_diag', 'memo') and parent.get('ParentProcessId') in targets:
                if parent['ProcessId'] in seen:
                    break
                seen.add(parent['ProcessId'])
                parent = targets[parent['ParentProcessId']]
                role = process_role(parent, root, windows)
            return ({'supervisor': 0, 'backend_diag': 1, 'memo': 2}.get(role, 3), depth(process))
        info('Diag → Memo の順に強制停止します（共用プロセスは同時終了）。')
        for target in sorted(targets.values(), key=stop_order):
            current = next((p for p in snapshot() if p['ProcessId'] == target['ProcessId']), None)
            if current is None or identity(current) != identity(target):
                continue
            pid = target['ProcessId']
            info(f"AiDiyプロセスを停止します: {target.get('Name', '')} (PID={pid})")
            try:
                if windows:
                    subprocess.run(['taskkill', '/F', '/PID', str(pid)], capture_output=True,
                                   timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            except (OSError, subprocess.SubprocessError) as exc:
                # Diagの停止失敗でもMemo等は試す。最後の再照合で残留を判定する。
                error(f'AiDiyプロセスの停止操作に失敗しました (PID={pid}): {exc}')
        deadline = time.monotonic() + 5
        while True:
            current_processes = snapshot()
            remaining = select_targets(current_processes, root, windows)
            # 親停止後に再親付けされた補助プロセスも、最初の所有確認で追跡する。
            remaining.update({p['ProcessId']: p for p in current_processes
                              if p['ProcessId'] in targets and identity(p) == identity(targets[p['ProcessId']])})
            if not remaining:
                info('この配置先で確認した停止対象の AiDiy プロセスの終了を確認しました（Code / IDE / Discord / Slack は継続）。')
                return True
            if time.monotonic() >= deadline:
                error('停止対象の AiDiy プロセスが残っています。停止を完了できませんでした。')
                return False
            time.sleep(0.2)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        error(f'AiDiy プロセスの状態を確認できません。停止完了は未確認です: {exc}')
        return False
