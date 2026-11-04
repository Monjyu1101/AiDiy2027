# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy- の対象範囲と、除去失敗時のクリーンアップ停止を確認する。"""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vscode_cleanup', ROOT / '_cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)
from vscode_extensions import aidiy_extension_ids, uninstall_aidiy_extensions


class ExtensionRemovalTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_matches_extension_name_prefix_only_and_normalizes_versions(self):
        self.assertEqual(aidiy_extension_ids({
            'AiDiy.AiDiy-Code@0.1.0', 'aidiy.aidiy-code', 'other.aidiy-future',
            'aidiy-tools.other', 'other.my-aidiy-code', 'other.aidiycode', 'aidiy-code',
        }), ['aidiy.aidiy-code', 'other.aidiy-future'])

    def test_code_and_live_use_the_same_workspace_extension_host(self):
        for package in (ROOT / 'package.json', ROOT / 'aidiy_live/package.json'):
            with self.subTest(package=package):
                manifest = json.loads(package.read_text(encoding='utf-8'))
                self.assertEqual(manifest['extensionKind'], ['workspace'])

    def test_linux_remote_cli_removes_code_and_live_and_verifies_both(self):
        cli = '/vscode/server/bin/remote-cli/code'
        with patch.object(cleanup.sys, 'platform', 'linux'), patch.object(
            cleanup, 'find_vscode_cli', return_value=cli
        ), patch.object(cleanup, 'get_installed_extensions', side_effect=[
            {'aidiy.aidiy-code', 'aidiy.aidiy-live', 'other.tool'}, {'other.tool'},
        ]) as listing, patch.object(cleanup.subprocess, 'run') as command, patch.object(cleanup, 'print_info') as info:
            self.assertEqual(cleanup.uninstall_extension(), (True, 2))
        self.assertEqual([call.args[0] for call in command.call_args_list], [
            [cli, '--uninstall-extension', 'aidiy.aidiy-code'],
            [cli, '--uninstall-extension', 'aidiy.aidiy-live'],
        ])
        self.assertEqual([call.args for call in listing.call_args_list], [(cli,), (cli,)])
        self.assertTrue(any('接続元の旧 AiDiy Live' in call.args[0] for call in info.call_args_list))

    def test_live_remaining_on_linux_is_reported_as_a_failure(self):
        with patch.object(cleanup.sys, 'platform', 'linux'), patch.object(
            cleanup, 'find_vscode_cli', return_value='/vscode/server/bin/remote-cli/code'
        ), patch.object(cleanup, 'get_installed_extensions', side_effect=[
            {'aidiy.aidiy-code', 'aidiy.aidiy-live'}, {'aidiy.aidiy-live'},
        ]), patch.object(cleanup.subprocess, 'run'):
            self.assertEqual(cleanup.uninstall_extension(), (False, 0))

    def test_individual_extension_removal_keeps_other_apps_and_legacy(self):
        installed = {'aidiy.aidiy-code', 'aidiy.aidiy-live', 'other.aidiy-previous', 'other.tool'}
        for module in ('code', 'live'):
            target = f'aidiy.aidiy-{module}'
            with self.subTest(module=module), patch.object(cleanup, 'find_vscode_cli', return_value='code'), patch.object(
                cleanup, 'get_installed_extensions', side_effect=[installed, installed - {target}]
            ), patch.object(cleanup.subprocess, 'run') as command:
                self.assertEqual(cleanup.uninstall_extension(module), (True, 1))
                command.assert_called_once_with(['code', '--uninstall-extension', target], check=True, text=True, timeout=60)

    def test_individual_extension_failure_is_not_hidden_by_other_apps(self):
        installed = {'aidiy.aidiy-code', 'aidiy.aidiy-live'}
        with patch.object(cleanup, 'find_vscode_cli', return_value='code'), patch.object(
            cleanup, 'get_installed_extensions', return_value=installed
        ), patch.object(cleanup.subprocess, 'run'):
            self.assertEqual(cleanup.uninstall_extension('code'), (False, 0))

    def test_failed_list_does_not_attempt_removal(self):
        uninstall = Mock()
        self.assertEqual(uninstall_aidiy_extensions(lambda: None, uninstall, Mock(), Mock()), (False, 0))
        uninstall.assert_not_called()

    def test_unrelated_extensions_are_left_alone(self):
        uninstall = Mock()
        self.assertEqual(uninstall_aidiy_extensions(lambda: {'other.tool'}, uninstall, Mock(), Mock()), (True, 0))
        uninstall.assert_not_called()

    def test_failed_after_list_does_not_report_success(self):
        listing = Mock(side_effect=[{'aidiy.aidiy-live'}, None])
        self.assertEqual(uninstall_aidiy_extensions(listing, lambda _: True, Mock(), Mock()), (False, 0))

    def test_cleanup_removes_all_matching_ids_without_package_metadata(self):
        with patch.object(cleanup, 'FRONTEND_VSCODE_DIR', Path('missing-project')), patch.object(
            cleanup, 'find_vscode_cli', return_value='code'
        ), patch.object(cleanup, 'get_installed_extensions', side_effect=[
            {'aidiy.aidiy-code', 'aidiy.aidiy-live', 'other.aidiy-previous', 'other.tool'}, {'other.tool'},
        ]), patch.object(cleanup.subprocess, 'run') as command:
            self.assertEqual(cleanup.uninstall_extension(), (True, 3))
        self.assertEqual([call.args[0][2] for call in command.call_args_list], [
            'aidiy.aidiy-code', 'aidiy.aidiy-live', 'other.aidiy-previous',
        ])

    def test_failed_removal_preserves_launchers_and_generated_files(self):
        with patch.object(cleanup, 'uninstall_extension', return_value=(False, 0)), patch.object(
            cleanup, 'remove_directory'
        ) as directory, patch.object(cleanup, 'remove_file') as file:
            self.assertFalse(cleanup.cleanup())
        directory.assert_not_called()
        file.assert_not_called()


if __name__ == '__main__':
    unittest.main()
