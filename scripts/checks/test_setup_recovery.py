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

    def test_full_setup_only_uses_npm_for_dependency_install(self):
        with patch.object(pi, 'check_project_node_runtime', return_value=(True, 'test node')), patch.object(pi.shutil, 'which', return_value='npm'), patch.object(pi, 'run_command', return_value=True) as run, patch.object(pi, 'hydrate_bundled_model_data', return_value=True) as bundle, patch.object(pi, 'install_standalone_launcher', return_value=True), patch.object(pi, 'verify_cli', return_value=True):
            self.assertTrue(pi.setup())
            bundle.assert_called_once_with()
            run.assert_called_once_with([pi.npm_command(), 'ci', '--ignore-scripts', '--no-fund', '--no-audit'], cwd=pi.PI_DIR)

    def test_setup_uses_bundle_without_online_generation(self):
        for success in (True, False):
            with patch.object(pi, 'hydrate_bundled_model_data', return_value=success) as bundle, patch.object(pi, 'run_command') as run:
                self.assertEqual(pi.hydrate_model_data(), success)
                bundle.assert_called_once_with()
                run.assert_not_called()

    def test_existing_data_does_not_bypass_bundled_validation(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(pi, 'MODEL_DATA_DIR', Path(folder)), patch.object(pi, 'hydrate_bundled_model_data', return_value=False), patch.object(pi, 'run_command') as run:
            self.assertFalse(pi.hydrate_model_data())
            run.assert_not_called()

if __name__ == '__main__': unittest.main()
