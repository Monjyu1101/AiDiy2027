"""Local の起動境界を検証する。サーバー起動・アプリ import はしない。"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LocalLoopbackTests(unittest.TestCase):
    def tree(self, relative):
        return ast.parse((ROOT / relative).read_text(encoding='utf-8'))

    def test_launcher_both_runtimes_ignore_host_environment(self):
        tree = self.tree('backend_local/_start.py')
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'get_command')
        for python in (None, Path('/fixture/python')):
            with self.subTest(python=python):
                scope = dict(find_python_in_env=lambda *_: python, ENV_CANDIDATES=[],
                             BACKEND_LOCAL_DIR=ROOT / 'backend_local', APP='local_main:app', PORT_LOCAL=8096,
                             os=SimpleNamespace(environ={'UVICORN_HOST': '0.0.0.0', 'HOST': '0.0.0.0'}))
                exec(compile(ast.Module(body=[function], type_ignores=[]), '<launcher>', 'exec'), scope)
                command = scope['get_command']()
                self.assertEqual(command[command.index('--host') + 1], '127.0.0.1')
                self.assertEqual(command[command.index('--port') + 1], '8096')
                self.assertEqual(command[command.index('--ws-max-size') + 1], '20971520')

    def test_direct_main_uses_loopback(self):
        calls = [node for node in ast.walk(self.tree('backend_local/local_main.py'))
                 if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                 and isinstance(node.func.value, ast.Name) and node.func.value.id == 'uvicorn'
                 and node.func.attr == 'run']
        self.assertEqual(len(calls), 1)
        self.assertEqual(ast.literal_eval(next(k.value for k in calls[0].keywords if k.arg == 'host')), '127.0.0.1')

    def test_other_backend_hosts_are_unchanged(self):
        for relative, name in (('backend_server/_start.py', 'get_backend_command'),
                               ('backend_taskteam/_start.py', 'get_command')):
            with self.subTest(path=relative):
                function = next(node for node in self.tree(relative).body
                                if isinstance(node, ast.FunctionDef) and node.name == name)
                commands = [node for node in ast.walk(function) if isinstance(node, ast.List)
                            and any(isinstance(item, ast.Constant) and item.value == '--host'
                                    for item in node.elts)]
                self.assertEqual(len(commands), 2)
                for command in commands:
                    values = [item.value if isinstance(item, ast.Constant) else None
                              for item in command.elts]
                    self.assertEqual(values[values.index('--host') + 1], '0.0.0.0')

    def test_setup_examples_use_loopback(self):
        for relative in ('_setup.py', 'backend_local/download_model.py',
                         '_AIDIY/knowledge/backend_local,モデル準備と起動.md',
                         'README.md', 'docs/開発ガイド/README.md',
                         'docs/開発ガイド/00_このプロジェクトの歩き方/03_セットアップと起動.html',
                         '_AIDIY/knowledge/backend_server,command_hermes,backend_tools,バックエンド起動.md'):
            with self.subTest(path=relative):
                lines = [line for line in (ROOT / relative).read_text(encoding='utf-8').splitlines()
                         if 'uvicorn local_main:app' in line]
                self.assertTrue(lines)
                self.assertTrue(all('--host 127.0.0.1' in line for line in lines))

    def test_root_launcher_delegates_to_local_start(self):
        tree = self.tree('_start.py')
        self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                            and isinstance(node.func.value, ast.Name) and node.func.value.id == 'LOCAL'
                            and node.func.attr == 'start' for node in ast.walk(tree)))


if __name__ == '__main__':
    unittest.main()
