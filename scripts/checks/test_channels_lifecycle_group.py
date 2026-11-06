# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Channels の一括選択・結果集計を、実導入・停止・削除なしで検証する。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, call, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
FOLDERS = ('frontend_channels/discord', 'frontend_channels/slack')


def load(relative):
    spec = importlib.util.spec_from_file_location('channels_group_' + relative.replace('/', '_'), ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ChannelsGroupTests(unittest.TestCase):
    def setUp(self):
        self.setup = load('_setup.py')
        self.cleanup = load('_cleanup.py')
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(subprocess, 'run', side_effect=AssertionError('real process forbidden')))
        self.enterContext(patch.object(subprocess, 'Popen', side_effect=AssertionError('real process forbidden')))

    def test_choices_ask_once_and_keep_yes_default_for_both_modes(self):
        for module, method in ((self.setup, 'collect_setup_choices'), (self.cleanup, 'collect_cleanup_choices')):
            for auto in (False, True):
                for answer in (False, True):
                    with self.subTest(method=method, auto=auto, answer=answer), tempfile.TemporaryDirectory() as temporary:
                        prompts = []

                        def ask(prompt, default='n'):
                            if 'Discord' in prompt or 'Slack' in prompt:
                                prompts.append((prompt, default))
                                return answer
                            return False

                        with patch.object(module, 'ask_start_mode', return_value=(True, auto)), \
                                patch.object(module, 'ask_yes_no', side_effect=ask):
                            choices = getattr(module, method)(*[Path(temporary)] if method == 'collect_cleanup_choices' else [])
                        self.assertEqual(choices['channels'], answer)
                        self.assertNotIn('discord', choices)
                        self.assertNotIn('slack', choices)
                        self.assertEqual(len(prompts), 1)
                        self.assertIn('Channels(Discord / Slack)', prompts[0][0])
                        self.assertEqual(prompts[0][1], 'y')

    def test_group_skip_does_not_import_either_component(self):
        for module, method in ((self.setup, 'setup_channels'), (self.cleanup, 'cleanup_channels')):
            with self.subTest(method=method), patch.object(module, '_load_folder_module') as loader:
                self.assertEqual(getattr(module, method)({'channels': False, 'discord': True, 'slack': True}), [])
                loader.assert_not_called()

    def test_setup_runs_each_once_with_same_choices_and_one_heading(self):
        components = {folder: Mock() for folder in FOLDERS}
        choices = {'channels': True, 'continue_on_error': True}
        for component in components.values():
            component.setup.return_value = True
        with patch.object(self.setup, '_load_folder_module', side_effect=components.get) as loader:
            self.assertEqual(self.setup.setup_channels(choices), [])
        self.assertEqual(loader.call_args_list, [call(folder) for folder in FOLDERS])
        for component in components.values():
            component.setup.assert_called_once_with(choices, report=False)
        self.assertEqual(self.output.getvalue().count('Channels(Discord / Slack) セットアップ\x1b'), 1)
        self.assertEqual(self.output.getvalue().count('Channels(Discord / Slack) セットアップ完了'), 1)

    def test_setup_keeps_fail_fast_and_best_effort_for_false_and_exception(self):
        for keep_going in (False, True):
            for raises in (False, True):
                with self.subTest(keep_going=keep_going, raises=raises):
                    components = {folder: Mock() for folder in FOLDERS}
                    components[FOLDERS[0]].setup.return_value = False
                    if raises:
                        components[FOLDERS[0]].setup.side_effect = OSError('fixture')
                    components[FOLDERS[1]].setup.return_value = False
                    with patch.object(self.setup, '_load_folder_module', side_effect=components.get):
                        errors = self.setup.setup_channels({'channels': True, 'continue_on_error': keep_going})
                    self.assertEqual(errors, ['Channels: Discord', 'Channels: Slack'] if keep_going else ['Channels: Discord'])
                    self.assertEqual(components[FOLDERS[1]].setup.call_count, int(keep_going))

    def test_setup_warning_is_preserved_without_unqualified_success(self):
        choices = {'channels': True, '_setup_warnings': ['unrelated warning']}
        component = Mock()

        def setup(given, *, report):
            self.assertIs(given, choices)
            self.assertFalse(report)
            given['_setup_warnings'].append('Electron fixture')
            return True

        component.setup.side_effect = setup
        with patch.object(self.setup, '_load_folder_module', return_value=component):
            self.assertEqual(self.setup.setup_channels(choices), [])
        self.assertEqual(choices['_setup_warnings'], ['unrelated warning', 'Electron fixture', 'Electron fixture'])
        self.assertIn('警告付き', self.output.getvalue())
        self.assertNotIn('セットアップ完了', self.output.getvalue())

    def test_cleanup_attempts_both_and_preserves_each_failure_and_cache_result(self):
        for discord_ok, slack_ok, cache_ok in ((True, True, True), (False, True, True),
                                              (True, False, True), (False, False, True), (True, True, False)):
            with self.subTest(discord_ok=discord_ok, slack_ok=slack_ok, cache_ok=cache_ok):
                components = {folder: Mock() for folder in FOLDERS}
                components[FOLDERS[0]].cleanup.return_value = discord_ok
                components[FOLDERS[1]].cleanup.return_value = slack_ok
                choices = {'channels': True}
                with patch.object(self.cleanup, '_load_folder_module', side_effect=components.get), \
                        patch.object(self.cleanup, '_remove_folder_import_cache', return_value=cache_ok) as cache:
                    errors = self.cleanup.cleanup_channels(choices)
                expected = [f'Channels: {label}' for label, ok in (('Discord', discord_ok), ('Slack', slack_ok)) if not ok or not cache_ok]
                self.assertEqual(errors, expected)
                for component in components.values():
                    component.cleanup.assert_called_once_with(choices, report=False)
                self.assertEqual(cache.call_args_list, [call(folder) for folder in FOLDERS])

    def test_cleanup_exception_still_attempts_other_component(self):
        with patch.object(self.cleanup, '_run_folder_cleanup', side_effect=[OSError('fixture'), True]) as run:
            self.assertEqual(self.cleanup.cleanup_channels({'channels': True}), ['Channels: Discord'])
        self.assertEqual([item.args[0] for item in run.call_args_list], list(FOLDERS))

    def test_service_names_remain_separate_for_monitor_stop_request(self):
        targets = [target for target in self.cleanup.SERVICE_CLEANUP_TARGETS if target[1] in FOLDERS]
        self.assertEqual([target[0] for target in targets], ['channels', 'channels'])
        self.assertEqual([target[3] for target in targets], [('フロントエンド(Discord)',), ('フロントエンド(Slack)',)])
        with tempfile.TemporaryDirectory() as temporary:
            request = Path(temporary) / 'stop.json'
            with patch.object(self.cleanup, 'CLEANUP_STOP_REQUEST_PATH', request):
                with self.cleanup.cleanup_stop_request({'channels': False}):
                    services = json.loads(request.read_text(encoding='utf-8'))['services']
                    self.assertEqual(services.count('フロントエンド(Discord)'), 1)
                    self.assertEqual(services.count('フロントエンド(Slack)'), 1)
            self.assertFalse(request.exists())

    def test_components_skip_without_state_checks_when_channels_is_false(self):
        for folder, label in zip(FOLDERS, ('discord', 'slack')):
            for operation in ('setup', 'cleanup'):
                with self.subTest(folder=folder, operation=operation):
                    module = load(f'{folder}/_{operation}.py')
                    checker = f'_{label}_in_use' if operation == 'setup' else f'stop_{label}_processes'
                    with patch.object(module, checker, side_effect=AssertionError('must not inspect or stop')):
                        self.assertTrue(getattr(module, operation)({'channels': False, label: True}, report=False))

    def test_grouped_cleanup_uses_authoritative_channels_choice_and_one_summary(self):
        modules = {folder: load(f'{folder}/_cleanup.py') for folder in FOLDERS}
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            for folder, label in zip(FOLDERS, ('discord', 'slack')):
                module = modules[folder]
                stack.enter_context(patch.object(module, 'THIS_DIR', Path(temporary) / label))
                stop = stack.enter_context(patch.object(module, f'stop_{label}_processes', return_value=True))
                stack.enter_context(patch.object(module, 'remove_launcher', return_value=True))
                stack.enter_context(patch.object(module, 'remove_directory', return_value=True))
                modules[folder].test_stop = stop
            stack.enter_context(patch.object(self.cleanup, '_load_folder_module', side_effect=modules.get))
            stack.enter_context(patch.object(self.cleanup, '_remove_folder_import_cache', return_value=True))
            self.assertEqual(self.cleanup.cleanup_channels({'channels': True, 'discord': False, 'slack': False}), [])
        for module in modules.values():
            module.test_stop.assert_called_once()
        self.assertNotIn('フロントエンド(Discord) のクリーンアップ', self.output.getvalue())
        self.assertNotIn('フロントエンド(Slack) のクリーンアップ', self.output.getvalue())
        self.assertEqual(self.output.getvalue().count('Channels(Discord / Slack) のクリーンアップ完了'), 1)

    def test_setup_components_suppress_headers_without_skipping_work(self):
        for folder, label in zip(FOLDERS, ('discord', 'slack')):
            with self.subTest(folder=folder), contextlib.ExitStack() as stack:
                module = load(f'{folder}/_setup.py')
                stack.enter_context(patch.object(module, f'_{label}_in_use', return_value=False))
                stack.enter_context(patch.object(module, 'check_project_node_runtime', return_value=(True, 'fixture')))
                stack.enter_context(patch.object(module.shutil, 'which', return_value='npm'))
                run = stack.enter_context(patch.object(module.subprocess, 'run'))
                stack.enter_context(patch.object(module, 'prepare_electron_binary', return_value=True))
                launcher = stack.enter_context(patch.object(module, 'install_launcher', return_value=True))
                config = stack.enter_context(patch.object(module, '_supplement_config', return_value=True))
                header = stack.enter_context(patch.object(module, 'print_header'))
                self.assertTrue(module.setup({'channels': True}, report=False))
                header.assert_not_called()
                self.assertEqual(run.call_count, 4)
                launcher.assert_called_once()
                config.assert_called_once()


if __name__ == '__main__':
    unittest.main()
