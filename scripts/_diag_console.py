# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Diag 専用プロセスのコンソールと Ctrl+C。通常の起動経路には適用しない。"""
import ctypes
import os
import signal
import subprocess
import sys


class HiddenSubprocess:
    """環境確認やポート整理の短命コマンドはコンソールを作らない。"""
    def __init__(self, original):
        self.original = original

    def __getattr__(self, name):
        return getattr(self.original, name)

    def run(self, *args, **kwargs):
        flags = kwargs.get('creationflags', 0) & ~(subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP)
        kwargs['creationflags'] = flags | subprocess.CREATE_NO_WINDOW
        kwargs.setdefault('stdin', subprocess.DEVNULL)
        return self.original.run(*args, **kwargs)


class ConsoleSubprocess(HiddenSubprocess):
    """Windows では隠した専用コンソールへ分離し、Ctrl+C を他の窓へ送らない。"""
    def Popen(self, *args, **kwargs):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
        # NEW_PROCESS_GROUP は Ctrl+C を無効にするため、専用コンソールでは外す。
        flags = kwargs.get('creationflags', 0) & ~subprocess.CREATE_NEW_PROCESS_GROUP
        kwargs.update(creationflags=flags | subprocess.CREATE_NEW_CONSOLE, startupinfo=startup)
        # Ctrl+C 無視の属性は子へ継承される。Diag 本体が NEW_PROCESS_GROUP で起動されると
        # 専用コンソールの子も Ctrl+C を受け取れないため、起動前に自分の無視属性を解除する。
        ctypes.WinDLL('kernel32', use_last_error=True).SetConsoleCtrlHandler(None, False)
        process = self.original.Popen(*args, **kwargs)
        process._aidiy_private_console = True
        return process


# 別プロセスで専用コンソールへ接続し、監視側のコンソール状態を変更しない。
WINDOWS_INTERRUPT = '''
import ctypes, sys, time
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.FreeConsole()
if not kernel.AttachConsole(int(sys.argv[1])):
    raise SystemExit(1)
try:
    if not kernel.SetConsoleCtrlHandler(None, True):
        raise SystemExit(1)
    if not kernel.GenerateConsoleCtrlEvent(0, 0):
        raise SystemExit(1)
    time.sleep(.15)
finally:
    kernel.FreeConsole()
'''


def interrupt(process):
    if os.name == 'nt':
        if not getattr(process, '_aidiy_private_console', False):
            raise OSError('共有コンソールへの Ctrl+C 送信は行いません。')
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
        result = subprocess.run([sys.executable, '-B', '-c', WINDOWS_INTERRUPT, str(process.pid)],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                creationflags=subprocess.CREATE_NO_WINDOW, startupinfo=startup, timeout=3)
        if result.returncode:
            raise OSError('専用コンソールへ Ctrl+C を送信できませんでした。')
    else:
        os.killpg(os.getpgid(process.pid), signal.SIGINT)
