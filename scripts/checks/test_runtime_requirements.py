# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""版数範囲・metadata・有限時間の確認。導入/削除/実アプリ起動は行わない。"""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_requirements_fixture', ROOT / 'scripts/_runtime_requirements.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeRequirementTests(unittest.TestCase):
    def test_vite_disjunction_does_not_accept_node21_or_old_patches(self):
        for version, expected in [('20.18.9', False), ('20.19.0', True), ('20.20.0', True),
                                  ('21.7.0', False), ('22.11.9', False), ('22.12.0', True), ('24.0.0', True)]:
            with self.subTest(version=version):
                self.assertEqual(runtime.version_satisfies(version, '^20.19.0 || >=22.12.0'), expected)

    def test_python_node_and_vscode_ranges(self):
        for version, requirement, expected in [('3.12.9', '>=3.13', False), ('3.13.0', '>=3.13', True),
                ('22.12.0', '>=22.13', False), ('22.13.0', '>=22.13', True),
                ('1.105.0', '^1.106.0', False), ('1.106.0', '^1.106.0', True), ('2.0.0', '^1.106.0', False),
                ('3.13.5', '>=3.13, <3.14', True), ('0.3.0', '^0.2.0', False), ('1.3.0', '~1.2.0', False)]:
            with self.subTest(version=version, requirement=requirement):
                self.assertEqual(runtime.version_satisfies(version, requirement), expected)

    def test_unknown_ranges_and_unstable_versions_are_not_assumed_supported(self):
        for requirement in ['latest', '>=22 ||', '>=22 foo', '22.x']:
            with self.subTest(requirement=requirement), self.assertRaises(ValueError):
                runtime.version_satisfies('22.13.0', requirement)
        for value in ['v22.13.0-rc.1', 'Python 3.13.0rc1', 'broken']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.version_satisfies(value, '>=1')

    def test_metadata_is_project_scoped_and_dependency_falls_back_to_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'pyproject.toml').write_text('[project]\nname="fixture"\nrequires-python=">=3.13"\n[tool.x]\nrequires-python=">=9"\n')
            self.assertEqual(runtime.python_requirement(root), '>=3.13')
            (root / 'package.json').write_text('{"engines":{"node":">=22.13"}}')
            self.assertEqual(runtime.project_node_requirement(root), '>=22.13')
            (root / 'package-lock.json').write_text(json.dumps({'packages': {'node_modules/vite': {'engines': {'node': '^20.19.0 || >=22.12.0'}}}}))
            self.assertEqual(runtime.project_node_requirement(root, 'vite'), '^20.19.0 || >=22.12.0')
            installed = root / 'node_modules/vite/package.json'; installed.parent.mkdir(parents=True)
            installed.write_text('{"engines":{"node":">=24"}}')
            self.assertEqual(runtime.project_node_requirement(root, 'vite'), '>=24')
            with self.assertRaises(ValueError):
                runtime.project_node_requirement(root, '../outside')

    def test_project_metadata_warning_does_not_hide_unrunnable_node(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout='v22.13.0', stderr='')):
            root = Path(tmp)
            for content in [None, '{broken', '{}']:
                if content is not None:
                    (root / 'package.json').write_text(content)
                ok, detail = runtime.check_project_node_runtime(root, command='fixture')
                self.assertTrue(ok)
                self.assertIn('[WARN]', detail)
            with patch.object(runtime.subprocess, 'run', side_effect=FileNotFoundError):
                self.assertFalse(runtime.check_project_node_runtime(root, command='missing')[0])

    def test_versions_warn_and_continue_but_existing_strict_floor_is_preserved(self):
        for probe, version in [(runtime.check_python_runtime, 'Python 3.12.9'),
                               (runtime.check_vscode_runtime, '1.105.0')]:
            with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout=version, stderr='')):
                ok, detail = probe('fixture')
                self.assertTrue(ok)
                self.assertIn('[WARN]', detail)
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout='v17.0.0', stderr='')):
            self.assertTrue(runtime.check_node_runtime('>=22.13', command='fixture')[0])
            self.assertFalse(runtime.check_node_runtime('>=18', command='fixture', strict=True)[0])

    def test_all_backend_manifests_agree_on_python_floor(self):
        for name in ['backend_local', 'backend_server', 'backend_tools', 'backend_taskteam', 'command_hermes']:
            self.assertEqual(runtime.python_requirement(ROOT / name), '>=3.13')

    def test_bounded_version_process_does_not_inherit_stdin_or_print_stderr(self):
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout='v22.13.0\n', stderr='private')) as run:
            self.assertTrue(runtime.check_node_runtime('>=22.13', command='fixture-node')[0])
        args, kwargs = run.call_args
        self.assertEqual(args[0], ['fixture-node', '--version'])
        self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
        self.assertEqual(kwargs['timeout'], 15)
        self.assertTrue(kwargs['check'])
        self.assertEqual(runtime.check_python_runtime(None)[0], False)
        for error in [PermissionError(), subprocess.TimeoutExpired('fixture', 15), subprocess.CalledProcessError(1, 'fixture', stderr='private')]:
            with patch.object(runtime.subprocess, 'run', side_effect=error):
                ok, detail = runtime.check_python_runtime('fixture')
            self.assertFalse(ok)
            self.assertNotIn('private', detail)

    def test_python_version_stderr_and_vscode_multiline(self):
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout='', stderr='Python 3.13.5\n')):
            ok, detail = runtime.check_python_runtime('fixture')
            self.assertTrue(ok)
            self.assertEqual(detail, 'Python 3.13.5（必要条件: >=3.13）')
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(stdout='1.106.0\nfixture-commit\nx64\n', stderr='')):
            self.assertTrue(runtime.check_vscode_runtime('fixture-code')[0])


if __name__ == '__main__':
    unittest.main()
