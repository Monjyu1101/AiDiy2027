# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""IDE群の登録結果と起動一覧をまとめ、単独setupの案内も維持する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    spec = importlib.util.spec_from_file_location('output_' + path.replace('/', '_'), ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SetupOutputTests(unittest.TestCase):
    def test_all_seven_registered_together_and_path_once(self):
        for platform in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                setup = load('frontend_ide/_setup.py')
                launcher = load('frontend_ide/viewer/launcher.py')
                host = load('frontend_ide/host/_setup.py')
                output = io.StringIO()
                def path_notice(_):
                    print('PATH 登録済み。')
                    return True
                with patch.object(launcher._path_helper, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(host, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='node'), patch.object(setup, 'load_setup_module', return_value=launcher), patch.object(launcher, 'ensure_launcher_path', side_effect=path_notice) as ensure, patch.object(host, 'ensure_launcher_path') as host_ensure, contextlib.redirect_stdout(output):
                    self.assertTrue(setup.register_launchers(host))
                names = ['navi', 'console', 'code', 'live', 'ide', 'task', 'team', 'browser']
                suffix = '.cmd' if platform == 'win32' else ''
                lines = [line for line in output.getvalue().splitlines() if 'を登録しました:' in line]
                self.assertEqual(len(lines), 8)
                for name, line in zip(names, lines):
                    self.assertIn(f'aidiy_{name}{suffix} を登録しました:', line)
                    self.assertTrue((Path(tmp) / '_AIDIY' / f'aidiy_{name}' / 'bin' / f'aidiy_{name}{suffix}').is_file())
                self.assertEqual(output.getvalue().count('PATH 登録済み。'), 8)
                self.assertEqual(ensure.call_count, 8)
                host_ensure.assert_not_called()

    def test_child_setups_defer_registration_and_aligned_success(self):
        setup = load('frontend_ide/_setup.py')
        children = []
        def child(_):
            module = SimpleNamespace(setup=Mock(return_value=True))
            children.append(module)
            return module
        output = io.StringIO()
        with patch.object(setup, 'load_setup_module', side_effect=child), patch.object(setup, 'register_launchers', return_value=True) as register, contextlib.redirect_stdout(output):
            self.assertTrue(setup.setup())
        self.assertEqual(len(children), 7)
        for child in children:
            self.assertTrue(child.setup.call_args.args[0]['_defer_ide_launchers'])
        register.assert_called_once_with(children[2])
        lines = [line for line in output.getvalue().splitlines() if ' 起動:' in line]
        self.assertEqual(len(lines), 8)
        self.assertEqual(len({line.index(':') for line in lines}), 1)

    def test_child_or_registration_failure_has_no_completion_summary(self):
        for child_ok, registration_ok in ((False, True), (True, False)):
            setup = load('frontend_ide/_setup.py')
            output = io.StringIO()
            with patch.object(setup, 'load_setup_module', return_value=SimpleNamespace(setup=Mock(return_value=child_ok))), patch.object(setup, 'register_launchers', return_value=registration_ok) as register, contextlib.redirect_stdout(output):
                self.assertFalse(setup.setup())
            self.assertNotIn('セットアップ完了', output.getvalue())
            self.assertNotIn(' 起動:', output.getvalue())
            if not child_ok:
                register.assert_not_called()

    def test_registration_stops_on_first_failure_and_path_failure_propagates(self):
        for fail_at in (0, 1, 2, 3, 4, 5, 'path'):
            setup = load('frontend_ide/_setup.py')
            launcher = SimpleNamespace(install_launcher=Mock(), launcher_path=Mock(return_value=Path('/fake/bin/aidiy_ide')), ensure_launcher_path=Mock(return_value=fail_at != 'path'))
            host = SimpleNamespace(install_standalone_launcher=Mock(return_value=fail_at != 1))
            if isinstance(fail_at, int) and fail_at != 1:
                call_index = {0: 0, 2: 1, 3: 2, 4: 3, 5: 4}[fail_at]
                launcher.install_launcher.side_effect = [None] * call_index + [OSError('fixture failure')]
            with patch.object(setup, 'load_setup_module', return_value=launcher), contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(setup.register_launchers(host))
            if fail_at != 'path':
                launcher.ensure_launcher_path.assert_not_called()

    def test_command_only_children_obey_deferred_mode(self):
        for kind in ('navi', 'console', 'task', 'team', 'browser'):
            module = load(f'frontend_ide/aidiy_{kind}/_setup.py')
            with patch.object(module.importlib.util, 'spec_from_file_location') as loader:
                self.assertTrue(module.setup({'_defer_ide_launchers': True}))
                loader.assert_not_called()

    def test_single_launcher_keeps_path_notice_and_suffix(self):
        launcher = load('frontend_ide/viewer/launcher.py')
        with tempfile.TemporaryDirectory() as tmp, patch.object(launcher._path_helper, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(launcher.shutil, 'which', return_value='node'), patch.object(launcher, 'ensure_launcher_path', return_value=True) as ensure, contextlib.redirect_stdout(io.StringIO()):
            launcher.install_launcher(ROOT / 'frontend_ide/aidiy_console', 'console')
            self.assertEqual(ensure.call_count, 1)

    def test_single_host_setup_keeps_path_registration(self):
        host = load('frontend_ide/host/_setup.py')
        with tempfile.TemporaryDirectory() as tmp, patch.object(host, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(host, 'ensure_launcher_path', return_value=True) as ensure, contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(host.install_standalone_launcher())
            self.assertEqual(ensure.call_count, 2)

    def test_root_twelve_app_colons_align(self):
        root = load('_setup.py')
        output = io.StringIO()
        with patch.object(root, 'print_info', side_effect=print), contextlib.redirect_stdout(output):
            root.print_app_launch_commands()
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 13)
        self.assertEqual(len({line.index(':') for line in lines}), 1)
        self.assertIn('Console  起動: aidiy_console', output.getvalue())
        self.assertIn('Browser  起動: aidiy_browser', output.getvalue())
        self.assertIn('Discord  起動: aidiy_discord', output.getvalue())


if __name__ == '__main__':
    unittest.main()
