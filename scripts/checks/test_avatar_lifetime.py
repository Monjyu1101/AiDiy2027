# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Avatarは全体終了でも停止し、Code/IDEは通常終了で継続する。実プロセスは停止しない。"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location('avatar_lifetime_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AvatarLifetimeTest(unittest.TestCase):
    def test_setup_stops_apps_through_shared_inventory(self):
        setup = load('_setup')
        import sys
        sys.path.insert(0, str(ROOT / 'scripts'))
        import _setup_processes
        with patch.object(_setup_processes, 'stop_setup_processes', return_value=True) as stop:
            setup.stop_setup_apps()
        self.assertEqual(stop.call_args.args[0], setup.BASE_DIR)


    def test_setup_stop_failure_reports_setup_abort(self):
        setup = load('_setup')
        import sys
        sys.path.insert(0, str(ROOT / 'scripts'))
        import _setup_processes
        with patch.object(_setup_processes, 'stop_setup_processes', return_value=False), patch.object(setup, 'print_error') as error:
            with self.assertRaises(SystemExit) as raised:
                setup.stop_setup_apps()
        self.assertEqual(raised.exception.code, 1)
        self.assertIn('セットアップを中止', error.call_args.args[0])

    def test_normal_stop_closes_avatar_but_preserves_code_and_ide(self):
        start = load('_start')
        avatar = Mock()
        process = Mock()
        with patch.object(start, 'AVATAR', avatar), patch.object(start.subprocess, 'run') as run:
            start.stop_processes({'フロントエンド(Avatar)': process, 'フロントエンド(code)': Mock(), 'フロントエンド(IDE)': Mock()})
        run.assert_not_called()
        avatar.kill_ports.assert_called_once_with()

    def test_cleanup_stops_avatar_even_when_code_and_ide_are_preserved(self):
        cleanup = load('_cleanup')
        for keep in (True, False):
            calls = []
            def fake_module(folder):
                module = Mock()
                module.kill_ports.side_effect = lambda *args: calls.append(folder)
                module.process_tree_pids.return_value = set()
                return module
            with patch.object(cleanup, '_load_folder_start_module', side_effect=fake_module), \
                    patch.object(cleanup, '_load_folder_module', side_effect=fake_module), \
                    patch.object(cleanup.time, 'sleep'):
                cleanup.stop_all_services(keep_code=keep, keep_dev=keep, keep_discord=True)
            self.assertIn('frontend_avatar', calls)
            self.assertEqual('frontend_ide/viewer' in calls, not keep)


if __name__ == '__main__':
    unittest.main()
