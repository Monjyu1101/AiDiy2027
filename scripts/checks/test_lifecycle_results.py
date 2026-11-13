# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""管理入口の警告継続・失敗伝播。実環境の起動/導入/削除は禁止する。"""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

cleanup = load('lifecycle_root_cleanup', '_cleanup.py')
setup = load('lifecycle_root_setup', '_setup.py')
diag_setup = load('lifecycle_diag_setup', 'frontend_diag/_setup.py')
diag_start = load('lifecycle_diag_start', 'frontend_diag/_start.py')


class LifecycleResultsTests(unittest.TestCase):
    def setUp(self):
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(subprocess, 'run', side_effect=AssertionError('real process forbidden')))
        self.enterContext(patch.object(subprocess, 'Popen', side_effect=AssertionError('real process forbidden')))
        self.enterContext(patch.object(cleanup.shutil, 'rmtree', side_effect=AssertionError('real deletion forbidden')))

    def test_module_result_and_import_cache_failure_both_propagate(self):
        for result, cache, expected in ((True, True, True), (None, True, True),
                                        (False, True, False), (True, False, False), (None, False, False)):
            with self.subTest(result=result, cache=cache), \
                    patch.object(cleanup, '_load_folder_module', return_value=SimpleNamespace(cleanup=Mock(return_value=result))), \
                    patch.object(cleanup, '_remove_folder_import_cache', return_value=cache) as remove:
                self.assertEqual(cleanup._run_folder_cleanup('fixture', {}), expected)
                remove.assert_called_once_with('fixture')

    def test_import_cache_is_attempted_even_after_module_failure(self):
        with patch.object(cleanup, '_load_folder_module', side_effect=RuntimeError('fixture')), \
                patch.object(cleanup, '_remove_folder_import_cache', return_value=True) as remove:
            with self.assertRaises(RuntimeError):
                cleanup._run_folder_cleanup('fixture', {})
        remove.assert_called_once()

    def test_import_cache_removal_failure_is_false(self):
        with patch.object(Path, 'is_dir', return_value=True), \
                patch.object(cleanup.shutil, 'rmtree', side_effect=PermissionError('fixture')):
            self.assertFalse(cleanup._remove_folder_import_cache('fixture'))

    def test_backup_is_optional_and_failure_propagates(self):
        with patch.object(Path, 'exists', return_value=True), patch.object(cleanup, 'remove_directory', return_value=False) as remove:
            self.assertTrue(cleanup.cleanup_backup(ROOT, {'backup': False}))
            remove.assert_not_called()
            self.assertFalse(cleanup.cleanup_backup(ROOT, {'backup': True}))
            remove.assert_called_once()
        with patch.object(Path, 'exists', return_value=False):
            self.assertTrue(cleanup.cleanup_backup(ROOT, {'backup': True}))

    def test_npm_uninstall_nonzero_and_missing_command_are_not_success(self):
        for error in (subprocess.CalledProcessError(1, ['npm']), FileNotFoundError('fixture')):
            with self.subTest(error=type(error)), patch.object(cleanup, 'NPM_PACKAGES', ['fixture']), \
                    patch.object(subprocess, 'run', side_effect=error):
                self.assertFalse(cleanup.uninstall_global_npm_tools())
        self.assertNotIn('アンインストール対象はありませんでした', self.output.getvalue())
        with patch.object(cleanup, 'NPM_PACKAGES', ['fixture']), patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0)):
            self.assertTrue(cleanup.uninstall_global_npm_tools())

    def test_root_aggregates_every_module_and_auxiliary_failure(self):
        functions = ('stop_all_services', 'cleanup_backup', 'uninstall_global_npm_tools', '_run_folder_cleanup',
                     'remove_launcher_path', 'cleanup_temp_directories', '_remove_folder_import_cache', '_remove_root_python_caches')
        choices = dict.fromkeys(('diag', 'npm_uninstall', 'local', 'tools', 'backend', 'taskteam', 'web', 'avatar', 'hermes', 'ide', 'channels'), True)
        modules = ('frontend_diag', 'backend_local', 'backend_tools', 'backend_server', 'backend_taskteam',
                   'frontend_web', 'frontend_avatar', 'command_hermes', 'frontend_ide', 'frontend_channels/discord', 'frontend_channels/slack')
        cases = [(None, None)] + [('_run_folder_cleanup', name) for name in modules] + [(name, None) for name in functions if name not in ('stop_all_services', '_run_folder_cleanup')]
        for failure, folder in cases:
            with self.subTest(failure=failure, folder=folder), contextlib.ExitStack() as stack:
                mocks = {name: stack.enter_context(patch.object(cleanup, name, return_value=True)) for name in functions}
                stack.enter_context(patch.object(cleanup.time, 'sleep'))
                if failure:
                    if folder:
                        mocks[failure].side_effect = lambda name, _choices, target=folder, **kwargs: name != target
                    else:
                        mocks[failure].return_value = False
                self.assertEqual(cleanup.execute_cleanup(ROOT, choices), failure is None)
                self.assertEqual(mocks['_run_folder_cleanup'].call_count, len(modules))
                mocks['stop_all_services'].assert_called_once_with(choices, keep_diag=False)

    def test_main_preserves_error_exit_code_without_actual_cleanup(self):
        with patch.object(cleanup, 'collect_cleanup_choices', return_value={}), \
                patch.object(cleanup, 'cleanup_stop_request', return_value=contextlib.nullcontext()), \
                patch.object(cleanup, 'execute_cleanup', return_value=False):
            with self.assertRaises(SystemExit) as result:
                cleanup.main()
            self.assertEqual(result.exception.code, 1)

    def test_build_metadata_warning_does_not_refuse_old_or_unknown_node(self):
        for version in ('v20.18.0', 'unknown'):
            with self.subTest(version=version):
                self.assertTrue(setup.check_refresh_node_runtime(version))
        self.assertIn('[WARN]', self.output.getvalue())

    def test_diag_retains_existing_node18_floor(self):
        for version, expected in [('v17.9.0', False), ('v18.0.0', True), ('v24.0.0', True)]:
            with self.subTest(version=version), patch.object(diag_start.shutil, 'which', return_value='node'), \
                    patch.object(subprocess, 'run', return_value=SimpleNamespace(stdout=version, stderr='')):
                self.assertEqual(diag_start.check_environment()[0], expected)

    def test_diag_desktop_warns_but_runs_existing_setup_dependency_path(self):
        import _runtime_requirements
        dependency_setup = Mock(return_value=True)
        helper = SimpleNamespace(setup_dependencies=dependency_setup)
        with patch.dict(os.environ, {'CODESPACES': 'false', 'DISPLAY': ':fixture'}), \
                patch.object(diag_setup.shutil, 'which', return_value='/fixture/node'), \
                patch.object(diag_setup, 'setup_ui_dependencies', return_value=True) as ui_dependencies, \
                patch.object(_runtime_requirements, 'check_project_node_runtime', return_value=(True, '[WARN] fixture version')), \
                patch.object(diag_setup.importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))), \
                patch.object(diag_setup.importlib.util, 'module_from_spec', return_value=helper):
            self.assertTrue(diag_setup.setup_desktop())
        dependency_setup.assert_called_once()
        ui_dependencies.assert_called_once()
        self.assertIn('[WARN] fixture version', self.output.getvalue())


if __name__ == '__main__':
    unittest.main()
