"""Setup recovery uses isolated launchers and mocked network commands."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

diag = load('recovery_diag', 'frontend_diag/_setup.py')
pi = load('recovery_pi', 'command_pi/_setup.py')

class DiagRecovery(unittest.TestCase):
    def test_regular_launchers_always_replaced_and_links_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def directory(program):
                path = root / program
                path.mkdir(exist_ok=True)
                return path
            with patch.object(diag._path_helper, 'launcher_directory', side_effect=directory), patch.object(diag._path_helper, 'sync_shared_launcher'), patch.object(diag, 'ensure_launcher_path', return_value=True):
                for program in ('aidiy_diag', 'aidiy_memo'):
                    (directory(program)/program).write_bytes(b'foreign or invalid \xff')
                self.assertTrue(diag.setup(desktop=False))
                for program in ('aidiy_diag', 'aidiy_memo'):
                    self.assertIn(b'node', (directory(program)/program).read_bytes())
                path = directory('aidiy_diag')/'aidiy_diag'
                path.unlink()
                target = root/'unrelated'
                target.write_text('protected')
                path.symlink_to(target)
                self.assertFalse(diag.setup(desktop=False))
                self.assertEqual(target.read_text(), 'protected')

class PiRecovery(unittest.TestCase):
    def test_launcher_refreshes_existing_shared_pi(self):
        for platform in ('win32', 'linux'):
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                path = root/'checkout/bin'/('aidiy_pi.cmd' if platform == 'win32' else 'aidiy_pi')
                shared = root/'home/.local/bin'/path.name
                shared.parent.mkdir(parents=True)
                shared.write_bytes(b'other checkout or old format')
                with patch.object(pi.sys, 'platform', platform), patch.object(pi, 'launcher_path', return_value=path), patch.object(Path, 'home', return_value=root/'home'), patch.object(pi._path_helper, 'ensure_launcher_path', return_value=True), patch.object(pi.shutil, 'which', return_value='node'):
                    self.assertTrue(pi.install_standalone_launcher())
                    self.assertEqual(shared.read_bytes(), path.read_bytes())

    def test_transient_retry_success(self):
        with patch.object(pi, 'run_command', side_effect=[False, True]) as run, patch.object(pi.time, 'sleep') as sleep:
            self.assertTrue(pi.hydrate_model_data())
            self.assertEqual(run.call_count, 2)
            sleep.assert_called_once_with(2)
    def test_missing_data_stays_failed(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(pi, 'MODEL_DATA_DIR', Path(folder)/'missing'), patch.object(pi, 'run_command', return_value=False) as run, patch.object(pi.time, 'sleep'):
            self.assertFalse(pi.hydrate_model_data())
            self.assertEqual(run.call_count, 3)
    def test_existing_data_must_pass_validation(self):
        for valid in (True, False):
            with tempfile.TemporaryDirectory() as folder, patch.object(pi, 'MODEL_DATA_DIR', Path(folder)), patch.object(pi, 'run_command', side_effect=[False,False,False,valid]) as run, patch.object(pi.time, 'sleep'):
                self.assertEqual(pi.hydrate_model_data(), valid)
                self.assertEqual(run.call_args.args[0][-2:], ['run','check:model-data'])

if __name__ == '__main__': unittest.main()
