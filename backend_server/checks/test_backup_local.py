# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""一時プロジェクトだけで .aidiy_backup の保存・参照・除外を検証する。"""

import importlib.util
import logging
import os
from pathlib import Path
import sys
import subprocess
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load_module("backup_local_tools_under_test", ROOT / "backend_tools/tools_proc/backup.py")
folder_status = load_module("backup_local_folders_under_test", ROOT / "backend_server/core_router/フォルダ状態.py")


class BackupLocalTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="aidiy-backup-local-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.saver = backup.BackupSave(str(self.root))
        # アプリのログ初期化とローカル Git 記録は実行せず、保存・走査・コピーは実装を使う。
        logging_stub = ModuleType("log_config")
        logging_stub.get_logger = logging.getLogger
        with patch.dict(sys.modules, {"log_config": logging_stub}):
            self.native = self.saver._get_native()
        git_record = patch.object(self.native, "_ローカルGit記録")
        git_record.start()
        self.addCleanup(git_record.stop)
        self.checker = backup.BackupCheck(str(self.root))

    def write(self, relative, content="fixture\n", mtime=1_800_000_000):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="")
        os.utime(path, (mtime, mtime))
        return path

    def test_internal_credentials_never_enter_snapshots(self):
        for relative in ('internal_auth.json', 'nested/internal_auth.json',
                         '_AIDIY/backend_core/internal_auth.json',
                         '_AIDIY/backend_core/.internal_auth.json.fixture.tmp',
                         '_AIDIY/backend_core/internal_auth_keys.json',
                         '_AIDIY/backend_taskteam/internal_auth_keys.json',
                         '_AIDIY/backend_core/.internal_auth_keys.json.fixture.tmp',
                         '_AIDIY/backend_core/.internal_auth_keys.lock'):
            self.write(relative, 'fake-only-not-a-token')
        for relative in ('main.txt', 'nested/internal_auth.example.json', '_AIDIY/backend_core/README.md'):
            self.write(relative)
        result = self.saver.run()
        self.assertTrue(result['ok'])
        target = Path(result['バックアップ先'])
        actual = sorted(p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file())
        self.assertEqual(actual, ['_AIDIY/backend_core/README.md', 'main.txt', 'nested/internal_auth.example.json'])

    def test_aidiy_runtime_directories_match_git_in_scan_and_saved_snapshot(self):
        apps = ('avatar', 'browser', 'code', 'console', 'diag', 'discord', 'hermes',
                'ide', 'live', 'navi', 'slack', 'task', 'team')
        names = [f'aidiy_{app}' for app in apps] + ['aidiy_custom', 'aidiy_ide_extra', 'aidiy_', 'aidiy_新機能', 'aidiy_with space']
        excluded = {f'{prefix}_AIDIY/{name}/record.md' for name in names for prefix in ('', 'nested/')}
        excluded |= {'_AIDIY/aidiy_custom/electron/profile.json', '_AIDIY/aidiy_custom/browser-profile/profile.json'}
        included = {'_AIDIY/knowledge/guide.md', '_AIDIY/histories/entry.md', '_AIDIY/custom/note.md',
                    '_AIDIY/aidiy-custom/note.md', '_AIDIY/AIDIY_custom/note.md', '_aidiy/aidiy_custom/note.md',
                    '_AIDIY/knowledge/aidiy_custom/note.md', '_AIDIY/subdir/aidiy_custom/note.md',
                    '_AIDIY/aidiy_note.md', 'nested/_AIDIY/aidiy_note.md', 'frontend_ide/aidiy_custom/source.py'}
        for relative in included | excluded:
            self.write(relative)
        self.write('.gitignore', (ROOT / '.gitignore').read_text(encoding='utf-8'))
        def git(*args):
            return subprocess.run(['git', '-C', str(self.root), *args], capture_output=True)
        self.assertEqual(git('init', '--template=').returncode, 0)
        self.assertEqual(git('config', 'core.ignorecase', 'false').returncode, 0)
        for relative in included | excluded:
            self.assertEqual(git('check-ignore', '--no-index', '-q', '--', relative).returncode,
                             0 if relative in excluded else 1, relative)
        expected = included | {'.gitignore'}
        native = self.native._全ファイルスキャン(str(self.root))
        status = folder_status.状態走査(self.root)
        self.assertEqual({item['パス'] for item in native}, expected)
        self.assertEqual({item['パス'] for item in status['ファイル一覧']}, expected)
        self.assertFalse(status['不完全'])
        result = self.saver.run()
        self.assertTrue(result['ok'])
        target = Path(result['バックアップ先'])
        self.assertEqual({p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}, expected)
        for folder in ('_AIDIY/aidiy_custom', 'nested/_AIDIY/aidiy_', '_AIDIY/aidiy_ide_extra'):
            with self.assertRaises(ValueError):
                folder_status.状態走査(self.root, folder)
            self.assertFalse(folder_status.状態走査(self.root, folder, フィルター='')['不完全'])
        # 新しい未知アプリの記録だけが変わっても、差分へ混入しない。
        self.write('_AIDIY/aidiy_future/histories/new.md', mtime=1_800_000_020)
        self.assertEqual(self.saver.diff_scan()['count'], 0)
        self.write('_AIDIY/knowledge/guide.md', '更新したHowTo', mtime=1_800_000_020)
        self.assertEqual(self.saver.diff_scan()['差分ファイル'], ['_AIDIY/knowledge/guide.md'])

    def test_first_save_uses_new_store_and_keeps_ordinary_backup_sources(self):
        self.write("main.txt", "first\n")
        legacy = self.write(".backup_local/20990101/000000.all/main.txt", "legacy\n")
        self.write(".aidiy_cache/electron/fixture.zip", "cache\n")
        self.write("backup/ordinary.txt")
        self.write("src/backup/nested.txt")
        # 旧名の日時フォルダを保存履歴として使わない。ここでは合成した通常ソースとして扱う。
        old_file = self.write("backup/20990101/000000.all/main.txt", "ordinary old-name fixture\n")

        result = self.saver.run()

        self.assertTrue(result["ok"])
        self.assertTrue(result["全件フラグ"])
        target = Path(result["バックアップ先"])
        self.assertTrue(target.is_relative_to(self.root / ".aidiy_backup"))
        self.assertTrue(target.name.endswith(".all"))
        self.assertEqual(result["全件数"], 4)
        self.assertEqual((target / "main.txt").read_text(encoding="utf-8"), "first\n")
        self.assertTrue((target / "backup/ordinary.txt").is_file())
        self.assertTrue((target / "src/backup/nested.txt").is_file())
        self.assertEqual(old_file.read_text(encoding="utf-8"), "ordinary old-name fixture\n")
        self.assertFalse((self.root / ".git_local").exists())
        self.assertEqual(legacy.read_text(), "legacy\n")
        self.assertFalse((target / ".backup_local").exists())
        self.assertFalse((target / ".aidiy_cache").exists())

    def test_second_save_and_mcp_queries_share_new_store(self):
        self.write("main.txt", "first\n")
        first = self.saver.run()
        self.assertTrue(first["ok"])
        self.assertEqual(self.saver.diff_scan()["count"], 0)
        self.assertTrue(self.saver.run()["差分なし"])

        self.write("main.txt", "second\n", mtime=1_800_000_010)
        scan = self.saver.diff_scan()
        self.assertEqual(scan["差分ファイル"], ["main.txt"])
        before = self.checker.get_before_after("main.txt")
        self.assertEqual(before["before"]["content"], "first\n")
        self.assertEqual(before["before"]["source"], "backup")
        self.assertEqual(before["after"]["content"], "second\n")

        second = self.saver.run()
        self.assertTrue(second["ok"])
        self.assertFalse(second["全件フラグ"])
        self.assertEqual(second["バックアップ件数"], 1)
        self.assertTrue(Path(second["バックアップ先"]).is_relative_to(self.root / ".aidiy_backup"))
        self.assertFalse(Path(second["バックアップ先"]).name.endswith(".all"))
        self.assertEqual(self.saver.diff_scan()["count"], 0)
        self.assertEqual(self.checker.list_versions("main.txt")["count"], 2)
        changed = self.checker.find_changed("20000101_000000")
        self.assertEqual([item["path"] for item in changed["items"]], ["main.txt"])

    def test_old_store_is_not_a_reader_or_diff_fallback(self):
        self.write("main.txt", "current\n")
        self.write("backup/20990101/000000.all/main.txt", "not history\n")
        self.write(".backup_local/20990101/000000.all/main.txt", "legacy history\n")
        info = self.checker.backup_root_path()
        self.assertEqual(info["backup_root"], (self.root / ".aidiy_backup").as_posix())
        self.assertFalse(info["exists"])
        self.assertIsNone(self.checker.get_before_after("main.txt")["before"])
        self.assertEqual(self.checker.list_versions("main.txt")["count"], 0)
        self.assertEqual(self.checker.find_changed("20000101_000000")["count"], 0)
        self.assertEqual(self.saver.diff_scan()["最終バックアップ日時"], "")
        self.assertFalse((self.root / ".aidiy_backup").exists())

    def test_project_named_backup_is_not_excluded(self):
        self.write("backup/project/main.txt")
        project = self.root / "backup/project"
        saver = backup.BackupSave(str(project))
        saver._native = self.native
        result = saver.run()
        self.assertTrue(result["ok"])
        self.assertEqual(result["バックアップ件数"], 1)
        self.assertTrue(Path(result["バックアップ先"]).is_relative_to(project / ".aidiy_backup"))

    def test_scanners_exclude_new_store_but_not_ordinary_backup(self):
        expected = {"main.txt", "backup/ordinary.txt", "src/backup/nested.txt"}
        for name in expected:
            self.write(name)
        self.write(".aidiy_backup/20990101/000000.all/private.txt")
        self.write("src/.aidiy_backup/private.txt")
        for directory in (".backup_local", ".aidiy_cache", "nested/.backup_local", "nested/.aidiy_cache"):
            self.write(f"{directory}/private.txt")
        native = self.native._全ファイルスキャン(str(self.root))
        status = folder_status.状態走査(self.root)
        self.assertEqual({entry["パス"] for entry in native}, expected)
        self.assertEqual({entry["パス"] for entry in status["ファイル一覧"]}, expected)
        self.assertFalse(status["不完全"])
        self.assertIn(".aidiy_backup", folder_status.規則["backupDirectories"])
        self.assertNotIn("backup", folder_status.規則["backupDirectories"])
        with self.assertRaises(ValueError):
            folder_status.状態走査(self.root, ".aidiy_backup")

    def test_exclusion_is_relative_to_selected_project(self):
        for ancestor in ("temp", "log", "_AIDIY/aidiy_code", "_AIDIY/aidiy_custom"):
            with self.subTest(ancestor=ancestor):
                project = self.root / ancestor / "project"
                self.write(f"{ancestor}/project/main.txt")
                self.write(f"{ancestor}/project/temp/ignored.txt")
                self.write(f"{ancestor}/project/_AIDIY/aidiy_code/ignored.md")
                scanned = self.native._全ファイルスキャン(str(project))
                self.assertEqual({item["パス"] for item in scanned}, {"main.txt"})


if __name__ == "__main__":
    unittest.main()
