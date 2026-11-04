"""実サービス・実DB・実秘密を使わない03時鍵ライフサイクル試験。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import itertools
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jose import JWTError, jwt
from auth_keyring import CoreKeyring, KeyringError, NORMAL_TTL, ACTIVE_TTL

READ = '/core/AIコア/モデル情報/取得'
UTC = timezone.utc


def fixture_factory(prefix):
    sequence = itertools.count()
    return lambda: hashlib.sha256(f'fixture-only-{prefix}-{next(sequence)}'.encode()).hexdigest()


def process_issue(root, count, output):
    now = datetime(2050, 1, 1, 4, 0, tzinfo=UTC)
    store = CoreKeyring(root, clock=lambda: now, key_factory=fixture_factory('process-key'), kid_factory=fixture_factory('process-kid'))
    store.initialize()
    tokens = [store.issue_normal({'sub': 'same-fixture-user'}, timedelta(minutes=number + 1)) for number in range(count)]
    output.put(tokens)


class KeyringTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.now = datetime(2050, 1, 1, 2, 0, tzinfo=UTC)
        self.keys = Mock(side_effect=fixture_factory('key'))
        self.kids = Mock(side_effect=fixture_factory('kid'))
        self.store = self.new_store()

    def new_store(self, root=None):
        return CoreKeyring(root or self.root, clock=lambda: self.now, key_factory=self.keys, kid_factory=self.kids)

    def state(self):
        return json.loads(self.store.path.read_text())

    def internal(self):
        return json.loads(self.store.token_path.read_text())['access_token']

    def test_constructor_and_auth_import_do_not_create_keys_or_files(self):
        with patch('secrets.token_urlsafe', side_effect=AssertionError('No runtime key generation')):
            import auth
            importlib.reload(auth)
            auth.get_keyring()
        self.assertFalse(self.store.directory.exists())
        self.keys.assert_not_called()

    def test_start_stop_watcher_uses_fixture_store(self):
        self.store.start()
        self.store.stop()
        self.assertFalse(self.store._thread.is_alive())
        self.assertTrue(self.store.path.exists())

    def test_startup_reuses_valid_key_and_token_even_after_three(self):
        kid = self.store.initialize(); before = self.store.path.read_bytes(); token = self.internal()
        self.now += timedelta(hours=2)
        restarted = self.new_store()
        self.assertEqual(restarted.initialize(), kid)
        restarted.refresh()
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.internal(), token)
        self.assertEqual(self.keys.call_count, 2)

    def test_three_boundary_rotates_once_and_refresh_uses_new_key(self):
        initial = self.store.initialize(); internal = self.internal()
        self.now = self.now.replace(hour=2, minute=59, second=59)
        old = self.store.issue_normal({'sub': 'same-fixture-user'})
        old_exp = jwt.get_unverified_claims(old)['exp']
        self.now += timedelta(seconds=1)
        self.store.refresh(); new = self.state()['current']['kid']
        self.assertNotEqual(initial, new)
        self.store.refresh(); self.assertEqual(self.state()['current']['kid'], new)
        self.store.verify_normal(old); self.store.verify(internal, 'POST', READ)
        refreshed = self.store.issue_normal({'sub': self.store.verify_normal(old)['sub']})
        self.assertEqual(jwt.get_unverified_header(refreshed)['kid'], new)
        self.assertEqual(jwt.get_unverified_claims(old)['exp'], old_exp)
        self.assertEqual(jwt.get_unverified_claims(refreshed)['exp'] - jwt.get_unverified_claims(refreshed)['iat'], 36000)

    def test_expiry_fallback_retains_last_normal_exp_beyond_internal_exp(self):
        self.now = self.now.replace(hour=4)
        original = self.store.initialize(); old_internal = self.internal()
        self.now += timedelta(days=1, minutes=30)
        restarted = self.new_store(); self.assertEqual(restarted.initialize(), original)
        self.now = self.now.replace(hour=4, minute=59)
        normal = restarted.issue_normal({'sub': 'same-fixture-user'})
        self.now = self.now.replace(hour=5, minute=0)
        restarted.refresh()
        self.assertNotEqual(self.state()['current']['kid'], original)
        with self.assertRaises(JWTError): restarted.verify(old_internal, 'POST', READ)
        restarted.verify_normal(normal)
        self.now = self.now.replace(hour=14, minute=58)
        restarted.verify_normal(normal); restarted.refresh()
        self.assertTrue(self.state()['previous'])
        self.now = self.now.replace(hour=14, minute=59)
        with self.assertRaises(JWTError): restarted.verify_normal(normal)
        restarted.refresh(); self.assertEqual(self.state()['previous'], [])

    def test_startup_expired_key_rotates_and_forward_jump_prunes_old(self):
        first = self.store.initialize()
        self.now += timedelta(days=3)
        restarted = self.new_store(); self.assertNotEqual(restarted.initialize(), first)
        self.assertEqual(self.state()['previous'], [])
        self.assertEqual(len([self.state()['current'], *self.state()['previous']]), 1)

    def test_wall_clock_expired_persisted_generation_can_rotate(self):
        # 2050年固定の通常fixtureではjose内部の実時刻による期限切れを再現しない。
        self.now = datetime(2000, 1, 1, tzinfo=UTC)
        old_kid = self.store.initialize()
        old_token = self.internal()
        self.now = datetime.now(UTC)
        restarted = self.new_store()
        self.assertNotEqual(restarted.initialize(), old_kid)
        self.assertEqual(self.state()['previous'], [])
        restarted.verify(self.internal(), 'POST', READ)
        with self.assertRaises(JWTError):
            restarted.verify(old_token, 'POST', READ)

    def test_missing_or_wrong_persisted_time_claim_is_rejected(self):
        self.store.initialize()
        good = self.store.path.read_bytes()
        for field in ('iat', 'exp'):
            for missing in (True, False):
                state = json.loads(good)
                generation = state['current']
                claims = jwt.get_unverified_claims(generation['internal_token'])
                if missing:
                    claims.pop(field)
                else:
                    claims[field] += 1
                generation['internal_token'] = jwt.encode(claims, generation['internal_key'],
                    algorithm='HS256', headers={'kid': generation['kid']})
                self.store.path.write_text(json.dumps(state))
                with self.assertRaises(KeyringError):
                    self.new_store().initialize()

    def test_backward_clock_fails_closed_without_mutation(self):
        self.store.initialize(); before = self.store.path.read_bytes()
        self.now -= timedelta(hours=1)
        with self.assertRaises(KeyringError): self.store.refresh()
        self.assertEqual(self.store.path.read_bytes(), before)
        with self.assertRaises(KeyringError): self.new_store().initialize()
        self.assertEqual(self.keys.call_count, 2)

    def test_dst_offset_change_before_three_does_not_rotate(self):
        self.now = datetime(2050, 10, 30, 23, tzinfo=timezone(timedelta(hours=2)))
        kid = self.store.initialize()
        self.now = datetime(2050, 10, 31, 2, 59, tzinfo=timezone(timedelta(hours=2)))
        self.store.refresh()
        self.now = datetime(2050, 10, 31, 2, 1, tzinfo=timezone(timedelta(hours=1)))
        self.store.refresh()
        self.assertEqual(self.state()['current']['kid'], kid)
        self.now = self.now.replace(hour=3, minute=0)
        self.store.refresh(); self.assertNotEqual(self.state()['current']['kid'], kid)

    def test_crash_between_files_recovers_same_token_without_new_generation(self):
        real_write = self.store._atomic_write
        def failure(target, value):
            if target == self.store.token_path: raise OSError('synthetic token publication failure')
            return real_write(target, value)
        with patch.object(self.store, '_atomic_write', side_effect=failure):
            with self.assertRaises(OSError): self.store.initialize()
        kid = self.state()['current']['kid']; token = self.state()['current']['internal_token']
        self.assertFalse(self.store.token_path.exists())
        restarted = self.new_store(); self.assertEqual(restarted.initialize(), kid)
        self.assertEqual(self.internal(), token); self.assertEqual(self.keys.call_count, 2)
        self.store.token_path.write_text('stale-client-fixture')
        restarted.refresh(); self.assertEqual(self.internal(), token)

    def test_failed_rotation_does_not_discard_last_good_state(self):
        self.store.initialize(); before = self.store.path.read_bytes(); token = self.internal()
        self.now = self.now.replace(hour=3)
        with patch.object(self.store, '_atomic_write', side_effect=OSError('synthetic')):
            with self.assertRaises(OSError): self.store.refresh()
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.internal(), token)
        self.store.refresh(); self.assertNotEqual(self.internal(), token)

    def test_malformed_keyring_and_corrupt_persisted_token_fail_closed(self):
        self.store.initialize()
        good = self.store.path.read_bytes()
        malformed = json.loads(good); malformed['current']['internal_token'] = 'fake-corrupt-token'
        for payload in ('{broken', json.dumps(malformed), json.dumps({'version': 1, 'previous': []})):
            self.store.path.write_text(payload)
            calls = self.keys.call_count
            with self.assertRaises(KeyringError): self.new_store().initialize()
            self.assertEqual(self.store.path.read_text(), payload)
            self.assertEqual(self.keys.call_count, calls)
        self.store.path.write_bytes(good)

    def test_two_installations_same_user_are_isolated_and_public_legacy_rejected(self):
        self.store.initialize(); token_a = self.store.issue_normal({'sub': 'same-fixture-user'})
        with tempfile.TemporaryDirectory() as other:
            b = self.new_store(Path(other)); b.initialize()
            token_b = b.issue_normal({'sub': 'same-fixture-user'})
            with self.assertRaises(JWTError): b.verify_normal(token_a)
            with self.assertRaises(JWTError): self.store.verify_normal(token_b)
        legacy = jwt.encode({'sub': 'same-fixture-user', 'exp': int((self.now + NORMAL_TTL).timestamp())},
                            'dummy-secret-key-for-development', algorithm='HS256')
        with self.assertRaises(JWTError): self.store.verify_normal(legacy)
        claims = jwt.get_unverified_claims(token_a)
        fixed_with_kid = jwt.encode(claims, 'dummy-secret-key-for-development', algorithm='HS256',
                                    headers=jwt.get_unverified_header(token_a))
        with self.assertRaises(JWTError): self.store.verify_normal(fixed_with_kid)

    def test_apps_readonly_verify_never_creates_or_rotates(self):
        apps = self.new_store()
        with self.assertRaises((KeyringError, JWTError)): apps.verify_normal('fake-invalid')
        self.assertFalse(self.store.directory.exists())
        probe = jwt.encode({'sub': 'fixture', 'exp': int((self.now + NORMAL_TTL).timestamp())},
                           'fixture-only-key', algorithm='HS256', headers={'kid': 'fixture-coldstart-kid'})
        with self.assertRaises(KeyringError): apps.verify_normal(probe)
        self.assertFalse(self.store.directory.exists())
        self.store.initialize(); normal = self.store.issue_normal({'sub': 'same-fixture-user'})
        before = self.store.path.read_bytes()
        with patch.object(apps, '_atomic_write', side_effect=AssertionError('Apps must not write')):
            apps.verify_normal(normal)
        self.assertEqual(self.store.path.read_bytes(), before)

    def test_internal_normal_separation_scope_and_ttl_bound(self):
        self.store.initialize(); internal = self.internal(); normal = self.store.issue_normal({'sub': 'same-fixture-user'})
        with self.assertRaises(JWTError): self.store.verify_normal(internal)
        with self.assertRaises(JWTError): self.store.verify(normal, 'POST', READ)
        self.store.verify(internal, 'POST', '/core/C利用者/登録')
        with self.assertRaises(ValueError): self.store.issue_normal({'sub': 'same-fixture-user'}, timedelta(days=30))
        self.now += NORMAL_TTL
        with self.assertRaises(JWTError): self.store.verify_normal(normal)
        self.store.verify(internal, 'POST', READ)
        self.now += ACTIVE_TTL - NORMAL_TTL
        with self.assertRaises(JWTError): self.store.verify(internal, 'POST', READ)

    def test_thread_concurrent_rotation_and_issuance_preserve_all_expiries(self):
        self.store.initialize(); others = [self.new_store() for _ in range(5)]
        for store in others: store.initialize()
        self.now = self.now.replace(hour=3)
        def work(index):
            store = others[index]; store.refresh()
            return store.issue_normal({'sub': 'same-fixture-user'}, timedelta(minutes=index + 1))
        with ThreadPoolExecutor(max_workers=5) as pool: tokens = list(pool.map(work, range(5)))
        self.assertEqual(len({jwt.get_unverified_header(token)['kid'] for token in tokens}), 1)
        self.assertEqual(len(self.state()['previous']), 1)
        for token in tokens: self.store.verify_normal(token)
        self.assertEqual(self.state()['current']['normal_expires_at'], max(jwt.get_unverified_claims(t)['exp'] for t in tokens))

    @unittest.skipIf(os.name == 'nt', 'Separate POSIX process-lock fixture; Windows locking reviewed separately')
    def test_process_concurrent_issue_uses_same_key_and_retains_max(self):
        self.now = self.now.replace(hour=4); self.store.initialize()
        context = multiprocessing.get_context('fork'); output = context.Queue()
        processes = [context.Process(target=process_issue, args=(str(self.root), count, output)) for count in (2, 4, 6)]
        for process in processes: process.start()
        tokens = [token for _ in processes for token in output.get(timeout=10)]
        for process in processes:
            process.join(timeout=10); self.assertEqual(process.exitcode, 0)
        self.assertEqual(len({jwt.get_unverified_header(token)['kid'] for token in tokens}), 1)
        for token in tokens: self.store.verify_normal(token)
        self.assertEqual(self.state()['current']['normal_expires_at'], int((self.now + timedelta(minutes=6)).timestamp()))
        output.close()

    def test_private_permissions_and_no_signing_keys_in_client_file(self):
        self.store.initialize(); state = self.state(); client = self.store.token_path.read_text()
        for field in ('normal_key', 'internal_key'):
            self.assertNotIn(state['current'][field], client); self.assertNotIn(field, client)
        self.assertEqual(set(json.loads(client)), {'access_token', 'token_type', 'issued_at', 'expires_at'})
        if os.name != 'nt':
            for path in (self.store.path, self.store.token_path, self.store.lock_path):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.store.directory.glob('*.tmp')), [])

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_symlink_private_path_rejected(self):
        (self.root / '_AIDIY').symlink_to(self.root)
        with self.assertRaises(KeyringError): self.store.initialize()
        self.keys.assert_not_called()


if __name__ == '__main__': unittest.main()
