# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Uvicorn の実起動なしで、各起動入口の WebSocket 上限を確認する。"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 20 * 1024 * 1024


class ServerTransportLimitsTests(unittest.TestCase):
    def test_all_backend_command_builders_set_twenty_mib_for_both_runtimes(self):
        for folder in ('backend_server', 'backend_tools', 'backend_local', 'backend_taskteam'):
            path = ROOT / folder / '_start.py'
            tree = ast.parse(path.read_text(encoding='utf-8'))
            name = 'get_backend_command' if folder == 'backend_server' else 'get_command'
            function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
            for python, setting in ((None, None), (Path('/fixture/python'), None), (None, '1048576'), (Path('/fixture/python'), '52428800')):
                with self.subTest(folder=folder, python=python, setting=setting):
                    scope = {'find_python_in_env': lambda *_: python, 'ENV_CANDIDATES': [], 'APP': 'fixture:app',
                             'os': SimpleNamespace(environ={} if setting is None else {'UVICORN_WS_MAX_SIZE': setting}),
                             **{key: ROOT / folder for key in ('BACKEND_DIR', 'BACKEND_TOOLS_DIR', 'BACKEND_LOCAL_DIR', 'BACKEND_TASKTEAM_DIR')},
                             **dict(PORT_TOOLS=8095, PORT_LOCAL=8096, PORT_TASKTEAM=8093)}
                    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), scope)
                    command = scope[name]('core_main:app', 8091) if folder == 'backend_server' else scope[name]()
                    self.assertEqual(command[command.index('--ws-max-size') + 1], setting or str(LIMIT))

    def test_direct_uvicorn_run_entrypoints_set_twenty_mib(self):
        for relative in ('backend_tools/tools_main.py', 'backend_local/local_main.py', 'backend_taskteam/taskteam_main.py'):
            with self.subTest(path=relative):
                tree = ast.parse((ROOT / relative).read_text(encoding='utf-8'))
                calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                         and isinstance(node.func.value, ast.Name) and node.func.value.id == 'uvicorn' and node.func.attr == 'run']
                self.assertEqual(len(calls), 1)
                value = next(keyword.value for keyword in calls[0].keywords if keyword.arg == 'ws_max_size')
                for setting in (None, '1048576', '52428800'):
                    scope = {'__builtins__': {'int': int}, 'os': SimpleNamespace(environ={} if setting is None else {'UVICORN_WS_MAX_SIZE': setting})}
                    self.assertEqual(eval(compile(ast.Expression(value), relative, 'eval'), scope), int(setting) if setting else LIMIT)

    def test_automation_setup_and_docker_launchers_set_twenty_mib(self):
        automation = ROOT / 'backend_tools/aidiy_automations/ビデオページ生成/無限解説ビデオ生成.py'
        tree = ast.parse(automation.read_text(encoding='utf-8'))
        commands = [node for node in ast.walk(tree) if isinstance(node, ast.List)
                    and any(isinstance(value, ast.Constant) and value.value == 'uvicorn' for value in node.elts)]
        self.assertEqual(len(commands), 1)
        values = [value.value if isinstance(value, ast.Constant) else None for value in commands[0].elts]
        value = commands[0].elts[values.index('--ws-max-size') + 1]
        for setting in (None, '1048576', '52428800'):
            scope = {'__builtins__': {}, 'os': SimpleNamespace(environ={} if setting is None else {'UVICORN_WS_MAX_SIZE': setting})}
            self.assertEqual(eval(compile(ast.Expression(value), 'automation', 'eval'), scope), setting or str(LIMIT))
        for relative, expected in (('backend_tools/_setup.py', 1), ('docker/start.sh', 2)):
            commands = [line for line in (ROOT / relative).read_text(encoding='utf-8').splitlines()
                        if 'uvicorn ' in line and '--port ' in line]
            self.assertEqual(len(commands), expected)
            expected_flag = '--ws-max-size "${UVICORN_WS_MAX_SIZE:-20971520}"' if relative.endswith('.sh') else '--ws-max-size ' + str(LIMIT)
            self.assertTrue(all(expected_flag in line for line in commands))

    def test_root_setup_printed_launch_examples_set_twenty_mib(self):
        tree = ast.parse((ROOT / '_setup.py').read_text(encoding='utf-8'))
        messages = [node.args[0] for node in ast.walk(tree)
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == 'print_info' and node.args
                    and isinstance(node.args[0], ast.JoinedStr)]
        commands = [''.join(value.value for value in message.values if isinstance(value, ast.Constant))
                    for message in messages]
        commands = [value for value in commands if 'uvicorn ' in value and '--port ' in value]
        self.assertEqual(len(commands), 5)
        self.assertEqual({value.split('uvicorn ', 1)[1].split()[0] for value in commands},
                         {'local_main:app', 'tools_main:app', 'core_main:app', 'apps_main:app', 'taskteam_main:app'})
        self.assertTrue(all('--ws-max-size ' + str(LIMIT) in command for command in commands))

    def test_existing_higher_cdp_limit_is_not_lowered(self):
        tree = ast.parse((ROOT / 'backend_tools/tools_proc/chrome_devtools.py').read_text(encoding='utf-8'))
        limits = [keyword.value for node in ast.walk(tree) if isinstance(node, ast.Call)
                  for keyword in node.keywords if keyword.arg == 'max_size']
        self.assertEqual(len(limits), 2)
        for value in limits:
            self.assertEqual(eval(compile(ast.Expression(value), 'cdp', 'eval'), {'__builtins__': {}}), 50 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
