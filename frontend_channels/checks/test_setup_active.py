# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実行中の Discord を停止・変更しない setup の事前確認（実プロセス不使用）。"""
import contextlib
import importlib.util
import io
from pathlib import Path, PureWindowsPath
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('discord_setup_active_test', ROOT / 'frontend_channels' / '_setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ActiveDiscordSetupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(setup, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(setup, '_runtime_in_use', return_value=False))
        self.snapshot = self.enterContext(patch.object(setup, 'snapshot', return_value=[]))
        self.run = self.enterContext(patch.object(setup.subprocess, 'run'))
        self.npm = self.enterContext(patch.object(setup.shutil, 'which'))
        self.prepare = self.enterContext(patch.object(setup, 'prepare_electron_binary'))
        self.launcher = self.enterContext(patch.object(setup, 'install_launcher'))

    def record(self, command, name='node', **kwargs):
        return dict(ProcessId=12345, ParentProcessId=1, Name=name, CommandLine=command, **kwargs)

    def assert_blocked_without_changes(self):
        self.assertFalse(setup.setup())
        self.run.assert_not_called()
        self.npm.assert_not_called()
        self.prepare.assert_not_called()
        self.launcher.assert_not_called()
        self.assertNotIn('[OK]', self.output.getvalue())

    def test_running_entries_block_before_npm(self):
        for entry in ('src/main.ts', 'src/panel-worker.ts', 'src/web-server.ts', 'panel/desktop.cjs', 'panel/launch.mjs'):
            with self.subTest(entry=entry):
                self.snapshot.return_value = [self.record(f'node "{setup.THIS_DIR / entry}"')]
                self.assert_blocked_without_changes()

    def test_headless_tsx_relative_main_blocks(self):
        loader = setup.THIS_DIR / 'node_modules/tsx/dist/loader.mjs'
        self.snapshot.return_value = [self.record(f'node --import "{loader}" src/main.ts')]
        self.assert_blocked_without_changes()

    def test_relative_entry_with_known_cwd_blocks(self):
        self.snapshot.return_value = [self.record('node panel/launch.mjs', WorkingDirectory=str(setup.THIS_DIR))]
        self.assert_blocked_without_changes()

    def test_component_electron_binary_blocks_even_without_entry(self):
        binary = setup.THIS_DIR / 'node_modules/electron/dist/electron'
        self.snapshot.return_value = [self.record(f'"{binary}" --type=renderer', name='electron')]
        self.assert_blocked_without_changes()

    def test_windows_headless_bot_blocks_only_own_copy(self):
        with patch.object(setup.sys, 'platform', 'win32'), patch.object(
                setup, 'THIS_DIR', PureWindowsPath('C:/AiDiy/frontend_channels')):
            self.snapshot.return_value = [self.record(
                'node.exe "C:\\AiDiy\\frontend_channels\\src\\main.ts"', name='node.exe')]
            self.assert_blocked_without_changes()
            self.snapshot.return_value = [self.record(
                'node.exe "C:\\other\\frontend_channels\\src\\main.ts"', name='node.exe')]
            self.assertFalse(setup._discord_in_use())

    def test_windows_electron_fallback_blocks(self):
        with patch.object(setup, '_runtime_in_use', return_value=True):
            self.assert_blocked_without_changes()
        self.snapshot.assert_not_called()

    def test_scan_failure_and_unknown_command_fail_closed(self):
        for failure in (OSError('unavailable'), ValueError('invalid'), subprocess.TimeoutExpired('ps', 15)):
            with self.subTest(failure=type(failure).__name__):
                self.snapshot.side_effect = failure
                self.assert_blocked_without_changes()
        self.snapshot.side_effect = None
        for command in ('', 'node "unterminated'):
            with self.subTest(command=command):
                self.snapshot.return_value = [self.record(command)]
                self.assert_blocked_without_changes()

    def test_other_copy_and_argument_mentions_do_not_block(self):
        other = setup.THIS_DIR.parent.parent / 'other-copy' / 'frontend_channels'
        self.snapshot.return_value = [
            self.record(f'node "{other / "src/main.ts"}"'),
            self.record(f'node /tmp/unrelated.js "{setup.THIS_DIR / "src/main.ts"}"'),
        ]
        self.assertFalse(setup._discord_in_use())
        self.run.assert_not_called()

    def test_standalone_setup_does_not_block_itself(self):
        current = self.record(f'python "{setup.THIS_DIR / "_setup.py"}"', name='python')
        current['ProcessId'] = setup.os.getpid()
        self.snapshot.return_value = [current]
        self.assertFalse(setup._discord_in_use())
        self.snapshot.return_value.append(self.record(f'node "{setup.THIS_DIR / "src/main.ts"}"'))
        self.assert_blocked_without_changes()

    def test_idle_scan_allows_setup_to_continue(self):
        self.assertFalse(setup._discord_in_use())
        self.snapshot.assert_called_once()


if __name__ == '__main__':
    unittest.main()
