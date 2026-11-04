# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Git はmock、コピーはtempだけ。同期/batchとも別workerのGitを待たない。"""
import importlib.util
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts import local_git_backup as worker


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load('git_worker_backup_test', ROOT / 'backend_tools/tools_proc/backup.py')


class LocalGitBackgroundTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='aidiy-git-worker-')
        self.root = Path(self.tmp.name)
        self.root.joinpath('file.txt').write_bytes(b'copy bytes\n')
        os.utime(self.root / 'file.txt', (1_800_000_000, 1_800_000_000))
        self.release = threading.Event()
        self.entered = threading.Event()
        self.threads = []
        original_thread = threading.Thread
        original_lexists = os.path.lexists
        def fixture_lexists(path):
            return original_lexists(path) if Path(path).is_relative_to(self.root) else False
        def make_thread(*args, **kwargs):
            thread = original_thread(*args, **kwargs)
            self.threads.append(thread)
            return thread
        logging_stub = ModuleType('log_config')
        logging_stub.get_logger = logging.getLogger
        self.patches = [
            patch('os.path.lexists', side_effect=fixture_lexists),
            patch.dict(sys.modules, {'log_config': logging_stub, 'aidiy_local_git_backup': worker}),
            patch.object(threading, 'Thread', side_effect=make_thread),
            patch.object(socket.socket, 'connect', side_effect=AssertionError('no network')),
            patch.object(subprocess, 'Popen', side_effect=AssertionError('no process')),
            patch.object(worker, 'commit_local_backup', return_value=('unchanged', '')),
        ]
        for item in self.patches:
            item.start()
        self.saver = backup.BackupSave(str(self.root))
        self.native = self.saver._get_native()
        self.log = logging.getLogger('git-worker-test')

    def tearDown(self):
        self.release.set()
        for thread in self.threads:
            if thread.ident is not None:
                thread.join(5)
                self.assertFalse(thread.is_alive())
        self.assertFalse(worker._PENDING)
        self.assertFalse(backup._RUNS)
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def block_git(self, *args, **kwargs):
        self.entered.set()
        if not self.release.wait(5):
            raise RuntimeError('fixture barrier timeout')
        return 'created', 'fixture'

    def call_while_git_blocked(self, **kwargs):
        worker.commit_local_backup.side_effect = self.block_git
        result = self.saver.run(**kwargs)
        self.assertTrue(self.entered.wait(2))
        self.assertTrue(result['ok'])
        self.assertFalse(self.release.is_set())
        self.assertEqual(result['batch'], kwargs.get('batch', False))
        git_threads = [t for t in self.threads if t.name == 'AiDiy-backup-git']
        self.assertEqual(len(git_threads), 1)
        self.assertTrue(git_threads[0].is_alive())
        self.assertFalse(git_threads[0].daemon)
        if kwargs.get('batch'):
            # copy 完了も Git 完了を待たない。
            for thread in self.threads:
                if thread.name == 'AiDiy-backup-copy':
                    thread.join(2)
                    self.assertFalse(thread.is_alive())
        self.assertEqual((Path(result['バックアップ先']) / 'file.txt').read_bytes(), b'copy bytes\n')

    def test_default_sync_copy_returns_while_git_is_blocked(self):
        self.call_while_git_blocked()

    def test_explicit_false_copy_returns_while_git_is_blocked(self):
        self.call_while_git_blocked(batch=False)

    def test_batch_copy_has_separate_worker_and_returns_while_git_is_blocked(self):
        self.call_while_git_blocked(batch=True)

    def test_git_directory_or_file_prevents_git_thread_for_both_modes(self):
        for kind in ('dir', 'file'):
            for batch in (False, True):
                with self.subTest(kind=kind, batch=batch):
                    marker = self.root / '.git'
                    if kind == 'dir':
                        marker.mkdir()
                    else:
                        marker.write_text('gitdir: ../other')
                    local = self.root / '.git_local'
                    local.mkdir(exist_ok=True)
                    (local / 'keep').write_text('unchanged')
                    result = self.saver.run(batch=batch)
                    for t in self.threads:
                        if t.ident is not None: t.join(2)
                    self.assertTrue(result['ok'])
                    self.assertFalse(any(t.name == 'AiDiy-backup-git' for t in self.threads))
                    self.assertEqual((local / 'keep').read_text(), 'unchanged')
                    worker.commit_local_backup.assert_not_called()
                    marker.rmdir() if kind == 'dir' else marker.unlink()

    def test_broken_git_link_and_ancestor_git_prevent_git_worker(self):
        (self.root / '.git').symlink_to(self.root / 'absent')
        self.assertFalse(worker.queue_local_backup(self.root, ['file.txt'], logger=self.log))
        (self.root / '.git').unlink()
        (self.root / '.git').mkdir()
        child = self.root / 'child'; child.mkdir()
        self.assertFalse(worker.queue_local_backup(child, [], logger=self.log))
        self.assertFalse(self.threads)
        worker.commit_local_backup.assert_not_called()

    def test_git_created_after_queue_skips_job_without_touching_local(self):
        captured = []
        class DeferredThread:
            def __init__(self, **kwargs): captured.append(kwargs['target'])
            def start(self): pass
        with patch.object(threading, 'Thread', DeferredThread):
            self.assertTrue(worker.queue_local_backup(self.root, ['file.txt'], logger=self.log))
        (self.root / '.git').write_text('gitdir: ../worktree')
        (self.root / '.git_local').mkdir()
        (self.root / '.git_local' / 'keep').write_bytes(b'protected')
        captured[0]()
        worker.commit_local_backup.assert_not_called()
        self.assertEqual((self.root / '.git_local' / 'keep').read_bytes(), b'protected')

    def test_same_target_queues_in_order_and_freezes_input_list(self):
        calls = []
        def record(root, files, **kwargs):
            calls.append(tuple(files))
            if len(calls) == 1: self.block_git()
            return 'unchanged', ''
        worker.commit_local_backup.side_effect = record
        first = ['first.txt']
        self.assertTrue(worker.queue_local_backup(self.root, first, logger=self.log))
        self.assertTrue(self.entered.wait(2))
        first.append('later mutation')
        self.assertTrue(worker.queue_local_backup(self.root / '..' / self.root.name, ['second.txt'], logger=self.log))
        self.assertEqual(calls, [('first.txt',)])
        self.assertEqual(len(self.threads), 1)
        self.release.set(); self.threads[0].join(2)
        self.assertEqual(calls, [('first.txt',), ('second.txt',)])

    def test_other_project_runs_without_waiting_for_first_git(self):
        other = self.root / 'other'; other.mkdir()
        second = threading.Event()
        def record(root, *args, **kwargs):
            if root == self.root: return self.block_git()
            second.set(); return 'unchanged', ''
        worker.commit_local_backup.side_effect = record
        worker.queue_local_backup(self.root, [], logger=self.log)
        self.assertTrue(self.entered.wait(2))
        worker.queue_local_backup(other, [], logger=self.log)
        self.assertTrue(second.wait(2))
        self.assertFalse(self.release.is_set())

    def test_git_error_and_exception_are_logged_and_next_job_runs(self):
        worker.commit_local_backup.side_effect = [('error', 'fixture git error'), RuntimeError('fixture exception'), ('created', '')]
        with self.assertLogs('git-worker-test', level='INFO') as logs:
            for _ in range(3): worker.queue_local_backup(self.root, ['file.txt'], logger=self.log)
            for thread in self.threads: thread.join(2)
        text = '\n'.join(logs.output)
        self.assertIn('fixture git error', text)
        self.assertIn('fixture exception', text)
        self.assertIn('変更記録を作成', text)
        self.assertEqual(worker.commit_local_backup.call_count, 3)

    def test_git_thread_start_failure_does_not_fail_copy_and_can_retry(self):
        original_thread = threading.Thread
        original_lexists = os.path.lexists
        def fixture_lexists(path):
            return original_lexists(path) if Path(path).is_relative_to(self.root) else False
        def fail_git(*args, **kwargs):
            if kwargs.get('name') == 'AiDiy-backup-git':
                return Mock(start=Mock(side_effect=RuntimeError('no thread')))
            return original_thread(*args, **kwargs)
        with patch.object(threading, 'Thread', side_effect=fail_git), self.assertLogs('バックアップ', level='ERROR'):
            result = self.saver.run()
        self.assertTrue(result['ok'])
        self.assertEqual((Path(result['バックアップ先']) / 'file.txt').read_bytes(), b'copy bytes\n')
        self.assertFalse(worker._PENDING)
        self.assertTrue(worker.queue_local_backup(self.root, [], logger=self.log))

    def test_thread_constructor_failure_releases_queue_and_allows_retry(self):
        with patch.object(threading, 'Thread', side_effect=RuntimeError('constructor failure')), \
                self.assertLogs('git-worker-test', level='ERROR'):
            self.assertFalse(worker.queue_local_backup(self.root, ['file.txt'], logger=self.log))
        self.assertFalse(worker._PENDING)
        self.assertTrue(worker.queue_local_backup(self.root, ['file.txt'], logger=self.log))
        for thread in self.threads: thread.join(2)
        worker.commit_local_backup.assert_called_once()

    def test_git_worker_failure_never_changes_sync_or_batch_result(self):
        worker.commit_local_backup.side_effect = RuntimeError('fixture git failure')
        with self.assertLogs('バックアップ', level='ERROR') as logs:
            for batch in (False, True):
                result = self.saver.run(batch=batch)
                for thread in self.threads: thread.join(2)
                self.assertTrue(result['ok'])
                self.assertEqual(result['batch'], batch)
        self.assertIn('fixture git failure', '\n'.join(logs.output))

    def test_native_dynamic_helper_is_cached_across_native_instances(self):
        candidate = ModuleType('fixture_git_helper')
        candidate.queue_local_backup = Mock()
        spec = Mock(loader=Mock())
        another = backup.BackupSave(str(self.root))._get_native()
        with patch.dict(sys.modules):
            del sys.modules['aidiy_local_git_backup']
            with patch.object(importlib.util, 'spec_from_file_location', return_value=spec) as make_spec, \
                    patch.object(importlib.util, 'module_from_spec', return_value=candidate):
                self.native._ローカルGit記録(str(self.root), ['first'])
                another._ローカルGit記録(str(self.root), ['second'])
            self.assertIs(sys.modules['aidiy_local_git_backup'], candidate)
        self.assertEqual(make_spec.call_count, 1)
        self.assertEqual(candidate.queue_local_backup.call_count, 2)

    def test_native_reload_shares_one_worker_and_core_path_is_also_nonblocking(self):
        worker.commit_local_backup.side_effect = self.block_git
        first = self.native.バックアップ実行(セッション設定={'CODE_BASE_PATH': str(self.root)}, ログ出力=False)
        self.assertTrue(self.entered.wait(2))
        another = backup.BackupSave(str(self.root))._get_native()
        second = another.バックアップ実行(セッション設定={'CODE_BASE_PATH': str(self.root)}, ログ出力=False)
        self.assertIsNotNone(first); self.assertIsNotNone(second)
        self.assertFalse(self.release.is_set())
        self.assertEqual(len([t for t in self.threads if t.name == 'AiDiy-backup-git']), 1)


if __name__ == '__main__':
    unittest.main()
