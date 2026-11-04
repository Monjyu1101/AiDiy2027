# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Chrome セッションレジストリ

セッション名（自由な文字列）ごとに独立した Chrome インスタンス
（デバッグポート + プロファイルディレクトリ）を管理する。

- セッション名は内部で連番キー (s0001, s0002, ...) へ辞書変換するため、
  "../" や "M得意先" などどんな文字列でも安全に扱える
  （セッション名がそのままファイルパスになることはない）。
- 対応表は temp/_chrome_sessions.json に永続化し、backend_tools
  再起動後も稼働中の Chrome へ同じセッション名で再接続できる。
- "default" セッションは従来どおりポート 9222 + temp/_chrome_profile を使う
  （後方互換: session 省略時の挙動は従来と同一）。
"""

import json
import socket
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from log_config import get_logger

from tools_proc.chrome_manager import ChromeManager
from tools_proc.chrome_devtools import CDPClient
from tools_proc.ide_browser_session import is_ide_session, is_reserved_browser_session, read_ide_session, IDEBrowserManager, IDEBrowserClient

logger = get_logger(__name__)

_TEMP_DIR = Path(__file__).parent.parent / "temp"
_SESSIONS_FILE = _TEMP_DIR / "_chrome_sessions.json"

DEFAULT_SESSION = "default"


def _port_is_free(port: int) -> bool:
    """ポートが未使用 (LISTEN していない) か確認する"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        return s.connect_ex(("127.0.0.1", port)) != 0


class ChromeSessionRegistry:
    """
    セッション名 → (ChromeManager, CDPClient) の対応を管理する。

    get() で取得（未登録なら新規割り当て）、close() で該当 Chrome を停止する。
    セッション名→内部キー→ポート の対応は JSON に永続化される。
    """

    def __init__(
        self,
        default_port: int = 9222,
        port_range: tuple[int, int] = (9223, 9299),
        sessions_file: Path = _SESSIONS_FILE,
    ):
        self.default_port = default_port
        self.port_range = port_range
        self.sessions_file = Path(sessions_file)
        self._lock = threading.Lock()
        # name -> {"key": str, "port": int, "headless": bool}
        self._sessions: dict[str, dict] = {}
        self._next_seq: int = 1
        # name -> (ChromeManager, CDPClient)
        self._instances: dict[str, tuple[ChromeManager, CDPClient]] = {}
        self._ide_directory = self.sessions_file.parent / "_ide_browser_sessions"
        self._ide_instances = {}
        self._load()

    # ------------------------------------------------------------------ #
    # 永続化
    # ------------------------------------------------------------------ #

    def _load(self) -> None:
        if not self.sessions_file.exists():
            return
        try:
            data = json.loads(self.sessions_file.read_text(encoding="utf-8"))
            self._sessions = data.get("sessions", {})
            self._next_seq = int(data.get("next_seq", 1))
        except Exception as e:
            logger.warning(f"セッション対応表の読み込みに失敗（初期化します）: {e}")
            self._sessions = {}
            self._next_seq = 1

    def _save(self) -> None:
        try:
            self.sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self.sessions_file.write_text(
                json.dumps(
                    {"next_seq": self._next_seq, "sessions": self._sessions},
                    ensure_ascii=False, indent=2,
                ),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"セッション対応表の保存に失敗: {e}")

    # ------------------------------------------------------------------ #
    # 内部ヘルパー
    # ------------------------------------------------------------------ #

    def _profile_dir(self, key: str) -> str:
        """内部キーからプロファイルディレクトリを決める（default は従来位置）"""
        if key == DEFAULT_SESSION:
            return str(_TEMP_DIR / "_chrome_profile")
        return str(_TEMP_DIR / f"_chrome_profile_{key}")

    def _allocate_port(self) -> int:
        """未割り当てかつ未使用のデバッグポートを探す"""
        assigned = {info["port"] for info in self._sessions.values()}
        assigned.add(self.default_port)
        for port in range(self.port_range[0], self.port_range[1] + 1):
            if port in assigned:
                continue
            if _port_is_free(port):
                return port
        raise RuntimeError(
            f"空きデバッグポートがありません "
            f"({self.port_range[0]}-{self.port_range[1]})"
        )

    def _chrome_responding(self, port: int) -> bool:
        """ポートで Chrome デバッグ API が応答しているか確認する"""
        return ChromeManager(debug_port=port).is_running()

    def _resolve_entry(self, name: str, headless: bool | None) -> dict:
        """セッション名のエントリを返す（未登録なら新規割り当て）。要ロック内呼び出し"""
        entry = self._sessions.get(name)
        if entry is None:
            if name == DEFAULT_SESSION:
                entry = {"key": DEFAULT_SESSION, "port": self.default_port,
                         "headless": bool(headless)}
            else:
                key = f"s{self._next_seq:04d}"
                self._next_seq += 1
                entry = {"key": key, "port": self._allocate_port(),
                         "headless": bool(headless)}
            self._sessions[name] = entry
            self._save()
            logger.info(
                f"Chrome セッション登録: '{name}' → key={entry['key']}, "
                f"port={entry['port']}, headless={entry['headless']}"
            )
            return entry

        # 既存エントリ: ポートが他プロセスに奪われていたら再割り当て
        # （Chrome 応答ありなら再接続、応答なし かつ ポート使用中なら別アプリ）
        if (
            name not in self._instances
            and not self._chrome_responding(entry["port"])
            and not _port_is_free(entry["port"])
        ):
            if name != DEFAULT_SESSION:
                old_port = entry["port"]
                entry["port"] = self._allocate_port()
                self._save()
                self._instances.pop(name, None)
                logger.warning(
                    f"Chrome セッション '{name}' のポート {old_port} が他プロセスに"
                    f"使用されているため {entry['port']} へ再割り当てしました"
                )

        if headless is not None and entry.get("headless") != bool(headless):
            entry["headless"] = bool(headless)
            self._save()
            inst = self._instances.get(name)
            if inst:
                inst[0].headless = bool(headless)

        return entry

    # ------------------------------------------------------------------ #
    # 公開 API
    # ------------------------------------------------------------------ #

    def get(
        self,
        name: str = DEFAULT_SESSION,
        headless: bool | None = None,
    ) -> tuple[ChromeManager, CDPClient]:
        """
        セッション名に対応する (ChromeManager, CDPClient) を返す。
        未登録なら新規にポート・プロファイルを割り当てる（Chrome の起動はしない。
        起動は ChromeManager.ensure_running() 側で行う）。

        Args:
            name: セッション名（自由な文字列。省略時 "default"）
            headless: 指定時はセッションの headless 設定を更新する
                      （稼働中の Chrome には次回起動から反映）
        """
        name = name or DEFAULT_SESSION
        if is_reserved_browser_session(name) or (is_ide_session(name) and name not in self._sessions):
            entry = read_ide_session(self._ide_directory, name)
            if entry is None:
                raise RuntimeError('aidiy_browserを起動するか、IDEをtoolsへ接続し「＋ Browser」を開いてください。')
            with self._lock:
                inst = self._ide_instances.get(name)
                if inst is None or inst[0].entry != entry:
                    manager, cdp = IDEBrowserManager(entry), IDEBrowserClient(entry)
                    cdp._on_unreachable = manager.mark_unreachable
                    inst = (manager, cdp)
                    self._ide_instances[name] = inst
                return inst
        with self._lock:
            entry = self._resolve_entry(name, headless)
            inst = self._instances.get(name)
            if inst is None:
                manager = ChromeManager(
                    debug_port=entry["port"],
                    profile_dir=self._profile_dir(entry["key"]),
                )
                manager.headless = bool(entry.get("headless", False))
                cdp = CDPClient(port=entry["port"])
                cdp._on_unreachable = manager.mark_unreachable
                inst = (manager, cdp)
                self._instances[name] = inst
            return inst

    def peek(self, name: str = DEFAULT_SESSION) -> tuple[ChromeManager, CDPClient] | None:
        """
        登録済みインスタンスがあればロック取得のみで即座に返す（起動確認や
        ポート再割り当ては行わない）。ホットパス用の高速版で、未登録／
        未起動の場合は None を返すので、その場合は get() を使うこと。
        """
        name = name or DEFAULT_SESSION
        if is_reserved_browser_session(name) or (is_ide_session(name) and name not in self._sessions):
            try:
                return self.get(name)
            except RuntimeError:
                return None
        with self._lock:
            return self._instances.get(name)

    def list(self) -> list[dict]:
        """登録済みセッションの一覧（稼働状態付き）を返す"""
        with self._lock:
            items = list(self._sessions.items())
        result = []
        for name, entry in items:
            if is_reserved_browser_session(name):
                continue
            result.append({
                "session": name,
                "key": entry["key"],
                "port": entry["port"],
                "headless": bool(entry.get("headless", False)),
                "running": self._chrome_responding(entry["port"]),
                "profile_dir": self._profile_dir(entry["key"]),
            })
        for path in self._ide_directory.glob("aidiy_*.json"):
            name = path.stem
            if name in self._sessions and not is_reserved_browser_session(name):
                continue
            entry = read_ide_session(self._ide_directory, name)
            if entry:
                result.append({"session": name, "key": name, "port": entry["port"],
                               "headless": False, "running": IDEBrowserManager(entry).is_running(),
                               "profile_dir": "", "owner": "aidiy_browser" if name.startswith("aidiy_browser") else "aidiy_ide"})
        return result

    def close(self, name: str) -> bool:
        """
        セッションの Chrome を停止する。
        対応表・プロファイルは残すため、同じセッション名で再起動すると
        ログイン状態などを引き継げる。

        Returns:
            True = 停止した / False = 稼働していなかった
        """
        name = name or DEFAULT_SESSION
        if is_reserved_browser_session(name) or (is_ide_session(name) and name not in self._sessions):
            try:
                manager, _ = self.get(name)
                return manager.close()
            except RuntimeError:
                return False
            finally:
                with self._lock:
                    self._ide_instances.pop(name, None)
        with self._lock:
            entry = self._sessions.get(name)
        if entry is None:
            return False
        manager, _ = self.get(name)
        if not manager.is_running():
            with self._lock:
                self._instances.pop(name, None)
            return False
        stopped = manager._kill_on_debug_port()
        if stopped:
            with self._lock:
                # 次回は新しい CDPClient を生成し、停止前の WebSocket
                # キャッシュを再利用しない。
                self._instances.pop(name, None)
            logger.info(f"Chrome セッション '{name}' (port={entry['port']}) を停止しました")
        return stopped

    def delete(self, name: str) -> bool:
        """
        セッションを削除する（Chrome 停止 + 対応表から除去）。
        プロファイルディレクトリは残す（必要なら手動削除）。
        """
        name = name or DEFAULT_SESSION
        if is_reserved_browser_session(name) or (is_ide_session(name) and name not in self._sessions):
            # 登録ファイルはIDEが所有する。削除要求もBrowserパネルだけを閉じる。
            return self.close(name)
        self.close(name)
        time.sleep(0.2)
        with self._lock:
            existed = self._sessions.pop(name, None) is not None
            self._instances.pop(name, None)
            if existed:
                self._save()
        return existed
