# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""共有フォルダ規則を一時ファイルだけで検証。内容取得・サービス起動なし。"""
import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'core_router/フォルダ状態.py'
spec = importlib.util.spec_from_file_location('folder_baseline_under_test', SOURCE)
folders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(folders)


class FolderBaselineTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='aidiy-folder-baseline-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for method in ('connect', 'bind', 'listen'):
            guard = patch.object(socket.socket, method, side_effect=AssertionError('No live socket allowed'))
            guard.start()
            self.addCleanup(guard.stop)

    def write(self, path, text='ordinary fixture'):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
        return target

    def test_both_modes_always_ignore_exact_directory_names_case_insensitively(self):
        for name in folders.規則['ignored']:
            self.write(f'{name}/hidden.txt')
            self.write(f'src/{name.upper()}/hidden.txt')
        self.write('main.txt')
        self.write('docs/node_modules.md')
        self.write('_AIDIY/knowledge/guide.md')
        for mode in ('', 'backup'):
            result = folders.状態走査(self.root, フィルター=mode)
            self.assertEqual([f['パス'] for f in result['ファイル一覧']],
                             ['_AIDIY/knowledge/guide.md', 'docs/node_modules.md', 'main.txt'])
            for name in folders.規則['ignored']:
                for path in (name, f'src/{name.upper()}'):
                    with self.assertRaises(ValueError):
                        folders.対象解決(self.root, path, mode)

    def test_off_is_less_strict_than_backup_but_not_show_all(self):
        visible = ['main.txt', '.git-notes/a.txt', 'package.json', 'temp/draft.txt']
        for path in visible:
            self.write(path)
        self.write('.git_local/hidden.txt')
        self.assertEqual(folders.状態走査(self.root, フィルター='')['ファイル数'], 4)
        self.assertEqual(folders.状態走査(self.root, フィルター='backup')['ファイル数'], 1)
        for mode in ('', 'backup'):
            # 通常ファイル名をディレクトリ名や部分一致と取り違えない。
            self.assertTrue(folders.ファイル許可('node_modules.md', mode))
            self.assertTrue(folders.ファイル許可('venv', mode))

    def test_credentials_never_listed_in_either_mode(self):
        for path in ('internal_auth.json', '_AIDIY/backend_core/INTERNAL_AUTH.JSON',
                     '_AIDIY/backend_core/.internal_auth.json.fixture.tmp',
                     '_AIDIY/backend_taskteam/internal_auth_keys.json',
                     '_AIDIY/backend_core/INTERNAL_AUTH_KEYS.JSON',
                     '_AIDIY/backend_taskteam/.internal_auth_keys.json.fixture.tmp'):
            self.write(path, 'synthetic-not-a-token')
        self.write('docs/internal_auth.md')
        for mode in ('', 'backup'):
            self.assertEqual(folders.状態走査(self.root, フィルター=mode)['ファイル数'], 1)
            for name in ('internal_auth.json. ', 'internal_auth.json::$DATA', '.INTERNAL_AUTH.JSON.fixture.TMP',
                         'INTERNAL_AUTH_KEYS.JSON. ', 'internal_auth_keys.json::$DATA',
                         '.internal_auth_keys.json.fixture.tmp'):
                self.assertFalse(folders.ファイル許可(name, mode))

    def test_alias_directories_and_files_are_not_traversed(self):
        hidden = self.write('node_modules/hidden.txt')
        (self.root / 'alias.txt').symlink_to(hidden)
        (self.root / 'alias-dir').symlink_to(hidden.parent, target_is_directory=True)
        for mode in ('', 'backup'):
            self.assertEqual(folders.状態走査(self.root, フィルター=mode)['ファイル数'], 0)
            with self.assertRaises(ValueError):
                folders.対象解決(self.root, 'alias-dir', mode)


if __name__ == '__main__':
    unittest.main()
