"""TaskTeam token transport; fixtures only, no sockets or real credentials."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
from tools_proc import taskteam_auth as auth


class TaskTeamAuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / 'internal_auth.json'
        self.file.write_text(json.dumps({'access_token': 'fixture-first'}))
        self.patch = patch.object(auth, 'TOKEN_FILE', self.file)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.session = Mock()
        self.session.__enter__ = Mock(return_value=self.session)
        self.session.__exit__ = Mock(return_value=False)
        self.factory = patch.object(auth.requests, 'Session', return_value=self.session)
        self.factory.start()
        self.addCleanup(self.factory.stop)

    def reply(self, status=200):
        response = Mock(status_code=status)
        if status >= 400:
            response.raise_for_status.side_effect = requests.HTTPError('fixture secret should not leak')
        return response

    def call(self, url='http://127.0.0.1:8093/task/fixture'):
        return auth.post_taskteam(url, {'fixture': True}, 5)

    def test_reads_each_call_and_disables_proxy_redirect(self):
        self.session.post.return_value = self.reply()
        self.call()
        self.file.write_text(json.dumps({'access_token': 'fixture-next-day'}))
        self.call()
        self.assertFalse(self.session.trust_env)
        self.assertEqual([c.kwargs['headers']['Authorization'] for c in self.session.post.call_args_list],
                         ['Bearer fixture-first', 'Bearer fixture-next-day'])
        self.assertTrue(all(c.kwargs['allow_redirects'] is False for c in self.session.post.call_args_list))

    def test_restart_401_reads_new_file_once(self):
        def respond(*args, **kwargs):
            if self.session.post.call_count == 1:
                self.file.write_text(json.dumps({'access_token': 'fixture-after-restart'}))
                return self.reply(401)
            return self.reply()
        self.session.post.side_effect = respond
        self.call()
        self.assertEqual(self.session.post.call_count, 2)
        self.assertEqual(self.session.post.call_args.kwargs['headers']['Authorization'], 'Bearer fixture-after-restart')

    def test_repeated_401_stops_and_redacts(self):
        self.session.post.return_value = self.reply(401)
        with self.assertRaises(requests.RequestException) as error:
            self.call()
        self.assertNotIn('secret', str(error.exception))
        self.assertEqual(self.session.post.call_count, 2)

    def test_other_errors_do_not_retry(self):
        for code in (403, 500, 302, 307):
            with self.subTest(code=code):
                self.session.post.reset_mock()
                self.session.post.return_value = self.reply(code)
                with self.assertRaises(requests.RequestException):
                    self.call()
                self.assertEqual(self.session.post.call_count, 1)

    def test_remote_and_bad_destinations_never_read_or_send(self):
        for url in ('http://example.com:8093/task/test', 'http://0.0.0.0:8093/task/test',
                    'http://127.0.0.1:8093/core/test', 'http://user:pass@127.0.0.1:8093/task/test',
                    'http://localhost:8093/task/test?x=1', 'file:///task/test',
                    'http://127.0.0.1:8093/task/../core/test',
                    'http://127.0.0.1:8093/task/%2e%2e/core/test'):
            with self.subTest(url=url), patch.object(auth, '_read_token') as read:
                with self.assertRaises(requests.RequestException):
                    self.call(url)
                read.assert_not_called()
        self.session.post.assert_not_called()

    def test_local_alias_and_ipv6(self):
        self.session.post.return_value = self.reply()
        self.call('http://localhost:18093/team/test')
        self.assertEqual(self.session.post.call_args.args[0], 'http://127.0.0.1:18093/team/test')
        self.call('http://[::1]:8093/team/test')
        self.assertEqual(self.session.post.call_args.args[0], 'http://[::1]:8093/team/test')

    def test_missing_malformed_or_symlink_file_never_sends(self):
        for value in ('', 'null', '{', '{"access_token":"bad token"}', '{"access_token":42}'):
            with self.subTest(value=value):
                self.file.write_text(value)
                with self.assertRaises(requests.RequestException):
                    self.call()
        self.file.unlink()
        with self.assertRaises(requests.RequestException):
            self.call()
        target = self.file.with_name('fixture.json')
        target.write_text('{"access_token":"fixture"}')
        self.file.symlink_to(target)
        with self.assertRaises(requests.RequestException):
            self.call()
        self.session.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
