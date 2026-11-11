# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実サービスを触らず、Diag 用 _start.py の停止・起動・監視を確認する。"""
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import shlex
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import nullcontext
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    spec = importlib.util.spec_from_file_location('diag_start_test_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StartTests(unittest.TestCase):
    def test_runtime_uses_repository_temp_not_diagnostic_results_or_cwd(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        self.assertEqual(module.RUNTIME, ROOT / 'temp/aidiy_diag/起動')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / '日本語 空白 project'
            scripts = root / 'scripts'
            scripts.mkdir(parents=True)
            (scripts / '_diag_start.py').write_bytes((ROOT / 'scripts/_diag_start.py').read_bytes())
            (scripts / '起動対象.json').write_text('[]', encoding='utf-8')
            copied = load(scripts / '_diag_start.py')
            self.assertEqual(copied.RUNTIME, root / 'temp/aidiy_diag/起動')
            with copied.service_lock(copied.RUNTIME / 'fixture.lock', threading.Event()):
                self.assertTrue((copied.RUNTIME / 'fixture.lock').is_file())
            self.assertFalse((root / '_AIDIY').exists())

    def test_short_progress_is_forwarded_before_child_exit(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        output = queue.Queue()
        child = subprocess.Popen(
            [sys.executable, '-u', '-c', "import sys;print('準備完了',flush=True);sys.stdin.read()"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}),
        )
        reader = threading.Thread(target=module.pipe_output,
                                  args=(child, SimpleNamespace(write=output.put)), daemon=True)
        reader.start()
        try:
            self.assertIn('準備完了', output.get(timeout=10))
            self.assertIsNone(child.poll(), '終了前の進捗を確認する')
        finally:
            child.stdin.close()
            child.wait(timeout=5)
            reader.join(timeout=5)
            child.stdout.close()

    def test_revision_replacement_is_checked_after_one_second_and_stop_skips_io(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        for value in ('{"run":"replacement"}', 'invalid json'):
            with self.subTest(value=value):
                revision = Mock()
                revision.read_text.return_value = value
                stopped = Mock()
                stopped.wait.side_effect = [False, True]
                module.watch_revision(revision, 'original', stopped)
                self.assertEqual(stopped.wait.call_args_list[0].args, (1.0,))
                revision.read_text.assert_called_once_with(encoding='utf-8')
                stopped.set.assert_called_once_with()
        revision = Mock()
        stopped = threading.Event()
        stopped.set()
        module.watch_revision(revision, 'original', stopped)
        revision.read_text.assert_not_called()

    def test_process_management_checks_once_per_second_until_exit(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        child = Mock()
        child.poll.side_effect = [None, None, 0]
        stopped = Mock()
        stopped.is_set.return_value = False
        stopped.wait.return_value = False
        module.wait_for_exit(child, stopped)
        self.assertEqual([call.args for call in stopped.wait.call_args_list], [(1.0,), (1.0,)])
        self.assertEqual(child.poll.call_count, 3)

    def test_process_wait_is_interruptible_and_independent_per_instance(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        first_stop, second_stop = threading.Event(), threading.Event()
        entered = threading.Event()
        first = Mock()
        first.poll.side_effect = lambda: (entered.set() or None)
        second = Mock()
        second.poll.return_value = None
        thread = threading.Thread(target=module.wait_for_exit, args=(first, first_stop), daemon=True)
        other = threading.Thread(target=module.wait_for_exit, args=(second, second_stop), daemon=True)
        thread.start(); other.start()
        try:
            self.assertTrue(entered.wait(2))
            first_stop.set()
            thread.join(timeout=.5)
            self.assertFalse(thread.is_alive(), '停止は1秒タイマーの満了を待たない')
            self.assertTrue(other.is_alive(), '別インスタンスの監視は停止しない')
        finally:
            first_stop.set(); second_stop.set()
            thread.join(timeout=2); other.join(timeout=2)

    def test_output_preserves_split_utf8_and_final_tail_without_timers(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        data = '進捗\n末尾'.encode('utf-8')
        chunks = [data[:1], data[1:7], data[7:], b'']
        stream = Mock()
        stream.read1.side_effect = chunks
        output = io.StringIO()
        with patch.object(module.time, 'sleep') as sleep:
            module.pipe_output(SimpleNamespace(stdout=stream), output)
        self.assertEqual(output.getvalue(), '進捗\n末尾')
        stream.read.assert_not_called()
        sleep.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows の補助コマンド非表示')
    def test_auxiliary_commands_are_hidden_and_module_api_is_restored(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        for name in ('backend_local', 'backend_tools', 'backend_server', 'backend_taskteam', 'frontend_web'):
            with self.subTest(name=name):
                folder = load(ROOT / name / '_start.py')
                original = folder.subprocess
                with patch.object(original, 'run') as execute:
                    with module.hidden_commands(folder):
                        folder.subprocess.run(['fixture'], capture_output=True, timeout=5)
                    options = execute.call_args.kwargs
                    self.assertEqual(options['creationflags'], subprocess.CREATE_NO_WINDOW)
                    self.assertEqual(options['stdin'], subprocess.DEVNULL)
                    self.assertTrue(options['capture_output'])
                self.assertIs(folder.subprocess, original)
                with self.assertRaises(RuntimeError), module.hidden_commands(folder):
                    raise RuntimeError('fixture')
                self.assertIs(folder.subprocess, original)

    @unittest.skipUnless(os.name == 'nt', 'Windows のコンソール可視状態')
    def test_hidden_headless_has_private_console_and_auxiliary_has_none(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        helper = load(ROOT / 'scripts/_diag_console.py')
        source = ("import ctypes,json,sys\n"
                  "window=ctypes.windll.kernel32.GetConsoleWindow()\n"
                  "print(json.dumps({'console':bool(window),'visible':bool(ctypes.windll.user32.IsWindowVisible(window)),'input':sys.stdin.read()}),flush=True)\n"
                  "print('stderr output',file=sys.stderr,flush=True)\n")
        result = helper.HiddenSubprocess(subprocess).run([sys.executable, '-B', '-c', source],
                                                        capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {'console': False, 'visible': False, 'input': ''})
        self.assertIn('stderr output', result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'backend_diag'
            folder.mkdir()
            (folder / 'diag_main.mjs').write_text(source, encoding='utf-8')
            with patch.object(module, 'ROOT', Path(directory)):
                child = module.start_headless(sys.executable)
            try:
                output, error = child.communicate(timeout=5)
                self.assertEqual(child.returncode, 0)
                self.assertTrue(child._aidiy_private_console)
                result = json.loads(output.decode('utf-8').splitlines()[0])
                self.assertEqual(result, {'console': True, 'visible': False, 'input': ''})
                self.assertIn(b'stderr output', output)
                self.assertIsNone(error)
            finally:
                if child.poll() is None:
                    child.kill();child.wait(timeout=5)
                child.stdout.close()

    def test_npm_version_checks_do_not_inherit_control_input(self):
        for name in ('_start.py', 'frontend_web/_start.py', 'frontend_avatar/_start.py'):
            with self.subTest(name=name):
                module = load(ROOT / name)
                with patch.object(module.subprocess, 'run') as execute:
                    self.assertIsNotNone(module.get_npm_command())
                self.assertEqual(execute.call_args.kwargs['stdin'], subprocess.DEVNULL)
                self.assertEqual(execute.call_args.kwargs['timeout'], 15)

    def test_npm_timeout_is_reported_and_next_candidate_can_succeed(self):
        for name in ('_start.py', 'frontend_web/_start.py', 'frontend_avatar/_start.py'):
            with self.subTest(name=name):
                module = load(ROOT / name)
                with patch.object(module.sys, 'platform', 'win32'), \
                        patch.object(module.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
                        patch.object(module, 'print_warning') as warning, \
                        patch.object(module.subprocess, 'run', side_effect=[
                            subprocess.TimeoutExpired('npm.cmd', 15), Mock(returncode=0)]):
                    self.assertEqual(module.get_npm_command(), 'npm')
                self.assertIn('15秒でタイムアウト', warning.call_args.args[0])

    def test_npm_probe_finishes_while_supervisor_control_pipe_stays_open(self):
        with tempfile.TemporaryDirectory(prefix='diag npm ') as temporary:
            folder = Path(temporary)
            command = folder / 'npm-probe'
            code = "import sys;sys.stdin.buffer.read();print('11.0.0')"
            if os.name == 'nt':
                file = command.with_suffix('.cmd')
                file.write_bytes((f'@echo off\r\n"{sys.executable}" -B -c "{code}"\r\n').encode('utf-8'))
            else:
                file = command
                file.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} -B -c {shlex.quote(code)}\n', encoding='utf-8')
                file.chmod(0o755)
            runner = folder / 'runner.py'
            runner.write_text(f'''
import importlib.util,sys,threading
spec=importlib.util.spec_from_file_location('web_probe',{str(ROOT / 'frontend_web/_start.py')!r})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.FRONTEND_COMMAND={str(command)!r}
threading.Thread(target=lambda:list(sys.stdin),daemon=True).start()
print(module.get_npm_command(),flush=True)
''', encoding='utf-8')
            child = subprocess.Popen([sys.executable, '-B', '-u', '-X', 'utf8', str(runner)],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                child.wait(timeout=6)  # 制御入力は閉じず、version コマンドだけが完了することを確認。
                self.assertEqual(child.returncode, 0)
                self.assertIn(str(file).encode('utf-8'), child.stdout.read())
            finally:
                child.stdin.close()
                if child.poll() is None:
                    child.kill();child.wait(timeout=5)
                child.stdout.close();child.stderr.close()

    def test_stop_sends_ctrl_c_and_allows_child_cleanup_before_forced_termination(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'interrupted.txt'
            source = ("import signal,time,sys\nfrom pathlib import Path\n"
                      "def interrupted(*_):\n"
                      f"    Path({str(marker)!r}).write_text('Ctrl+C',encoding='utf-8')\n"
                      "    sys.exit(0)\n"
                      "signal.signal(signal.SIGINT,interrupted)\n"
                      "print('ready',flush=True)\nwhile True: time.sleep(.1)\n")
            folder = SimpleNamespace(subprocess=subprocess)
            def start():
                return folder.subprocess.Popen([sys.executable, '-B', '-u', '-c', source],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    **({'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}))
            folder.start = start
            child = module.launch(folder, {'id': 'fixture'}, {})
            self.assertIs(folder.subprocess, subprocess)
            self.addCleanup(child.stdout.close)
            self.addCleanup(lambda: module.terminate(child))
            self.assertEqual(child.stdout.readline().strip(), b'ready')
            with patch('builtins.print'):
                module.terminate(child)
            self.assertEqual(child.returncode, 0)
            self.assertEqual(marker.read_text(encoding='utf-8'), 'Ctrl+C')

    @unittest.skipUnless(os.name == 'nt', 'Windows の共有コンソール保護')
    def test_windows_never_sends_ctrl_c_to_a_shared_console(self):
        module = load(ROOT / 'scripts/_diag_console.py')
        with patch.object(module.subprocess, 'run') as execute:
            with self.assertRaisesRegex(OSError, '共有コンソール'):
                module.interrupt(SimpleNamespace(pid=123))
            execute.assert_not_called()

    def test_unresponsive_child_falls_back_after_interrupt_timeout(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        child = Mock(pid=123)
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired('fixture', 5), 0]
        interrupt = Mock()
        with patch.object(module, 'load_module', return_value=SimpleNamespace(interrupt=interrupt)), \
                patch.object(module.subprocess, 'run') as force, \
                patch.object(module.os, 'getpgid', return_value=123, create=True), \
                patch.object(module.os, 'killpg', create=True) as killgroup, patch('builtins.print'):
            module.terminate(child)
        interrupt.assert_called_once_with(child)
        if os.name == 'nt':
            self.assertEqual(force.call_args.args[0], ['taskkill', '/F', '/T', '/PID', '123'])
        else:
            killgroup.assert_called_once_with(123, module.signal.SIGTERM)

    def test_core_and_apps_stop_only_their_own_port(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        for kind, port in (('core', 8091), ('apps', 8098)):
            with self.subTest(kind=kind), patch.object(module.socket, 'create_connection', side_effect=ConnectionRefusedError):
                folder = SimpleNamespace(kill_process_on_port=Mock(), kill_ports=Mock())
                module.stop_previous(folder, {'id': kind, 'ポート': port})
                folder.kill_process_on_port.assert_called_once_with(port)
                folder.kill_ports.assert_not_called()

    def test_existing_port_that_cannot_stop_prevents_launch(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        with patch.object(module.socket, 'create_connection', side_effect=lambda *_args, **_kwargs: nullcontext()):
            with self.assertRaises(RuntimeError):
                module.stop_previous(SimpleNamespace(kill_ports=Mock()), {'id': 'web', 'ポート': 8090})

    def test_wrong_script_or_options_are_rejected_before_process_actions(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        folder = SimpleNamespace(__file__=str(ROOT / 'frontend_web/_start.py'), start=Mock(), kill_ports=Mock())
        with self.assertRaises(ValueError):
            module.run(folder, 'core', {'起動対象': True, '自動再起動': True})
        with self.assertRaises(ValueError):
            module.run(folder, 'web', {'起動対象': True, '自動再起動': True, 'command': 'evil'})
        folder.start.assert_not_called(); folder.kill_ports.assert_not_called()

    def test_root_default_diag_skips_other_prompts(self):
        root = load(ROOT / '_start.py')
        with patch.object(root, 'prompt_choice', side_effect=lambda _, default_yes: default_yes) as prompt, patch('builtins.print'):
            values = root.collect_startup_choices()
        self.assertEqual(values, (False,) * 6 + (True,) + (False,) * 7)
        prompt.assert_called_once_with('  Diag      : 開始しますか?', default_yes=True)

    def test_root_without_diag_prompts_use_shared_defaults(self):
        root = load(ROOT / '_start.py')
        with patch.object(root, 'prompt_choice', side_effect=lambda label, default_yes: False if 'Diag' in label else default_yes) as prompt, patch('builtins.print'):
            values = root.collect_startup_choices()
        self.assertEqual(values, (False, True, True, True, True, False, False, False, False, False, False, False, False, False))
        # Slack は結果の並びを変えず、Discord の直後に尋ねてモジュール変数へ保持する。
        self.assertEqual(prompt.call_count, 16)
        self.assertIn('Slack', prompt.call_args_list[-1].args[0])
        self.assertIs(root.SLACK_ENABLED, False)
        self.assertIs(root.CPU_ENABLED, False)

    def test_diag_children_cannot_consume_console_control_input(self):
        for folder in ('backend_local', 'backend_tools', 'backend_server', 'backend_taskteam', 'frontend_web'):
            with self.subTest(folder=folder):
                module = load(ROOT / folder / '_start.py')
                with patch.dict(os.environ, {'AIDIY_DIAG_CONSOLE': '1'}), patch.object(module.subprocess, 'Popen') as popen, patch('builtins.print'):
                    module.launch_process('fixture', ['fixture'], ROOT)
                    self.assertEqual(popen.call_args.kwargs['stdin'], subprocess.DEVNULL)

    def test_web_wait_requires_continuous_success_after_a_failed_response(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        clock = [0]
        stopped = SimpleNamespace(is_set=lambda: False, wait=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        opener = Mock()
        opener.open.side_effect = [nullcontext(SimpleNamespace(status=status)) for status in (200, 200, 503, 200, 200, 200)]
        with patch.object(module.urllib.request, 'build_opener', return_value=opener), patch.object(module.time, 'monotonic', side_effect=lambda: clock[0]), patch('builtins.print'):
            self.assertTrue(module.wait_for_web(SimpleNamespace(poll=lambda: None), 12345, stopped, seconds=2))
        self.assertEqual(clock[0], 5)
        self.assertEqual(opener.open.call_count, 6)

    def test_web_wait_can_stop_and_rejects_dead_process_or_unhealthy_timeout(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        stopped = threading.Event()
        opener = Mock()
        opener.open.side_effect = ConnectionRefusedError
        with patch.object(module.urllib.request, 'build_opener', return_value=opener), patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, '安定しない'):
                module.wait_for_web(SimpleNamespace(poll=lambda: None), 12345, stopped, max_wait=0)
            with self.assertRaisesRegex(RuntimeError, 'プロセスが終了'):
                module.wait_for_web(SimpleNamespace(poll=lambda: 1), 12345, stopped)
            opener.open.side_effect = lambda *_args, **_kwargs: (stopped.set() or nullcontext(SimpleNamespace(status=200)))
            self.assertFalse(module.wait_for_web(SimpleNamespace(poll=lambda: None), 12345, stopped))

    def test_web_opens_via_tools_only_after_stable_and_uses_existing_endpoint(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        target = next(item for item in module.TARGETS if item['id'] == 'web')
        self.assertTrue(target['初期設定']['ブラウザ表示'])
        self.assertNotIn('chrome_devtoolsで開く', target['初期設定'])
        actions = []
        opener = Mock()
        def respond(*_args, **_kwargs):
            actions.append('open')
            return nullcontext(io.BytesIO(b'{"id":"test-page"}'))
        opener.open.side_effect = respond
        with patch.object(module, 'wait_for_web', side_effect=lambda *_args: actions.append('stable') or True), patch.object(module.urllib.request, 'build_opener', return_value=opener), patch('builtins.print'):
            self.assertTrue(module.show_web(target, target['初期設定'], Mock(), threading.Event()))
        self.assertEqual(actions, ['stable', 'open'])
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:8095/aidiy_chrome_devtools/new_page')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'url': 'http://127.0.0.1:8090/', 'show_automation_banner': False})

    def test_web_browser_options_and_cancellation_never_open_early(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        target = next(item for item in module.TARGETS if item['id'] == 'web')
        with patch.object(module, 'wait_for_web', return_value=False) as wait, patch.object(module.urllib.request, 'build_opener') as opener, patch('builtins.print'):
            self.assertFalse(module.show_web(target, target['初期設定'], Mock(), threading.Event()))
            opener.assert_not_called()
            wait.return_value = True
            wait.reset_mock()
            self.assertTrue(module.show_web(target, {**target['初期設定'], 'ブラウザ表示': False}, Mock(), threading.Event()))
            wait.assert_not_called(); opener.assert_not_called()
            wait.side_effect = RuntimeError('HTTP wait failed')
            with self.assertRaisesRegex(RuntimeError, 'HTTP wait failed'):
                module.show_web(target, target['初期設定'], Mock(), threading.Event())
            opener.assert_not_called()

    def test_web_tools_failure_is_reported_without_stopping_web_or_opening_fallback(self):
        module = load(ROOT / 'scripts/_diag_start.py')
        target = next(item for item in module.TARGETS if item['id'] == 'web')
        opener = Mock()
        for result in (ConnectionRefusedError('offline'), nullcontext(io.BytesIO(b'{"error":"Chrome failed"}'))):
            with self.subTest(result=result), patch.object(module, 'wait_for_web', return_value=True), patch.object(module.urllib.request, 'build_opener', return_value=opener), patch('builtins.print') as output:
                opener.open.side_effect = result if isinstance(result, Exception) else lambda *_args, **_kwargs: result
                self.assertTrue(module.show_web(target, target['初期設定'], Mock(), threading.Event()))
                self.assertIn('Web は稼働を続けます', str(output.call_args_list))

    def make_runner(self, directory):
        directory = Path(directory)
        folder = directory / 'fixture'
        folder.mkdir()
        (directory / '_cleanup.py').write_text(
            'from contextlib import contextmanager\n@contextmanager\ndef cleanup_stop_request(*args, **kwargs):\n    yield\n', encoding='utf-8')
        source = f'''
import importlib.util, json, os, subprocess, sys
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('shared_diag_start', {str(ROOT / 'scripts/_diag_start.py')!r})
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
shared.ROOT=Path({str(directory)!r});shared.RUNTIME=shared.ROOT/'temp/aidiy_diag/起動'
shared.TARGETS=[{{'id':'fixture','フォルダ':'fixture','監視名':'fixture','初期設定':{{'起動対象':True,'自動再起動':False}}}}]
def stop():
    with (shared.ROOT/'stops.txt').open('a') as output: output.write('stop\\n')
def start():
    return subprocess.Popen([sys.executable,'-u','-c',"import time;print('fixture output',flush=True);time.sleep(60)"],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,**({{'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP}} if os.name=='nt' else {{'start_new_session':True}}))
module=SimpleNamespace(__file__=str(shared.ROOT/'fixture/_start.py'),check_environment=lambda:(True,'fixture'),kill_ports=stop,start=start)
shared.run(module,'fixture',{{'起動対象':True,'自動再起動':False}})
'''
        file = directory / 'runner.py'
        file.write_text(source, encoding='utf-8')
        return file

    def spawn_runner(self, file, run_id=None):
        env = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
        if run_id:
            env['AIDIY_DIAG_RUN'] = run_id
        process = subprocess.Popen([sys.executable, '-B', '-u', str(file)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', env=env)
        events = queue.Queue()
        def output():
            for line in process.stdout:
                events.put(json.loads(line))
        reader = threading.Thread(target=output, daemon=True)
        reader.start()
        def cleanup():
            if process.poll() is None:
                process.stdin.close()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
            reader.join(timeout=2)
            process.stdout.close();process.stderr.close()
            if not process.stdin.closed:
                process.stdin.close()
        self.addCleanup(cleanup)
        return process, events

    def ready(self, process, events):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                event = events.get(timeout=.2)
                if event['type'] == 'ready':
                    return
            except queue.Empty:
                if process.poll() is not None:
                    self.fail('fixture exited before ready: ' + process.stderr.read())
        self.fail('fixture startup timed out')

    def test_console_stop_command_stops_owned_child_and_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            file = self.make_runner(directory)
            process, events = self.spawn_runner(file)
            self.ready(process, events)
            process.stdin.write('{"action":"stop"}\n');process.stdin.flush()
            self.assertEqual(process.wait(timeout=12), 0)
            self.assertEqual((Path(directory) / 'stops.txt').read_text().count('stop'), 2)

    def test_a_new_run_replaces_old_supervisor_before_starting(self):
        with tempfile.TemporaryDirectory() as directory:
            file = self.make_runner(directory)
            runtime = Path(directory) / 'temp/aidiy_diag/起動';runtime.mkdir(parents=True)
            legacy = Path(directory) / '_AIDIY/aidiy_diag/起動'
            legacy.mkdir(parents=True)
            (legacy / 'fixture.json').write_text('{"run":"stale"}', encoding='utf-8')
            revision = runtime / 'fixture.json'
            revision.write_text('{"run":"first"}', encoding='utf-8')
            first, first_events = self.spawn_runner(file, 'first')
            self.ready(first, first_events)
            self.assertTrue((runtime / 'fixture.lock').is_file())
            self.assertEqual(list(legacy.iterdir()), [legacy / 'fixture.json'])
            self.assertEqual((legacy / 'fixture.json').read_text(), '{"run":"stale"}')
            revision.write_text('{"run":"second"}', encoding='utf-8')
            second, second_events = self.spawn_runner(file, 'second')
            self.ready(second, second_events)
            self.assertEqual(first.wait(timeout=12), 0)
            self.assertIsNone(second.poll())
            second.stdin.write('{"action":"stop"}\n');second.stdin.flush()
            self.assertEqual(second.wait(timeout=12), 0)


if __name__ == '__main__':
    unittest.main()
