# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""全体startの停止順・保持対象。実プロセスを起動/終了しない。"""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import _setup_processes


def load():
    spec = importlib.util.spec_from_file_location('start_shutdown_flow', ROOT / '_start.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ShutdownFlowTests(unittest.TestCase):
    def test_initial_services_does_not_repeat_start_stop(self):
        module = load()
        with patch.object(module, 'stop_all_tasks') as stop, patch('builtins.print'):
            module.start_initial_services(False, False, False, False, False, False, {}, {}, None)
        stop.assert_not_called()

    def test_main_stops_once_before_validation_then_starts(self):
        module = load()
        order = []
        with patch.object(module, '_init_modules'), \
                patch.object(module, 'collect_startup_choices', return_value=(False,) * 14), \
                patch.object(module, 'stop_all_tasks', side_effect=lambda *a: order.append('stop') or True) as stop, \
                patch.object(module, 'validate_initial_environment', side_effect=lambda **kw: (order.append('validate') or True, None)), \
                patch.object(module, 'start_initial_services', side_effect=lambda **kw: order.append('start') or {}), \
                patch.object(module, 'monitor_and_restart'), \
                patch.object(module, 'stop_processes'), patch.object(module.time, 'sleep'), patch('builtins.print'):
            module.main()
        self.assertEqual(order, ['stop', 'validate', 'start'])
        stop.assert_called_once()

    def test_shutdown_result_controls_final_message(self):
        for verified in (True, False):
            with self.subTest(verified=verified):
                module = load()
                with patch.object(module, '_init_modules'), \
                        patch.object(module, 'collect_startup_choices', return_value=(False,) * 14), \
                        patch.object(module, 'stop_all_tasks', side_effect=[True, verified]), \
                        patch.object(module, 'validate_initial_environment', return_value=(True, None)), \
                        patch.object(module, 'start_initial_services', return_value={}), \
                        patch.object(module, 'monitor_and_restart', side_effect=KeyboardInterrupt), \
                        patch.object(module, 'stop_processes'), \
                        patch.object(module.sys, 'platform', 'linux'), \
                        patch.object(module.time, 'sleep'), \
                        patch.object(module, 'print_success') as success, \
                        patch.object(module, 'print_warning') as warning, \
                        patch.object(module, 'print_header') as header, patch('builtins.print'):
                    module.main()
                if verified:
                    self.assertTrue(any('この配置先の停止対象を確認しました' in c.args[0]
                                        for c in success.call_args_list))
                    header.assert_any_call('停止完了')
                    warning.assert_not_called()
                else:
                    success.assert_not_called()
                    header.assert_any_call('停止確認未完了')
                    self.assertTrue(any('確認できない対象' in c.args[0]
                                        for c in warning.call_args_list))
                    self.assertNotIn('停止完了', [c.args[0] for c in header.call_args_list])

    def test_unverified_exit_does_not_claim_all_stopped(self):
        module = load()
        with patch.object(module, '_init_modules'), \
                patch.object(module, 'collect_startup_choices', return_value=(False,) * 14), \
                patch.object(module, 'stop_all_tasks', return_value=True), \
                patch.object(module, 'validate_initial_environment', return_value=(True, None)), \
                patch.object(module, 'start_initial_services', return_value={}), \
                patch.object(module, 'monitor_and_restart'), \
                patch.object(module, 'stop_processes'), patch.object(module.time, 'sleep'), \
                patch.object(module, 'print_success') as success, \
                patch.object(module, 'print_info') as info, patch('builtins.print'):
            module.main()
        success.assert_not_called()
        self.assertTrue(any('全体の停止確認は実施していません' in c.args[0]
                            for c in info.call_args_list))

    def test_stop_failure_aborts_before_validation(self):
        module = load()
        with patch.object(module, '_init_modules'), \
                patch.object(module, 'collect_startup_choices', return_value=(False,) * 14), \
                patch.object(module, 'stop_all_tasks', return_value=False), \
                patch.object(module, 'validate_initial_environment') as validate, patch('builtins.print'):
            with self.assertRaises(SystemExit) as caught:
                module.main()
        self.assertEqual(caught.exception.code, 1)
        validate.assert_not_called()

    def test_cancel_does_not_stop(self):
        module = load()
        with patch.object(module, '_init_modules'), \
                patch.object(module, 'collect_startup_choices', side_effect=SystemExit(0)), \
                patch.object(module, 'stop_all_tasks') as stop:
            with self.assertRaises(SystemExit):
                module.main()
        stop.assert_not_called()

    def test_stop_all_uses_setup_policy(self):
        module = load()
        with patch.object(_setup_processes, 'stop_setup_processes', return_value=True) as stop, patch('builtins.print'):
            self.assertTrue(module.stop_all_tasks())
        self.assertEqual(stop.call_args.args[0], ROOT)

    def test_normal_stop_preserves_code_ide_and_discord(self):
        module = load()
        processes = {f'フロントエンド({name})': Mock(pid=10 + index)
                     for index, name in enumerate(('code', 'IDE', 'console', 'Discord', 'Slack'))}
        original = dict(processes)
        with patch.object(module.sys, 'platform', 'win32'), \
                patch.object(module.subprocess, 'run') as run, \
                patch.object(module, 'CONSOLE', Mock()) as console, \
                patch.object(module, 'DISCORD', Mock()) as discord, \
                patch.object(module, 'SLACK', Mock()) as slack:
            module.stop_processes(processes)
        stopped = {call.args[0][-1] for call in run.call_args_list}
        self.assertEqual(stopped, {str(original['フロントエンド(console)'].pid)})
        console.kill_ports.assert_called_once_with()
        discord.kill_ports.assert_not_called()
        slack.kill_ports.assert_not_called()
        original['フロントエンド(code)'].wait.assert_not_called()
        original['フロントエンド(IDE)'].wait.assert_not_called()
        original['フロントエンド(Discord)'].wait.assert_not_called()
        original['フロントエンド(Slack)'].wait.assert_not_called()
        self.assertFalse(processes)


if __name__ == '__main__':
    unittest.main()
