# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Chrome プロセス管理

Chrome を --remote-debugging-port で自動起動・状態確認する。
"""

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from log_config import get_logger

logger = get_logger(__name__)

# Windows での Chrome/Edge 候補パス
_CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Users\{username}\AppData\Local\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    # Linux / macOS
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

# 専用プロファイルディレクトリ (ユーザーの通常プロファイルと分離)
_PROFILE_DIR = str(Path(__file__).parent.parent / "temp" / "_chrome_profile")

# Chrome の CDP は同一マシン内だけで使う。Windows のシステムプロキシや
# localhost の IPv6 -> IPv4 フォールバックを経由すると、疎通確認だけで
# 数秒かかる環境があるため、IPv4 loopback と proxy 無効の opener を固定する。
_LOOPBACK_HOST = "127.0.0.1"
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# launch() は呼び出しのたびに /json/version へ疎通確認していたため、
# 連続するツール呼び出しのたびに HTTP ラウンドトリップが発生していた。
# 直近の疎通確認から一定時間は結果を信用し、確認を省略する。
_VERIFIED_TTL = 5.0


class ChromeManager:
    """
    Chrome プロセスの起動・状態管理

    is_running() で疎通確認し、起動していなければ launch() で起動する。
    ensure_running() を呼ぶだけで自動起動まで完了する。
    """

    def __init__(
        self,
        debug_port: int = 9222,
        profile_dir: str = _PROFILE_DIR,
        show_automation_banner: bool = True,
        headless: bool = False,
    ):
        self.debug_port = debug_port
        self.profile_dir = profile_dir
        self.show_automation_banner = show_automation_banner
        self.headless = headless
        self._process: subprocess.Popen | None = None
        self._verified_until: float = 0.0

    # ------------------------------------------------------------------ #
    # 状態確認
    # ------------------------------------------------------------------ #

    def is_running(self) -> bool:
        """Chrome がデバッグポートで応答しているか確認"""
        url = f"http://{_LOOPBACK_HOST}:{self.debug_port}/json/version"
        try:
            with _NO_PROXY_OPENER.open(url, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False

    def is_verified(self) -> bool:
        """
        直近の疎通確認 TTL 内かどうかを HTTP 通信なしで返す。
        呼び出し側のホットパス（既に起動確認済みのセッション）で
        launch()/is_running() のスレッド・HTTP 往復を避けるために使う。
        """
        return time.monotonic() < self._verified_until

    def mark_unreachable(self) -> None:
        """
        疎通確認 TTL を即時失効させる。CDP コマンドが WebSocket 接続エラーで
        失敗した際に呼び、TTL 満了を待たず次回呼び出しで再確認させる。
        """
        self._verified_until = 0.0

    def get_version(self) -> dict | None:
        """Chrome のバージョン情報を返す (未起動時は None)"""
        import json

        url = f"http://{_LOOPBACK_HOST}:{self.debug_port}/json/version"
        try:
            with _NO_PROXY_OPENER.open(url, timeout=2) as resp:
                return json.loads(resp.read().decode())
        except Exception:
            return None

    # ------------------------------------------------------------------ #
    # 起動
    # ------------------------------------------------------------------ #

    def find_chrome(self) -> str | None:
        """Chrome / Edge の実行ファイルパスを返す (見つからなければ None)"""
        username = os.environ.get("USERNAME", os.environ.get("USER", ""))
        for candidate in _CHROME_CANDIDATES:
            path = candidate.format(username=username)
            if Path(path).exists():
                return path

        # 環境変数で明示指定されている場合
        env_path = os.environ.get("CHROME_EXECUTABLE")
        if env_path and Path(env_path).exists():
            return env_path

        return None

    def _build_launch_args(
        self,
        chrome_path: str,
        show_automation_banner: bool | None = None,
        url: str | None = None,
    ) -> list[str]:
        """Chrome 起動引数を組み立てる。

        url を渡すと起動時にそのページを開く。--autoplay-policy などの
        起動引数はプロセス単位で効くため、音声つき自動再生を確実にしたい
        ページは navigate ではなく起動引数として URL を渡す。
        """
        should_show_banner = (
            self.show_automation_banner
            if show_automation_banner is None
            else bool(show_automation_banner)
        )

        args = [
            chrome_path,
            f"--remote-debugging-port={self.debug_port}",
            f"--user-data-dir={self.profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--autoplay-policy=no-user-gesture-required",
            # パスワード保存・変更提案・漏洩検知・自動パスワード変更フローをすべて抑制
            # (PasswordChangeSubmission は漏洩検知後に表示される「パスワードを変更」誘導フロー本体)
            "--disable-features=PasswordManagerOnboarding,AutofillEnableAccountWalletStorage,"
            "PasswordLeakDetection,PasswordCheck,PasswordChangeSubmission,"
            "FetchChangePasswordUrlForPasswordChange,AutofillPasswordSurvey",
        ]
        if should_show_banner:
            args.append("--enable-automation")
        if self.headless:
            args.append("--headless=new")
            args.append("--window-size=1920,1080")
        if url:
            # URL は必ず最後に置く（Chrome はオプションの後ろの引数を開く URL として扱う）
            args.append(url)
        return args


    def _open_url_in_running(self, url: str) -> bool:
        """起動済み Chrome の同じプロファイルへ URL を開く。戻り値は実行できたか。

        Chrome は同じ --user-data-dir で再実行すると、プロセスを増やさず起動中の
        インスタンスへ URL を転送して新しいタブで開く。--autoplay-policy などの
        起動引数は最初に起動したプロセスのものが効き続けるため、ここでは URL だけ渡す。
        """
        chrome_path = self.find_chrome()
        if not chrome_path:
            logger.warning("Chrome が見つからないため URL を開けませんでした")
            return False
        try:
            subprocess.Popen(
                [chrome_path, f"--user-data-dir={self.profile_dir}", url],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception as e:
            logger.warning(f"起動済み Chrome への URL オープンに失敗しました: {e}")
            return False

    def _kill_on_debug_port(self) -> bool:
        """デバッグポートを使用している Chrome プロセスだけを停止する"""
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), capture_output=True, text=True, timeout=5,
            )
            pid = None
            for line in result.stdout.splitlines():
                if f":{self.debug_port}" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if parts:
                        pid = int(parts[-1])
                        break
            if pid:
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/F"],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), capture_output=True, timeout=5,
                )
                logger.info(f"Chrome プロセス (PID={pid}, port={self.debug_port}) を停止しました")
                time.sleep(1.5)
                return True
        except Exception as e:
            logger.warning(f"Chrome 停止に失敗: {e}")
        return False

    def _setup_profile(self) -> None:
        """Chrome プロファイルのパスワード関連設定を初期化する"""
        import json

        prefs_dir = Path(self.profile_dir) / "Default"
        prefs_dir.mkdir(parents=True, exist_ok=True)

        # 保存済みパスワード DB を削除（漏洩検知警告の原因）
        # Chrome 起動中はファイルがロックされるので、必要なら先に止める
        for db_file in ("Login Data", "Login Data-journal"):
            db_path = prefs_dir / db_file
            if db_path.exists():
                try:
                    db_path.unlink()
                    logger.info(f"Chrome: {db_file} を削除しました（保存パスワードをクリア）")
                except Exception:
                    # ロック中 → Chrome を止めてから再試行
                    logger.info(f"Chrome: {db_file} がロック中 — Chrome を停止して再試行します")
                    self._kill_on_debug_port()
                    try:
                        db_path.unlink()
                        logger.info(f"Chrome: {db_file} を削除しました（再試行成功）")
                    except Exception as e2:
                        logger.warning(f"Chrome: {db_file} の削除に失敗: {e2}")

        # Preferences でパスワードマネージャー・漏洩検知を無効化
        prefs_path = prefs_dir / "Preferences"
        existing: dict = {}
        if prefs_path.exists():
            try:
                existing = json.loads(prefs_path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}

        existing.setdefault("profile", {})
        existing["credentials_enable_service"] = False
        existing["profile"]["password_manager_enabled"] = False
        # 実際の pref キーは "profile.password_manager_leak_detection"。
        # "password_manager.leak_detection_enabled" は存在しないキーで無効だった。
        existing["profile"]["password_manager_leak_detection"] = False
        existing.setdefault("safebrowsing", {})
        existing["safebrowsing"]["password_protection_warning_trigger"] = 0

        prefs_path.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info("Chrome Preferences: パスワードマネージャー無効設定を書き込みました")

    def launch(
        self,
        wait_timeout: float = 30.0,
        show_automation_banner: bool | None = None,
        url: str | None = None,
    ) -> str:
        """
        Chrome をリモートデバッグモードで起動する。

        Args:
            wait_timeout: 起動完了待ちのタイムアウト秒数
            show_automation_banner: True で「自動操作中」の帯表示あり。
                                    None の場合は現在の既定値を使う。
            url: 指定するとそのページを開く。未起動なら起動引数として渡し、
                 起動済みなら同じプロファイルへ新しいタブで開く。

        Returns:
            "already_running" | "launched" | "launch_failed"

        Raises:
            FileNotFoundError: Chrome が見つからない場合
        """
        if time.monotonic() < self._verified_until:
            if url:
                self._open_url_in_running(url)
            return "already_running"

        if self.is_running():
            self._verified_until = time.monotonic() + _VERIFIED_TTL
            if url:
                self._open_url_in_running(url)
            return "already_running"

        chrome_path = self.find_chrome()
        if not chrome_path:
            raise FileNotFoundError(
                "Chrome / Edge が見つかりません。\n"
                "環境変数 CHROME_EXECUTABLE にパスを指定するか、\n"
                "Chrome をインストールしてください。"
            )

        args = self._build_launch_args(chrome_path, show_automation_banner, url)
        self._setup_profile()

        logger.info(f"起動: {chrome_path}")
        self._process = subprocess.Popen(
            args,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # 起動完了を待つ
        deadline = time.monotonic() + wait_timeout
        while time.monotonic() < deadline:
            if self.is_running():
                self._verified_until = time.monotonic() + _VERIFIED_TTL
                logger.info(f"起動完了 (port={self.debug_port})")
                return "launched"
            time.sleep(0.3)

        logger.warning(f"起動タイムアウト ({wait_timeout}秒経過) — Chrome プロセスは起動しましたがデバッグポートが応答しませんでした")
        return "launch_failed"

    def ensure_running(
        self,
        show_automation_banner: bool | None = None,
        url: str | None = None,
    ) -> str:
        """
        Chrome が起動していなければ自動起動する。

        Args:
            url: 指定するとそのページを開く（未起動時は起動引数として渡す）。

        Returns:
            "already_running" | "launched" | "launch_failed"

        Raises:
            FileNotFoundError: Chrome が見つからない場合
        """
        # launch() が疎通確認と、必要な場合だけプロファイル初期化・起動を行う。
        # ここで先に is_running() を呼ぶと全リクエストで疎通が二重になる。
        return self.launch(show_automation_banner=show_automation_banner, url=url)
