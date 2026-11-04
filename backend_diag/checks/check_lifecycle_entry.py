# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Diagの単独管理入口。起動/登録/実削除はmockし、外部アプリを実行しない。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location('diag_entry_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

start, setup, cleanup = load('_start'), load('_setup'), load('_cleanup')
import _runtime_requirements as runtime


class StartEntryTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.errors = self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.enterContext(patch.object(subprocess, 'Popen', side_effect=AssertionError('real launch forbidden')))
        self.enterContext(patch.object(start, 'check_environment', return_value=(True, 'fixture')))
        self.enterContext(patch.object(start.shutil, 'which', return_value='/fixture/node'))

    def test_default_and_explicit_arguments_match_node_entry_without_implicit_auto(self):
        for args in ([], ['--browser', '--no-open'], ['--headless'], ['--help'], ['--auto'], ['--unknown']):
            with self.subTest(args=args), patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
                self.assertEqual(start.main(args), 0)
                self.assertEqual(run.call_args.args[0], ['/fixture/node', str(ROOT / 'diag_main.mjs'), *args])
                self.assertEqual(run.call_args.kwargs['cwd'], ROOT)
                self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
                self.assertEqual(run.call_args.kwargs['creationflags'], subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)

    def test_child_error_and_signal_exit_status_are_preserved(self):
        for result, expected in [(0, 0), (1, 1), (130, 130), (-15, 143)]:
            with self.subTest(result=result), patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=result)):
                self.assertEqual(start.main([]), expected)

    def test_failed_preflight_never_launches(self):
        with patch.object(start, 'check_environment', return_value=(False, 'Node unavailable')), patch.object(subprocess, 'run') as run:
            self.assertEqual(start.main([]), 1)
        run.assert_not_called()
        self.assertIn('Node unavailable', self.errors.getvalue())

    def test_node_disappearance_and_launch_failure_are_nonzero_without_raw_error(self):
        for error in (FileNotFoundError('private path'), PermissionError('private path'), subprocess.SubprocessError('private path')):
            with self.subTest(error=type(error)), patch.object(subprocess, 'run', side_effect=error):
                self.assertEqual(start.main([]), 1)
        with patch.object(start.shutil, 'which', return_value=None), patch.object(subprocess, 'run') as run:
            self.assertEqual(start.main([]), 1)
            run.assert_not_called()
        self.assertNotIn('private path', self.errors.getvalue())

    def test_interrupt_at_preflight_or_child_is_130(self):
        with patch.object(start, 'check_environment', side_effect=KeyboardInterrupt):
            self.assertEqual(start.main([]), 130)
        with patch.object(subprocess, 'run', side_effect=KeyboardInterrupt):
            self.assertEqual(start.main([]), 130)

    def test_python_script_entry_executes_node_instead_of_successful_noop(self):
        def run(command, **kwargs):
            return SimpleNamespace(stdout='v24.0.0', stderr='', returncode=0)
        with patch.object(subprocess, 'run', side_effect=run) as execute, patch.object(sys, 'argv', [str(ROOT / '_start.py'), '--help']):
            with self.assertRaises(SystemExit) as exit_code:
                runpy.run_path(str(ROOT / '_start.py'), run_name='__main__')
        self.assertEqual(exit_code.exception.code, 0)
        self.assertEqual(execute.call_args.args[0][-1], '--help')
        self.assertNotIn('--auto', execute.call_args.args[0])


class BrowserSetupTests(unittest.TestCase):
    def setUp(self):
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.dict('os.environ', {'CODESPACES': 'true'}))
        self.enterContext(patch.object(subprocess, 'run', side_effect=AssertionError('real install forbidden')))
        self.enterContext(patch.object(subprocess, 'Popen', side_effect=AssertionError('real launch forbidden')))

    def test_gui_less_setup_requires_working_node_but_not_electron_or_npm(self):
        for ok, detail in ((False, 'Node unavailable'), (False, 'Node timeout'), (True, 'Node ready'), (True, '[WARN] Node old')):
            with self.subTest(detail=detail), patch.object(runtime, 'check_node_runtime', return_value=(ok, detail)) as probe, patch.object(setup.shutil, 'which', side_effect=AssertionError('must not look for npm')):
                self.assertEqual(setup.setup_desktop(), ok)
                probe.assert_called_once_with('>=18')
        self.assertIn('[WARN] Node old', self.output.getvalue())

    def test_real_helper_with_missing_node_does_not_report_success(self):
        with patch.object(setup.shutil, 'which', return_value=None):
            self.assertFalse(setup.setup_desktop())
        self.assertIn('Node.js', self.output.getvalue())

    def test_real_helper_old_node_warns_without_new_version_stop(self):
        with patch.object(setup.shutil, 'which', return_value='/fixture/node'), patch.object(subprocess, 'run', return_value=SimpleNamespace(stdout='v17.9.0', stderr='')):
            self.assertTrue(setup.setup_desktop())
        self.assertIn('[WARN]', self.output.getvalue())


class CleanupNotificationTests(unittest.TestCase):
    def fixture(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(cleanup, '__file__', str(root / '_cleanup.py')))
        self.enterContext(patch.object(cleanup, 'stop_processes', return_value=False))
        self.enterContext(patch.object(cleanup, 'cleanup_dependencies', side_effect=AssertionError('must not delete dependencies')))
        self.enterContext(patch.object(subprocess, 'run', side_effect=AssertionError('real process forbidden')))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        return root

    def test_existing_fixed_temporary_file_is_not_overwritten_or_removed(self):
        root = self.fixture()
        legacy = root / '.stop-request.tmp'
        legacy.write_text('unrelated file')
        self.assertFalse(cleanup.cleanup())
        self.assertEqual(legacy.read_text(), 'unrelated file')
        self.assertRegex((root / '.stop-request').read_text(), r'^[a-f0-9]{32}$')
        self.assertEqual(list(root.glob('.stop-request-*.tmp')), [])

    def test_existing_temporary_symlink_never_writes_its_target(self):
        root = self.fixture()
        target = root / 'unrelated.txt'
        target.write_text('keep original')
        legacy = root / '.stop-request.tmp'
        try:
            legacy.symlink_to(target)
        except OSError:
            self.skipTest('symlink creation unavailable')
        self.assertFalse(cleanup.cleanup())
        self.assertEqual(target.read_text(), 'keep original')
        self.assertTrue(legacy.is_symlink())
        self.assertFalse((root / '.stop-request').is_symlink())
        self.assertEqual(list(root.glob('.stop-request-*.tmp')), [])

    def test_failed_atomic_replace_keeps_old_notice_and_removes_owned_temp(self):
        root = self.fixture()
        notice = root / '.stop-request'
        notice.write_text('a' * 32)
        with patch.object(Path, 'replace', side_effect=PermissionError('fixture')):
            self.assertFalse(cleanup.cleanup())
        self.assertEqual(notice.read_text(), 'a' * 32)
        self.assertEqual(list(root.glob('.stop-request-*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
