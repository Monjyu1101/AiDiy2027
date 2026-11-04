"""Discord / Slack の続行指定を副作用なしで確認する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULES = [load('frontend_channels/_setup.py', 'discord_setup_continue'),
           load('frontend_channels/slack/_setup.py', 'slack_setup_continue')]


class ContinueSetupTest(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, module, running=False):
        name = '_slack_in_use' if hasattr(module, '_slack_in_use') else '_discord_in_use'
        with contextlib.ExitStack() as stack:
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            scan = stack.enter_context(patch.object(module, name, return_value=running))
            stack.enter_context(patch.object(module, 'check_project_node_runtime', return_value=(True, 'Node')))
            stack.enter_context(patch.object(module.shutil, 'which', return_value='npm'))
            run = stack.enter_context(patch.object(module.subprocess, 'run'))
            prepare = stack.enter_context(patch.object(module, 'prepare_electron_binary', return_value=True))
            launcher = stack.enter_context(patch.object(module, 'install_launcher'))
            config = stack.enter_context(patch.object(module, '_supplement_config'))
            yield output, scan, run, prepare, launcher, config

    def test_running_default_still_holds(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module, True) as (_, _, run, prepare, launcher, config):
                self.assertFalse(module.setup())
                for action in (run, prepare, launcher, config):
                    action.assert_not_called()

    def test_running_explicit_continue_attempts_all(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module, True) as (output, _, run, prepare, launcher, config):
                self.assertTrue(module.setup({'continue_on_error': True}))
                self.assertEqual(run.call_count, 4)
                self.assertTrue(prepare.call_args.kwargs['continue_on_error'])
                launcher.assert_called_once()
                config.assert_called_once()
                self.assertIn('[WARN]', output.getvalue())

    def test_each_failure_continues_and_is_not_success(self):
        for module in MODULES:
            for failing in ('npm', 'electron', 'launcher', 'config', 'scan'):
                with self.subTest(module=module.__name__, failing=failing), self.fixture(module) as (output, scan, run, prepare, launcher, config):
                    if failing == 'npm':
                        run.side_effect = subprocess.CalledProcessError(1, ['npm'])
                    elif failing == 'electron':
                        prepare.return_value = False
                    elif failing == 'launcher':
                        launcher.side_effect = OSError('locked')
                    elif failing == 'config':
                        config.side_effect = ValueError('invalid')
                    else:
                        scan.side_effect = OSError('unavailable')
                    self.assertFalse(module.setup({'continue_on_error': True}))
                    self.assertEqual(run.call_count, 4)
                    prepare.assert_called_once()
                    launcher.assert_called_once()
                    config.assert_called_once()
                    self.assertNotIn('で起動できます', output.getvalue())
                    self.assertIn('未完了の項目', output.getvalue())

    def test_copy_only_warning_is_not_ng(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module) as (output, _, run, prepare, launcher, config):
                def locked(*args, **kwargs):
                    kwargs['copy_warnings'].append('Electron コピー失敗')
                    return False
                prepare.side_effect = locked
                choices = {'continue_on_error': True}
                self.assertTrue(module.setup(choices))
                self.assertEqual(choices['_setup_warnings'], ['Electron コピー失敗'])
                self.assertEqual(run.call_count, 4)
                launcher.assert_called_once()
                config.assert_called_once()
                self.assertIn('警告あり／Electron配置未確認', output.getvalue())
                self.assertNotIn('で起動できます', output.getvalue())
                self.assertNotIn('[NG]', output.getvalue())

    def test_build_ng_is_not_hidden_by_copy_warning(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module) as (output, _, run, prepare, launcher, config):
                def command(args, **kwargs):
                    if 'build:panel' in args:
                        raise subprocess.CalledProcessError(1, args)
                def locked(*args, **kwargs):
                    kwargs['copy_warnings'].append('Electron コピー失敗')
                    return False
                run.side_effect = command
                prepare.side_effect = locked
                choices = {'continue_on_error': True}
                self.assertFalse(module.setup(choices))
                self.assertEqual(choices['_setup_warnings'], ['Electron コピー失敗'])
                self.assertIn('build:panel', output.getvalue())
                self.assertIn('[NG]', output.getvalue())
                self.assertEqual(run.call_count, 4)
                launcher.assert_called_once()
                config.assert_called_once()

    def test_default_dependency_failure_stops(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module) as (_, _, run, prepare, launcher, config):
                run.side_effect = subprocess.CalledProcessError(1, ['npm'])
                self.assertFalse(module.setup({'continue_on_error': False}))
                run.assert_called_once()
                for action in (prepare, launcher, config):
                    action.assert_not_called()

    def test_default_copy_failure_stops(self):
        for module in MODULES:
            with self.subTest(module=module.__name__), self.fixture(module) as (_, _, run, prepare, launcher, config):
                prepare.return_value = False
                self.assertFalse(module.setup())
                self.assertEqual(run.call_count, 4)
                launcher.assert_not_called()
                config.assert_not_called()


if __name__ == '__main__':
    unittest.main()
