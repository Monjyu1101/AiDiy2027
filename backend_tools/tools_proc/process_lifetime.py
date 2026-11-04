#!/usr/bin/env python
# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""CLI / stdio MCP の寿命を起動元に揃える。stdout/stdin は中継せず継承する。"""

from __future__ import annotations

import argparse
import atexit
import os
import signal
import subprocess
import sys
import threading
import time
import uuid

import psutil


_OWNER_TOKEN = "AIDIY_PROCESS_OWNER_TOKEN"
_guard = None


def _windows_job():
    """自身を Job に入れてから子を起動する。ハンドルは子へ継承させない。"""
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
        )]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    # BREAKAWAY / SILENT_BREAKAWAY は許可しない。孫の Job もこの Job の配下。
    limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    # 成功後は明示的に閉じない（自身も Job 内）。OS が終了時に閉じて子孫を破棄する。
    return job


class ParentGuard:
    def __init__(self, parent_pid: int, *, token: str | None = None):
        self.parent = psutil.Process(parent_pid)
        self.parent.create_time()  # PID の再利用を is_running() で検出できるよう固定
        self.process = psutil.Process()
        self.token = token
        self.children: dict[int, psutil.Process] = {}
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.job = _windows_job() if os.name == "nt" else None
        self.thread = threading.Thread(target=self._watch, name="aidiy-parent-lifetime", daemon=True)
        self.thread.start()

    @staticmethod
    def _alive(process: psutil.Process) -> bool:
        try:
            return process.is_running() and process.status() != psutil.STATUS_ZOMBIE
        except psutil.Error:
            return False

    def _remember(self):
        try:
            children = self.process.children(recursive=True)
        except psutil.Error:
            children = []
        self.children = {pid: p for pid, p in self.children.items() if self._alive(p)}
        for child in children:
            try:
                child.create_time()
                self.children[child.pid] = child
            except psutil.Error:
                pass

    def _cleanup(self):
        with self.lock:
            self._remember()
            if self.token:
                # setsid() や中間プロセスの先行終了で親子関係が切れても、
                # 当該実行だけの識別子で回収する。コマンド名だけで一括終了しない。
                for process in psutil.process_iter():
                    try:
                        if process.pid != os.getpid() and process.environ().get(_OWNER_TOKEN) == self.token:
                            process.create_time()
                            self.children[process.pid] = process
                    except psutil.Error:
                        continue
            children = list(self.children.values())
            for child in reversed(children):
                try:
                    child.terminate()
                except psutil.Error:
                    pass
            _, alive = psutil.wait_procs(children, timeout=1)
            for child in alive:
                try:
                    child.kill()
                except psutil.Error:
                    pass
            psutil.wait_procs(alive, timeout=1)
            self.children.clear()

    def _watch(self):
        while not self.stop.wait(0.5):
            if not self._alive(self.parent):
                self._cleanup()
                # main が stdin / 通信 / SDK 内で待っていても必ず終了させる。
                os._exit(1)
            # Windows の子孫管理は Job が行う。stdio bridge が多数あっても
            # 各プロセスからプロセス一覧を繰り返し走査しない。
            if os.name == "nt":
                continue
            with self.lock:
                try:
                    self._remember()
                except psutil.Error:
                    pass

    def close(self):
        self.stop.set()
        if threading.current_thread() is not self.thread:
            self.thread.join(timeout=0.5)
        self._cleanup()


def _parent_pid(parent_pid: int | None = None) -> int:
    """Windows venvの中継python.exeを越えて、実際の起動元を取得する。"""
    # 呼び出し側が保存した直近の親PIDも補正する。それ以外の明示指定は保持する。
    if parent_pid is not None and parent_pid != os.getppid():
        return parent_pid
    process = psutil.Process()
    parent = process.parent()
    if os.name == "nt" and parent is not None:
        try:
            if (os.path.normcase(parent.exe()) == os.path.normcase(sys.executable)
                    and parent.cmdline() == process.cmdline()
                    and os.path.normcase(process.exe()) != os.path.normcase(parent.exe())):
                return parent.ppid()
        except psutil.Error:
            pass
    return parent.pid if parent is not None else os.getppid()


def guard_parent(parent_pid: int | None = None) -> ParentGuard:
    """単独起動 Hermes / stdio bridge に親終了のデーモン監視を付ける。"""
    global _guard
    if _guard is None:
        token = None
        if _OWNER_TOKEN not in os.environ:
            token = uuid.uuid4().hex
            os.environ[_OWNER_TOKEN] = token
        _guard = ParentGuard(_parent_pid(parent_pid), token=token)
        atexit.register(_guard.close)
    return _guard


def main() -> int:
    parser = argparse.ArgumentParser(description="起動元の終了時に CLI と子孫を破棄する")
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--creationflags", type=int, default=0)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("実行コマンドが必要です")
    token = uuid.uuid4().hex
    os.environ[_OWNER_TOKEN] = token
    if sys.platform.startswith("linux"):
        # 中間 CLI が先に終了した孫を引き取り、kill 後の wait で zombie も回収する。
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), "子孫プロセスの回収設定に失敗しました")
    guard = ParentGuard(args.parent_pid, token=token)
    stopped = False

    def request_stop(*_):
        nonlocal stopped
        stopped = True

    # POSIX は SIGTERM で子孫を回収してから終了。Windows は Job が強制終了も処理する。
    # signal handler ではロックを取らない。
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        # CREATE_NO_WINDOW で起動した Windows 子プロセスにも、監視ラッパーの
        # 標準ハンドルを明示して渡す。省略するとパイプ出力が失われる。
        process = subprocess.Popen(
            command,
            stdin=sys.stdin,
            stdout=sys.stdout,
            stderr=sys.stderr,
            creationflags=args.creationflags,
        )
        with guard.lock:
            guard._remember()
        while process.poll() is None:
            if stopped:
                return 1
            time.sleep(0.05)
        return process.returncode
    finally:
        guard.close()


if __name__ == "__main__":
    sys.exit(main())
