# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""接続専用Browserの登録試験。GUI依存だけを置換し、プロセスは起動しない。"""
import json
import logging
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend_tools'))
# この試験は画面キャプチャを使わない。未導入のscreeninfo/OS GUIを要求しない。
capture = types.ModuleType('tools_proc.desktop_capture')
capture.DesktopCapture = object
log = types.ModuleType('log_config')
log.get_logger = logging.getLogger
try:
    import PIL  # noqa: F401  Tools のブラウザ処理の依存。ルートの Python には無い。
except ImportError:
    raise unittest.SkipTest('Pillow が無い環境（backend_tools/.venv の Python で実行）')
with patch.dict(sys.modules, {'tools_proc.desktop_capture': capture, 'log_config': log}):
    from tools_proc.ide_browser_session import is_ide_session, is_reserved_browser_session, read_ide_session, IDEBrowserManager, IDEBrowserClient
    import tools_proc.chrome_sessions as sessions
    from tools_proc.chrome_sessions import ChromeSessionRegistry


BROWSER_SESSION = 'aidiy_browser 5ea6a3a0-21b2-4c31-80ab-123456789abc'
NEW_SESSIONS = ('aidiy_ide 1', 'aidiy_ide 2', BROWSER_SESSION)
TOKEN = '12345678-1234-1234-1234-123456789abc'


def manifest(name, port=12345, token=TOKEN):
    return dict(name=name, port=port, token=token, pid=1)


class BrowserSessionsTest(unittest.TestCase):
    def test_names_and_manifest_validation(self):
        for name in (*NEW_SESSIONS, 'aidiy_ide 100', 'aidiy_ide', 'aidiy_ide-2', 'aidiy_browser', 'aidiy_browser-2', 'aidiy_browser-100'):
            self.assertTrue(is_ide_session(name))
        for name in ('aidiy_ide 0', 'aidiy_ide 01', 'aidiy_ide １', 'aidiy_ide 1/../x', 'aidiy_ide 1\n', 'aidiy_browser not-a-uuid', BROWSER_SESSION.upper(), BROWSER_SESSION.replace('-4c31-', '-3c31-'), 'aidiy_browser-1', 'aidiy_browser-01', 'aidiy_browser/../../x', 'aidiy_browser_extra', 'default', None):
            self.assertFalse(is_ide_session(name))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = dict(name='aidiy_browser', port=12345, token='12345678-1234-1234-1234-123456789abc', pid=1)
            (root / 'aidiy_browser.json').write_text(json.dumps(entry))
            self.assertEqual(read_ide_session(root, 'aidiy_browser'), entry)
            entry['port'] = True
            (root / 'aidiy_browser.json').write_text(json.dumps(entry))
            self.assertIsNone(read_ide_session(root, 'aidiy_browser'))

    def test_registry_discovers_without_chrome_or_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests = root / '_ide_browser_sessions'
            manifests.mkdir()
            for name in (*NEW_SESSIONS, 'aidiy_browser', 'aidiy_browser-2', 'aidiy_ide'):
                (manifests / (name + '.json')).write_text(json.dumps(dict(name=name, port=12345, token='12345678-1234-1234-1234-123456789abc', pid=1)))
            registry = ChromeSessionRegistry(sessions_file=root / '_chrome_sessions.json')
            with patch.object(sessions, 'ChromeManager', side_effect=AssertionError('Chrome must not start')), patch.object(IDEBrowserManager, 'is_running', return_value=True), patch.object(IDEBrowserManager, 'close', return_value=True):
                for name in (*NEW_SESSIONS, 'aidiy_browser', 'aidiy_browser-2', 'aidiy_ide'):
                    manager, client = registry.get(name)
                    self.assertIsInstance(manager, IDEBrowserManager)
                    self.assertIsInstance(client, IDEBrowserClient)
                items = {item['session']: item for item in registry.list()}
                self.assertEqual(items['aidiy_browser']['owner'], 'aidiy_browser')
                self.assertEqual(items['aidiy_ide']['owner'], 'aidiy_ide')
                self.assertTrue(registry.close('aidiy_browser'))
                self.assertTrue(registry.delete('aidiy_browser-2'))
                self.assertTrue((manifests / 'aidiy_browser.json').exists())
                self.assertFalse(registry.sessions_file.exists())
                with self.assertRaises(RuntimeError):
                    registry.get('aidiy_browser-3')
                self.assertIsNone(registry.peek('aidiy_browser-3'))


    def test_new_names_are_reserved_even_when_missing_or_malformed(self):
        names = (*NEW_SESSIONS, 'aidiy_ide 0', 'aidiy_ide ../x', 'aidiy_browser not-a-uuid')
        with tempfile.TemporaryDirectory() as directory:
            registry = ChromeSessionRegistry(sessions_file=Path(directory) / '_chrome_sessions.json')
            with patch.object(sessions, 'ChromeManager', side_effect=AssertionError('Chrome must not start')):
                for name in names:
                    with self.subTest(name=name):
                        self.assertTrue(is_reserved_browser_session(name))
                        with self.assertRaises(RuntimeError):
                            registry.get(name)
                        self.assertIsNone(registry.peek(name))
                        self.assertFalse(registry.close(name))
                        self.assertFalse(registry.delete(name))
                self.assertEqual(registry.list(), [])
                self.assertFalse(registry.sessions_file.exists())

    def test_new_names_override_normal_chrome_registry_without_mutating_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests = root / '_ide_browser_sessions'
            manifests.mkdir()
            saved = {'next_seq': 4, 'sessions': {name: {'key': f's{i:04d}', 'port': 9223 + i} for i, name in enumerate(NEW_SESSIONS, 1)}}
            registry_path = root / '_chrome_sessions.json'
            registry_path.write_text(json.dumps(saved), encoding='utf-8')
            for name in NEW_SESSIONS:
                (manifests / (name + '.json')).write_text(json.dumps(manifest(name)), encoding='utf-8')
            registry = ChromeSessionRegistry(sessions_file=registry_path)
            with patch.object(sessions, 'ChromeManager', side_effect=AssertionError('Chrome must not start')), patch.object(IDEBrowserManager, 'is_running', return_value=True), patch.object(IDEBrowserManager, 'close', return_value=True) as close:
                for name in NEW_SESSIONS:
                    manager, client = registry.get(name)
                    self.assertIsInstance(manager, IDEBrowserManager)
                    self.assertIsInstance(client, IDEBrowserClient)
                    self.assertEqual(manager.entry['name'], name)
                    self.assertEqual(registry.peek(name), (manager, client))
                    self.assertTrue(registry.close(name))
                    self.assertTrue(registry.delete(name))
                self.assertEqual(close.call_count, len(NEW_SESSIONS) * 2)
                listed = registry.list()
                self.assertEqual(len(listed), len(NEW_SESSIONS))
                self.assertTrue(all(item['owner'] in ('aidiy_ide', 'aidiy_browser') for item in listed))
                for name in NEW_SESSIONS:
                    (manifests / (name + '.json')).unlink()
                    with self.assertRaises(RuntimeError):
                        registry.get(name)
                    self.assertIsNone(registry.peek(name))
                    self.assertFalse(registry.close(name))
                    self.assertFalse(registry.delete(name))
                self.assertEqual(registry.list(), [])
            self.assertEqual(json.loads(registry_path.read_text(encoding='utf-8')), saved)

    def test_manifest_changes_refresh_cache_and_do_not_fall_back_to_chrome(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests = root / '_ide_browser_sessions'
            manifests.mkdir()
            registry = ChromeSessionRegistry(sessions_file=root / '_chrome_sessions.json')
            name = 'aidiy_ide 1'
            path = manifests / (name + '.json')
            path.write_text(json.dumps(manifest(name)), encoding='utf-8')
            with patch.object(sessions, 'ChromeManager', side_effect=AssertionError('Chrome must not start')):
                old = registry.get(name)
                path.write_text(json.dumps(manifest(name, 12346, '22345678-1234-1234-1234-123456789abc')), encoding='utf-8')
                new = registry.peek(name)
                self.assertIsNot(old[0], new[0])
                self.assertEqual(new[0].debug_port, 12346)
                with patch.object(new[0], 'request', side_effect=ConnectionError('stale manifest')):
                    with self.assertRaises(RuntimeError):
                        new[0].ensure_running()
                    self.assertFalse(new[0].is_verified())
                for broken in ([], {}, {**manifest(name), 'name': 'aidiy_ide 2'}, {**manifest(name), 'port': True}, {**manifest(name), 'token': '../x'}):
                    with self.subTest(broken=broken):
                        path.write_text(json.dumps(broken), encoding='utf-8')
                        self.assertIsNone(read_ide_session(manifests, name))
                        self.assertIsNone(registry.peek(name))
                        with self.assertRaises(RuntimeError):
                            registry.get(name)

    def test_default_and_legacy_normal_sessions_are_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved = {'next_seq': 3, 'sessions': {'default': {'key': 'default', 'port': 9222}, 'aidiy_ide': {'key': 's0001', 'port': 9223}, 'aidiy_browser': {'key': 's0002', 'port': 9224}}}
            registry_path = root / '_chrome_sessions.json'
            registry_path.write_text(json.dumps(saved), encoding='utf-8')
            registry = ChromeSessionRegistry(sessions_file=registry_path)
            with patch.object(sessions, 'ChromeManager') as chrome, patch.object(registry, '_chrome_responding', return_value=True):
                chrome.return_value.is_running.return_value = True
                chrome.return_value._kill_on_debug_port.return_value = True
                for name in ('default', 'aidiy_ide', 'aidiy_browser'):
                    manager, client = registry.get(name)
                    self.assertIs(manager, chrome.return_value)
                    self.assertNotIsInstance(client, IDEBrowserClient)
                    self.assertEqual(registry.peek(name), (manager, client))
                    self.assertTrue(registry.close(name))
                self.assertEqual(chrome.call_count, 3)
                self.assertEqual(chrome.call_args_list[0].kwargs['debug_port'], 9222)
                self.assertEqual({item['session'] for item in registry.list()}, set(saved['sessions']))
                self.assertFalse(is_reserved_browser_session('default'))
                self.assertEqual(json.loads(registry_path.read_text(encoding='utf-8')), saved)

    def test_manager_verifies_session_name_and_owner_token(self):
        manager = IDEBrowserManager(manifest('aidiy_ide 2'))
        with patch.object(manager, 'request') as request:
            request.return_value = {'AiDiy-Owner': TOKEN, 'AiDiy-Session': 'aidiy_ide 2'}
            self.assertTrue(manager.is_running())
            request.assert_called_with('/json/version')
            for response in ({'AiDiy-Owner': TOKEN, 'AiDiy-Session': 'aidiy_ide 1'}, {'AiDiy-Owner': 'other', 'AiDiy-Session': 'aidiy_ide 2'}, {'AiDiy-Owner': TOKEN}, None):
                request.return_value = response
                self.assertFalse(manager.is_running())
                with self.assertRaises(RuntimeError):
                    manager.ensure_running()


if __name__ == '__main__':
    unittest.main()
