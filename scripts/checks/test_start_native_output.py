# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""UTF-8 モードと Windows ネイティブ出力が混在してもポート整理を続行する。"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
FILES = ['_start.py', *[folder + '/_start.py' for folder in
         ('backend_tools', 'backend_local', 'backend_server', 'backend_taskteam', 'frontend_web', 'frontend_avatar')]]


def load(path):
    spec = importlib.util.spec_from_file_location('native_start_' + path.parent.name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NETSTAT = ('アクティブな接続\r\n'
           '  TCP    127.0.0.1:8095   0.0.0.0:0   LISTENING   1456\r\n'
           '  TCP    [::]:8095       [::]:0       LISTENING   42\r\n'
           '  TCP    127.0.0.1:8095   0.0.0.0:0   LISTENING   1456\r\n'
           '  TCP    127.0.0.1:80950  0.0.0.0:0   LISTENING   7\r\n'
           '  TCP    127.0.0.1:8095   0.0.0.0:0   TIME_WAIT   8\r\n'
           '  TCP    127.0.0.1:8095   0.0.0.0:0   LISTENING   0\r\n').encode('cp932')
SUCCESS = '成功: プロセスを終了しました。\r\n'.encode('cp932')
FAILURE = 'エラー: アクセスが拒否されました。\r\n'.encode('cp932') + b'\x81'


class NativeOutputTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows の OEM codec / subprocess 読取スレッドを使う試験')
    def test_utf8_python_reads_native_stdout_stderr_and_finishes_port_cleanup(self):
        original_run = subprocess.run
        for name in FILES:
            with self.subTest(name=name):
                module = load(ROOT / name)
                queries = [NETSTAT, b'']
                killed = []
                failures = []
                def native(command, **kwargs):
                    if command[0] == 'netstat':
                        output = queries.pop(0)
                    elif command[0] == 'taskkill':
                        killed.append(command[-1]); output = SUCCESS
                    else:
                        self.fail('想定しないコマンド: ' + repr(command))
                    # 生バイトを出す小さな Python を代わりに実行し、本物の readerthread を通す。
                    source = f'import sys;sys.stdout.buffer.write({output!r});sys.stderr.buffer.write({FAILURE!r})'
                    return original_run([sys.executable, '-B', '-X', 'utf8', '-c', source], **kwargs)
                with patch.object(module.subprocess, 'run', side_effect=native), \
                        patch.object(module.time, 'sleep'), patch('builtins.print') as messages, \
                        patch.object(threading, 'excepthook', side_effect=failures.append):
                    self.assertTrue(module.kill_process_on_port(8095))
                self.assertEqual(killed, ['42', '1456'])
                self.assertEqual(queries, [])
                self.assertEqual(failures, [], 'subprocess の読取スレッドで例外を発生させない')
                self.assertNotIn('確認時にエラー', str(messages.call_args_list))

    def test_kill_failure_reports_message_without_losing_pid_or_crashing(self):
        for name in FILES:
            with self.subTest(name=name):
                module = load(ROOT / name)
                calls = []
                def native(command, **kwargs):
                    calls.append(command)
                    # oem は Windows 専用のため、模擬実行では CP932 として復号する。
                    encoding = 'cp932' if kwargs.get('encoding') == 'oem' else kwargs.get('encoding', 'utf-8')
                    if command[0] == 'netstat':
                        return SimpleNamespace(returncode=0, stdout=NETSTAT.decode(encoding, errors=kwargs.get('errors', 'strict')), stderr='')
                    return SimpleNamespace(returncode=1, stdout='', stderr=FAILURE.decode(encoding, errors=kwargs.get('errors', 'strict')))
                with patch.object(module.sys, 'platform', 'win32'), patch.object(module.subprocess, 'run', side_effect=native), \
                        patch.object(module.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), \
                        patch.object(module.time, 'sleep'), patch('builtins.print') as messages:
                    self.assertFalse(module.kill_process_on_port(8095))
                self.assertTrue(any(command[0] == 'taskkill' for command in calls))
                self.assertIn('アクセスが拒否', str(messages.call_args_list))
                self.assertNotIn('確認時にエラー', str(messages.call_args_list))

    def test_posix_port_lookup_keeps_its_own_text_mode(self):
        for name in FILES:
            with self.subTest(name=name):
                module = load(ROOT / name)
                with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='42\n1456\n')) as execute:
                    self.assertEqual(module._listening_pids_linux(8095), ['42', '1456'])
                self.assertNotEqual(execute.call_args.kwargs.get('encoding'), 'oem')


if __name__ == '__main__':
    unittest.main()
