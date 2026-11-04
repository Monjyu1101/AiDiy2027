# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""batch のコピーは一時プロジェクトだけ。Git・通信・実ユーザーデータは使わない。"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools_proc import backup
import httpx
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
import log_config
with patch.object(log_config, 'get_logger', return_value=logging.getLogger('backup-route-test')):
    from tools_proc import tools_backup
from tools_proc.tools_management import ToolsGateMiddleware


class BackupBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aidiy-batch-fixture-')
        self.root = Path(self.temp.name)
        self.saver = backup.BackupSave(str(self.root))
        logging_stub = ModuleType('log_config')
        logging_stub.get_logger = logging.getLogger
        with patch.dict(sys.modules, {'log_config': logging_stub}):
            self.native = self.saver._get_native()
        self.patches = [patch.object(self.native, '_ローカルGit記録'),
                        patch.object(socket.socket, 'connect', side_effect=AssertionError('no network')),
                        patch.object(subprocess, 'Popen', side_effect=AssertionError('no process'))]
        for item in self.patches:
            item.start()
        self.release = threading.Event()
        self.started = threading.Event()
        self.original_copy = self.native._ファイルコピー実行
        self.copy_calls = []
        self.write('first.txt', 'first bytes\n')
        self.write('nested/second.txt', 'second bytes\n')

    def tearDown(self):
        self.release.set()
        with backup._RUNS_LOCK:
            pending = list(backup._RUNS.values())
        for record in pending:
            self.assertTrue(record.done.wait(5), 'worker must finish before fixture cleanup')
            if record.thread is not None:
                record.thread.join(5)
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()
        self.assertFalse(backup._RUNS)

    def write(self, name, text, when=1_800_000_000):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8', newline='')
        os.utime(path, (when, when))

    def blocked_copy(self, root, files, target):
        self.copy_calls.append((root, files, target))
        self.started.set()
        if not self.release.wait(5):
            raise RuntimeError('fixture barrier timeout')
        return self.original_copy(root, files, target)

    def pending(self, path=None):
        key = os.path.normcase(os.path.realpath(path or self.root))
        return backup._RUNS[key]

    def complete(self, record):
        self.release.set()
        self.assertTrue(record.done.wait(5))
        record.thread.join(5)
        self.assertFalse(record.thread.is_alive())

    def sync_case(self, explicit):
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            with ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(self.saver.run, **({'batch': False} if explicit else {}))
                try:
                    self.assertTrue(self.started.wait(2))
                    self.assertFalse(result.done())
                finally:
                    self.release.set()
                response = result.result(5)
        self.assertFalse(response['batch'])
        self.assertTrue(response['ok'])
        self.assertEqual(response['バックアップ件数'], 2)
        self.assertEqual((Path(response['バックアップ先']) / 'first.txt').read_text(), 'first bytes\n')

    def test_omitted_batch_waits_for_real_copy(self):
        self.sync_case(False)

    def test_explicit_false_waits_for_real_copy(self):
        self.sync_case(True)

    def test_true_returns_plan_before_copy_and_worker_survives_response(self):
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            response = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            self.assertTrue(response['batch'])
            self.assertTrue(response['ok'])
            self.assertEqual(response['全件数'], 2)
            self.assertEqual(response['バックアップ件数'], 2)
            self.assertFalse(record.thread.daemon)
            self.assertTrue(record.thread.is_alive())
            target = Path(response['バックアップ先'])
            self.assertFalse(target.exists())
            self.assertIsNone(self.native._バックアップ全体の最終日時取得(str(self.root / '.aidiy_backup')))
            self.complete(record)
        self.assertEqual((target / 'first.txt').read_bytes(), b'first bytes\n')
        self.assertEqual((target / 'nested/second.txt').read_bytes(), b'second bytes\n')
        self.assertTrue(self.native._バックアップ全体の最終日時取得(str(self.root / '.aidiy_backup')))
        self.assertFalse(list((self.root / '.aidiy_backup').rglob('.pending-*')))

    def test_incremental_batch_keeps_previous_snapshot_until_copy_finishes(self):
        first = self.saver.run()
        self.write('first.txt', 'updated bytes\n', 1_800_000_010)
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            response = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            self.assertFalse(response['全件フラグ'])
            self.assertEqual(response['バックアップ件数'], 1)
            self.assertEqual(self.saver.diff_scan()['count'], 1)
            self.assertEqual(backup.BackupCheck(str(self.root)).list_versions('first.txt')['count'], 1)
            self.complete(record)
        self.assertEqual((Path(first['バックアップ先']) / 'first.txt').read_text(), 'first bytes\n')
        self.assertEqual((Path(response['バックアップ先']) / 'first.txt').read_text(), 'updated bytes\n')
        self.assertEqual(self.saver.diff_scan()['count'], 0)

    def test_duplicate_batch_rejects_without_waiting_across_instances_and_paths(self):
        other = backup.BackupSave(str(self.root / 'nested' / '..'))
        other._native = self.native
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            first = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            second = other.run(batch=True)
            self.assertTrue(first["ok"])
            self.assertFalse(second["ok"])
            self.assertTrue(second["batch"])
            self.assertIn("実行中", second["error"])
            self.assertEqual(len(self.copy_calls), 1)
            self.complete(record)

    def test_sync_waits_for_inflight_batch_before_new_scan(self):
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            with ThreadPoolExecutor(max_workers=1) as pool:
                waiting = pool.submit(self.saver.run)
                self.assertFalse(waiting.done())
                self.complete(record)
                result = waiting.result(5)
        self.assertFalse(result['batch'])
        self.assertTrue(result['差分なし'])
        self.assertEqual(len(self.copy_calls), 1)

    def test_batch_rejects_promptly_while_sync_copy_runs_and_retry_works(self):
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            with ThreadPoolExecutor(max_workers=1) as pool:
                first = pool.submit(self.saver.run)
                try:
                    self.assertTrue(self.started.wait(2))
                    second = self.saver.run(batch=True)
                    self.assertFalse(second['ok'])
                    self.assertTrue(second['batch'])
                    self.assertIn('実行中', second['error'])
                    self.assertFalse(first.done(), 'batch rejection must not wait for sync copy')
                finally:
                    self.release.set()
                normal = first.result(5)
        self.assertFalse(normal['batch'])
        self.assertEqual(len(self.copy_calls), 1)
        self.assertTrue(self.saver.run(batch=True)['ok'])

    def test_failed_copy_is_logged_not_published_and_next_request_can_retry(self):
        def broken(root, files, target):
            Path(target, 'first.txt').write_text('partial')
            self.started.set()
            self.release.wait(5)
            return False
        with patch.object(self.native, '_ファイルコピー実行', side_effect=broken), self.assertLogs('バックアップ', level='ERROR') as logs:
            response = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            self.complete(record)
        self.assertTrue(response['batch'])
        self.assertTrue(response['ok'], 'accepted is not completed')
        self.assertFalse(Path(response['バックアップ先']).exists())
        self.assertIn('バッチバックアップ失敗', '\n'.join(logs.output))
        self.assertFalse(list((self.root / '.aidiy_backup').rglob('.pending-*')))
        self.assertTrue(self.saver.run()['ok'])

    def test_exception_copy_is_logged_and_guard_released(self):
        def broken(*args):
            self.started.set();self.release.wait(5)
            raise OSError('fixture')
        with patch.object(self.native, '_ファイルコピー実行', side_effect=broken), self.assertLogs('バックアップ', level='ERROR') as logs:
            response = self.saver.run(batch=True)
            record = self.pending()
            self.complete(record)
        self.assertFalse(Path(response['バックアップ先']).exists())
        self.assertIn('fixture', '\n'.join(logs.output))

    def test_missing_source_never_publishes_partial_snapshot(self):
        def missing(root, files, target):
            os.unlink(Path(root, 'first.txt'))
            return self.blocked_copy(root, files, target)
        with patch.object(self.native, '_ファイルコピー実行', side_effect=missing), self.assertLogs('バックアップ', level='ERROR'):
            response = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            self.complete(record)
        self.assertFalse(Path(response['バックアップ先']).exists())

    def test_sync_first_copy_failure_is_not_reported_as_completed_or_unchanged(self):
        with patch.object(self.native, '_ファイルコピー実行', return_value=False):
            result = self.saver.run(batch=False)
        self.assertFalse(result['ok'])
        self.assertFalse(result['batch'])
        self.assertFalse(result['差分なし'])
        self.assertEqual(result['バックアップ先'], '')

    def test_sync_incremental_copy_failure_is_not_reported_as_completed(self):
        self.assertTrue(self.saver.run()['ok'])
        self.write('first.txt', 'updated bytes\n', 1_800_000_010)
        with patch.object(self.native, '_ファイルコピー実行', return_value=False):
            result = self.saver.run(batch=False)
        self.assertFalse(result['ok'])
        self.assertFalse(result['batch'])
        self.assertFalse(result['差分なし'])

    def test_thread_start_failure_returns_failure_and_unlocks(self):
        with patch.object(backup.threading.Thread, 'start', side_effect=RuntimeError('fixture')), self.assertLogs('バックアップ', level='ERROR'):
            result = self.saver.run(batch=True)
        self.assertFalse(result['ok'])
        self.assertTrue(result['batch'])
        self.assertFalse(backup._RUNS)
        self.assertTrue(self.saver.run()['ok'])

    def test_other_project_batch_can_copy_independently(self):
        other_root = self.root / 'other-project'
        other_root.mkdir();(other_root / 'different.txt').write_text('other bytes')
        os.utime(other_root / 'different.txt', (1_800_000_000, 1_800_000_000))
        other = backup.BackupSave(str(other_root));other._native = self.native
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy):
            first = self.saver.run(batch=True)
            first_record = self.pending()
            second = other.run(batch=True)
            second_record = self.pending(other_root)
            self.assertTrue(first['ok']);self.assertTrue(second['ok'])
            self.assertIsNot(first_record, second_record)
            self.complete(first_record);self.complete(second_record)
        self.assertEqual((Path(second['バックアップ先']) / 'different.txt').read_bytes(), b'other bytes')

    def test_external_destination_is_not_overwritten(self):
        with patch.object(self.native, '_ファイルコピー実行', side_effect=self.blocked_copy), self.assertLogs('バックアップ', level='ERROR'):
            response = self.saver.run(batch=True)
            record = self.pending()
            self.assertTrue(self.started.wait(2))
            target = Path(response['バックアップ先']);target.mkdir(parents=True)
            (target / 'existing.txt').write_text('external bytes')
            self.complete(record)
        self.assertEqual((target / 'existing.txt').read_bytes(), b'external bytes')
        self.assertFalse((target / 'first.txt').exists())

    def test_no_changes_batch_returns_zero_without_background_thread(self):
        self.saver.run()
        with patch.object(backup.threading.Thread, 'start', side_effect=AssertionError('no copy')):
            result = self.saver.run(batch=True)
        self.assertTrue(result['batch'])
        self.assertTrue(result['差分なし'])
        self.assertEqual(result['バックアップ件数'], 0)

    def test_strict_bool_input_and_empty_project_success_echo_batch(self):
        for value in (None, 0, 1, 'true', 'false'):
            with self.assertRaises(backup.BackupSaveError):
                self.saver.run(batch=value)
        empty = self.root / 'empty'
        empty.mkdir()
        saver = backup.BackupSave(str(empty));saver._native = self.native
        for value in (False, True):
            result = saver.run(batch=value)
            self.assertTrue(result['ok'])
            self.assertTrue(result['対象なし'])
            self.assertIs(result['batch'], value)


class BackupBatchApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.patches = [patch.object(socket.socket, 'connect', side_effect=AssertionError('no network')),
                        patch.object(subprocess, 'Popen', side_effect=AssertionError('no process'))]
        for guard in self.patches:
            guard.start();self.addCleanup(guard.stop)
        self.temp = tempfile.TemporaryDirectory(prefix='aidiy-batch-api-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.saver = backup.BackupSave(self.temp.name)
        self.native = SimpleNamespace(バックアップ実行=Mock(return_value=('fixture-time', [{'パス': 'a.txt'}], ['a.txt'], True, '/fixture/snapshot')))
        self.saver._native = self.native
        self.app = FastAPI()
        self.app.include_router(tools_backup.create_router(self.saver, SimpleNamespace()))
        self.expected = {'ok': True, '対象なし': False, '最終時刻': 'fixture-time', '全件数': 1,
                         'バックアップ件数': 1, '全件フラグ': True,
                         'バックアップ先': '/fixture/snapshot', '差分なし': False}

    async def request(self, body):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://fixture') as client:
            return await client.post('/aidiy_backup/save/run', json=body)

    async def test_rest_omitted_false_true_preserve_exact_old_fields_and_echo_batch(self):
        for body in ({}, {'batch': False}, {'batch': True}):
            result = await self.request(body)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json(), {**self.expected, 'batch': body.get('batch', False)})
            options = self.native.バックアップ実行.call_args.kwargs
            self.assertEqual('コピー実行' in options, body.get('batch', False))

    async def test_rest_batch_rejects_non_bool_before_backup(self):
        for value in (None, 0, 1, 'true', 'false', [], {}):
            self.assertEqual((await self.request({'batch': value})).status_code, 422)
        self.native.バックアップ実行.assert_not_called()

    async def test_rest_failure_echoes_batch_without_job_or_status_fields(self):
        self.native.バックアップ実行.return_value = None
        for batch in (False, True):
            result = (await self.request({'batch': batch})).json()
            self.assertFalse(result['ok'])
            self.assertIs(result['batch'], batch)
            self.assertEqual(set(result), (set(self.expected) - {'対象なし'}) | {'batch', 'error'})

    async def test_mcp_omitted_false_true_preserve_exact_fields(self):
        import json
        server = MCPServer('backup-fixture')
        tools_backup.register_tools(server, self.saver, SimpleNamespace())
        for args in ({}, {'batch': False}, {'batch': True}):
            result = await server.call_tool('backup_run', args)
            self.assertFalse(result.is_error)
            self.assertEqual(json.loads(result.content[0].text), {**self.expected, 'batch': args.get('batch', False)})

    async def test_mcp_strict_bool_rejected_and_disabled_rest_gate_stays_active(self):
        server = MCPServer('backup-fixture')
        tools_backup.register_tools(server, self.saver, SimpleNamespace())
        for value in (None, 0, 1, 'true', 'false'):
            with self.assertRaises(ToolError):
                await server.call_tool('backup_run', {'batch': value})
        self.native.バックアップ実行.assert_not_called()
        manager = SimpleNamespace(availability={'aidiy_backup': lambda: True}, active=lambda _: False)
        self.app.add_middleware(ToolsGateMiddleware, manager=manager)
        result = (await self.request({'batch': True})).json()
        self.assertEqual(result['status'], 'NG')
        self.assertFalse(result['available'])
        self.native.バックアップ実行.assert_not_called()



if __name__ == '__main__':
    unittest.main()
