# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
共通ログ設定モジュール
全モジュールで統一されたログ設定を提供
"""
import logging
import os
import sys
from datetime import datetime

# ログ設定済みフラグ
_logging_configured = False


class ByteAlignedFormatter(logging.Formatter):
    """
    ロガー名をShift_JISバイト幅で揃えるフォーマッタ
    - 24バイト以下: 半角スペースで右埋め
    - 24バイト超過: そのまま表示（切り詰めない）
    """

    def __init__(self, fmt: str, datefmt: str | None = None, name_width_bytes: int = 24, encoding: str = "shift_jis"):
        super().__init__(fmt=fmt, datefmt=datefmt)
        self.name_width_bytes = max(0, int(name_width_bytes))
        self.encoding = encoding

    def _byte_width(self, text: str) -> int:
        try:
            return len(text.encode(self.encoding, errors="replace"))
        except Exception:
            return len(text.encode("shift_jis", errors="replace"))

    def _pad_name_by_width(self, name: str) -> str:
        text = str(name)
        width = self._byte_width(text)
        if width >= self.name_width_bytes:
            return text
        return text + (" " * (self.name_width_bytes - width))

    def format(self, record: logging.LogRecord) -> str:
        record.name_aligned = self._pad_name_by_width(record.name)
        return super().format(record)


def _detect_instance_name() -> str:
    """
    起動引数からインスタンス名を推定する
    """
    args = " ".join(sys.argv).lower()
    if "core_main:app" in args or "core_main.py" in args:
        return "core_main"
    if "apps_main:app" in args or "apps_main.py" in args:
        return "apps_main"
    return "AiDiy"


class EndpointFilter(logging.Filter):
    """
    特定のエンドポイントへのアクセスログをフィルタリングするクラス
    """

    def __init__(self, excluded_endpoints: list):
        super().__init__()
        self.excluded_endpoints = excluded_endpoints

    def filter(self, record: logging.LogRecord) -> bool:
        # record.getMessage()でログメッセージ全体を取得
        message = record.getMessage()

        # 除外するエンドポイントがメッセージに含まれている場合はFalse（ログを出力しない）
        for endpoint in self.excluded_endpoints:
            if endpoint in message:
                return False

        # それ以外はTrue（ログを出力する）
        return True


class DailyDateFileHandler(logging.FileHandler):
    """
    1時間ごとにログファイルを切り替えるハンドラ
    例: temp/logs/yyyymmdd.hh0000.AiDiy.log
    """

    def __init__(self, log_dir: str, prefix: str = "AiDiy", encoding: str = "utf-8"):
        self.log_dir = log_dir
        self.prefix = prefix
        self._current_datetime = datetime.now().strftime("%Y%m%d.%H0000")
        os.makedirs(self.log_dir, exist_ok=True)
        super().__init__(self._build_filename(self._current_datetime), mode="a", encoding=encoding, delay=True)

    def _build_filename(self, datetime_str: str) -> str:
        return os.path.join(self.log_dir, f"{datetime_str}.{self.prefix}.log")

    def emit(self, record: logging.LogRecord) -> None:
        try:
            current_datetime = datetime.now().strftime("%Y%m%d.%H0000")
            if current_datetime != self._current_datetime:
                self._current_datetime = current_datetime
                self.baseFilename = os.path.abspath(self._build_filename(current_datetime))
                if self.stream:
                    self.stream.close()
                    self.stream = None
            super().emit(record)
        except Exception:
            self.handleError(record)


def setup_logging(instance_name: str | None = None):
    """
    アプリケーション全体のログ設定を初期化
    最初に1回だけ呼ばれる
    """
    global _logging_configured

    if _logging_configured:
        return

    instance = (instance_name or _detect_instance_name()).strip() or "AiDiy"
    log_dir = os.path.join(os.path.dirname(__file__), "temp", "logs")
    formatter = ByteAlignedFormatter(
        '%(asctime)s - %(name_aligned)s - %(levelname)-8s - %(message)s',
        datefmt='%H:%M:%S'
    )
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    file_handler = DailyDateFileHandler(log_dir=log_dir, prefix=instance)
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=logging.INFO,
        handlers=[console_handler, file_handler],
        force=True,
    )

    # 特定のライブラリのログレベルを調整
    logging.getLogger('matplotlib.font_manager').setLevel(logging.WARNING)
    logging.getLogger('comtypes.client._code_cache').setLevel(logging.WARNING)
    logging.getLogger('uvicorn').setLevel(logging.WARNING)
    logging.getLogger('uvicorn.error').setLevel(logging.WARNING)
    logging.getLogger('uvicorn.access').setLevel(logging.WARNING)
    logging.getLogger('uvicorn.app').setLevel(logging.WARNING)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('google_genai').setLevel(logging.WARNING)
    logging.getLogger('asyncio').setLevel(logging.CRITICAL)  # asyncio ProactorエラーやCallbackエラーを抑制

    # Uvicornログを共通フォーマットに統一（Uvicorn独自ハンドラを除去してrootへ伝播）
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "uvicorn.app"):
        target = logging.getLogger(name)
        target.handlers = []
        target.propagate = True

    # Uvicornのアクセスログに対してフィルタを設定
    uvicorn_logger = logging.getLogger("uvicorn.access")

    # 除外するエンドポイントのリスト
    excluded_endpoints = [
        "/core/サーバー状態",  # サーバー状態取得（頻繁に呼ばれる）
        "/core/%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC%E7%8A%B6%E6%85%8B",  # URLエンコード版
    ]

    # フィルタを追加
    endpoint_filter = EndpointFilter(excluded_endpoints)
    uvicorn_logger.addFilter(endpoint_filter)

    _logging_configured = True

    # 初期化完了ログ
    logger = logging.getLogger('log_config')
    logger.info(f"ログ設定を初期化しました (instance={instance})")
    logger.debug("サーバー状態取得のアクセスログを非表示にしました")


def get_logger(module_name: str) -> logging.Logger:
    """
    モジュール用のロガーを取得

    使用例:
        from log_config import get_logger
        logger = get_logger(__name__)
        logger.info("メッセージ")

    Args:
        module_name: モジュール名（通常は __name__ を渡す）

    Returns:
        logging.Logger: 設定済みロガー
    """
    # ログ設定が未初期化の場合は初期化
    if not _logging_configured:
        setup_logging()

    return logging.getLogger(module_name)
