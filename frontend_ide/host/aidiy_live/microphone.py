# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Windows waveIn の PCM を stdout へ送る。stdin の終了でマイクを閉じる。"""
import ctypes
from ctypes import wintypes
import sys
import threading
import time


def capture():
    if sys.platform != 'win32':
        raise RuntimeError('Windows のマイク入力に対応しています。')
    winmm = ctypes.WinDLL('winmm')
    pointer = ctypes.c_size_t

    class WaveFormat(ctypes.Structure):
        _fields_ = [('format', wintypes.WORD), ('channels', wintypes.WORD),
                    ('rate', wintypes.DWORD), ('bytes_per_second', wintypes.DWORD),
                    ('block', wintypes.WORD), ('bits', wintypes.WORD), ('extra', wintypes.WORD)]

    class WaveHeader(ctypes.Structure):
        _fields_ = [('data', ctypes.c_void_p), ('length', wintypes.DWORD),
                    ('recorded', wintypes.DWORD), ('user', pointer), ('flags', wintypes.DWORD),
                    ('loops', wintypes.DWORD), ('next', ctypes.c_void_p), ('reserved', pointer)]

    winmm.waveInOpen.argtypes = [ctypes.POINTER(wintypes.HANDLE), wintypes.UINT,
                                ctypes.POINTER(WaveFormat), pointer, pointer, wintypes.DWORD]
    for name in ('waveInPrepareHeader', 'waveInUnprepareHeader', 'waveInAddBuffer'):
        getattr(winmm, name).argtypes = [wintypes.HANDLE, ctypes.POINTER(WaveHeader), wintypes.UINT]
    for name in ('waveInStart', 'waveInReset', 'waveInClose'):
        getattr(winmm, name).argtypes = [wintypes.HANDLE]

    def check(code):
        if code:
            message = ctypes.create_unicode_buffer(256)
            winmm.waveInGetErrorTextW(code, message, len(message))
            raise RuntimeError(f'{message.value} (waveIn: {code})')

    handle = wintypes.HANDLE()
    fmt = WaveFormat(1, 1, 48000, 96000, 2, 16, 0)
    check(winmm.waveInOpen(ctypes.byref(handle), 0xFFFFFFFF, ctypes.byref(fmt), 0, 0, 0))
    stopped = threading.Event()

    def control():
        sys.stdin.buffer.read()
        stopped.set()

    threading.Thread(target=control, daemon=True).start()
    headers = []
    buffers = []
    try:
        for _ in range(8):
            buffer = ctypes.create_string_buffer(6144)
            buffers.append(buffer)
            header = WaveHeader(ctypes.addressof(buffer), len(buffer), 0, 0, 0, 0, None, 0)
            check(winmm.waveInPrepareHeader(handle, ctypes.byref(header), ctypes.sizeof(header)))
            headers.append(header)
            check(winmm.waveInAddBuffer(handle, ctypes.byref(header), ctypes.sizeof(header)))
        check(winmm.waveInStart(handle))
        index = 0
        while not stopped.is_set():
            header = headers[index]
            if not header.flags & 1:
                time.sleep(.005)
                continue
            if header.recorded:
                sys.stdout.buffer.write(ctypes.string_at(header.data, header.recorded))
                sys.stdout.buffer.flush()
            header.recorded = 0
            check(winmm.waveInAddBuffer(handle, ctypes.byref(header), ctypes.sizeof(header)))
            index = (index + 1) % len(headers)
    finally:
        winmm.waveInReset(handle)
        for header in headers:
            winmm.waveInUnprepareHeader(handle, ctypes.byref(header), ctypes.sizeof(header))
        winmm.waveInClose(handle)


if __name__ == '__main__':
    try:
        capture()
    except (Exception, KeyboardInterrupt) as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
