# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

import os
import importlib.util
import logging
import types
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.local_git_backup import commit_local_backup

@unittest.skipUnless(shutil.which("git"), "git required")
class LocalBackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "日本語 space"
        self.root.mkdir()
        boundary=Path(self.tmp.name)
        original_lexists=os.path.lexists
        def fixture_lexists(path):
            return original_lexists(path) if Path(path).is_relative_to(boundary) else False
        original_run=subprocess.run
        def fixture_run(*args, **kwargs):
            kwargs["env"]=dict(kwargs.get("env",os.environ), GIT_CEILING_DIRECTORIES=str(boundary.parent))
            return original_run(*args, **kwargs)
        lexists_patch=patch("os.path.lexists",side_effect=fixture_lexists)
        run_patch=patch("subprocess.run",side_effect=fixture_run)
        lexists_patch.start();run_patch.start()
        self.addCleanup(lexists_patch.stop);self.addCleanup(run_patch.stop)
        self.meta = self.root / ".git_local"
        self.git("init", "--template=", "--initial-branch=main")
    def git(self, *args):
        env = {k:v for k,v in os.environ.items() if not k.upper().startswith("GIT_")}
        return subprocess.run(["git", "-C", str(self.root), "--git-dir="+str(self.meta), "--work-tree="+str(self.root), *args], env=env, capture_output=True, text=True)
    def snapshot(self):
        return commit_local_backup(self.root, [p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()])
    def metadata_bytes(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes()
                for p in self.root.rglob("*") if p.is_file() and not p.is_symlink()}

    def assert_protected(self):
        before = self.metadata_bytes()
        with patch("subprocess.run", side_effect=AssertionError("Git must not run")):
            self.assertEqual(self.snapshot()[0], "skipped")
            from scripts.local_git_setup import ensure_local_git
            self.assertEqual(ensure_local_git(self.root)[0], "existing")
        self.assertEqual(self.metadata_bytes(), before)

    def test_coexisting_normal_git_and_local_metadata_never_touched(self):
        subprocess.run(["git", "-C", str(self.root), "init"], capture_output=True, check=True)
        (self.root / "source.txt").write_text("source")
        self.assert_protected()

    def test_old_aidiy_pointer_is_preserved_not_migrated(self):
        (self.root / ".git").write_text("gitdir: .git_local\n")
        self.assert_protected()

    def test_worktree_and_submodule_pointer_shapes_are_preserved(self):
        for pointer in ("gitdir: ../repo/.git/worktrees/child\n", "gitdir: ../repo/.git/modules/child\n", "invalid"):
            with self.subTest(pointer=pointer):
                (self.root / ".git").write_text(pointer)
                self.assert_protected()

    def symlink_or_skip(self, link, target, directory=False):
        # Windows は開発者モード等のシンボリックリンク権限が無いと作成できない。
        try:
            link.symlink_to(target, target_is_directory=directory)
        except OSError as error:
            if getattr(error, 'winerror', None) == 1314:
                self.skipTest('シンボリックリンクを作成できない環境')
            raise

    def test_broken_git_symlink_is_preserved(self):
        self.symlink_or_skip(self.root / ".git", self.root / "absent")
        self.assert_protected()
        self.assertTrue((self.root / ".git").is_symlink())

    def test_ancestor_git_with_existing_local_metadata_is_preserved(self):
        (self.root.parent / ".git").mkdir()
        self.assert_protected()

    def test_bare_git_with_local_metadata_is_preserved(self):
        subprocess.run(["git", "init", "--bare", str(self.root)], capture_output=True, check=True)
        self.assert_protected()

    def test_explicit_git_environment_is_preserved(self):
        for variable in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"):
            with self.subTest(variable=variable), patch.dict(os.environ, {variable: str(self.root.parent)}):
                self.assert_protected()

    def test_git_local_symlink_is_not_followed(self):
        target = self.root.parent / "metadata"
        self.meta.rename(target)
        self.symlink_or_skip(self.meta, target, directory=True)
        before = {p.relative_to(target): p.read_bytes() for p in target.rglob("*") if p.is_file()}
        self.assertEqual(self.snapshot()[0], "error")
        self.assertEqual(before, {p.relative_to(target): p.read_bytes() for p in target.rglob("*") if p.is_file()})

    def test_missing_repo_created_and_first_backup_committed(self):
        # 既存fixtureの隣に、Git管理されていない別のプロジェクトを作る。
        plain=self.root.parent/"new project"
        plain.mkdir();(plain/"source.txt").write_text("source")
        self.assertEqual(commit_local_backup(plain,["source.txt"])[0],"created")
        self.assertTrue((plain/".git_local").is_dir())
        self.assertFalse((plain/".git").exists())
        self.assertEqual(commit_local_backup(plain,["source.txt"])[0],"unchanged")
    def test_normal_repository_not_initialized_or_committed(self):
        plain=self.root.parent/"normal"
        plain.mkdir()
        subprocess.run(["git","-C",str(plain),"init"],capture_output=True,check=True)
        (plain/"source.txt").write_text("source")
        self.assertEqual(commit_local_backup(plain,["source.txt"])[0],"skipped")
        self.assertFalse((plain/".git_local").exists())
    def test_ancestor_repository_not_initialized(self):
        (self.root / ".git").write_text("gitdir: .git_local\n")
        child=self.root/"nested"
        child.mkdir();(child/"source.txt").write_text("source")
        self.assertEqual(commit_local_backup(child,["source.txt"])[0],"skipped")
        self.assertFalse((child/".git_local").exists())
    def test_incomplete_metadata_not_reinitialized(self):
        plain=self.root.parent/"incomplete"
        plain.mkdir();(plain/".git_local").mkdir()
        (plain/".git_local"/"keep").write_text("keep")
        self.assertEqual(commit_local_backup(plain,[])[0],"error")
        self.assertFalse((plain/".git").exists())
        self.assertEqual((plain/".git_local"/"keep").read_text(),"keep")
    def test_new_modified_deleted_unchanged(self):
        path=self.root/"source.txt";path.write_text("one")
        self.assertEqual(self.snapshot()[0], "created")
        first=self.git("rev-parse","HEAD").stdout
        self.assertEqual(self.snapshot()[0], "unchanged")
        path.write_text("two");self.assertEqual(self.snapshot()[0], "created")
        self.assertNotEqual(self.git("rev-parse","HEAD").stdout,first)
        path.unlink();self.assertEqual(self.snapshot()[0], "created")
        self.assertEqual(self.git("ls-files").stdout, "")
        self.assertEqual(self.git("remote").stdout, "")
    def test_ignore_and_secret_exclusion_even_previously_tracked(self):
        (self.root/"source.txt").write_text("ok")
        self.snapshot()
        (self.root/".gitignore").write_text("source.txt\nprivate.txt\n")
        (self.root/"private.txt").write_text("private")
        (self.root/".env").write_text("secret")
        (self.root/"db.sqlite").write_text("db")
        self.assertEqual(self.snapshot()[0], "created")
        self.assertEqual(self.git("ls-files").stdout, "")
    def test_backup_storage_never_enters_snapshot_but_ordinary_backup_does(self):
        # 既存 .git_local に info/exclude がない場合も保存版を再帰記録しない。
        for directory in (".aidiy_backup", ".backup_local", ".aidiy_cache", "backup"):
            (self.root / directory).mkdir()
            (self.root / directory / "source.txt").write_text("fixture")
        self.assertEqual(self.snapshot()[0], "created")
        self.assertEqual(self.git("ls-files").stdout, "backup/source.txt\n")
        (self.root / ".aidiy_backup" / "source.txt").write_text("new snapshot")
        self.assertEqual(self.snapshot()[0], "unchanged")

    def test_no_git_or_no_metadata_skips(self):
        with patch("scripts.local_git_backup.shutil.which",return_value=None):
            self.assertEqual(self.snapshot()[0], "skipped")

    def test_wrong_pointer_and_regular_repository_untouched(self):
        before=(self.meta/"HEAD").read_bytes()
        (self.root/".git").write_text("gitdir: ../other\n")
        self.assertEqual(self.snapshot()[0], "skipped")
        self.assertEqual((self.meta/"HEAD").read_bytes(),before)
    def test_invalid_metadata_errors(self):
        (self.meta/"HEAD").write_text("not git")
        self.assertEqual(self.snapshot()[0], "error")
    def test_wrong_config_worktree_rejected(self):
        self.git("config","core.worktree",str(self.root.parent))
        self.assertEqual(self.snapshot()[0], "error")
    def test_hooks_and_filters_not_executed(self):
        sentinel=self.root/"unexpected"
        hook=self.meta/"hooks"/"reference-transaction";hook.parent.mkdir(exist_ok=True)
        hook.write_text('#!/bin/sh\ntouch "'+str(sentinel)+'"\n');hook.chmod(0o755)
        self.git("config","filter.bad.clean",'touch "'+str(sentinel)+'"')
        (self.root/".gitattributes").write_text("*.txt filter=bad\n")
        (self.root/"source.txt").write_text("data")
        self.assertEqual(self.snapshot()[0],"created")
        self.assertFalse(sentinel.exists())
    def test_locked_index_preserved(self):
        (self.root/"source.txt").write_text("data")
        lock=self.meta/"index.lock";lock.write_text("user")
        self.assertEqual(self.snapshot()[0],"error")
        self.assertEqual(lock.read_text(),"user")
    def test_user_staged_changes_are_preserved(self):
        (self.root/"source.txt").write_text("user staged")
        self.git("add", "source.txt")
        before=(self.meta/"index").read_bytes()
        self.assertEqual(self.snapshot()[0], "error")
        self.assertEqual((self.meta/"index").read_bytes(), before)
        self.assertNotEqual(self.git("rev-parse", "--verify", "HEAD").returncode, 0)
    def test_actual_backup_triggers_history_even_without_copy_changes(self):
        spec=importlib.util.spec_from_file_location("backup_under_test",Path(__file__).resolve().parents[2]/"backend_server/AIコア/AIバックアップ.py")
        module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{"log_config":types.SimpleNamespace(get_logger=logging.getLogger)}):
            spec.loader.exec_module(module)
        # 実workerを使い、fixture固有のhelperで生成したthreadだけを待つ。
        # コピー完了は非同期Git記録の完了を意味しない。
        helper_spec = importlib.util.spec_from_file_location(
            "fixture_local_git_backup", Path(__file__).resolve().parents[1] / "local_git_backup.py")
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        workers = []
        def create_worker(*args, **kwargs):
            worker = threading.Thread(*args, **kwargs)
            workers.append(worker)
            return worker
        def wait_for_workers():
            for worker in workers:
                worker.join(timeout=60)
                self.assertFalse(worker.is_alive(), "fixtureのGit記録workerが完了しませんでした")
        self.addCleanup(wait_for_workers)
        def backup_and_wait():
            count = len(workers)
            self.assertIsNotNone(module.バックアップ実行(セッション設定=context, ログ出力=False))
            self.assertEqual(len(workers), count + 1, "Git記録workerが起動されていません")
            wait_for_workers()
            head = self.git("rev-parse", "--verify", "HEAD")
            self.assertEqual(head.returncode, 0, head.stderr)
            return head.stdout
        path=self.root/"source.txt";path.write_text("before")
        context={"CODE_BASE_PATH":str(self.root)}
        with patch.dict(sys.modules, {"aidiy_local_git_backup": helper}), \
                patch.object(helper, "threading", types.SimpleNamespace(Thread=create_worker)):
            try:
                first = backup_and_wait()
                self.assertEqual(self.git("show", "HEAD:source.txt").stdout, "before")
                # 同一mtime内の変更は従来コピー差分には現れなくてもGitへ記録する。
                timestamp=path.stat().st_mtime
                path.write_text("after");os.utime(path,(timestamp,timestamp))
                self.assertNotEqual(backup_and_wait(), first)
                self.assertEqual(self.git("show", "HEAD:source.txt").stdout, "after")
                self.assertEqual(self.git("ls-files").stdout,"source.txt\n")
            finally:
                wait_for_workers()
    def test_file_backup_continues_when_git_management_is_protected(self):
        spec = importlib.util.spec_from_file_location("protected_backup_under_test", Path(__file__).resolve().parents[2] / "backend_server/AIコア/AIバックアップ.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"log_config": types.SimpleNamespace(get_logger=logging.getLogger)}):
            spec.loader.exec_module(module)
        subprocess.run(["git", "-C", str(self.root), "init"], capture_output=True, check=True)
        (self.root / "source.txt").write_text("source")
        before = {p.relative_to(self.root): p.read_bytes() for folder in (self.meta, self.root / ".git") for p in folder.rglob("*") if p.is_file()}
        with patch("subprocess.run", side_effect=AssertionError("Git must not run")):
            result = module.バックアップ実行(セッション設定={"CODE_BASE_PATH": str(self.root)}, ログ出力=False)
        self.assertIsNotNone(result)
        self.assertTrue(list((self.root / ".aidiy_backup").rglob("source.txt")))
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for folder in (self.meta, self.root / ".git") for p in folder.rglob("*") if p.is_file()})

    def test_identity_not_written_to_config(self):
        (self.root/"source.txt").write_text("data")
        before=(self.meta/"config").read_bytes()
        self.snapshot()
        self.assertEqual((self.meta/"config").read_bytes(),before)
        self.assertIn("AiDiy Local Backup",self.git("log","-1","--format=%an").stdout)

if __name__ == "__main__": unittest.main()
