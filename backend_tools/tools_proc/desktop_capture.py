# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
スクリーンショット取得モジュール

pyautogui / PIL.ImageGrab / screeninfo を使って
OS 画面を取得する。ウィンドウ操作は ctypes (Windows 専用、追加依存なし)。

参考: 認証済_スクリーンショット画像取得202405.py (Mitsuo KONDOU)
"""

import base64
import io
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

_PYAUTOGUI_IMPORT_ERROR: Optional[Exception] = None
try:
    import pyautogui
except Exception as exc:
    pyautogui = None
    _PYAUTOGUI_IMPORT_ERROR = exc

import screeninfo
from PIL import Image, ImageDraw, ImageFont, ImageGrab


class DesktopCaptureError(Exception):
    """デスクトップキャプチャ取得エラー"""
    pass


class DesktopCapture:
    """
    デスクトップキャプチャ取得クラス

    screen_number パラメータ:
        "auto" — カーソルのあるモニター全体（デフォルト）
        "all"  — 全モニター結合
        "0"    — モニター番号 0
        "1"    — モニター番号 1
        ...
    """

    DEFAULT_OUTPUT_DIR = "backend_server/temp/output"

    # ------------------------------------------------------------------ #
    # カーソル・モニター情報
    # ------------------------------------------------------------------ #

    def _ensure_gui_backend(self) -> None:
        if pyautogui is None:
            reason = str(_PYAUTOGUI_IMPORT_ERROR) if _PYAUTOGUI_IMPORT_ERROR else "unknown"
            raise DesktopCaptureError(
                "デスクトップキャプチャは現在の環境で利用できません。"
                f" GUI 初期化に失敗しました: {reason}"
            )

    def cursor_pos(self) -> tuple[int, int]:
        """現在のマウスカーソル座標を返す"""
        self._ensure_gui_backend()
        pos = pyautogui.position()
        return int(pos.x), int(pos.y)

    def monitors(self) -> list[dict]:
        """全モニターの情報を返す"""
        result = []
        for i, m in enumerate(screeninfo.get_monitors()):
            result.append({
                "index": i,
                "x": m.x,
                "y": m.y,
                "width": m.width,
                "height": m.height,
                "primary": getattr(m, "is_primary", i == 0),
            })
        return result

    # ------------------------------------------------------------------ #
    # 内部ヘルパー
    # ------------------------------------------------------------------ #

    def _grab_all(self) -> Image.Image:
        """全画面（全モニター結合）を取得"""
        try:
            return ImageGrab.grab(all_screens=True)
        except Exception:
            time.sleep(0.5)
            return ImageGrab.grab(all_screens=True)

    def _monitor_offsets(self) -> tuple[int, int]:
        """負座標モニターを考慮した全画面左上オフセットを返す"""
        mons = screeninfo.get_monitors()
        if not mons:
            return 0, 0
        min_x = min(m.x for m in mons)
        min_y = min(m.y for m in mons)
        return min_x, min_y

    # ------------------------------------------------------------------ #
    # スクリーンショット取得
    # ------------------------------------------------------------------ #

    @staticmethod
    def _play_shutter_sound() -> None:
        """シャッター音を再生する。"""
        sound_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "sounds", "_sound_shutter.mp3",
        )
        sound_path = os.path.abspath(sound_path)
        if not os.path.isfile(sound_path):
            return
        try:
            DesktopCapture._playsound(sound_path)
        except Exception:
            pass

    @staticmethod
    def _playsound(path: str) -> None:
        """プラットフォーム別最小サウンド再生。Windows: winmm、macOS: afplay、Linux: gst"""
        import platform
        import subprocess
        pf = platform.system()
        if pf == "Windows":
            import ctypes
            ext = os.path.splitext(path)[1].lower()
            mci_type = "waveaudio" if ext == ".wav" else "mpegvideo"
            ctypes.windll.winmm.mciSendStringW(
                f'open "{path}" type {mci_type} alias _dc', None, 0, None)
            ctypes.windll.winmm.mciSendStringW(
                'play _dc wait', None, 0, None)
            ctypes.windll.winmm.mciSendStringW(
                'close _dc', None, 0, None)
        elif pf == "Darwin":
            subprocess.run(["afplay", path], timeout=30, check=False)
        else:
            subprocess.run(
                ["gst-launch-1.0", "playbin", f"uri=file://{path}"],
                timeout=30, check=False,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )

    def grab_screen(self, screen_number: str = "auto", shutter_sounds: str = "none") -> tuple[Image.Image, dict]:
        """
        モニター単位でスクリーンショットを取得する。

        Returns:
            (image, info_dict)
            info_dict: x, y, width, height, cursor_x, cursor_y
        """
        if shutter_sounds == "auto":
            self._play_shutter_sound()

        mons = screeninfo.get_monitors()
        cursor_x, cursor_y = self.cursor_pos()

        if not mons:
            # fallback: pyautogui
            self._ensure_gui_backend()
            img = pyautogui.screenshot()
            return img, {
                "x": 0, "y": 0,
                "width": img.width, "height": img.height,
                "cursor_x": cursor_x, "cursor_y": cursor_y,
            }

        all_img = self._grab_all()
        min_x, min_y = self._monitor_offsets()

        if str(screen_number) == "all":
            return all_img, {
                "x": min_x, "y": min_y,
                "width": all_img.width, "height": all_img.height,
                "cursor_x": cursor_x, "cursor_y": cursor_y,
            }

        # モニター選択
        target = None
        if str(screen_number).isdigit():
            idx = int(screen_number)
            if 0 <= idx < len(mons):
                target = mons[idx]

        if target is None:  # "auto" またはインデックス範囲外 → カーソルのあるモニター
            for m in mons:
                if m.x <= cursor_x < m.x + m.width and m.y <= cursor_y < m.y + m.height:
                    target = m
                    break
            if target is None:
                target = mons[0]

        # 全画面から切り出し
        left = target.x - min_x
        top  = target.y - min_y
        img  = all_img.crop((left, top, left + target.width, top + target.height))

        return img, {
            "x": target.x, "y": target.y,
            "width": target.width, "height": target.height,
            "cursor_x": cursor_x, "cursor_y": cursor_y,
        }

    def grab_cursor_region(self, size: int, screen_number: str = "auto", shutter_sounds: str = "none") -> tuple[Image.Image, dict]:
        """
        カーソル中心に size×size px の領域を切り出す。

        モニター境界でクランプするため、実際のサイズが size を下回る場合がある。

        Returns:
            (image, info_dict)
            info_dict: screen_x, screen_y, screen_width, screen_height,
                       cursor_x, cursor_y, crop_rel_x, crop_rel_y
        """
        screen_img, info = self.grab_screen(screen_number, shutter_sounds=shutter_sounds)
        cx, cy = info["cursor_x"], info["cursor_y"]

        # スクリーン相対座標に変換
        rel_x = cx - info["x"]
        rel_y = cy - info["y"]

        half  = size // 2
        left  = max(0, rel_x - half)
        top   = max(0, rel_y - half)
        right = min(info["width"],  rel_x + half)
        bottom = min(info["height"], rel_y + half)

        img = screen_img.crop((left, top, right, bottom))
        return img, {
            **info,
            "crop_rel_x": left,
            "crop_rel_y": top,
            "crop_width": right - left,
            "crop_height": bottom - top,
        }

    def grab_region(self, x: int, y: int, width: int, height: int, shutter_sounds: str = "none") -> Image.Image:
        """絶対座標で領域を切り出す"""
        if shutter_sounds == "auto":
            self._play_shutter_sound()
        min_x, min_y = self._monitor_offsets()
        all_img = self._grab_all()
        left = x - min_x
        top  = y - min_y
        return all_img.crop((left, top, left + width, top + height))

    def grab_window(self, title: str, shutter_sounds: str = "none") -> tuple[Image.Image, dict]:
        """
        ウィンドウタイトル（部分一致）でウィンドウをキャプチャする。
        Windows 専用（ctypes 使用、pywin32 不要）。

        Returns:
            (image, info_dict)  info_dict: hwnd, title, x, y, width, height
        """
        if shutter_sounds == "auto":
            self._play_shutter_sound()

        if os.name != "nt":
            raise DesktopCaptureError("ウィンドウキャプチャは Windows のみ対応しています")

        import ctypes
        from ctypes import wintypes

        found: dict = {}

        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        @EnumProc
        def _enum_cb(hwnd, lparam):
            if not ctypes.windll.user32.IsWindowVisible(hwnd):
                return True
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            win_title = buf.value
            if title.lower() in win_title.lower():
                found["hwnd"]  = hwnd
                found["title"] = win_title
                return False  # 最初にヒットしたものを使用
            return True

        ctypes.windll.user32.EnumWindows(_enum_cb, 0)

        if not found:
            raise DesktopCaptureError(f"ウィンドウが見つかりません: '{title}'")

        hwnd = found["hwnd"]
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))

        x, y = rect.left, rect.top
        w, h = rect.right - rect.left, rect.bottom - rect.top
        if w <= 0 or h <= 0:
            raise DesktopCaptureError(f"ウィンドウサイズが不正です: '{found['title']}'")

        img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
        return img, {
            "hwnd":   hwnd,
            "title":  found["title"],
            "x": x, "y": y,
            "width": w, "height": h,
        }

    def list_windows(self) -> list[dict]:
        """
        表示中ウィンドウの一覧を返す。
        Windows 専用（ctypes 使用、pywin32 不要）。
        """
        if os.name != "nt":
            return []

        import ctypes
        from ctypes import wintypes

        windows: list[dict] = []

        EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        @EnumProc
        def _enum_cb(hwnd, lparam):
            if not ctypes.windll.user32.IsWindowVisible(hwnd):
                return True
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            win_title = buf.value
            if win_title:
                rect = wintypes.RECT()
                ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
                w = rect.right  - rect.left
                h = rect.bottom - rect.top
                if w > 0 and h > 0:
                    windows.append({
                        "hwnd":   hwnd,
                        "title":  win_title,
                        "x":      rect.left,
                        "y":      rect.top,
                        "width":  w,
                        "height": h,
                    })
            return True

        ctypes.windll.user32.EnumWindows(_enum_cb, 0)
        return windows

    # ------------------------------------------------------------------ #
    # アノテーション
    # ------------------------------------------------------------------ #

    def annotate(
        self,
        img: Image.Image,
        crosshair_pos: Optional[tuple[int, int]] = None,
        label_text: Optional[str] = None,
    ) -> Image.Image:
        """
        画像にアノテーションを追加する。

        Args:
            crosshair_pos: 十字線を描く座標（画像内相対座標）
            label_text: 右下に表示するラベルテキスト
        """
        img = img.copy()
        draw = ImageDraw.Draw(img)

        if crosshair_pos:
            cx, cy = crosshair_pos
            color = (255, 50, 50)
            arm   = 20
            thick = 2
            draw.line([(cx - arm, cy), (cx + arm, cy)], fill=color, width=thick)
            draw.line([(cx, cy - arm), (cx, cy + arm)], fill=color, width=thick)
            r = 8
            draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)], outline=color, width=thick)

        if label_text:
            w, h = img.size
            margin = 4
            # フォントサイズ推定（デフォルトフォントは約10px幅/文字）
            char_w, char_h = 8, 14
            text_w = len(label_text) * char_w
            bx0 = w - text_w - margin * 2
            by0 = h - char_h - margin * 2
            draw.rectangle([(bx0, by0), (w, h)], fill=(0, 0, 0, 180))
            draw.text((bx0 + margin, by0 + margin), label_text, fill=(255, 255, 255))

        return img

    # ------------------------------------------------------------------ #
    # 出力
    # ------------------------------------------------------------------ #

    def _resolve_default_output_dir(self) -> str:
        """プロジェクトルート起点で DEFAULT_OUTPUT_DIR を絶対パス化する"""
        project_root = Path(__file__).resolve().parent.parent.parent
        return str(project_root / self.DEFAULT_OUTPUT_DIR)

    @staticmethod
    def _is_directory_path(path: str) -> bool:
        """save_path をフォルダ扱いとするか判定する。
           - 既存ディレクトリ
           - 末尾が / または \\
           - 拡張子なし
        """
        if os.path.isdir(path):
            return True
        if path.endswith(("/", "\\")):
            return True
        if not os.path.splitext(path)[1]:
            return True
        return False

    def to_base64(
        self,
        img: Image.Image,
        fmt: str = "png",
        quality: int = 85,
        save_path: Optional[str] = None,
        return_base64: bool = True,
    ) -> tuple[str, str]:
        """PIL Image を保存し、(base64, 保存先パス) を返す。

        return_base64=False なら base64 は空文字にする。呼び出し側が保存先を
        知っているのに同じ画像を base64 でも返すと、文脈が二重に膨らむため。

        Args:
            fmt: "png" または "jpeg"
            quality: JPEG 品質 (1-100)
            save_path: 保存先。
                       フォルダ指定（既存ディレクトリ / 末尾 / または \\ / 拡張子なし）なら
                       そのフォルダに yyyymmdd.hhmmss.png で保存（常に PNG）。
                       ファイル指定（拡張子あり）なら指定ファイルに上書き保存（拡張子に合わせて変換）。
                       None なら DEFAULT_OUTPUT_DIR にデフォルト保存。
        """
        buf = io.BytesIO()
        fmt_upper = fmt.upper()
        if fmt_upper in ("JPEG", "JPG"):
            img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=quality, optimize=True)
        else:
            img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()

        if save_path is None:
            save_path = self._resolve_default_output_dir()

        if self._is_directory_path(save_path):
            # フォルダ指定 → yyyymmdd.hhmmss.png で保存（常に PNG）
            os.makedirs(save_path, exist_ok=True)
            fname = datetime.now().strftime("%Y%m%d.%H%M%S") + ".png"
            dest = os.path.join(save_path, fname)
            file_buf = io.BytesIO()
            img.save(file_buf, format="PNG", optimize=True)
            file_data = file_buf.getvalue()
        else:
            # ファイル指定 → 拡張子に合わせて変換して上書き保存
            dest = save_path
            parent = os.path.dirname(os.path.abspath(dest))
            if parent:
                os.makedirs(parent, exist_ok=True)
            ext = os.path.splitext(save_path)[1].lower()
            if ext in (".jpg", ".jpeg"):
                file_buf = io.BytesIO()
                img.convert("RGB").save(file_buf, format="JPEG", quality=quality, optimize=True)
                file_data = file_buf.getvalue()
            else:
                # .png その他 → PNG で保存
                file_buf = io.BytesIO()
                img.save(file_buf, format="PNG", optimize=True)
                file_data = file_buf.getvalue()
        with open(dest, "wb") as f:
            f.write(file_data)

        if not return_base64:
            return "", dest
        return base64.b64encode(data).decode("ascii"), dest
