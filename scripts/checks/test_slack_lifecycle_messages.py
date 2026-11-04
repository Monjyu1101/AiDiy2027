"""Slack通常表記を実入口で確認。導入・起動・削除前に必ず中断する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


class NoticeReached(Exception):
    pass


class SlackLifecycleMessagesTests(unittest.TestCase):
    def test_channel_labels_before_actions(self):
        cases = [
            ('_setup.py', 'main', 'print_info'),
            ('_start.py', 'collect_startup_choices', 'print_info'),
            ('_cleanup.py', 'main', 'print_info'),
            ('frontend_channels/_setup.py', 'setup', 'print_info'),
            ('frontend_channels/_start.py', 'main', 'print'),
            ('frontend_channels/_cleanup.py', 'cleanup', 'print_info'),
        ]
        for filename, function, printer in cases:
            with self.subTest(filename=filename):
                spec = importlib.util.spec_from_file_location('slack_notice_' + filename.replace('/', '_'), ROOT / filename)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                messages = []
                def capture(value, *args, **kwargs):
                    if isinstance(value, str) and 'Discord / Slack' in value:
                        messages.append(value)
                        raise NoticeReached()
                with patch.object(sys, 'argv', [str(ROOT / filename)]), patch.object(module, printer, side_effect=capture, create=True), patch('subprocess.Popen', side_effect=AssertionError('must not launch')), patch('subprocess.run', side_effect=AssertionError('must not run')), contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(NoticeReached):
                        getattr(module, function)()
                self.assertEqual(len(messages), 1)
                self.assertIn('外部チャンネル: Discord / Slack', messages[0])
                for unwanted in ('準備中', '未実装', '起動不可', '対象なし'):
                    self.assertNotIn(unwanted, messages[0])

    def test_slack_selection_uses_existing_module(self):
        # 選択肢は実在する独立モジュールの入口だけを呼ぶ。成功表示だけを先に作らない。
        slack = ROOT / 'frontend_channels' / 'slack'
        for name, functions in (('_setup.py', ('setup',)), ('_start.py', ('check_environment', 'start', 'kill_ports', 'process_tree_pids')),
                                ('_cleanup.py', ('cleanup',))):
            with self.subTest(module=name):
                source = (slack / name).read_text(encoding='utf-8')
                for function in functions:
                    self.assertIn(f'def {function}(', source)
        for filename in ('_setup.py', '_start.py', '_cleanup.py'):
            source = (ROOT / filename).read_text(encoding='utf-8')
            self.assertIn('frontend_channels/slack', source)
        self.assertTrue((slack / 'src' / 'main.ts').is_file())


if __name__ == '__main__':
    unittest.main()
