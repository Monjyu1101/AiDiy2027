"""Tools の起動境界を検証する。サーバー起動・アプリ import はしない。"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ToolsLoopbackTests(unittest.TestCase):
    def tree(self, relative):
        return ast.parse((ROOT / relative).read_text(encoding='utf-8'))

    def test_launcher_both_runtimes_ignore_host_environment(self):
        tree = self.tree('backend_tools/_start.py')
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'get_command')
        for python in (None, Path('/fixture/python')):
            with self.subTest(python=python):
                scope = dict(find_python_in_env=lambda *_: python, ENV_CANDIDATES=[],
                             BACKEND_TOOLS_DIR=ROOT / 'backend_tools', APP='tools_main:app', PORT_TOOLS=8095,
                             os=SimpleNamespace(environ={'UVICORN_HOST': '0.0.0.0', 'HOST': '0.0.0.0'}))
                exec(compile(ast.Module(body=[function], type_ignores=[]), '<launcher>', 'exec'), scope)
                command = scope['get_command']()
                self.assertEqual(command[command.index('--host') + 1], '127.0.0.1')
                self.assertEqual(command[command.index('--port') + 1], '8095')

    def test_direct_main_uses_loopback(self):
        calls = [node for node in ast.walk(self.tree('backend_tools/tools_main.py'))
                 if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                 and isinstance(node.func.value, ast.Name) and node.func.value.id == 'uvicorn'
                 and node.func.attr == 'run']
        self.assertEqual(len(calls), 1)
        self.assertEqual(ast.literal_eval(next(k.value for k in calls[0].keywords if k.arg == 'host')), '127.0.0.1')

    def test_automation_uses_loopback(self):
        tree = self.tree('backend_tools/aidiy_automations/ビデオページ生成/無限解説ビデオ生成.py')
        commands = [node for node in ast.walk(tree) if isinstance(node, ast.List)
                    and any(isinstance(item, ast.Constant) and item.value == 'tools_main:app' for item in node.elts)]
        self.assertEqual(len(commands), 1)
        values = [item.value if isinstance(item, ast.Constant) else None for item in commands[0].elts]
        self.assertEqual(values[values.index('--host') + 1], '127.0.0.1')

    def test_setup_examples_use_loopback(self):
        for relative in ('_setup.py', 'backend_tools/_setup.py', '_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md',
                         'README.md', '_AIDIY/knowledge/backend_tools,backend_server,運用手順.md',
                         '_AIDIY/knowledge/backend_server,command_hermes,backend_tools,バックエンド起動.md'):
            with self.subTest(path=relative):
                lines = [line for line in (ROOT / relative).read_text(encoding='utf-8').splitlines()
                         if 'uvicorn tools_main:app' in line]
                self.assertTrue(lines)
                self.assertTrue(all('--host 127.0.0.1' in line for line in lines))

    def test_root_launcher_delegates_to_tools_start(self):
        tree = self.tree('_start.py')
        self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                            and isinstance(node.func.value, ast.Name) and node.func.value.id == 'TOOLS'
                            and node.func.attr == 'start' for node in ast.walk(tree)))


if __name__ == '__main__':
    unittest.main()
