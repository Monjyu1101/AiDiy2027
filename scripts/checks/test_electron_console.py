# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""起動入口の実子プロセスにコンソールがなく、ログを取得できることを確認する。"""
import importlib.util
import contextlib
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
PROBE = "import ctypes,json; print(json.dumps({'console':ctypes.windll.kernel32.GetConsoleWindow(),'log':'起動ログ'},ensure_ascii=False))"


def load(relative):
    spec = importlib.util.spec_from_file_location('console_' + relative.replace('/', '_'), ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(sys.platform == 'win32', 'Windows の実プロセス試験')
class ElectronConsoleTest(unittest.TestCase):
    def check_child(self, module, action):
        real_popen = subprocess.Popen
        observed = []

        def probe(_command, **kwargs):
            kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            child = real_popen([sys.executable, '-X', 'utf8', '-c', PROBE], **kwargs)
            observed.append(child)
            return child

        with patch.object(module.subprocess, 'Popen', side_effect=probe), patch('builtins.print'), contextlib.ExitStack() as stack:
            # 実子のコンソール属性だけを測る。版数確認用の別プロセスは専用回帰で扱う。
            if hasattr(module, 'check_project_node_runtime'):
                stack.enter_context(patch.object(module, 'check_project_node_runtime', return_value=(True, 'Node fixture')))
            child = action()
        output, error = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, error)
        self.assertEqual(json.loads(output), {'console': 0, 'log': '起動ログ'})
        self.assertEqual(observed, [child])

    def test_diag_start(self):
        module = load('backend_diag/_start.py')
        self.check_child(module, module.start)

    def test_diag_auto_launcher_has_no_console(self):
        module = load('backend_diag/_start.py')
        real_run = subprocess.run
        observed = []

        def run(_command, **kwargs):
            result = real_run([sys.executable, '-X', 'utf8', '-c', PROBE],
                              **kwargs, capture_output=True)
            observed.append(json.loads(result.stdout))
            return result

        with patch.object(module.subprocess, 'run', side_effect=run):
            module.launch_gui()
        self.assertEqual(observed, [{'console': 0, 'log': '起動ログ'}])

    def test_tools_checker_has_no_console_and_keeps_output(self):
        module = load('backend_tools/tools_proc/code_checker.py')
        result = module.CodeChecker(str(ROOT))._run(
            [sys.executable, '-X', 'utf8', '-c', PROBE], str(ROOT))
        self.assertEqual(json.loads(result['stdout']), {'console': 0, 'log': '起動ログ'})

    def test_tools_audio_helpers_have_no_console(self):
        with patch.dict(sys.modules, {'log_config': Mock(get_logger=Mock(return_value=Mock()))}):
            tts = load('backend_tools/tools_proc/text_to_speech.py')
            ffmpeg = load('backend_tools/tools_proc/ffmpeg_control.py')
        real_run = subprocess.run
        observed = []

        def run(_command, **kwargs):
            result = real_run([sys.executable, '-X', 'utf8', '-c', PROBE], **kwargs)
            observed.append(json.loads(result.stdout))
            return result

        with patch.object(tts.subprocess, 'run', side_effect=run), patch.object(tts.shutil, 'which', return_value=sys.executable):
            tts.TextToSpeech._probe_ffmpeg()
        self.assertEqual(observed, [{'console': 0, 'log': '起動ログ'}])
        control = object.__new__(ffmpeg.FfmpegControl)
        with patch.object(control, '_split_args', return_value=['-X', 'utf8', '-c', PROBE]):
            result = asyncio.run(control._exec(sys.executable, 'probe', '', 10, True))
        self.assertEqual(json.loads(result['stdout']), {'console': 0, 'log': '起動ログ'})

    def test_code_and_live_start(self):
        module = load('frontend_ide/host/_start.py')
        for action in (module.start_code, lambda: module.start_live(True)):
            with self.subTest(action=action):
                self.check_child(module, action)

    def test_discord_start(self):
        module = load('frontend_channels/discord/_start.py')
        self.check_child(module, lambda: module.start(True))

    def test_ide_and_term_detached_start(self):
        module = load('frontend_ide/viewer/_start.py')
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'THIS_DIR', Path(directory) / 'viewer'):
            for kind in ('ide', 'console'):
                with self.subTest(kind=kind):
                    self.check_child(module, lambda: module.start(kind=kind))

    def test_discord_preflight_and_direct_entry(self):
        module = load('frontend_channels/discord/_start.py')
        self.enterContext(patch.object(module, 'check_project_node_runtime', return_value=(True, 'Node fixture')))
        import _setup_electron
        real_run = subprocess.run
        records = []

        def run(_command, **kwargs):
            result = real_run([sys.executable, '-X', 'utf8', '-c', PROBE], **kwargs)
            records.append(json.loads(result.stdout))
            return result

        with patch.object(module.subprocess, 'run', side_effect=run), patch.object(_setup_electron, 'electron_binary_ready', return_value=True):
            self.assertTrue(module.check_environment()[0])
        self.assertEqual(records, [{'console': 0, 'log': '起動ログ'}])
        with patch.object(module.subprocess, 'call') as call, patch.object(module.sys, 'argv', ['aidiy_discord']), patch('builtins.print'):
            call.return_value = 0
            with self.assertRaises(SystemExit) as exited:
                module.main()
            self.assertEqual(exited.exception.code, 0)
        self.assertTrue(call.call_args.kwargs['creationflags'] & subprocess.CREATE_NO_WINDOW)

    def test_process_lookup_and_stop_helpers(self):
        module = load('scripts/_cleanup_processes.py')
        real_run = subprocess.run
        observed = []

        def run(_command, **kwargs):
            # taskkill / PowerShell 自体は実行せず、同じ起動オプションで無害な子を測る。
            source = "import ctypes,sys; print('[]'); print(ctypes.windll.kernel32.GetConsoleWindow(),file=sys.stderr)"
            result = real_run([sys.executable, '-c', source], **kwargs)
            observed.append((result.stderr, kwargs))
            return result

        with patch.object(module.subprocess, 'run', side_effect=run):
            self.assertEqual(module.list_processes(), [])
            target = dict(ProcessId=987654321, ParentProcessId=0, Name='fixture', CommandLine='fixture')
            with patch.object(module, 'list_processes', side_effect=[[target], [target], []]):
                self.assertTrue(module.stop_matching(lambda p: p == target, Mock(), Mock(), '試験'))
        self.assertEqual(len(observed), 2)
        for stderr, options in observed:
            self.assertEqual(str(stderr, 'utf-8').strip() if isinstance(stderr, bytes) else stderr.strip(), '0')
            self.assertTrue(options['creationflags'] & subprocess.CREATE_NO_WINDOW)

    def test_viewer_stop_helper(self):
        module = load('frontend_ide/viewer/_start.py')
        with patch.object(module.subprocess, 'run') as run:
            module._stop(Mock(pid=987654321, poll=Mock(return_value=None)))
        self.assertTrue(run.call_args.kwargs['creationflags'] & subprocess.CREATE_NO_WINDOW)


class PosixLaunchOptionsTest(unittest.TestCase):
    def test_windows_flags_are_not_used_on_mac_or_linux(self):
        for relative, name, args in (
            ('backend_diag/_start.py', 'start', ()),
            ('frontend_ide/host/_start.py', 'start_code', ()),
            ('frontend_channels/discord/_start.py', 'start', ()),
        ):
            module = load(relative)
            for platform in ('darwin', 'linux'):
                with self.subTest(module=relative, platform=platform), patch.object(module.sys, 'platform', platform), patch.object(module.shutil, 'which', return_value='/fixture/node'), patch.object(module.subprocess, 'Popen') as popen, contextlib.ExitStack() as stack:
                    # 本試験はPopen起動オプションが対象。新しい版数preflightは別の回帰で確認する。
                    if hasattr(module, 'check_project_node_runtime'):
                        stack.enter_context(patch.object(module, 'check_project_node_runtime', return_value=(True, 'fixture')))
                    getattr(module, name)(*args)
                    self.assertEqual(popen.call_args.kwargs.get('creationflags', 0), 0)
                    self.assertTrue(popen.call_args.kwargs['start_new_session'])


if __name__ == '__main__':
    unittest.main()
