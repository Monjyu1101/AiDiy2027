# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""使い捨てフォルダで保存先変更・旧名との衝突防止を確認する。"""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackupLocalPathTests(unittest.TestCase):
    def test_cleanup_targets_only_new_storage_and_names_it(self):
        cleanup = load_module("cleanup_backup_paths", "_cleanup.py")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / "backup"
            new = root / ".aidiy_backup"
            old.mkdir(); new.mkdir()
            with patch.object(cleanup, "remove_directory") as remove, patch.object(cleanup, "print_header") as header:
                cleanup.cleanup_backup(root, {"backup": True})
                remove.assert_called_once_with(new, ".aidiy_backup")
                self.assertIn(".aidiy_backup", header.call_args.args[0])
            with patch.object(cleanup, "remove_directory") as remove, patch.object(cleanup, "print_info") as info:
                cleanup.cleanup_backup(root, {"backup": False})
                remove.assert_not_called()
                self.assertIn(".aidiy_backup", info.call_args.args[0])
            new.rmdir()
            with patch.object(cleanup, "remove_directory") as remove:
                cleanup.cleanup_backup(root, {"backup": True})
                remove.assert_not_called()
            self.assertTrue(old.is_dir())

    def test_retained_snapshots_are_not_touched_by_generic_cleanup(self):
        cleanup = load_module("cleanup_retained_backup_paths", "_cleanup.py")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for relative in (".aidiy_backup/20261023/120000.all/temp", ".aidiy_backup/test",
                             "nested/.aidiy_backup/.test", ".AIDIY_BACKUP/_temp",
                             ".backup_local/temp", "nested/.backup_local/test", ".BACKUP_LOCAL/.temp",
                             ".aidiy_cache/temp", "nested/.aidiy_cache/test",
                             "backup/temp", "source/test"):
                (root / relative).mkdir(parents=True)
            expected = [root / "backup/temp", root / "source/test"]
            self.assertEqual(cleanup.find_temp_directories(root), expected)
            with patch.object(cleanup, "remove_directory", return_value=True) as remove:
                cleanup.cleanup_backup(root, {"backup": False})
                self.assertTrue(cleanup.cleanup_temp_directories(root))
                self.assertEqual([call.args[0] for call in remove.call_args_list], expected)
            self.assertTrue((root / ".aidiy_backup/20261023/120000.all/temp").is_dir())

    def test_repo_ignore_rules_keep_ordinary_backup_visible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "--template=", str(root)], check=True, capture_output=True)
            (root / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
            for relative in (".aidiy_backup/source.py", "nested/.aidiy_backup/source.py",
                             ".backup_local/source.py", "nested/.backup_local/source.py",
                             ".aidiy_cache/electron/a.zip", "nested/.aidiy_cache/electron/a.zip"):
                result = subprocess.run(["git", "-C", str(root), "check-ignore", relative], capture_output=True)
                self.assertEqual(result.returncode, 0, relative)
            for relative in ("backup/source.py", "nested/backup/source.py"):
                result = subprocess.run(["git", "-C", str(root), "check-ignore", relative], capture_output=True)
                self.assertEqual(result.returncode, 1, relative)
        docker_rules = (ROOT / "docker/.dockerignore").read_text().splitlines()
        self.assertIn(".aidiy_backup/", docker_rules)
        self.assertIn(".aidiy_cache/", docker_rules)
        self.assertIn(".backup_local/", docker_rules)
        self.assertNotIn("backup/", docker_rules)

    def test_bom_scans_skip_saved_versions_but_not_ordinary_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for directory in (".aidiy_backup", ".backup_local", ".aidiy_cache", "backup"):
                (root / directory).mkdir()
                (root / directory / "source.py").write_text("fixture", encoding="utf-8")
            bom = load_module("remove_bom_backup_paths", "scripts/remove_bom.py")
            anomaly = load_module("bom_anomaly_backup_paths", "scripts/bom_anomaly_list.py")
            self.assertEqual(list(bom.iter_files(root, {".py"})), [root / "backup/source.py"])
            self.assertEqual(list(anomaly.iter_files(root)), [root / "backup/source.py"])

    def test_hermes_broad_discovery_skips_new_storage(self):
        # Hermes の upstream 汎用 backup/backups 除外は変更しない。
        module = load_module("hermes_backup_search_policy", "command_hermes/core/search_policy.py")
        self.assertIn(".aidiy_backup", module.SEARCH_PRUNE_DIR_NAMES)


if __name__ == "__main__":
    unittest.main()
