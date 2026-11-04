"""内部 consumer のみ。すべて fixture と mock、実サービス・資格情報なし。"""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from taskteam_proc import internal_client as client


class ConsumerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / 'internal_auth.json'
        self.write('fixture-before')
        self.file_patch = patch.object(client, 'TOKEN_FILE', self.file)
        self.file_patch.start()

    def tearDown(self):
        self.file_patch.stop()
        self.tmp.cleanup()

    def write(self, token):
        self.file.write_text(json.dumps({'token_type': 'bearer', 'access_token': token}))

    def response(self):
        return io.BytesIO(b'{"status":"OK"}')

    def test_fresh_read_between_calls(self):
        with patch.object(client._HTTP, 'open', side_effect=lambda *a, **k: self.response()) as send:
            client.post_json('http://127.0.0.1:8093/task/タスク要求/取得', {})
            self.write('fixture-after')
            client.post_json('http://127.0.0.1:8093/team/状態/取得', {})
        self.assertEqual([call.args[0].get_header('Authorization') for call in send.call_args_list],
                         ['Bearer fixture-before', 'Bearer fixture-after'])
        self.assertIn('%E7', send.call_args.args[0].full_url)

    def test_restart_401_rereads_once(self):
        def send(request, **kwargs):
            if request.get_header('Authorization') == 'Bearer fixture-before':
                self.write('fixture-after')
                raise HTTPError(request.full_url, 401, 'no', {}, io.BytesIO(b'ignored'))
            return self.response()
        with patch.object(client._HTTP, 'open', side_effect=send) as mock:
            self.assertEqual(client.post_json('http://127.0.0.1:8093/task_check_okng', {}), {'status': 'OK'})
            self.assertEqual(mock.call_count, 2)

    def test_repeated_401_bounded_redacted(self):
        def fail(request, **kwargs):
            raise HTTPError(request.full_url, 401, 'fixture-secret', {}, io.BytesIO(b'fixture-secret'))
        with patch.object(client._HTTP, 'open', side_effect=fail) as mock:
            with self.assertRaisesRegex(RuntimeError, '^内部 API HTTP 401$'):
                client.post_json('http://127.0.0.1:8093/task_check_okng', {})
            self.assertEqual(mock.call_count, 2)

    def test_does_not_retry_other_failures(self):
        with patch.object(client._HTTP, 'open', side_effect=HTTPError('fixture', 500, 'secret', {}, None)) as mock:
            with self.assertRaises(RuntimeError):
                client.post_json('http://127.0.0.1:8093/task_check_okng', {})
            self.assertEqual(mock.call_count, 1)

    def test_no_credentials_to_tools_or_other_services(self):
        self.file.unlink()
        with patch.object(client._HTTP, 'open', side_effect=lambda *a, **k: self.response()) as send:
            for path in ('aidiy_code_agents/run', 'aidiy_task_agents/submit', 'aidiy_team_agents/submit', 'aidiy_backup/save/run'):
                client.post_json('http://127.0.0.1:8095/' + path, {})
            for call in send.call_args_list:
                self.assertIsNone(call.args[0].get_header('Authorization'))

    def test_untrusted_origin_and_ambiguous_urls_rejected_before_read_or_send(self):
        urls = ['http://example.com:8093/task/取得', 'http://127.0.0.1:8095/task/取得',
                'https://127.0.0.1:8093/task/取得', 'http://a@127.0.0.1:8093/task/取得',
                'http://127.0.0.1:8093/task/取得?x=1', 'http://127.0.0.1:8093/task/../core/test']
        with patch.object(client, '_read_token') as read, patch.object(client._HTTP, 'open') as send:
            for url in urls:
                with self.subTest(url=url), self.assertRaises(RuntimeError):
                    client.post_json(url, {})
            read.assert_not_called()
            send.assert_not_called()

    def test_missing_malformed_symlink_fail_closed(self):
        for data in ('{malformed-secret', '{}', '[]', '{"token_type":"bearer","access_token":"injected\\nheader"}'):
            self.file.write_text(data)
            with patch.object(client._HTTP, 'open') as send, self.assertRaises(RuntimeError) as caught:
                client.post_json('http://127.0.0.1:8093/task_check_okng', {})
            send.assert_not_called()
            self.assertNotIn('secret', str(caught.exception))
        self.file.unlink()
        with self.assertRaises(RuntimeError):
            client._read_token()
        target = self.file.with_name('target.json'); target.write_text('{}')
        self.file.symlink_to(target)
        with self.assertRaises(RuntimeError):
            client._read_token()

    def test_localhost_is_sent_to_numeric_loopback(self):
        with patch.object(client._HTTP, 'open', side_effect=lambda *a, **k: self.response()) as send:
            client.post_json('http://localhost:8093/task/check', {})
        self.assertEqual(send.call_args.args[0].full_url, 'http://127.0.0.1:8093/task/check')

    def test_generic_cli_and_report_alias(self):
        for args, expected in [(['--post', '/task/タスク要求/停止検査'], '/task/タスク要求/停止検査'),
                               (['--post', '/team/状態/取得'], '/team/状態/取得'),
                               (['--check-report'], '/task_check_okng')]:
            with patch.object(client, 'post_json', return_value={'status': 'OK'}) as send, patch('sys.stdout', new=io.StringIO()):
                self.assertEqual(client.main(args, stdin=io.StringIO('{}')), 0)
                self.assertEqual(send.call_args.args, ('http://127.0.0.1:8093' + expected, {}))
        with patch.object(client, 'post_json') as send:
            for path in ['http://example.com/task/check', '//example.com/task/check', '/core/auth/token', '/task/check?x=1', '/task/check#fragment']:
                with self.assertRaises(ValueError):
                    client.main(['--post', path], stdin=io.StringIO('{}'))
            send.assert_not_called()

    def test_redirect_is_never_followed(self):
        self.assertIsNone(client._NoRedirect().redirect_request(None, None, 307, '', {}, 'http://example.com'))

    def test_all_post_wrappers_use_helper_and_prompts_do_not_read_token(self):
        files = list((BASE/'task_sub').glob('*.py')) + list((BASE/'team_sub').glob('*.py'))
        wrappers = [path for path in files if 'def POST送信(' in path.read_text()]
        self.assertEqual(len(wrappers), 9)
        for path in wrappers:
            self.assertIn('return post_json(url, payload, timeout=timeout)', path.read_text())
        with patch.object(client, '_read_token', side_effect=AssertionError('must not read')):
            instruction = client.report_instruction()
        self.assertIn('--check-report', instruction)
        self.assertIn('--post', instruction)
        self.assertNotIn('fixture-before', instruction)
        for name in ('sub_do.py', 'sub_end.py', 'sub_if.py'):
            self.assertIn('+= report_instruction()', (BASE/'task_sub'/name).read_text())


if __name__ == '__main__':
    unittest.main()
