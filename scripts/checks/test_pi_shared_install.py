"""Pi shared launcher fresh install / cwd-independent registration."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
setup = load('pi_shared_setup', 'command_pi/_setup.py')
cleanup = load('pi_shared_cleanup', 'command_pi/_cleanup.py')
class PiSharedInstall(unittest.TestCase):
    def test_fresh_install_repeat_and_cleanup(self):
        for platform in ('win32', 'linux'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as folder:
                home = Path(folder)/'home'; home.mkdir()
                path = Path(folder)/'checkout/_AIDIY/aidiy_pi/bin'/('aidiy_pi.cmd' if platform == 'win32' else 'aidiy_pi')
                shared = home/'.local/bin'/path.name
                with patch.object(Path, 'home', return_value=home), patch.object(setup.sys, 'platform', platform), patch.object(setup, 'launcher_path', return_value=path), patch.object(setup.shutil, 'which', return_value='node'), patch.object(setup._path_helper, 'ensure_launcher_path', return_value=True) as ensure:
                    for _ in range(2):
                        self.assertTrue(setup.install_standalone_launcher())
                        self.assertEqual(shared.read_bytes(), path.read_bytes())
                    self.assertIn((shared.parent,), [c.args for c in ensure.call_args_list])
                    text = shared.read_text()
                    self.assertNotIn('pushd ', text)
                    self.assertNotIn('cd /d ', text)
                    with patch.object(cleanup, 'launcher_path', return_value=path), patch.object(cleanup._path_helper, 'remove_launcher_path', return_value=True):
                        self.assertTrue(cleanup.remove_launcher('Pi'))
                        self.assertFalse(shared.exists())
    def test_link_parent_is_not_followed_on_new_install(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)/'home'; home.mkdir()
            outside = Path(folder)/'outside'; outside.mkdir()
            (home/'.local').symlink_to(outside, target_is_directory=True)
            source = Path(folder)/'aidiy_pi'; source.write_text('test')
            with patch.object(Path, 'home', return_value=home):
                with self.assertRaises(OSError): setup._path_helper.sync_shared_launcher(source, setup.ENTRY_PATH, create=True)
            self.assertEqual(list(outside.iterdir()), [])
    def test_cleanup_preserves_foreign_shared(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder); shared=home/'.local/bin/aidiy_pi'; shared.parent.mkdir(parents=True); shared.write_text('foreign')
            with patch.object(Path, 'home', return_value=home), patch.object(cleanup, 'launcher_path', return_value=home/'project/bin/aidiy_pi'), patch.object(cleanup._path_helper, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_launcher('Pi'))
            self.assertEqual(shared.read_text(), 'foreign')
if __name__ == '__main__': unittest.main()
