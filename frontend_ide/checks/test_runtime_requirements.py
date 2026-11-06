# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""フロントエンドの実要件と起動方式を外部実行なしで検証する。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import _runtime_requirements as runtime


def load(path):
    spec = importlib.util.spec_from_file_location('runtime_' + path.replace('/', '_'), ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrontendRequirementsTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_metadata_retains_different_runtime_requirements(self):
        cases = (
            ('frontend_web', 'vite', '20.19.0', True),
            ('frontend_web', 'vite', '21.9.0', False),
            ('frontend_web', 'vite', '22.11.0', False),
            ('frontend_avatar', 'electron', '20.19.0', False),
            ('frontend_avatar', 'electron', '22.12.0', True),
            ('frontend_channels/discord', None, '22.11.0', False),
            ('frontend_channels/discord', None, '22.12.0', True),
            ('frontend_ide/viewer', None, '22.12.0', False),
            ('frontend_ide/viewer', None, '22.13.0', True),
        )
        for folder, dependency, version, expected in cases:
            with self.subTest(folder=folder, version=version):
                requirement = runtime.project_node_requirement(ROOT / folder, dependency=dependency)
                self.assertEqual(runtime.version_satisfies(version, requirement), expected)
        for folder in ('frontend_ide/host', 'frontend_ide/host/aidiy_live'):
            package = json.loads((ROOT / folder / 'package.json').read_text(encoding='utf-8'))
            self.assertEqual(package['engines']['vscode'], '^1.106.0')
        for folder in ('frontend_web', 'frontend_avatar', 'frontend_channels/discord', 'frontend_ide'):
            package = json.loads((ROOT / folder / 'package.json').read_text(encoding='utf-8'))
            self.assertTrue(package['dependencies']['vue'].lstrip('^~').startswith('3.'))

    def test_unavailable_node_stops_setups_before_install(self):
        for folder in ('frontend_web', 'frontend_avatar', 'frontend_channels/discord', 'frontend_ide/host', 'frontend_ide/viewer', 'frontend_ide'):
            with self.subTest(folder=folder):
                module = load(folder + '/_setup.py')
                with patch.object(module, 'check_project_node_runtime', return_value=(False, 'Node command failed')), \
                        patch.object(module.subprocess, 'run') as run, contextlib.ExitStack() as mocks:
                    if folder == 'frontend_channels/discord':
                        mocks.enter_context(patch.object(module, '_discord_in_use', return_value=False))
                    if hasattr(module, 'run_command'):
                        mocks.enter_context(patch.object(module, 'run_command', side_effect=AssertionError('must not install')))
                    self.assertFalse(module.prepare() if folder == 'frontend_ide' else module.setup())
                    run.assert_not_called()

    def test_node_failure_is_preserved_by_start_preflight(self):
        for folder in ('frontend_web', 'frontend_avatar', 'frontend_channels/discord', 'frontend_ide/host'):
            module = load(folder + '/_start.py')
            with self.subTest(folder=folder), patch.object(module, 'check_project_node_runtime', return_value=(False, 'Node command failed')), \
                    patch.object(module.subprocess, 'Popen') as spawn:
                self.assertEqual(module.check_environment(*(['code'] if folder.endswith('/host') else [])), (False, 'Node command failed'))
                if hasattr(module, 'launch_command'):
                    with self.assertRaisesRegex(RuntimeError, 'Node command failed'):
                        module.launch_command(*(['code'] if folder.endswith('/host') else []))
                spawn.assert_not_called()

    def test_wrappers_share_node_preflight_and_keep_setup_guidance(self):
        for kind in ('console', 'task', 'team', 'browser'):
            module = load(f'frontend_ide/aidiy_{kind}/_start.py')
            with self.subTest(kind=kind), patch.object(module.shared, 'check_node_environment', return_value=(False, 'viewer Node requirement')):
                self.assertEqual(module.check_environment(), (False, 'viewer Node requirement'))

    def test_viewer_direct_start_stops_before_log_creation(self):
        module = load('frontend_ide/viewer/_start.py')
        with patch.object(module, 'check_node_environment', return_value=(False, 'viewer Node requirement')), \
                patch.object(Path, 'mkdir') as mkdir, patch.object(module.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(RuntimeError, 'viewer Node requirement'):
                module.start()
            mkdir.assert_not_called()
            spawn.assert_not_called()

    def test_failed_vscode_command_does_not_remove_existing_extensions(self):
        module = load('frontend_ide/host/_setup.py')
        with patch.object(module, 'check_vscode_runtime', return_value=(False, 'VS Code command failed')), \
                patch.object(module, 'uninstall_aidiy_extensions') as uninstall, patch.object(module, 'run_command') as run:
            self.assertFalse(module.install_extensions('code'))
            uninstall.assert_not_called()
            run.assert_not_called()

    def test_absent_vscode_keeps_standalone_setup(self):
        module = load('frontend_ide/host/_setup.py')
        with patch.object(module, 'find_vscode_cli', return_value=None), \
                patch.object(module, 'run_command', return_value=True) as run, \
                patch.object(module, 'install_extensions') as install, \
                patch.object(module, 'install_standalone_launcher', return_value=True):
            self.assertTrue(module.setup_assets('npm'))
            run.assert_called_once_with(['npm', 'run', 'compile'], cwd=module.FRONTEND_VSCODE_DIR)
            install.assert_not_called()

    def test_old_vscode_warning_keeps_existing_extension_install_flow(self):
        module = load('frontend_ide/host/_setup.py')
        with patch.object(module, 'check_vscode_runtime', return_value=(True, '[WARN] VS Code old')), \
                patch.object(module, 'get_extension_metadata', side_effect=[('aidiy.code', '0.1.0', Path('/fixture/code.vsix')), ('aidiy.live', '0.1.0', Path('/fixture/live.vsix'))]), \
                patch.object(Path, 'is_file', return_value=True), \
                patch.object(module, 'uninstall_aidiy_extensions', return_value=(True, 0)) as uninstall, \
                patch.object(module, 'run_command', return_value=True) as run, \
                patch.object(module, 'get_installed_extensions', return_value={'aidiy.code@0.1.0', 'aidiy.live@0.1.0'}), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertTrue(module.install_extensions('code'))
            uninstall.assert_called_once()
            self.assertEqual(run.call_count, 2)
            self.assertIn('[WARN] VS Code old', output.getvalue())

    def test_node_version_warning_allows_direct_launchers(self):
        for folder in ('frontend_avatar', 'frontend_channels/discord', 'frontend_ide/host'):
            module = load(folder + '/_start.py')
            with self.subTest(folder=folder), patch.object(module, 'check_project_node_runtime', return_value=(True, '[WARN] Node old')), \
                    patch.object(module.shutil, 'which', return_value='node'), contextlib.redirect_stdout(io.StringIO()) as output:
                command = module.launch_command(*(['code'] if folder.endswith('/host') else []))
                self.assertEqual(command[0], 'node')
                self.assertIn('[WARN] Node old', output.getvalue())

    def test_node_version_warning_does_not_abort_dependency_preparation(self):
        for folder in ('frontend_web', 'frontend_avatar', 'frontend_ide/host'):
            module = load(folder + '/_setup.py')
            with self.subTest(folder=folder), patch.object(module, 'check_project_node_runtime', return_value=(True, '[WARN] Node old')), \
                    patch.object(module, 'run_command', return_value=True), contextlib.ExitStack() as mocks:
                if hasattr(module, 'check_npm_installed'):
                    mocks.enter_context(patch.object(module, 'check_npm_installed', return_value=True))
                if folder == 'frontend_web':
                    self.assertTrue(module.setup())
                else:
                    mocks.enter_context(patch.object(module.shutil, 'which', return_value='npm'))
                    dependencies = mocks.enter_context(patch.object(module, 'setup_dependencies', return_value=False))
                    self.assertFalse(module.setup())
                    dependencies.assert_called_once()

    def test_host_missing_electron_allows_existing_web_fallback(self):
        module = load('frontend_ide/host/_start.py')
        import _setup_electron as electron
        with patch.object(module, 'check_project_node_runtime', return_value=(True, 'Node')), \
                patch.object(module.shutil, 'which', return_value='node'), patch.object(Path, 'is_file', return_value=True), \
                patch.object(electron, 'electron_binary_ready', return_value=False):
            for kind in ('code', 'live'):
                ok, detail = module.check_environment(kind)
                self.assertTrue(ok)
                self.assertIn('Web', detail)

    def test_discord_check_does_not_require_electron_to_validate_web_mode(self):
        module = load('frontend_channels/discord/_start.py')
        import _setup_electron as electron
        with patch.object(module, 'check_project_node_runtime', return_value=(True, 'Node')), \
                patch.object(module.shutil, 'which', return_value='node'), patch.object(Path, 'is_file', return_value=True), \
                patch.object(electron, 'electron_binary_ready', return_value=False), \
                patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            ok, detail = module.check_environment()
            self.assertTrue(ok)
            self.assertIn('Web', detail)
            self.assertEqual(run.call_args.args[0][-1], '--check')

    def test_browser_requires_electron_from_either_supported_location(self):
        module = load('frontend_ide/aidiy_browser/_start.py')
        import _setup_electron as electron
        for results in ((False, False), (False, True), (True, False)):
            with self.subTest(results=results), patch.object(module.shared, 'check_node_environment', return_value=(True, 'Node')), \
                    patch.object(Path, 'is_file', return_value=True), patch.object(electron, 'electron_binary_ready', side_effect=results):
                ok, detail = module.check_environment()
                self.assertEqual(ok, any(results))
                if not ok:
                    self.assertIn('Electron', detail)
                    self.assertIn('_setup.py', detail)

    def test_nonempty_node_modules_without_vue_is_not_ready(self):
        for kind in ('web', 'avatar'):
            module = load(f'frontend_{kind}/_start.py')
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                (root / 'package.json').write_text('{}', encoding='utf-8')
                (root / 'node_modules/unrelated').mkdir(parents=True)
                ok, detail = module.check_npm_project_environment(root)
                self.assertFalse(ok)
                self.assertIn('vue', detail)
                self.assertIn('_setup.py', detail)
                for name in ('vue', 'vite'):
                    package = root / 'node_modules' / name
                    package.mkdir()
                    (package / 'package.json').write_text('{}', encoding='utf-8')
                self.assertTrue(module.check_npm_project_environment(root)[0])


if __name__ == '__main__':
    unittest.main()
