"""Persisted TaskTeam lifecycle fixtures only: temporary files and deterministic keys."""
from datetime import datetime, timedelta, timezone
import itertools
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_taskteam'))
from taskteam_proc import internal_auth as auth

LOCAL = timezone(timedelta(hours=9))
START = datetime(2026, 10, 31, 2, 59, tzinfo=LOCAL)
ENDPOINT = ('POST', '/task/fixture')


class PersistedLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.now = START
        counter = itertools.count(1)
        self.random = patch.object(auth.secrets, 'token_bytes', side_effect=lambda length: bytes([next(counter)]) * length)
        self.random.start()
        self.addCleanup(self.random.stop)
        self.ids = patch.object(auth.secrets, 'token_hex', return_value='fixture-token-id')
        self.ids.start()
        self.addCleanup(self.ids.stop)

    def create(self):
        authority = auth.InternalTokenAuthority(clock=lambda: self.now, endpoints=[ENDPOINT])
        rotator = auth.PersistentTokenRotator(authority, self.root, clock=lambda: self.now)
        return authority, rotator

    def public(self):
        return json.loads((self.root / '_AIDIY/backend_taskteam/internal_auth.json').read_text())

    def token(self):
        return self.public()['access_token']

    def verify(self, authority, token):
        return authority.verify(token, *ENDPOINT)

    def test_valid_startup_reuses_exact_token_even_after_three(self):
        authority, rotator = self.create()
        rotator.refresh()
        original = self.public()
        self.now = START.replace(hour=5)
        restarted, second = self.create()
        second.refresh()
        self.assertEqual(self.public(), original)
        self.verify(restarted, original['access_token'])
        second.refresh()
        self.assertEqual(self.public(), original)
        self.assertNotIn('key', self.public())
        self.assertNotIn('signing_key', self.public())

    def test_local_three_boundary_rotates_once_not_midnight(self):
        self.now = START.replace(hour=23, minute=59) - timedelta(days=1)
        authority, rotator = self.create()
        rotator.refresh()
        before = self.token()
        self.now += timedelta(minutes=1)
        rotator.refresh()
        self.assertEqual(self.token(), before)
        self.now = START.replace(hour=3, minute=0)
        rotator.refresh()
        after = self.token()
        self.assertNotEqual(after, before)
        self.verify(authority, before)
        self.verify(authority, after)
        self.now += timedelta(minutes=1)
        rotator.refresh()
        self.assertEqual(self.token(), after)
        self.assertEqual(datetime.fromisoformat(self.public()['expires_at']) - datetime.fromisoformat(self.public()['issued_at']), timedelta(hours=25))

    def test_old_key_survives_rotation_and_restart_only_until_token_expiry(self):
        authority, rotator = self.create()
        rotator.refresh()
        old = self.token()
        expiry = datetime.fromisoformat(self.public()['expires_at'])
        self.now = START.replace(hour=3, minute=0)
        rotator.refresh()
        latest = self.token()
        restarted, second = self.create()
        second.refresh()
        self.assertEqual(self.token(), latest)
        self.verify(restarted, old)
        self.now = expiry - timedelta(microseconds=1)
        self.verify(restarted, old)
        self.now = expiry
        with self.assertRaises(ValueError):
            self.verify(restarted, old)
        self.verify(restarted, latest)

    def test_expired_startup_regenerates_key_and_token(self):
        authority, rotator = self.create()
        rotator.refresh()
        before = self.token()
        self.now = datetime.fromisoformat(self.public()['expires_at'])
        restarted, second = self.create()
        second.refresh()
        self.assertNotEqual(self.token(), before)
        self.verify(restarted, self.token())
        with self.assertRaises(ValueError):
            self.verify(restarted, before)

    def test_reuse_after_three_cannot_leave_gap_until_next_three(self):
        self.now = START.replace(hour=3, minute=0)
        authority, rotator = self.create()
        rotator.refresh()
        before = self.token()
        expiry = datetime.fromisoformat(self.public()['expires_at'])
        self.now += timedelta(days=1, minutes=30)
        restarted, second = self.create()
        second.refresh()
        self.assertEqual(self.token(), before)
        self.now = expiry
        second.refresh()
        self.assertNotEqual(self.token(), before)
        self.verify(restarted, self.token())

    def test_public_write_failure_recovers_same_durable_token(self):
        authority, rotator = self.create()
        rotator.refresh()
        old = self.token()
        self.now = START.replace(hour=3, minute=0)
        attempted = []
        def fail(root, payload):
            attempted.append(payload.copy())
            raise OSError('fixture public publication failed')
        with patch.object(auth, 'write_token_file', side_effect=fail):
            with self.assertRaises(OSError):
                rotator.refresh()
        self.assertEqual(self.token(), old)
        rotator.refresh()
        self.assertEqual(self.public(), attempted[-1])
        self.verify(authority, old)
        self.verify(authority, self.token())
        restarted, second = self.create()
        second.refresh()
        self.assertEqual(self.public(), attempted[-1])


    def private_path(self):
        return self.root / '_AIDIY/backend_taskteam/internal_auth_keys.json'

    def test_private_file_permissions_and_corruption_fail_closed(self):
        authority, rotator = self.create()
        rotator.refresh()
        path = self.private_path()
        if sys.platform != 'win32':
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        original = self.token()
        path.write_text('{invalid fixture JSON')
        restarted, second = self.create()
        with self.assertRaises(ValueError):
            second.refresh()
        self.assertEqual(self.token(), original)
        self.assertEqual(path.read_text(), '{invalid fixture JSON')

    def test_private_schema_and_key_mismatch_do_not_silently_regenerate(self):
        authority, rotator = self.create()
        rotator.refresh()
        path = self.private_path()
        original = json.loads(path.read_text())
        for corrupt in ['version', 'key', 'expires_at']:
            ring = json.loads(json.dumps(original))
            if corrupt == 'version':
                ring['version'] = 99
            elif corrupt == 'key':
                import base64
                ring['current']['key'] = base64.b64encode(b'x' * 48).decode()
            else:
                ring['current']['expires_at'] += 1
            path.write_text(json.dumps(ring))
            restarted, second = self.create()
            with self.subTest(field=corrupt), self.assertRaises(ValueError):
                second.refresh()
            self.assertEqual(json.loads(path.read_text()), ring)

    def test_missing_public_file_restored_from_private_exact_payload(self):
        authority, rotator = self.create()
        rotator.refresh()
        original = self.public()
        (self.root / '_AIDIY/backend_taskteam/internal_auth.json').unlink()
        restarted, second = self.create()
        second.refresh()
        self.assertEqual(self.public(), original)
        self.verify(restarted, original['access_token'])

    def test_future_current_is_outside_valid_period_and_is_not_accepted(self):
        authority, rotator = self.create()
        rotator.refresh()
        future = self.token()
        self.now -= timedelta(minutes=10)
        restarted, second = self.create()
        second.refresh()
        self.assertNotEqual(self.token(), future)
        self.verify(restarted, self.token())
        with self.assertRaises(ValueError):
            self.verify(restarted, future)

    def test_two_rotators_crossing_three_commit_only_one_generation(self):
        from concurrent.futures import ThreadPoolExecutor
        first, first_rotator = self.create()
        first_rotator.refresh()
        second, second_rotator = self.create()
        second_rotator.refresh()
        old = self.token()
        self.now = START.replace(hour=3, minute=0)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda r: r.refresh(), [first_rotator, second_rotator]))
        self.assertEqual(sum(bool(result) for result in results), 1)
        new = self.token()
        self.assertNotEqual(old, new)
        for authority in (first, second):
            self.verify(authority, old)
            self.verify(authority, new)
        ring = json.loads(self.private_path().read_text())
        self.assertEqual(len(ring['previous']), 1)
        self.assertNotEqual(ring['current']['key'], ring['previous'][0]['key'])


    def test_private_commit_failure_preserves_files_and_installed_authority(self):
        authority, rotator = self.create()
        rotator.refresh()
        old_public = self.public()
        old_private = self.private_path().read_bytes()
        old_key = authority._key
        old_previous = authority._previous
        self.now = START.replace(hour=3, minute=0)
        with patch.object(auth, 'write_keyring_file', side_effect=OSError('fixture durable commit failed')):
            with self.assertRaises(OSError):
                rotator.refresh()
        self.assertEqual(self.public(), old_public)
        self.assertEqual(self.private_path().read_bytes(), old_private)
        self.assertEqual(authority._key, old_key)
        self.assertEqual(authority._previous, old_previous)
        self.verify(authority, old_public['access_token'])
        rotator.refresh()
        self.assertNotEqual(self.token(), old_public['access_token'])
        self.assertNotEqual(authority._key, old_key)
        self.verify(authority, old_public['access_token'])
        self.verify(authority, self.token())


    def test_dst_fallback_does_not_rotate_at_repeated_two_oclock(self):
        summer = timezone(timedelta(hours=2))
        winter = timezone(timedelta(hours=1))
        self.now = datetime(2026, 10, 24, 23, 0, tzinfo=summer)
        authority, rotator = self.create()
        rotator.refresh()
        old = self.token()
        self.now = datetime(2026, 10, 25, 2, 30, tzinfo=summer)
        rotator.refresh()
        self.assertEqual(self.token(), old)
        self.now = datetime(2026, 10, 25, 2, 30, tzinfo=winter)
        rotator.refresh()
        self.assertEqual(self.token(), old)
        self.now = datetime(2026, 10, 25, 3, 0, tzinfo=winter)
        rotator.refresh()
        new = self.token()
        self.assertNotEqual(new, old)
        self.verify(authority, old)
        self.verify(authority, new)
        self.now += timedelta(minutes=1)
        rotator.refresh()
        self.assertEqual(self.token(), new)


if __name__ == '__main__':
    unittest.main()
