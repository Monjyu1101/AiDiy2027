# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Diagの所有判定と、停止失敗時に削除へ進まないことを検証する。"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diag = load(ROOT / '_cleanup.py', 'diag_cleanup_test')
processes = diag._stop_helper
cleanup = load(ROOT.parent / '_cleanup.py', 'root_cleanup_test')


class DiagCleanupTests(unittest.TestCase):
    def owned(self, command, name='node.exe', executable=''):
        return processes.is_diag(dict(Name=name, CommandLine=command, ExecutablePath=executable), ROOT, True)

    def test_cleanup_stops_diag_then_memo_even_if_diag_fails(self):
        module = Mock()
        module.stop_processes.return_value = False
        with patch.object(cleanup, '_load_folder_module', return_value=module), \
                patch.object(cleanup, '_load_folder_start_module', return_value=module), \
                patch.object(cleanup.time, 'sleep'), patch('builtins.print'), \
                patch.object(cleanup._opencode_service, 'stop_opencode_service'):
            self.assertFalse(cleanup.stop_all_services(keep_diag=False, strict=False))
        names = [call[0] for call in module.mock_calls]
        self.assertLess(names.index('stop_processes'), names.index('stop_memo_processes'))

    def test_diag_stage_leaves_standalone_memo_for_memo_stage(self):
        for windows in (False, True):
            records = [dict(Name='node', CommandLine=f'node "{ROOT / entry}"')
                       for entry in ('diag_main.mjs', 'memo_main.mjs')]
            predicates = []
            def stop_matching(predicate, *args):
                predicates.append(predicate)
                return True
            with patch.object(processes.sys, 'platform', 'win32' if windows else 'linux'), \
                    patch.object(processes.common, 'stop_matching', side_effect=stop_matching):
                self.assertTrue(processes.stop(ROOT))
                self.assertTrue(processes.stop_memo(ROOT))
                self.assertEqual([predicates[0](p) for p in records], [True, False])
                self.assertEqual([predicates[1](p) for p in records], [True, True])

    def test_normal_and_preloaded_entrypoints(self):
        for entry in (ROOT / 'diag_main.mjs', ROOT / 'memo_main.mjs', ROOT / 'diag/起動/electron-main.cjs'):
            for prefix in ('', '--require "C:\\test dir\\probe.cjs" ', '--import=probe.mjs ', '-- '):
                self.assertTrue(self.owned(f'node.exe {prefix}"{entry}" --foreground'))

    def test_foreground_memo_owned_but_other_checkout_or_argument_is_not(self):
        entry = ROOT / 'memo_main.mjs'
        self.assertTrue(self.owned(f'node.exe "{entry}" --foreground'))
        for command in (f'node.exe "{ROOT}-other/memo_main.mjs"', f'node.exe other.js "{entry}"', f'node.exe --eval run() "{entry}"'):
            self.assertFalse(self.owned(command))

    def test_orphan_electron_children(self):
        exe = str(ROOT / 'node_modules/electron/dist/electron.exe')
        for kind in ('gpu-process', 'renderer', 'utility'):
            self.assertTrue(self.owned(f'"{exe}" --type={kind}', 'electron.exe'))
        self.assertTrue(self.owned('', 'electron.exe', exe))

    def test_other_checkout_and_argument_mentions_are_excluded(self):
        entry = ROOT / 'diag_main.mjs'
        for command in (f'node.exe other.js "{entry}"', f'node.exe --eval "run()" "{entry}"',
                        f'node.exe -erun() "{entry}"',
                        f'node.exe "{entry}.old"', f'node.exe "{ROOT}-other/diag_main.mjs"'):
            self.assertFalse(self.owned(command))
        self.assertFalse(self.owned(f'Code.exe "{entry}"', 'Code.exe'))
        self.assertFalse(self.owned(f'"{ROOT}-other/node_modules/electron/dist/electron.exe" --type=renderer', 'electron.exe'))

    def test_posix_entrypoint_with_spaces(self):
        root = (ROOT / 'space folder').resolve()
        self.assertTrue(processes.is_diag(dict(Name='node', CommandLine=f"node --require '/tmp/probe file.cjs' '{root.as_posix()}/diag_main.mjs'"), root, False))

    def test_posix_raw_space_entrypoint_is_uncertain_not_owned(self):
        root = (ROOT / 'space folder').resolve()
        for prefix in ('node ', 'node -- ', 'node --import=probe.mjs '):
            with self.subTest(prefix=prefix), self.assertRaisesRegex(ValueError, '所属を確認できません'):
                processes.is_diag(dict(Name='node', CommandLine=f'{prefix}{root}/diag_main.mjs --browser'), root, False)
        # 引数を連結して True にすると、この文字列が別script+引数だった場合に誤停止する。
        with self.assertRaises(ValueError):
            processes.is_diag(dict(Name='node', CommandLine=f'node {root}/diag_main.mjs'), root, False)

    def test_posix_raw_space_path_negative_cases_remain_excluded(self):
        root = (ROOT / 'space folder').resolve()
        entry = root / 'diag_main.mjs'
        for command in (f'node other.js {entry}', f'node --eval run() {entry}',
                        f'node -erun() {entry}', f'node {entry}.old',
                        f'node {root}-other/diag_main.mjs', f'python {entry}'):
            with self.subTest(command=command):
                name = command.split()[0]
                self.assertFalse(processes.is_diag(dict(Name=name, CommandLine=command), root, False))
        self.assertTrue(processes.is_diag(dict(Name='node', CommandLine=f'node {ROOT}/diag_main.mjs'), ROOT, False))

    def test_posix_unescaped_quote_path_does_not_mean_process_absent(self):
        root = ROOT / "owner's folder"
        with self.assertRaisesRegex(ValueError, '所属を確認できません'):
            processes.is_diag(dict(Name='node', CommandLine=f'node {root}/diag_main.mjs'), root, False)
        self.assertFalse(processes.is_diag(dict(Name='node', CommandLine='node other.js "unclosed'), root, False))

    def test_relative_entrypoint_is_uncertain_without_process_cwd(self):
        for windows in (False, True):
            name = 'node.exe' if windows else 'node'
            for entry in ('frontend_diag/diag_main.mjs', './frontend_diag/diag_main.mjs',
                          'diag_main.mjs', '../frontend_diag/diag_main.mjs', 'memo_main.mjs', 'frontend_diag/memo_main.mjs', '../frontend_diag/memo_main.mjs', 'diag/起動/electron-main.cjs'):
                with self.subTest(windows=windows, entry=entry), self.assertRaisesRegex(ValueError, '作業フォルダが不明'):
                    processes.is_diag(dict(Name=name, CommandLine=f'{name} {entry} --browser'), ROOT, windows)
            self.assertFalse(processes.is_diag(dict(Name=name, CommandLine=f'{name} other.js frontend_diag/diag_main.mjs'), ROOT, windows))
            self.assertFalse(processes.is_diag(dict(Name=name, CommandLine=f'{name} --eval run() frontend_diag/diag_main.mjs'), ROOT, windows))

    def test_ambiguous_process_blocks_stop_and_cleanup_without_deletion(self):
        common = processes.common
        with tempfile.TemporaryDirectory(prefix='diag cleanup ') as folder:
            root = Path(folder)
            for script in (str(root / 'diag_main.mjs'), 'frontend_diag/diag_main.mjs'):
                record = dict(ProcessId=987654, ParentProcessId=0, Name='node', CommandLine=f'node {script} --browser')
                with self.subTest(script=script), patch.object(diag, '__file__', str(root / '_cleanup.py')), \
                        patch.object(common.sys, 'platform', 'linux'), \
                        patch.object(common, 'list_processes', return_value=[record]), \
                        patch.object(common.os, 'kill') as kill, patch.object(common.subprocess, 'run') as run, \
                        patch.object(diag, 'cleanup_dependencies') as delete, \
                        patch.object(diag, 'remove_launcher_path') as remove, patch('builtins.print'):
                    self.assertFalse(processes.stop(root))
                    self.assertFalse(diag.cleanup())
                    kill.assert_not_called()
                    run.assert_not_called()
                    delete.assert_not_called()
                    remove.assert_not_called()

    def test_macos_unquoted_electron_helper_and_ps_comm_are_uncertain(self):
        root = ROOT / 'space folder'
        executable = root / 'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)'
        # 実行ファイル全体が引用されていないps argsと、空白入りcommの両方を検証する。
        raw = dict(Name='Electron Helper (Renderer)', CommandLine=f'{executable} --type=renderer')
        with self.assertRaisesRegex(ValueError, '所属を確認できません'):
            processes.is_diag(raw, root, False)
        common = processes.common
        for comm in (str(executable), executable.name):
            output = f'987654 1 {comm} {executable} --type=renderer\n'
            with patch.object(common.sys, 'platform', 'darwin'), \
                    patch.object(common.subprocess, 'run', return_value=Mock(stdout=output)):
                record = common.list_processes()[0]
            with self.subTest(comm=comm), self.assertRaisesRegex(ValueError, '所属を確認できません'):
                processes.is_diag(record, root, False)
        # 他コピーの同名Electronを停止対象や曖昧な自コピーとして扱わない。
        other = str(executable).replace(str(root), str(root) + '-other', 1)
        self.assertFalse(processes.is_diag(dict(Name='Electron Helper (Renderer)', CommandLine=f'{other} --type=renderer'), root, False))

    def test_macos_similar_executable_prefix_is_not_owned_or_uncertain(self):
        for root in (ROOT, ROOT / 'space folder'):
            executable = root / 'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)'
            for suffix in ('.old', '-other'):
                command = f'{executable}{suffix} --type=gpu-process'
                self.assertFalse(processes.is_diag(dict(Name='Electron Helper (GPU)', CommandLine=command), root, False))
                for comm in (str(executable), executable.name):
                    parts = comm.split(None, 1)
                    record = dict(Name=Path(parts[0]).name, CommandLine=f'{parts[1]} {command}')
                    self.assertFalse(processes.is_diag(record, root, False))

    def test_macos_orphan_electron_children(self):
        distribution = ROOT / 'node_modules/electron/dist/Electron.app/Contents'
        targets = [('Electron', distribution / 'MacOS/Electron')]
        for suffix in ('', ' (GPU)', ' (Renderer)', ' (Plugin)'):
            name = f'Electron Helper{suffix}'
            targets.append((name, distribution / f'Frameworks/{name}.app/Contents/MacOS/{name}'))
        for name, executable in targets:
            with self.subTest(name=name):
                self.assertTrue(processes.is_diag(dict(Name=name, CommandLine='', ExecutablePath=str(executable)), ROOT, False))
                self.assertTrue(processes.is_diag(dict(Name=name, CommandLine=f'"{executable}" --type=renderer'), ROOT, False))

    def test_posix_case_normalization_does_not_expand_project_scope(self):
        name = 'Electron'
        for other_root in (Path(str(ROOT) + '-other'), ROOT.with_name(ROOT.name.upper())):
            executable = other_root / 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
            self.assertFalse(processes.is_diag(dict(Name=name, CommandLine='', ExecutablePath=str(executable)), ROOT, False))
            self.assertFalse(processes.is_diag(dict(Name=name, CommandLine=f'Electron "{other_root / "diag/起動/electron-main.cjs"}"'), ROOT, False))
        self.assertTrue(processes.is_diag(dict(Name=name, CommandLine=f'Electron "{ROOT / "diag/起動/electron-main.cjs"}"'), ROOT, False))
        self.assertFalse(processes.is_diag(dict(Name=name, CommandLine=f'Electron other.js "{ROOT / "diag/起動/electron-main.cjs"}"'), ROOT, False))

    def test_stop_uses_tree_termination_and_checks_exit(self):
        record = dict(ProcessId=987654, ParentProcessId=0, Name='node.exe', CommandLine=f'node.exe "{ROOT / "diag_main.mjs"}"')
        common = processes.common
        with patch.object(common, 'list_processes', side_effect=[[record], [record], []]), \
                patch.object(common.sys, 'platform', 'win32'), \
                patch.object(common.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
                patch.object(common.subprocess, 'run') as run, patch('builtins.print'):
            self.assertTrue(processes.stop(ROOT))
        self.assertEqual(run.call_args.args[0], ['taskkill', '/F', '/T', '/PID', '987654'])
        self.assertEqual(run.call_args.kwargs['creationflags'], 0x08000000)

    def test_stop_failure_preserves_launcher(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diag, '__file__', str(Path(folder) / '_cleanup.py')), \
                patch.object(diag, 'stop_processes', return_value=False), \
                patch.object(diag, 'stop_memo_processes', return_value=True), patch.object(diag, 'remove_launcher_path') as remove:
            self.assertFalse(diag.cleanup())
            remove.assert_not_called()

    def test_root_cleanup_requests_diag_stop_even_without_uninstall(self):
        with patch.object(cleanup, 'stop_all_services', side_effect=RuntimeError('stop failed')) as stop, \
                patch.object(cleanup, 'cleanup_backup') as delete, patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'stop failed'):
                cleanup.execute_cleanup(ROOT.parent, {'diag': False})
        stop.assert_called_once_with({'diag': False}, keep_diag=False)
        delete.assert_not_called()

    def test_diag_stop_failure_is_reported_after_other_services_stop(self):
        module = Mock()
        module.stop_processes.return_value = False
        with patch.object(cleanup, '_load_folder_module', return_value=module), \
                patch.object(cleanup, '_load_folder_start_module', return_value=module), \
                patch.object(cleanup.time, 'sleep'), patch('builtins.print'), \
                patch.object(cleanup._opencode_service, 'stop_opencode_service'):
            with self.assertRaisesRegex(RuntimeError, 'Diag'):
                cleanup.stop_all_services(keep_diag=False)
        module.kill_ports.assert_called()
        module.stop_tools_processes.assert_called_once()

    def test_normal_start_stop_preserves_diag(self):
        module = Mock()
        module.process_tree_pids.return_value = set()
        with patch.object(cleanup, '_load_folder_module', return_value=module), \
                patch.object(cleanup, '_load_folder_start_module', return_value=module), \
                patch.object(cleanup.time, 'sleep'), patch('builtins.print'), \
                patch.object(cleanup._opencode_service, 'stop_opencode_service'):
            self.assertTrue(cleanup.stop_all_services(keep_code=True, keep_dev=True, keep_discord=True))
        module.stop_processes.assert_not_called()


if __name__ == '__main__':
    unittest.main()
