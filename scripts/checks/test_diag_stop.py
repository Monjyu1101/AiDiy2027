# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実サービスを触らず、固定対象の停止と自動復活の抑止を確認する。"""
import importlib.util
from pathlib import Path
import sys
import tempfile
from contextlib import contextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('diag_stop_test', ROOT / 'scripts/_diag_stop.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StopTests(unittest.TestCase):
    def test_only_fixed_service_can_be_stopped(self):
        with patch.object(module, 'load_module') as load:
            for kind in ('avatar', '../bad', 'web;evil', ''):
                with self.assertRaises(ValueError):
                    module.stop_target(kind)
            load.assert_not_called()

    def test_monitor_is_notified_before_existing_stop_with_no_launch_or_cleanup(self):
        events = []

        @contextmanager
        def request(_choices, services):
            events.append(('notify', services))
            yield
            events.append(('finished',))

        @contextmanager
        def hidden(_service):
            events.append(('hidden',))
            yield

        for target in module.TARGETS:
            events.clear()
            service = SimpleNamespace()
            with patch.object(module, 'load_module', side_effect=[service, SimpleNamespace(cleanup_stop_request=request)]), \
                    patch.object(module, 'hidden_commands', hidden), \
                    patch.object(module, 'cancel_previous', side_effect=lambda kind: events.append(('cancel', kind))), \
                    patch.object(module.time, 'sleep', side_effect=lambda seconds: events.append(('wait', seconds))), \
                    patch.object(module, 'stop_previous', side_effect=lambda owner, item: events.append(('stop', owner, item['id']))):
                module.stop_target(target['id'])
            self.assertEqual(events, [('notify', [target['監視名']]), ('hidden',), ('cancel', target['id']), ('wait', 1.3),
                                      ('stop', service, target['id']), ('finished',)])

    def test_existing_diag_monitor_receives_a_new_run_id_for_only_the_target(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'RUNTIME', Path(directory)):
            other = Path(directory) / 'tools.json'
            other.write_text('{"run":"keep-tools"}', encoding='utf-8')
            target = Path(directory) / 'web.json'
            target.write_text('{"run":"old-web"}', encoding='utf-8')
            module.cancel_previous('web')
            self.assertNotEqual(module.json.loads(target.read_text(encoding='utf-8'))['run'], 'old-web')
            self.assertEqual(other.read_text(encoding='utf-8'), '{"run":"keep-tools"}')
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
