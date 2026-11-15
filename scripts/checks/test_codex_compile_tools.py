"""Codex の不足ツール導入。実ネットワーク・インストーラーは実行しない。"""
import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load(relative):
    spec = importlib.util.spec_from_file_location('test_compile_tools_' + Path(relative).stem, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

compile = load('command_codex/_compile.py')
helper = load('command_codex/aidiy/setup_tools.py')

class BootstrapTests(unittest.TestCase):
    def test_compile_leaves_parallelism_to_cargo_unless_explicit(self):
        for jobs in (None, 2):
            with self.subTest(jobs=jobs), \
                 patch.object(compile, 'ensure_prerequisites', return_value=({'PATH': ''}, None)), \
                 patch.object(compile.shutil, 'which', return_value=None), \
                 patch.object(compile, 'prepare_install', return_value=True), \
                 patch.object(compile, 'run', return_value=False) as run, \
                 contextlib.redirect_stdout(io.StringIO()):
                compile.compile_codex(jobs=jobs)
                command = run.call_args.args[0]
                if jobs is None:
                    self.assertNotIn('--jobs', command)
                else:
                    self.assertEqual(command[-2:], ['--jobs', '2'])

    def prepare(self, **values):
        defaults = dict(IS_WINDOWS=False, find_cargo_bin=lambda: None,
                        free_gb=lambda _: 30, check_prerequisites=lambda: ({'PATH':'test'}, None))
        defaults.update(values)
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        for key, value in defaults.items():
            stack.enter_context(patch.object(compile, key, value))
        stack.enter_context(patch.object(compile.shutil, 'which', return_value='/usr/bin/tool'))
        fake = types.SimpleNamespace(install_unix_rust=unittest.mock.Mock(), install_windows_tool=unittest.mock.Mock())
        stack.enter_context(patch.object(compile.importlib.util, 'module_from_spec', return_value=fake))
        stack.enter_context(patch.object(compile.importlib.util, 'spec_from_file_location', return_value=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda _: None))))
        return fake

    def test_missing_unix_rust_installed_once_then_rechecked(self):
        fake = self.prepare()
        self.assertIsNotNone(compile.ensure_prerequisites()[0])
        fake.install_unix_rust.assert_called_once_with()
        fake.install_windows_tool.assert_not_called()

    def test_existing_tools_never_reinstalled(self):
        fake = self.prepare(find_cargo_bin=lambda: Path('/some/bin'))
        self.assertIsNotNone(compile.ensure_prerequisites()[0])
        fake.install_unix_rust.assert_not_called()

    def test_windows_only_missing_llvm_installed(self):
        fake = self.prepare(IS_WINDOWS=True, find_cargo_bin=lambda: Path('C:/cargo'),
                            find_llvm_mingw_bin=lambda _: None)
        self.assertIsNotNone(compile.ensure_prerequisites()[0])
        fake.install_windows_tool.assert_called_once_with('llvm-mingw')

    def test_windows_both_installed(self):
        fake = self.prepare(IS_WINDOWS=True, find_llvm_mingw_bin=lambda _: None)
        compile.ensure_prerequisites()
        self.assertEqual(fake.install_windows_tool.call_args_list, [unittest.mock.call('rust'), unittest.mock.call('llvm-mingw')])

    def test_low_disk_stops_before_download(self):
        fake = self.prepare(free_gb=lambda _: 4)
        self.assertEqual(compile.ensure_prerequisites(), (None, None))
        fake.install_unix_rust.assert_not_called()

    def test_failure_does_not_continue(self):
        fake = self.prepare()
        fake.install_unix_rust.side_effect = RuntimeError('checksum failed')
        self.assertEqual(compile.ensure_prerequisites(), (None, None))

    def test_native_compiler_missing_no_install(self):
        fake = self.prepare()
        with patch.object(compile.shutil, 'which', return_value=None):
            self.assertEqual(compile.ensure_prerequisites(), (None, None))
        fake.install_unix_rust.assert_not_called()

    def test_macos_stub_is_not_developer_tools(self):
        fake = self.prepare()
        with patch.object(compile.sys, 'platform', 'darwin'), patch.object(compile.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1, stdout='')):
            self.assertEqual(compile.ensure_prerequisites(), (None, None))
        fake.install_unix_rust.assert_not_called()

    def test_check_does_not_bootstrap(self):
        with patch.object(compile.sys, 'argv', ['_compile.py', '--check']), patch.object(compile, 'check_prerequisites', return_value=({}, None)), patch.object(compile, 'ensure_prerequisites') as install, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                compile.main()
            self.assertEqual(error.exception.code, 0)
            install.assert_not_called()

class ObjectPlacementTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(compile, 'INSTALL_DIR', self.root))
        self.enterContext(patch.object(compile, 'EXE', '.exe'))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.built = self.root / 'codex.exe'
        self.built.write_bytes(b'new executable')
        self.output = self.root / 'aidiy_codex.exe'
        self.output.write_bytes(b'old executable')
        self.staged = self.root / 'aidiy_codex_temp.exe'

    def test_success_replaces_existing_binary_after_staging(self):
        replace = compile.os.replace
        seen = []

        def observe(source, output):
            if output == self.output:
                self.assertEqual(source, self.staged)
                self.assertEqual(source.read_bytes(), b'new executable')
                self.assertEqual(output.read_bytes(), b'old executable')
                seen.append(True)
            replace(source, output)

        with patch.object(compile.os, 'replace', side_effect=observe):
            self.assertEqual(compile.install_object(self.built), self.output)
        self.assertEqual(seen, [True])
        self.assertEqual(self.output.read_bytes(), b'new executable')
        self.assertFalse(self.staged.exists())

    def test_locked_binary_keeps_completed_staging_file(self):
        replace = compile.os.replace

        def locked(source, output):
            if output == self.output:
                raise PermissionError('in use')
            replace(source, output)

        with patch.object(compile.os, 'replace', side_effect=locked):
            self.assertIsNone(compile.install_object(self.built))
        self.assertEqual(self.output.read_bytes(), b'old executable')
        self.assertEqual(self.staged.read_bytes(), b'new executable')

    def test_failed_generation_does_not_publish_partial_file(self):
        self.staged.write_bytes(b'previous complete executable')

        def partial_copy(source, output):
            output.write_bytes(b'partial')
            raise OSError('disk full')

        with patch.object(compile.shutil, 'copy2', side_effect=partial_copy):
            self.assertIsNone(compile.install_object(self.built))
        self.assertEqual(self.output.read_bytes(), b'old executable')
        self.assertEqual(self.staged.read_bytes(), b'previous complete executable')
        self.assertEqual(list(self.root.glob('*.tmp')), [])

class InstallerTests(unittest.TestCase):
    def test_custom_home_protected(self):
        with patch.dict(helper.os.environ, {'CARGO_HOME':'custom'}), patch.object(helper, 'download_verified') as download:
            with self.assertRaisesRegex(RuntimeError, 'CARGO_HOME'):
                helper.install_unix_rust()
            download.assert_not_called()

    def test_existing_cargo_protected(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(helper.os.environ, {}, clear=True), patch.object(helper.Path, 'home', return_value=Path(directory)), patch.object(helper, 'download_verified') as download:
            (Path(directory)/'.cargo').mkdir()
            with self.assertRaisesRegex(RuntimeError, '既に'):
                helper.install_unix_rust()
            download.assert_not_called()

    def test_checksum_before_execution(self):
        binary=b'installer'
        for digest, succeeds in [(hashlib.sha256(binary).hexdigest(), True), ('0'*64, False)]:
            with tempfile.TemporaryDirectory() as directory:
                target=Path(directory)/'installer'
                opener=types.SimpleNamespace(open=unittest.mock.Mock(side_effect=[io.BytesIO((digest+'  file').encode()),io.BytesIO(binary)]))
                with patch.object(helper.urllib.request, 'build_opener', return_value=opener):
                    if succeeds:
                        helper.download_verified(helper.STATIC_ORIGIN+'rustup/archive/file',target)
                        self.assertEqual(target.read_bytes(),binary)
                    else:
                        with self.assertRaisesRegex(RuntimeError,'一致'):
                            helper.download_verified(helper.STATIC_ORIGIN+'rustup/archive/file',target)

    def test_no_non_official_download_or_redirect(self):
        with self.assertRaises(RuntimeError):
            helper.download_verified('https://evil.invalid/file', Path('unused'))
        with self.assertRaises(RuntimeError):
            helper.OfficialRedirect().redirect_request(None,None,302,'',{},'http://static.rust-lang.org/file')

    def test_no_api_credentials_or_mirror_in_installer_environment(self):
        with patch.dict(helper.os.environ, {'SECRET_API_KEY':'hidden','RUSTUP_DIST_SERVER':'https://evil.invalid','CARGO_HOME':'custom','HOME':'home'}, clear=True):
            env=helper.tool_environment()
            self.assertEqual(env['HOME'],'home')
            self.assertNotIn('SECRET_API_KEY',env)
            self.assertNotIn('RUSTUP_DIST_SERVER',env)

    def test_windows_uses_inner_tree_aware_deadlines(self):
        with patch.object(helper.shutil, 'which', return_value='node'), patch.object(helper.subprocess, 'run') as run:
            helper.install_windows_tool('rust')
            self.assertNotIn('timeout',run.call_args.kwargs)

    def test_supported_hosts(self):
        with patch.object(helper.platform,'libc_ver',return_value=('glibc','2.35')):
            self.assertEqual(helper.rust_host('Linux','x86_64'),'x86_64-unknown-linux-gnu')
            self.assertEqual(helper.rust_host('Darwin','arm64'),'aarch64-apple-darwin')
            with self.assertRaises(RuntimeError): helper.rust_host('Linux','unknown')

if __name__ == '__main__': unittest.main()
