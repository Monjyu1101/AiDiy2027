# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""起動前の停止対象を合成プロセスで確認。実プロセスは停止しない。"""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _setup_processes as subject

ROOT = '/repo/AiDiy'

def proc(pid, command, parent=1, name='node', executable='', cwd=''):
    return dict(ProcessId=pid, ParentProcessId=parent, Name=name, CommandLine=command,
                ExecutablePath=executable, WorkingDirectory=cwd)

def app(pid, kind, parent=1):
    return proc(pid, f'node {ROOT}/frontend_ide/launch.mjs --app {kind}', parent)

class SetupProcessesTest(unittest.TestCase):
    def setUp(self):
        # POSIXの合成記録を使う。Windows固有ケースは各テスト内で上書きする。
        platform = patch.object(subject.sys, 'platform', 'linux')
        platform.start()
        self.addCleanup(platform.stop)
        signal = patch.object(subject.signal, 'SIGKILL', 9, create=True)
        signal.start()
        self.addCleanup(signal.stop)
        # 実機の OpenCode サービスは触らない。
        opencode = patch.object(subject, 'stop_opencode_service')
        self.opencode = opencode.start()
        self.addCleanup(opencode.stop)

    def test_diag_then_memo_order_and_other_checkout_preserved(self):
        for windows in (False, True):
            root = 'C:/repo/AiDiy' if windows else ROOT
            records = [proc(30, f'node {root}/backend_diag/memo_main.mjs'),
                       proc(20, f'node {root}/backend_diag/diag_main.mjs'),
                       proc(40, f'node {root}-other/backend_diag/memo_main.mjs'),
                       proc(10, f'python {root}/_start.py', name='python')]
            stopped = []
            def kill(pid, *_):
                stopped.append(pid)
                records[:] = [p for p in records if p['ProcessId'] != pid]
            def run(args, **kwargs):
                self.assertNotIn('/T', args)
                kill(int(args[-1]))
            with patch.object(subject.sys, 'platform', 'win32' if windows else 'linux'), \
                    patch.object(subject.subprocess, 'CREATE_NO_WINDOW', 0, create=True), \
                    patch.object(subject, 'snapshot', side_effect=lambda: list(records)), \
                    patch.object(subject.os, 'kill', side_effect=kill), \
                    patch.object(subject.subprocess, 'run', side_effect=run):
                self.assertTrue(subject.stop_setup_processes(root, lambda _: None))
            self.assertEqual(stopped, [10, 20, 30])
            self.assertEqual([p['ProcessId'] for p in records], [40])

    def test_diag_kill_failure_does_not_skip_memo(self):
        for windows in (False, True):
            root = 'C:/repo/AiDiy' if windows else ROOT
            records = [proc(20, f'node {root}/backend_diag/diag_main.mjs'),
                       proc(30, f'node {root}/backend_diag/memo_main.mjs')]
            attempted = []
            def kill(pid, *_):
                attempted.append(pid)
                if pid == 20:
                    if windows:
                        raise subject.subprocess.TimeoutExpired('taskkill', 10)
                    raise PermissionError('fixture denied')
                records[:] = [p for p in records if p['ProcessId'] != pid]
            with patch.object(subject.sys, 'platform', 'win32' if windows else 'linux'), \
                    patch.object(subject.subprocess, 'CREATE_NO_WINDOW', 0, create=True), \
                    patch.object(subject, 'snapshot', side_effect=lambda: list(records)), \
                    patch.object(subject.os, 'kill', side_effect=kill), \
                    patch.object(subject.subprocess, 'run', side_effect=lambda args, **kw: kill(int(args[-1]))), \
                    patch.object(subject.time, 'monotonic', side_effect=[0, 6]):
                self.assertFalse(subject.stop_setup_processes(root, lambda _: None, lambda _: None))
            self.assertEqual(attempted, [20, 30])
            self.assertEqual([p['ProcessId'] for p in records], [20])

    def test_memo_is_independent_boundary_under_preserved_code(self):
        records = [app(10, 'code'), proc(20, f'node {ROOT}/backend_diag/memo_main.mjs', 10),
                   proc(21, 'electron --type=renderer', 20)]
        self.assertEqual(set(subject.select_targets(records, ROOT, current_pid=999)), {20, 21})

    def test_all_components_except_code_ide_discord(self):
        records = [app(10, 'code'), app(11, 'ide'), app(12, 'live'), app(13, 'console')]
        for i, folder in enumerate(subject.COMPONENTS[:-1], 20):
            records.append(proc(i, f'node {ROOT}/{folder}/launch.mjs'))
        self.assertEqual(set(subject.select_targets(records, ROOT, current_pid=999)), {12, 13, *range(20,27), 28})

    def test_discord_entries_and_cli_mcp_descendants_are_preserved(self):
        for windows in (False, True):
            root = r'C:\repo\AiDiy' if windows else ROOT
            entries = ('panel/launch.mjs', 'panel/desktop.cjs', 'src/panel-worker.ts',
                       'src/web-server.ts', 'src/main.ts', '_start.py')
            for entry in (*(f'discord/{entry}' for entry in entries), *(f'slack/{entry}' for entry in entries)):
                with self.subTest(windows=windows, entry=entry):
                    records = [proc(5, f'python {root}/_start.py', name='python'),
                               proc(10, f'node "{root}/frontend_channels/{entry}"', 5),
                               proc(11, f'python "{root}/command_hermes/cli_main.py"', 10, 'python'),
                               proc(12, f'python "{root}/backend_tools/mcp_stdio.py"', 11, 'python'),
                               proc(13, 'electron --type=renderer', 10, 'electron'),
                               proc(20, f'node "{root}/frontend_ide/launch.mjs" --app live', 10),
                               proc(21, 'electron --type=renderer', 20, 'electron')]
                    self.assertEqual(set(subject.select_targets(records, root, windows, 999)), {5, 20, 21})

    def test_orphan_discord_electron_is_preserved(self):
        exe = f'{ROOT}/frontend_channels/discord/node_modules/electron/dist/electron'
        p = proc(10, f'{exe} --type=gpu-process', name='electron', executable=exe)
        self.assertEqual(subject.select_targets([p], ROOT, current_pid=999), {})

    def test_orphan_slack_electron_is_preserved(self):
        for windows in (False, True):
            root = r'C:\repo\AiDiy' if windows else ROOT
            exe = f'{root}/frontend_channels/slack/node_modules/electron/dist/electron'
            if windows:
                exe += '.exe'
            p = proc(10, f'"{exe}" --type=gpu-process', name='electron', executable=exe)
            self.assertEqual(subject.select_targets([p], root, windows, current_pid=999), {})

    def test_setup_and_start_share_discord_preserving_selector(self):
        import importlib.util
        root = Path(__file__).resolve().parents[2]
        for filename, method in (('_setup.py', 'stop_setup_apps'), ('_start.py', 'stop_all_tasks')):
            spec = importlib.util.spec_from_file_location('discord_route_' + method, root / filename)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            records = [proc(10, f'node {root}/frontend_channels/discord/src/web-server.ts'),
                       proc(11, f'python {root}/command_hermes/cli_main.py', 10, 'python'),
                       proc(12, f'python {root}/backend_tools/mcp_stdio.py', 11, 'python'),
                       proc(20, f'node {root}/frontend_channels/slack/src/web-server.ts'),
                       proc(21, f'python {root}/command_hermes/cli_main.py', 20, 'python'),
                       proc(22, f'python {root}/backend_tools/mcp_stdio.py', 21, 'python')]
            with patch.object(subject, 'snapshot', return_value=records), patch.object(subject.os, 'kill') as kill, \
                 patch.object(subject.subprocess, 'run') as run, patch.object(module, 'print_header'), \
                 patch.object(module, 'print_info'):
                getattr(module, method)()
            kill.assert_not_called()
            run.assert_not_called()

    def test_backend_venvs_and_hermes_relative(self):
        for folder in ('backend_server', 'backend_tools', 'backend_local', 'backend_taskteam', 'command_hermes'):
            with self.subTest(folder=folder):
                p = proc(10, f'{ROOT}/{folder}/.venv/bin/python -m uvicorn core_main:app', name='python3')
                self.assertEqual(subject.process_role(p, ROOT), folder)

    def test_system_python_relative_entry_requires_cwd(self):
        p = proc(10, 'python cli_main.py', name='python', cwd=f'{ROOT}/command_hermes')
        self.assertEqual(subject.process_role(p, ROOT), 'command_hermes')
        p['WorkingDirectory'] = ''
        self.assertIsNone(subject.process_role(p, ROOT))

    def test_windows_relative_supervisor_requires_ownership(self):
        records = [proc(10, 'python _start.py', name='python.exe'),
                   proc(11, r'C:\AiDiy\backend_server\.venv\Scripts\python.exe -m uvicorn core_main:app', parent=10, name='python.exe')]
        self.assertEqual(set(subject.select_targets(records, r'C:\AiDiy', True, 999)), {11})
        self.assertEqual(subject.ambiguous_supervisors(records,r'C:\AiDiy',True),[10])
        with patch.object(subject,'registered_supervisor',side_effect=lambda p,root:p['ProcessId']==10):
            self.assertEqual(set(subject.select_targets(records,r'C:\AiDiy',True,999)),{10,11})
            self.assertEqual(subject.ambiguous_supervisors(records,r'C:\AiDiy',True),[])

    def test_unknown_supervisor_cannot_claim_own_code_and_unrelated_child(self):
        records=[proc(10,'python _start.py',name='python.exe'),
                 proc(11,r'node C:\AiDiy\frontend_ide\launch.mjs --app code',parent=10),
                 proc(12,r'node C:\Other\worker.mjs',parent=10)]
        self.assertEqual(subject.select_targets(records,r'C:\AiDiy',True,999),{})

    def test_windows_owner_record_checks_creation_date_and_is_removed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            process=proc(10,'python _start.py',name='python.exe')
            process['CreationDate']='2026-10-22T23:00:00'
            with patch.object(subject.sys,'platform','win32'),patch.object(subject,'snapshot',return_value=[process]),patch.object(subject.os,'getpid',return_value=10):
                with subject.register_start_owner(root):
                    self.assertTrue(subject.registered_supervisor(process,root))
                    self.assertFalse(subject.registered_supervisor({**process,'CreationDate':'later'},root))
                self.assertFalse(subject.owner_path(root,10).exists())

    def test_keep_code_ide_helpers_but_stop_explicit_other_apps(self):
        records = [app(10,'code'), app(20,'ide'), proc(11,'python worker.py',10,'python'),
                   proc(21,'electron --type=renderer',20,'electron'), app(22,'live',20),
                   proc(23,'electron --type=renderer',22,'electron'), app(24,'console',20)]
        self.assertEqual(set(subject.select_targets(records, ROOT, current_pid=999)), {22,23,24})

    def test_stop_supervisor_without_killing_kept_descendants(self):
        records = [proc(5,f'python {ROOT}/_start.py',name='python'), app(10,'code',5),
                   app(20,'ide',5), app(30,'console',5), proc(11,'python mcp.py',10,'python')]
        self.assertEqual(set(subject.select_targets(records,ROOT,current_pid=999)), {5,30})

    def test_current_process_ancestors_and_children_protected(self):
        records = [proc(5,f'python {ROOT}/_start.py',name='python'), app(6,'console',5),
                   proc(7,'python _setup.py',6,'python'), proc(8,'ps -axo',7,'ps'), app(9,'live',5)]
        self.assertEqual(set(subject.select_targets(records,ROOT,current_pid=7)), {9})

    def test_other_copy_and_argument_mentions_not_matched(self):
        for command in (f'node /other/launch.mjs {ROOT}/backend_diag/diag_main.mjs',
                        f'node {ROOT}-other/backend_diag/diag_main.mjs',
                        f'python -c "print(1)" {ROOT}/backend_server/core_main.py',
                        f'node -econsole.log(1) {ROOT}/backend_diag/diag_main.mjs'):
            self.assertIsNone(subject.process_role(proc(10,command),ROOT))

    def test_windows_spaces_case_and_app_option(self):
        p = proc(10, 'node "C:\\Space Dir\\AiDiy\\frontend_ide\\desktop.cjs" --app=code')
        self.assertEqual(subject.process_role(p,r'c:\space dir\aidiy',True),'code')
        p['CommandLine'] = p['CommandLine'].replace('code','live')
        self.assertEqual(subject.process_role(p,r'c:\space dir\aidiy',True),'live')

    def test_old_term_process_is_console_cleanup_boundary(self):
        # 改名前から動く同じcheckoutのプロセスも対象判定を失わない。
        for command in (f'node {ROOT}/frontend_ide/launch.mjs --app term',
                        f'node {ROOT}/frontend_ide/aidiy_term/launch.mjs'):
            self.assertEqual(subject.process_role(proc(31, command), ROOT), 'console')

    def test_legacy_app_entries(self):
        for entry, kind in (('host/aidiy_code/desktop.cjs','code'),('host/dist/aidiy_live/server.cjs','live'),
                            ('viewer/launch.mjs','ide'),('aidiy_console/launch.mjs','console')):
            self.assertEqual(subject.process_role(proc(10,f'node {ROOT}/frontend_ide/{entry}'),ROOT),kind)

    def test_orphan_dedicated_electron_but_not_shared(self):
        for component in ('frontend_avatar','backend_diag','frontend_channels/discord','frontend_channels/slack'):
            exe=f'{ROOT}/{component}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
            self.assertEqual(subject.process_role(proc(10,f'"{exe}" --type=gpu-process',name='Electron',executable=exe),ROOT),component.split('/')[0])
        exe=f'{ROOT}/frontend_ide/node_modules/electron/dist/electron'
        self.assertIsNone(subject.process_role(proc(10,f'{exe} --type=renderer',name='electron'),ROOT))

    def test_shared_electron_profile_identifies_live_not_code(self):
        exe=f'{ROOT}/frontend_ide/node_modules/electron/dist/electron'
        for kind in ('live', 'console', 'code'):
            p=proc(10,f'{exe} --type=renderer --user-data-dir=/tmp/aidiy_{kind}_vue',name='electron')
            self.assertEqual(subject.process_role(p,ROOT),kind)
            self.assertEqual(bool(subject.select_targets([p],ROOT,current_pid=999)), kind != 'code')

    def test_mac_snapshot_preserves_helper_executable_spaces(self):
        from types import SimpleNamespace
        exe=f'{ROOT}/backend_diag/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)'
        outputs=[SimpleNamespace(stdout=f'10 1 {exe} --type=gpu-process\n'),
                 SimpleNamespace(stdout=f'10 {exe}\n')]
        with patch.object(subject.sys,'platform','darwin'),patch.object(subject,'list_processes',return_value=[]),patch.object(subject.subprocess,'run',side_effect=outputs):
            records=subject.snapshot()
        self.assertEqual(records[0]['ExecutablePath'],exe)
        self.assertEqual(subject.process_role(records[0],ROOT),'backend_diag')

    def test_posix_paths_remain_case_sensitive(self):
        self.assertIsNone(subject.process_role(proc(10,'node /repo/aidiy/backend_diag/diag_main.mjs'),ROOT))

    def test_loader_options_skip_loader_value(self):
        p=proc(10, f'node --import /global/loader.mjs {ROOT}/frontend_channels/discord/src/main.ts')
        self.assertEqual(subject.process_role(p,ROOT),'frontend_channels')
        p=proc(10, f'node --import {ROOT}/frontend_channels/discord/loader.mjs /other/main.ts')
        self.assertIsNone(subject.process_role(p,ROOT))

    def test_windows_never_taskkills_tree(self):
        p=app(10,'live'); p['CommandLine']=r'node C:\repo\frontend_ide\launch.mjs --app live'
        with patch.object(subject.sys,'platform','win32'),patch.object(subject,'snapshot',side_effect=[[p],[p],[]]), \
             patch.object(subject.subprocess,'CREATE_NO_WINDOW',0,create=True),patch.object(subject.subprocess,'run') as run:
            self.assertTrue(subject.stop_setup_processes(r'C:\repo',lambda _:None,lambda _:None))
        self.assertEqual(run.call_args.args[0],['taskkill','/F','/PID','10'])

    def test_reparented_child_still_stopped_and_verified(self):
        parent=app(10,'live'); child=proc(11,'electron --type=renderer',10,'electron')
        reparented={**child,'ParentProcessId':1}
        with patch.object(subject.sys,'platform','linux'),patch.object(subject,'snapshot',side_effect=[[parent,child],[parent,child],[reparented],[]]),patch.object(subject.os,'kill') as kill:
            self.assertTrue(subject.stop_setup_processes(ROOT,lambda _:None,lambda _:None))
        self.assertEqual([call.args[0] for call in kill.call_args_list],[10,11])

    def test_reused_pid_is_not_killed(self):
        p=app(10,'live'); other=proc(10,'node /else/script.mjs')
        with patch.object(subject,'snapshot',side_effect=[[p],[other],[other]]),patch.object(subject.os,'kill') as kill:
            self.assertTrue(subject.stop_setup_processes(ROOT,lambda _:None,lambda _:None))
        kill.assert_not_called()

    def test_remaining_process_fails(self):
        p=app(10,'live')
        with patch.object(subject,'snapshot',return_value=[p]),patch.object(subject.os,'kill'),patch.object(subject.time,'monotonic',side_effect=[0,6]):
            self.assertFalse(subject.stop_setup_processes(ROOT,lambda _:None,lambda _:None))

    def test_ambiguous_old_windows_monitor_aborts_without_kill(self):
        records=[proc(10,'python _start.py',name='python.exe'),
                 proc(11,r'C:\AiDiy\backend_server\.venv\Scripts\python.exe -m uvicorn core_main:app',parent=10,name='python.exe')]
        with patch.object(subject.sys,'platform','win32'),patch.object(subject,'snapshot',return_value=records),patch.object(subject.subprocess,'run') as run:
            self.assertFalse(subject.stop_setup_processes(r'C:\AiDiy',lambda _:None,lambda _:None))
        run.assert_not_called()

    def test_known_monitor_ancestor_aborts_without_kill(self):
        records=[proc(10,f'python {ROOT}/_start.py',name='python'),
                 proc(11,'python _setup.py',parent=10,name='python'),app(12,'live',10)]
        with patch.object(subject,'snapshot',return_value=records),patch.object(subject.os,'getpid',return_value=11),patch.object(subject.os,'kill') as kill:
            self.assertFalse(subject.stop_setup_processes(ROOT,lambda _:None,lambda _:None))
        kill.assert_not_called()

    def test_snapshot_failure_fails_closed(self):
        with patch.object(subject,'snapshot',side_effect=OSError('denied')),patch.object(subject.os,'kill') as kill:
            self.assertFalse(subject.stop_setup_processes(ROOT,lambda _:None,lambda _:None))
        kill.assert_not_called()

class StopOutputTest(unittest.TestCase):
    def setUp(self):
        platform = patch.object(subject.sys, 'platform', 'linux')
        platform.start()
        self.addCleanup(platform.stop)
        signal = patch.object(subject.signal, 'SIGKILL', 9, create=True)
        signal.start()
        self.addCleanup(signal.stop)
        # 実機の OpenCode サービスは触らない。
        opencode = patch.object(subject, 'stop_opencode_service')
        self.opencode = opencode.start()
        self.addCleanup(opencode.stop)

    def test_no_targets_is_not_stop_success(self):
        info, errors = [], []
        with patch.object(subject, 'snapshot', return_value=[]):
            self.assertTrue(subject.stop_setup_processes(ROOT, info.append, errors.append))
        self.assertIn('確認できる停止対象', info[-1])
        self.assertIn('ありません', info[-1])
        self.assertNotIn('終了を確認しました', info[-1])
        self.assertEqual(errors, [])

    def test_verified_exit_message_is_scoped(self):
        p = app(10, 'live')
        info, errors = [], []
        with patch.object(subject, 'snapshot', side_effect=[[p], [p], []]), patch.object(subject.os, 'kill'):
            self.assertTrue(subject.stop_setup_processes(ROOT, info.append, errors.append))
        self.assertIn('この配置先で確認した停止対象', info[-1])
        self.assertIn('Code / IDE / Discord / Slack は継続', info[-1])
        self.assertEqual(errors, [])

    def test_remaining_and_snapshot_error_never_claim_success_or_setup(self):
        for failed_snapshot in (False, True):
            with self.subTest(failed_snapshot=failed_snapshot):
                info, errors = [], []
                p = app(10, 'live')
                with patch.object(subject, 'snapshot', side_effect=OSError('unavailable') if failed_snapshot else None, return_value=[p]), patch.object(subject.os, 'kill'), patch.object(subject.time, 'monotonic', side_effect=[0, 6]):
                    self.assertFalse(subject.stop_setup_processes(ROOT, info.append, errors.append))
                self.assertTrue(errors)
                self.assertNotIn('セットアップ', ''.join(errors))
                self.assertNotIn('終了を確認しました', ''.join(info))
                self.assertIn('未確認' if failed_snapshot else '残っています', errors[-1])

if __name__=='__main__': unittest.main()
