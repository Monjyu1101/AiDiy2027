# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""使い捨てフォルダだけを利用するローカル Git 初期化試験。"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.local_git_setup import ensure_local_git


@unittest.skipUnless(shutil.which("git"), "Git required")
class LocalGitSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "日本語 project with spaces"
        self.root.mkdir()
        # CI 自体が /tmp 等を Git 管理していても fixture の境界外は参照しない。
        original_lexists = os.path.lexists
        boundary = Path(self.temp.name)
        def fixture_lexists(path):
            candidate = Path(path)
            return original_lexists(path) if candidate.is_relative_to(boundary) else False
        self.addCleanup(patch.stopall)
        patch("scripts.local_git_setup.os.path.lexists", side_effect=fixture_lexists).start()
        original_run = subprocess.run
        def fixture_run(*args, **kwargs):
            kwargs["env"] = dict(kwargs.get("env", os.environ), GIT_CEILING_DIRECTORIES=str(boundary.parent))
            return original_run(*args, **kwargs)
        patch("scripts.local_git_setup.subprocess.run", side_effect=fixture_run).start()

    def git(self, *args, root=None):
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        target = root or self.root
        explicit = [] if args[0] == "init" else ["--git-dir=" + str(target / ".git_local"), "--work-tree=" + str(target)]
        return subprocess.run(["git", "-C", str(target), *explicit, *args],
                              capture_output=True, text=True, env=env, check=False)

    def test_create_empty_local_repo_no_remote(self):
        (self.root / "secret.txt").write_text("fixture only")
        self.assertEqual(ensure_local_git(self.root)[0], "created")
        self.assertFalse((self.root / ".git").exists())
        self.assertEqual(self.git("status", "--porcelain").stdout, "?? secret.txt\n")
        self.assertEqual(self.git("remote").stdout, "")
        self.assertEqual(self.git("ls-files").stdout, "")
        self.assertNotEqual(self.git("rev-parse", "--verify", "HEAD").returncode, 0)
        self.assertEqual(self.git("config", "--local", "--get", "user.name").returncode, 1)
        before = (self.root / ".git_local" / "config").read_bytes()
        self.assertEqual(ensure_local_git(self.root)[0], "skipped")
        self.assertEqual((self.root / ".git_local" / "config").read_bytes(), before)

    def test_gitignore_not_recorded_but_rules_apply(self):
        ignore = self.root / ".gitignore"
        ignore.write_text("private.txt\n")
        (self.root / "private.txt").write_text("fixture")
        (self.root / "source.txt").write_text("source")
        self.assertEqual(ensure_local_git(self.root)[0], "created")
        self.assertEqual(self.git("status", "--porcelain").stdout, "?? source.txt\n")
        self.assertEqual(ignore.read_text(), "private.txt\n")
        self.assertEqual(self.git("ls-files").stdout, "")

    def test_backup_storage_ignored_without_hiding_ordinary_backup(self):
        for directory in (".aidiy_backup", ".backup_local", ".aidiy_cache", "backup"):
            (self.root / directory).mkdir()
            (self.root / directory / "source.txt").write_text("fixture")
        self.assertEqual(ensure_local_git(self.root)[0], "created")
        self.assertEqual(self.git("check-ignore", ".aidiy_backup/source.txt").returncode, 0)
        self.assertEqual(self.git("check-ignore", "backup/source.txt").returncode, 1)
        self.assertEqual(self.git("status", "--porcelain").stdout, "?? backup/\n")

    def test_existing_git_directory_unchanged(self):
        self.git("init")
        before = (self.root / ".git" / "config").read_bytes()
        self.assertEqual(ensure_local_git(self.root)[0], "existing")
        self.assertFalse((self.root / ".git_local").exists())
        self.assertEqual((self.root / ".git" / "config").read_bytes(), before)

    def test_existing_git_pointer_even_invalid_is_preserved(self):
        pointer = self.root / ".git"
        pointer.write_text("gitdir: ../existing-worktree\n")
        self.assertEqual(ensure_local_git(self.root)[0], "existing")
        self.assertEqual(pointer.read_text(), "gitdir: ../existing-worktree\n")
        self.assertFalse((self.root / ".git_local").exists())

    def test_parent_repository_is_preserved(self):
        self.git("init", root=self.root.parent)
        self.assertEqual(ensure_local_git(self.root)[0], "existing")
        self.assertFalse((self.root / ".git").exists())

    def test_preexisting_partial_metadata_is_preserved(self):
        metadata = self.root / ".git_local"
        metadata.mkdir()
        (metadata / "keep").write_text("keep")
        self.assertEqual(ensure_local_git(self.root)[0], "skipped")
        self.assertFalse((self.root / ".git").exists())
        self.assertEqual((metadata / "keep").read_text(), "keep")

    def test_caller_git_environment_cannot_redirect_initialization(self):
        elsewhere = self.root.parent / "elsewhere"
        elsewhere.mkdir()
        with patch.dict(os.environ, {"GIT_DIR": str(elsewhere),
                                      "GIT_WORK_TREE": str(elsewhere),
                                      "GIT_INDEX_FILE": str(elsewhere / "index"),
                                      "GIT_CONFIG_COUNT": "1",
                                      "GIT_CONFIG_KEY_0": "core.bare",
                                      "GIT_CONFIG_VALUE_0": "true"}):
            self.assertEqual(ensure_local_git(self.root)[0], "existing")
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.assertFalse((self.root / ".git_local").exists())

    def test_folder_can_be_moved(self):
        self.assertEqual(ensure_local_git(self.root)[0], "created")
        moved = self.root.with_name("moved project")
        self.root.rename(moved)
        self.assertEqual(self.git("status", "--porcelain", root=moved).returncode, 0)
        result = subprocess.run(["git", "--git-dir=" + str(moved / ".git_local"), "status", "--porcelain"], capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertFalse((moved / ".git").exists())

    def test_git_absent_skips_without_writes(self):
        with patch("scripts.local_git_setup.shutil.which", return_value=None):
            self.assertEqual(ensure_local_git(self.root)[0], "skipped")
        self.assertEqual(list(self.root.iterdir()), [])

    def test_unknown_probe_error_does_not_init(self):
        failure = subprocess.CompletedProcess([], 128, "", "fatal: dubious ownership")
        with patch("scripts.local_git_setup.subprocess.run", return_value=failure) as run:
            self.assertEqual(ensure_local_git(self.root)[0], "error")
        self.assertEqual(run.call_count, 1)
        self.assertEqual(list(self.root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
