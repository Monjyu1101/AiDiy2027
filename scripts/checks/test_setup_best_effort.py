import ast
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('best_effort_electron', ROOT / 'scripts/_setup_electron.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class BestEffortElectronTests(unittest.TestCase):
    def test_explicit_continue_attempts_remaining_stages_and_reports_failure(self):
        run = Mock(side_effect=[False, True])
        with (patch.object(helper, '_runtime_in_use', side_effect=AssertionError('must not block on running')),
              patch.object(helper, 'prepare_electron_binary', return_value=False) as prepare):
            self.assertFalse(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', run, continue_on_error=True))
        self.assertEqual([call.args[0][1] for call in run.call_args_list], ['install', 'update'])
        prepare.assert_called_once()
        self.assertTrue(prepare.call_args.kwargs['continue_on_error'])

    def test_command_exception_still_attempts_later_stage(self):
        run = Mock(side_effect=[subprocess.CalledProcessError(1, 'npm'), True])
        with patch.object(helper, 'prepare_electron_binary', return_value=True) as prepare:
            self.assertFalse(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', run, continue_on_error=True))
        self.assertEqual(run.call_count, 2)
        prepare.assert_called_once()

    def test_default_running_mismatch_stops_before_commands(self):
        run = Mock()
        with patch.object(helper, '_runtime_in_use', return_value=True), patch.object(helper, '_locked_dependencies_ready', return_value=False), patch.object(helper, 'electron_binary_ready', return_value=False):
            self.assertFalse(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', run))
        run.assert_not_called()

    def test_copy_failure_retains_false(self):
        with patch.object(helper, 'get_electron_version', return_value='1'), patch.object(helper, 'electron_binary_ready', return_value=False), patch.object(helper, '_runtime_in_use', side_effect=AssertionError('must not block')), patch.object(helper, '_dist_ready', side_effect=[False, True]), patch.object(helper, '_place_dist', side_effect=PermissionError('locked')) as place:
            warnings = []
            self.assertFalse(helper.prepare_electron_binary(Path('/fixture/frontend_avatar'), 'test', continue_on_error=True, copy_warnings=warnings))
            self.assertEqual(len(warnings), 1)
        place.assert_called_once()

    def test_missing_copy_input_remains_error(self):
        warnings, error = [], Mock()
        with patch.object(helper, 'get_electron_version', return_value='1'), patch.object(helper, 'electron_binary_ready', return_value=False), patch.object(helper, '_dist_ready', side_effect=[False, True]), patch.object(helper, '_place_dist', side_effect=FileNotFoundError('missing source')):
            self.assertFalse(helper.prepare_electron_binary(Path('/fixture/frontend_avatar'), 'test', continue_on_error=True, copy_warnings=warnings, error=error))
        self.assertEqual(warnings, [])
        error.assert_called_once()

    def test_copy_warning_is_not_dependency_error(self):
        warnings = []
        def copy_failure(*args, **kwargs):
            kwargs['copy_warnings'].append('locked Electron copy')
            return False
        with patch.object(helper, 'prepare_electron_binary', side_effect=copy_failure):
            self.assertTrue(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', Mock(return_value=True), continue_on_error=True, copy_warnings=warnings))
        self.assertEqual(warnings, ['locked Electron copy'])

    def test_noncopy_preparation_error_stays_error(self):
        warnings = []
        with patch.object(helper, 'prepare_electron_binary', return_value=False):
            self.assertFalse(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', Mock(return_value=True), continue_on_error=True, copy_warnings=warnings))
        self.assertEqual(warnings, [])

    def test_success_stays_success(self):
        with patch.object(helper, 'prepare_electron_binary', return_value=True):
            self.assertTrue(helper.setup_dependencies(Path('/fixture'), 'npm', 'test', Mock(return_value=True), continue_on_error=True))

class RootWarningSummaryTests(unittest.TestCase):
    def test_warning_only_summary_is_not_clean_success(self):
        tree = ast.parse((ROOT / '_setup.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'print_setup_summary')
        warning, success = Mock(), Mock()
        namespace = {'print': Mock(), 'print_header': Mock(), 'print_warning': warning, 'print_success': success}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<summary>', 'exec'), namespace)
        namespace['print_setup_summary']([], ['Diag: locked copy'])
        success.assert_not_called()
        self.assertTrue(any('locked copy' in str(c) for c in warning.call_args_list))
        warning.reset_mock()
        namespace['print_setup_summary'](['IDE: build'], ['Diag: locked copy'])
        self.assertTrue(any('IDE: build' in str(c) for c in warning.call_args_list))
        self.assertTrue(any('locked copy' in str(c) for c in warning.call_args_list))

if __name__ == '__main__': unittest.main()
