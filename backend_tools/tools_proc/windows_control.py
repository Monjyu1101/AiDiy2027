# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Windows OS 操作制御モジュール

マウス / キーボード操作（pyautogui）、ウィンドウ制御・プロセス管理・
クリップボード操作（ctypes、追加依存なし）、
UI Automation 要素操作（uiautomation）を提供する。Windows 専用。

参考: https://github.com/CursorTouch/Windows-MCP
"""

import ctypes
import math
import time
from contextlib import contextmanager
from ctypes import wintypes
from typing import Optional

_PYAUTOGUI_IMPORT_ERROR: Optional[Exception] = None
try:
    import pyautogui
    # 画面隅 (0,0) 等への操作で FailSafeException を出さない（サーバー用途のため無効化）
    pyautogui.FAILSAFE = False
except Exception as exc:
    pyautogui = None
    _PYAUTOGUI_IMPORT_ERROR = exc

_UIA_IMPORT_ERROR: Optional[Exception] = None
try:
    import uiautomation as auto
except Exception as exc:
    auto = None
    _UIA_IMPORT_ERROR = exc


class WindowsControlError(Exception):
    """Windows 操作制御エラー"""
    pass


# ========================================================================
# ctypes 定義
# ========================================================================

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)

# 64bit 環境で HWND / HANDLE が c_int に切り詰められないよう argtypes / restype を明示する
user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.OpenClipboard.restype = wintypes.BOOL
user32.EmptyClipboard.restype = wintypes.BOOL
user32.CloseClipboard.restype = wintypes.BOOL
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.GetClipboardData.restype = wintypes.HANDLE
user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.SetClipboardData.restype = wintypes.HANDLE
user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsWindow.restype = wintypes.BOOL
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL
user32.IsIconic.argtypes = [wintypes.HWND]
user32.IsIconic.restype = wintypes.BOOL
user32.IsZoomed.argtypes = [wintypes.HWND]
user32.IsZoomed.restype = wintypes.BOOL
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.ShowWindow.restype = wintypes.BOOL
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.BringWindowToTop.restype = wintypes.BOOL
user32.SetWindowPos.argtypes = [
    wintypes.HWND, wintypes.HWND,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT,
]
user32.SetWindowPos.restype = wintypes.BOOL
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.PostMessageW.restype = wintypes.BOOL
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.restype = wintypes.BOOL
kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalFree.restype = wintypes.HGLOBAL
kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
kernel32.TerminateProcess.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL
shell32.ShellExecuteW.argtypes = [
    wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR,
    wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int,
]
shell32.ShellExecuteW.restype = wintypes.HINSTANCE


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32FirstW.restype = wintypes.BOOL
kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32NextW.restype = wintypes.BOOL

_INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value

# Window show states / SetWindowPos flags
_SW_HIDE = 0
_SW_SHOWNORMAL = 1
_SW_MAXIMIZE = 3
_SW_SHOW = 5
_SW_MINIMIZE = 6
_SW_RESTORE = 9
_SWP_NOSIZE = 0x0001
_SWP_NOMOVE = 0x0002
_SWP_NOZORDER = 0x0004
_WM_CLOSE = 0x0010

_TH32CS_SNAPPROCESS = 0x00000002
_PROCESS_TERMINATE = 0x0001

_GMEM_MOVEABLE = 0x0002
_CF_UNICODETEXT = 13


class WindowsControl:
    """
    Windows デスクトップ操作制御クラス

    マウス/キーボード、ウィンドウ、プロセス、クリップボード、
    UI Automation 要素操作をまとめて提供する。
    """

    def __init__(self) -> None:
        # 直近の ui_snapshot 結果 (element_id -> uiautomation.Control)
        self._ui_cache: dict = {}

    # ------------------------------------------------------------------ #
    # 共通ヘルパー
    # ------------------------------------------------------------------ #

    def _ensure_gui_backend(self) -> None:
        if pyautogui is None:
            reason = str(_PYAUTOGUI_IMPORT_ERROR) if _PYAUTOGUI_IMPORT_ERROR else "unknown"
            raise WindowsControlError(f"マウス/キーボード操作が現在の環境で利用できません: {reason}")

    def _ensure_uia_backend(self) -> None:
        if auto is None:
            reason = str(_UIA_IMPORT_ERROR) if _UIA_IMPORT_ERROR else "unknown"
            raise WindowsControlError(f"UI Automation が現在の環境で利用できません: {reason}")

    @contextmanager
    def _uia_thread(self):
        """UIA 呼び出しを COM 初期化済みスレッドで実行するためのコンテキスト。

        asyncio.to_thread 等のワーカースレッドから呼ばれるため、
        呼び出しの都度 CoInitialize / CoUninitialize を行う。
        """
        self._ensure_uia_backend()
        with auto.UIAutomationInitializerInThread(debug=False):
            yield

    def _enum_windows(self) -> list[dict]:
        """表示中ウィンドウの一覧（hwnd/title/rect/pid/最小化・最大化状態）を返す"""
        windows: list[dict] = []
        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        @EnumProc
        def _cb(hwnd, lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value
            if not title:
                return True
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w <= 0 or h <= 0:
                return True
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            windows.append({
                "hwnd": hwnd,
                "title": title,
                "x": rect.left, "y": rect.top,
                "width": w, "height": h,
                "pid": pid.value,
                "minimized": bool(user32.IsIconic(hwnd)),
                "maximized": bool(user32.IsZoomed(hwnd)),
            })
            return True

        user32.EnumWindows(_cb, 0)
        return windows

    def _resolve_hwnd(self, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> int:
        if hwnd:
            if not user32.IsWindow(hwnd):
                raise WindowsControlError(f"無効な hwnd です: {hwnd}")
            return hwnd
        if not window_title:
            raise WindowsControlError("hwnd または window_title のいずれかを指定してください")
        for w in self._enum_windows():
            if window_title.lower() in w["title"].lower():
                return w["hwnd"]
        raise WindowsControlError(f"ウィンドウが見つかりません: '{window_title}'")

    # ------------------------------------------------------------------ #
    # マウス / キーボード
    # ------------------------------------------------------------------ #

    def mouse_click(self, x: int, y: int, button: str = "left", clicks: int = 1) -> dict:
        self._ensure_gui_backend()
        pyautogui.click(x=x, y=y, button=button, clicks=clicks)
        return {"x": x, "y": y, "button": button, "clicks": clicks}

    def mouse_move(self, x: int, y: int, duration: float = 0.0) -> dict:
        self._ensure_gui_backend()
        pyautogui.moveTo(x, y, duration=duration)
        return {"x": x, "y": y}

    def mouse_drag(self, x1: int, y1: int, x2: int, y2: int, button: str = "left", duration: float = 0.2) -> dict:
        self._ensure_gui_backend()
        pyautogui.moveTo(x1, y1)
        pyautogui.dragTo(x2, y2, duration=duration, button=button)
        return {"from": [x1, y1], "to": [x2, y2], "button": button}

    def mouse_long_press_drag(self, x1: int, y1: int, x2: int, y2: int, button: str = "left", duration: float = 0.2, hold_duration: float = 0.8) -> dict:
        """長押し後にドラッグ。保持時間と移動時間はそれぞれ秒。"""
        for name, value, limit in (("duration", duration, 60.0), ("hold_duration", hold_duration, 10.0)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= limit:
                raise WindowsControlError(f"{name} は0以上{limit:g}以下の有限の秒数で指定してください")
        if button not in ("left", "right", "middle"):
            raise WindowsControlError("button は left/right/middle で指定してください")
        if any(isinstance(value, bool) or not isinstance(value, int) for value in (x1, y1, x2, y2)):
            raise WindowsControlError("ドラッグの始点・終点は整数で指定してください")
        self._ensure_gui_backend()
        pyautogui.moveTo(x1, y1)
        try:
            pyautogui.mouseDown(button=button)
            time.sleep(hold_duration)
            pyautogui.moveTo(x2, y2, duration=duration)
        finally:
            # 押下・保持・移動の途中で例外になっても解放を試みる。
            pyautogui.mouseUp(button=button)
        return {"from": [x1, y1], "to": [x2, y2], "button": button}

    def mouse_scroll(self, amount: int, x: Optional[int] = None, y: Optional[int] = None, horizontal: bool = False) -> dict:
        self._ensure_gui_backend()
        if horizontal:
            pyautogui.hscroll(amount, x=x, y=y)
        else:
            pyautogui.scroll(amount, x=x, y=y)
        return {"amount": amount, "horizontal": horizontal}

    def keyboard_type(self, text: str, interval: float = 0.02) -> dict:
        self._ensure_gui_backend()
        pyautogui.typewrite(text, interval=interval)
        return {"text": text}

    def keyboard_key(self, key: str) -> dict:
        self._ensure_gui_backend()
        pyautogui.press(key)
        return {"key": key}

    def keyboard_shortcut(self, keys: list[str]) -> dict:
        self._ensure_gui_backend()
        pyautogui.hotkey(*keys)
        return {"keys": keys}

    # ------------------------------------------------------------------ #
    # ウィンドウ制御
    # ------------------------------------------------------------------ #

    def list_windows(self) -> list[dict]:
        return self._enum_windows()

    def focus_window(self, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> dict:
        h = self._resolve_hwnd(hwnd, window_title)
        if user32.IsIconic(h):
            user32.ShowWindow(h, _SW_RESTORE)
        ok = bool(user32.SetForegroundWindow(h))
        if not ok:
            # フォアグラウンドロック対策: ALT キーイベントでロックを解除して再試行
            _VK_MENU, _KEYEVENTF_KEYUP = 0x12, 0x0002
            user32.keybd_event(_VK_MENU, 0, 0, 0)
            user32.keybd_event(_VK_MENU, 0, _KEYEVENTF_KEYUP, 0)
            user32.BringWindowToTop(h)
            ok = bool(user32.SetForegroundWindow(h))
        return {"hwnd": h, "foreground": ok}

    def move_window(self, x: int, y: int, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> dict:
        h = self._resolve_hwnd(hwnd, window_title)
        user32.SetWindowPos(h, 0, x, y, 0, 0, _SWP_NOSIZE | _SWP_NOZORDER)
        return {"hwnd": h, "x": x, "y": y}

    def resize_window(self, width: int, height: int, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> dict:
        h = self._resolve_hwnd(hwnd, window_title)
        user32.SetWindowPos(h, 0, 0, 0, width, height, _SWP_NOMOVE | _SWP_NOZORDER)
        return {"hwnd": h, "width": width, "height": height}

    def set_window_state(self, state: str, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> dict:
        h = self._resolve_hwnd(hwnd, window_title)
        state_norm = state.lower()
        actions = {
            "minimize": lambda: user32.ShowWindow(h, _SW_MINIMIZE),
            "maximize": lambda: user32.ShowWindow(h, _SW_MAXIMIZE),
            "restore": lambda: user32.ShowWindow(h, _SW_RESTORE),
            "hide": lambda: user32.ShowWindow(h, _SW_HIDE),
            "show": lambda: user32.ShowWindow(h, _SW_SHOW),
            "close": lambda: user32.PostMessageW(h, _WM_CLOSE, 0, 0),
        }
        if state_norm not in actions:
            raise WindowsControlError(
                f"未知の state です: {state} ({'/'.join(actions)} のいずれかを指定してください)"
            )
        actions[state_norm]()
        return {"hwnd": h, "state": state_norm}

    # ------------------------------------------------------------------ #
    # アプリ起動 / プロセス
    # ------------------------------------------------------------------ #

    def launch_app(self, path: str, args: str = "") -> dict:
        """実行ファイル・ドキュメント・URI を既定の関連付けで開く（ShellExecute 相当）"""
        result = shell32.ShellExecuteW(None, "open", path, args or None, None, _SW_SHOWNORMAL)
        # HINSTANCE (c_void_p) は NULL のとき None になるため 0 に正規化する
        code = int(result) if result else 0
        if code <= 32:
            raise WindowsControlError(f"アプリ起動に失敗しました (code={code}): {path}")
        return {"path": path, "args": args, "result_code": code}

    def list_processes(self) -> list[dict]:
        snap = kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if not snap or snap == _INVALID_HANDLE_VALUE:
            raise WindowsControlError("プロセス一覧の取得に失敗しました")
        procs: list[dict] = []
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        try:
            if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                while True:
                    procs.append({
                        "pid": entry.th32ProcessID,
                        "ppid": entry.th32ParentProcessID,
                        "name": entry.szExeFile,
                        "threads": entry.cntThreads,
                    })
                    if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                        break
        finally:
            kernel32.CloseHandle(snap)
        return procs

    def kill_process(self, pid: Optional[int] = None, name: Optional[str] = None) -> dict:
        if pid is None and not name:
            raise WindowsControlError("pid または name のいずれかを指定してください")
        if pid is not None:
            targets = [pid]
        else:
            targets = [p["pid"] for p in self.list_processes() if p["name"].lower() == name.lower()]
        if not targets:
            raise WindowsControlError(f"対象プロセスが見つかりません: name={name}")
        killed: list[int] = []
        failed: list[int] = []
        for target_pid in targets:
            handle = kernel32.OpenProcess(_PROCESS_TERMINATE, False, target_pid)
            if not handle:
                failed.append(target_pid)
                continue
            ok = kernel32.TerminateProcess(handle, 1)
            kernel32.CloseHandle(handle)
            (killed if ok else failed).append(target_pid)
        return {"killed": killed, "failed": failed}

    # ------------------------------------------------------------------ #
    # クリップボード
    # ------------------------------------------------------------------ #

    def get_clipboard_text(self) -> str:
        if not user32.OpenClipboard(None):
            raise WindowsControlError("クリップボードを開けません（他アプリが使用中の可能性があります）")
        try:
            handle = user32.GetClipboardData(_CF_UNICODETEXT)
            if not handle:
                return ""
            ptr = kernel32.GlobalLock(handle)
            try:
                return ctypes.wstring_at(ptr) if ptr else ""
            finally:
                if ptr:
                    kernel32.GlobalUnlock(handle)
        finally:
            user32.CloseClipboard()

    def set_clipboard_text(self, text: str) -> dict:
        if not user32.OpenClipboard(None):
            raise WindowsControlError("クリップボードを開けません（他アプリが使用中の可能性があります）")
        try:
            user32.EmptyClipboard()
            buf = ctypes.create_unicode_buffer(text)
            size = ctypes.sizeof(buf)
            h_mem = kernel32.GlobalAlloc(_GMEM_MOVEABLE, size)
            if not h_mem:
                raise WindowsControlError("クリップボード用メモリの確保に失敗しました")
            ptr = kernel32.GlobalLock(h_mem)
            if not ptr:
                kernel32.GlobalFree(h_mem)
                raise WindowsControlError("クリップボード用メモリのロックに失敗しました")
            ctypes.memmove(ptr, buf, size)
            kernel32.GlobalUnlock(h_mem)
            if not user32.SetClipboardData(_CF_UNICODETEXT, h_mem):
                # 書き込み失敗時は所有権が移らないため自前で解放する
                kernel32.GlobalFree(h_mem)
                raise WindowsControlError("クリップボードへの書き込みに失敗しました")
        finally:
            user32.CloseClipboard()
        return {"length": len(text)}

    # ------------------------------------------------------------------ #
    # UI Automation（要素 ID ベースのクリック・入力）
    # ------------------------------------------------------------------ #

    def _walk_uia(self, control, depth: int, max_depth: int, max_elements: int, out: list) -> None:
        if len(out) >= max_elements:
            return
        try:
            rect = control.BoundingRectangle
        except Exception:
            rect = None
        if rect and (rect.right > rect.left) and (rect.bottom > rect.top):
            element_id = len(out) + 1
            self._ui_cache[element_id] = control
            out.append({
                "id": element_id,
                "name": control.Name or "",
                "control_type": control.ControlTypeName,
                "automation_id": control.AutomationId,
                "class_name": control.ClassName,
                "x": rect.left, "y": rect.top,
                "width": rect.right - rect.left,
                "height": rect.bottom - rect.top,
                "enabled": bool(control.IsEnabled),
                "offscreen": bool(control.IsOffscreen),
            })
        if depth >= max_depth:
            return
        try:
            children = control.GetChildren()
        except Exception:
            children = []
        for child in children:
            if len(out) >= max_elements:
                break
            self._walk_uia(child, depth + 1, max_depth, max_elements, out)

    def ui_snapshot(self, window_title: Optional[str] = None, max_depth: int = 6, max_elements: int = 150) -> dict:
        """
        UI Automation でウィンドウの要素ツリーを走査し、要素 ID 付きの一覧を返す。

        element_id はこの呼び出し直後のみ有効。ui_click / ui_type の前には
        必ず ui_snapshot を再実行すること（前回のキャッシュは上書きされる）。
        """
        with self._uia_thread():
            self._ui_cache = {}

            if window_title:
                hwnd = self._resolve_hwnd(window_title=window_title)
            else:
                hwnd = auto.GetForegroundWindow()
            if not hwnd:
                raise WindowsControlError("対象ウィンドウが見つかりません")

            root = auto.ControlFromHandle(hwnd)
            if root is None:
                raise WindowsControlError(f"UI Automation でウィンドウを取得できません: hwnd={hwnd}")

            elements: list = []
            self._walk_uia(root, 0, max_depth, max_elements, elements)

            return {
                "hwnd": hwnd,
                "window_title": root.Name or "",
                "element_count": len(elements),
                "elements": elements,
            }

    def _get_cached_control(self, element_id: int):
        control = self._ui_cache.get(element_id)
        if control is None:
            raise WindowsControlError(
                f"element_id={element_id} は無効です。ui_snapshot を再実行してください"
            )
        return control

    def ui_click(self, element_id: int, double: bool = False) -> dict:
        with self._uia_thread():
            control = self._get_cached_control(element_id)
            if double:
                control.DoubleClick(simulateMove=False)
            else:
                control.Click(simulateMove=False)
            return {"element_id": element_id, "double": double}

    def ui_set_focus(self, element_id: int) -> dict:
        with self._uia_thread():
            control = self._get_cached_control(element_id)
            control.SetFocus()
            return {"element_id": element_id}

    def ui_type(self, element_id: int, text: str, clear: bool = False) -> dict:
        with self._uia_thread():
            control = self._get_cached_control(element_id)
            control.SetFocus()
            if clear:
                control.SendKeys("{Ctrl}a{Delete}")
            control.SendKeys(text)
            return {"element_id": element_id, "text": text, "cleared": clear}
