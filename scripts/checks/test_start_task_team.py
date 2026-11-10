# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Task/Team の start opt-in。実サービス・プロセスは操作しない。"""
import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load():
    spec = importlib.util.spec_from_file_location('start_task_team_test', ROOT / '_start.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TaskTeamStartTests(unittest.TestCase):
    def test_prompt_order_defaults_and_individual_opt_in(self):
        for task, team in ((False, False), (True, False), (False, True), (True, True)):
            module = load()
            with self.subTest(task=task, team=team), redirect_stdout(io.StringIO()):
                def answer(label, default_yes):
                    if 'aidiy_task' in label:
                        self.assertFalse(default_yes)
                        return task
                    if 'aidiy_team' in label:
                        self.assertFalse(default_yes)
                        return team
                    return False
                with patch.object(module, 'prompt_choice', side_effect=answer) as prompt:
                    choices = module.collect_startup_choices()
                labels = [call.args[0] for call in prompt.call_args_list]
                i = next(i for i, label in enumerate(labels) if 'Avatar' in label)
                self.assertEqual([label.strip().split(':')[0].strip() for label in labels[i + 1:i + 8]],
                                 ['IDE', 'Console', 'Code', 'Live', 'aidiy_task', 'aidiy_team', 'CPU'])
                self.assertEqual(choices[-2:], (task, team))

    def test_enter_and_n_do_not_enable_optional_windows(self):
        module = load()
        for response, expected in (('', False), ('n', False), ('y', True), ('Y', True)):
            with patch.object(module.sys, 'platform', 'linux'), patch('builtins.input', return_value=response), redirect_stdout(io.StringIO()):
                self.assertEqual(module.prompt_choice('aidiy_task', default_yes=False), expected)

    def test_modules_are_loaded_from_their_own_launch_entries(self):
        module = load()
        with patch.object(module, '_load_folder_module', side_effect=lambda path: path), patch.object(module, '_remove_folder_import_cache'):
            module._init_modules()
        self.assertEqual(module.TASK, 'frontend_ide/aidiy_task')
        self.assertEqual(module.TEAM, 'frontend_ide/aidiy_team')

    def test_start_service_routes_to_task_and_team(self):
        module = load()
        task, team = Mock(), Mock()
        processes = {}
        with patch.object(module, 'TASK', task), patch.object(module, 'TEAM', team), patch.object(module, 'cleanup_stop_requested_services', return_value=set()), patch.object(module, 'attach_output_thread'):
            for kind, launcher in (('task', task), ('team', team)):
                self.assertTrue(module.start_service(f'フロントエンド({kind})', processes, {}, None))
                launcher.start.assert_called_once_with()
                self.assertIs(processes[f'フロントエンド({kind})'], launcher.start.return_value)

    def test_start_order_and_no_automatic_reopen(self):
        module = load()
        for task, team in ((False, False), (True, False), (False, True), (True, True)):
            with self.subTest(task=task, team=team), patch.object(module, 'start_service', return_value=True) as start, patch.object(module, 'wait_for_services_quiet'), patch.object(module, 'ensure_optional_service_ready', return_value=True), redirect_stdout(io.StringIO()):
                flags = module.start_initial_services(False, False, False, True, True, False, {}, {}, 'npm', task_enabled=task, team_enabled=team, console_enabled=True)
            expected = ['バックエンド(task,team)', 'フロントエンド(Avatar)', 'フロントエンド(console)']
            expected += [f'フロントエンド({kind})' for kind, enabled in (('task', task), ('team', team)) if enabled]
            self.assertEqual([call.args[0] for call in start.call_args_list], expected)
            self.assertFalse(flags['フロントエンド(task)'])
            self.assertFalse(flags['フロントエンド(team)'])

    def test_all_ide_windows_use_canonical_start_order(self):
        module = load()
        with patch.object(module, 'start_service', return_value=True) as start, patch.object(module, 'wait_for_services_quiet'), redirect_stdout(io.StringIO()):
            flags = module.start_initial_services(False, False, False, False, False, False, {}, {}, 'npm',
                dev_enabled=True, console_enabled=True, code_enabled=True, live_enabled=True,
                task_enabled=True, team_enabled=True, cpu_enabled=True)
        expected = [f'フロントエンド({kind})' for kind in ('IDE', 'console', 'code', 'live', 'task', 'team', 'cpu')]
        self.assertEqual([call.args[0] for call in start.call_args_list], expected)
        self.assertTrue(all(flags[name] is False for name in expected))

    def test_environment_checks_use_canonical_order(self):
        module = load()
        checked = []
        def checker(name):
            checked.append(name)
            return True, 'ready'
        modules = {name: Mock() for name in ('DEV', 'CONSOLE', 'VSCODE', 'TASK', 'TEAM', 'CPU')}
        for name, kind in (('DEV', 'IDE'), ('CONSOLE', 'console'), ('TASK', 'task'), ('TEAM', 'team'), ('CPU', 'cpu')):
            modules[name].check_environment.side_effect = lambda kind=kind: checker(kind)
        modules['VSCODE'].check_environment.side_effect = checker
        with patch.multiple(module, **modules), patch.object(module, 'get_npm_command', return_value='npm'), redirect_stdout(io.StringIO()):
            ok, _ = module.validate_initial_environment(False, False, False, False, False, False,
                dev_enabled=True, console_enabled=True, code_enabled=True, live_enabled=True,
                task_enabled=True, team_enabled=True, cpu_enabled=True)
        self.assertTrue(ok)
        self.assertEqual(checked, ['IDE', 'console', 'code', 'live', 'task', 'team', 'cpu'])

    def test_environment_checks_only_selected_windows(self):
        module = load()
        task, team = Mock(), Mock()
        task.check_environment.return_value = (True, 'ready')
        team.check_environment.return_value = (False, 'missing')
        with patch.object(module, 'TASK', task), patch.object(module, 'TEAM', team), patch.object(module, 'get_npm_command', return_value=None), redirect_stdout(io.StringIO()):
            self.assertTrue(module.validate_initial_environment(False, False, False, False, False, False, task_enabled=True)[0])
            team.check_environment.assert_not_called()
            self.assertFalse(module.validate_initial_environment(False, False, False, False, False, False, team_enabled=True)[0])

    def test_default_start_does_not_launch_task_team(self):
        module = load()
        with patch.object(module, 'start_service') as start:
            module.start_initial_services(False, False, False, False, False, False, {}, {}, None)
        start.assert_not_called()

    def test_main_passes_choices_to_validation_and_start(self):
        module = load()
        values = (False,) * 12 + (True, False)
        with patch.object(module, '_init_modules'), patch.object(module, 'collect_startup_choices', return_value=values), patch.object(module, 'stop_all_tasks', return_value=True), patch.object(module, 'validate_initial_environment', return_value=(True, None)) as validate, patch.object(module, 'start_initial_services', return_value={}) as start, patch.object(module, 'monitor_and_restart'), patch.object(module, 'stop_processes'), patch.object(module.time, 'sleep'), redirect_stdout(io.StringIO()):
            module.main()
        for call in (validate.call_args, start.call_args):
            self.assertTrue(call.kwargs['task_enabled'])
            self.assertFalse(call.kwargs['team_enabled'])

    def test_stop_uses_scoped_task_team_cleanup_and_preserves_code(self):
        module = load()
        task, team = Mock(), Mock()
        processes = {f'フロントエンド({kind})': Mock(pid=123) for kind in ('task', 'team', 'code')}
        with patch.object(module, 'TASK', task), patch.object(module, 'TEAM', team), patch.object(module.sys, 'platform', 'win32'), patch.object(module.subprocess, 'run') as kill, redirect_stdout(io.StringIO()):
            module.stop_processes(processes)
        self.assertEqual(kill.call_count, 2)
        task.kill_ports.assert_called_once_with()
        team.kill_ports.assert_called_once_with()
        self.assertEqual(processes, {})


if __name__ == '__main__':
    unittest.main()
