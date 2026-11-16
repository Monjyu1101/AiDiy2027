"""Offline generation uses the pinned official catalog, not a fabricated model list."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pi_bundled_test', ROOT / 'command_pi/_setup.py')
pi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pi)

class CatalogTests(unittest.TestCase):
    def test_pinned_bytes_match(self):
        data = gzip.decompress((pi.PI_DIR/'aidiy/assets/model-catalog.json.gz').read_bytes())
        self.assertEqual('sha256-'+hashlib.sha256(data).hexdigest(), pi.BUNDLED_MODEL_REVISION)
        self.assertEqual(json.loads((pi.PI_DIR/'nix/model-catalog.json').read_text())['revision'], pi.BUNDLED_MODEL_REVISION)

    def fixture(self):
        temporary = self.enterContext(tempfile.TemporaryDirectory())
        root = Path(temporary)
        for folder in ('nix', 'aidiy/assets', 'packages/ai/scripts', 'packages/ai/src'):
            shutil.copytree(pi.PI_DIR/folder, root/folder, ignore=shutil.ignore_patterns('data', 'node_modules'))
        return root

    @unittest.skipUnless(shutil.which('node'), 'Node required for real offline hydration')
    def test_new_checkout_without_cache_and_all_network_generation_failures(self):
        root = self.fixture()
        data = root/'packages/ai/src/providers/data'
        self.assertFalse(data.exists())
        original_run = pi.run_command
        calls = []
        def run(command, cwd=None):
            calls.append(command)
            if command[1:] == ['run','hydrate:model-data']:
                return False  # models.dev and every online generation attempt unavailable
            self.assertEqual(command[0], shutil.which('node'))
            self.assertIn(Path(command[1]).name, ('hydrate-model-catalog.ts','check-model-data.ts'))
            return original_run(command,cwd)
        with patch.object(pi,'PI_DIR',root), patch.object(pi,'MODEL_DATA_DIR',data), patch.object(pi,'run_command',side_effect=run), patch.object(pi.time,'sleep'):
            self.assertTrue(pi.hydrate_model_data())
        self.assertEqual(len(calls),5)
        self.assertTrue((data/'.manifest.json').is_file())
        subprocess.run([shutil.which('node'), str(root/'packages/ai/scripts/check-model-data.ts')], check=True)

    def test_corrupt_bundle_and_mismatched_pin_do_not_run_generator(self):
        root=self.fixture()
        for case in ('pin','archive','hash'):
            with self.subTest(case=case):
                (root/'nix/model-catalog.json').write_text(json.dumps({'revision': 'other' if case=='pin' else pi.BUNDLED_MODEL_REVISION}))
                if case=='archive': (root/'aidiy/assets/model-catalog.json.gz').write_bytes(b'bad gzip')
                if case=='hash': (root/'aidiy/assets/model-catalog.json.gz').write_bytes(gzip.compress(b'{}'))
                with patch.object(pi,'PI_DIR',root), patch.object(pi,'run_command') as run:
                    self.assertFalse(pi.hydrate_bundled_model_data())
                run.assert_not_called()

    def test_failed_hydration_or_validation_is_not_success(self):
        for responses in ([False], [True,False]):
            with patch.object(pi,'run_command',side_effect=responses):
                self.assertFalse(pi.hydrate_bundled_model_data())

if __name__=='__main__': unittest.main()
