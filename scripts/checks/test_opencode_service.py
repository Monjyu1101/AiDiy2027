# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""OpenCode の常駐サービス停止（setup / start / cleanup の停止の最後）を、実機を触らず確認する。"""
from pathlib import Path
import importlib.util
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import _opencode_service as subject  # noqa: E402
import _setup_processes  # noqa: E402


def result(stdout='', returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout=stdout, stderr='')


def runner(*outputs):
    """status / stop の呼び出し順に結果を返す。"""
    return Mock(side_effect=[result(*output) if isinstance(output, tuple) else result(output) for output in outputs])


class OpenCodeServiceTest(unittest.TestCase):
    def setUp(self):
        which = patch.object(subject.shutil, 'which', return_value='/bin/opencode')
        which.start()
        self.addCleanup(which.stop)
        self.info, self.warn = [], []

    def stop(self):
        return subject.stop_opencode_service(self.info.append, self.warn.append)

    def test_running_service_is_stopped_and_confirmed(self):
        run = runner('http://127.0.0.1:28894\n', '', 'stopped\n')
        with patch.object(subject.subprocess, 'run', run):
            self.assertTrue(self.stop())
        self.assertEqual([call.args[0][1:] for call in run.call_args_list], [['service', 'status'], ['service', 'stop'], ['service', 'status']])
        self.assertEqual(self.warn, [])

    def test_already_stopped_is_not_stopped_again(self):
        run = runner('stopped\n')
        with patch.object(subject.subprocess, 'run', run):
            self.assertTrue(self.stop())
        run.assert_called_once()

    def test_not_installed_does_nothing(self):
        with patch.object(subject.shutil, 'which', return_value=None), patch.object(subject.subprocess, 'run') as run:
            self.assertTrue(self.stop())
        run.assert_not_called()

    def test_old_version_without_service_command_is_skipped(self):
        run = runner(('', 1))
        with patch.object(subject.subprocess, 'run', run):
            self.assertTrue(self.stop())
        run.assert_called_once()

    def test_unconfirmed_stop_and_launch_failure_only_warn(self):
        with patch.object(subject.subprocess, 'run', runner('http://127.0.0.1:1\n', '', 'http://127.0.0.1:1\n')):
            self.assertFalse(self.stop())
        with patch.object(subject.subprocess, 'run', side_effect=OSError('boom')):
            self.assertFalse(self.stop())
        with patch.object(subject.subprocess, 'run', side_effect=subprocess.TimeoutExpired('opencode', 30)):
            self.assertFalse(self.stop())
        self.assertEqual(len(self.warn), 3)

    def test_windows_launches_cmd_or_exe_never_the_extensionless_shim(self):
        names = []
        with patch.object(subject.sys, 'platform', 'win32'), patch.object(subject.shutil, 'which', side_effect=lambda name: names.append(name) and None):
            self.assertIsNone(subject._find_opencode())
        self.assertEqual(names, ['opencode.cmd', 'opencode.exe'])
        with patch.object(subject.sys, 'platform', 'linux'), patch.object(subject.shutil, 'which', side_effect=lambda name: names.append(name) and None):
            subject._find_opencode()
        self.assertEqual(names[-1], 'opencode')


class WiringTest(unittest.TestCase):
    def test_setup_and_start_stop_opencode_last_and_only_after_aidiy_stopped(self):
        order = []
        with patch.object(_setup_processes, '_stop_aidiy_processes', side_effect=lambda *a: order.append('aidiy') or True), \
                patch.object(_setup_processes, 'stop_opencode_service', side_effect=lambda *a: order.append('opencode')):
            self.assertTrue(_setup_processes.stop_setup_processes('root', lambda _: None, lambda _: None))
        self.assertEqual(order, ['aidiy', 'opencode'])
        order.clear()
        with patch.object(_setup_processes, '_stop_aidiy_processes', return_value=False), \
                patch.object(_setup_processes, 'stop_opencode_service') as opencode:
            self.assertFalse(_setup_processes.stop_setup_processes('root', lambda _: None, lambda _: None))
        opencode.assert_not_called()

    def test_opencode_failure_does_not_fail_setup_or_start(self):
        with patch.object(_setup_processes, '_stop_aidiy_processes', return_value=True), \
                patch.object(_setup_processes, 'stop_opencode_service', return_value=False):
            self.assertTrue(_setup_processes.stop_setup_processes('root', lambda _: None, lambda _: None))

    def test_cleanup_stops_opencode_after_all_other_services_and_never_fails_cleanup(self):
        spec = importlib.util.spec_from_file_location('opencode_cleanup_root', ROOT / '_cleanup.py')
        cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cleanup)
        order = []
        module = Mock()
        module.kill_ports.side_effect = lambda *a: order.append('kill_ports') or True
        module.stop_tools_processes.side_effect = lambda *a, **k: order.append('tools') or True
        for failed in (False, True):
            order.clear()
            with patch.object(cleanup, '_load_folder_module', return_value=module), \
                    patch.object(cleanup, '_load_folder_start_module', return_value=module), \
                    patch.object(cleanup.time, 'sleep'), patch('builtins.print'), \
                    patch.object(cleanup._opencode_service, 'stop_opencode_service',
                                 side_effect=lambda *a: order.append('opencode') or not failed):
                self.assertTrue(cleanup.stop_all_services())
            self.assertEqual(order[-1], 'opencode')
            self.assertIn('tools', order[:-1])


if __name__ == '__main__':
    unittest.main()
