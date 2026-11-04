# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""予測呼出し内だけ、本文や例外を通常ログへ残さない。"""
from contextlib import contextmanager
from contextvars import ContextVar
import logging
from threading import Lock


_private = ContextVar("aidiy_prediction_private", default=False)
_install_lock = Lock()


def _install_redaction():
    # ロガー追加・SDK遅延import後も適用し、並行する通常チャットのログは変えない。
    with _install_lock:
        original = logging.getLogRecordFactory()
        if getattr(original, "_aidiy_prediction_redaction", False):
            return

        def factory(*args, **kwargs):
            record = original(*args, **kwargs)
            if _private.get():
                record.msg = "[Prediction] 非保存処理（本文・例外詳細は記録しません）"
                record.args = ()
                record.exc_info = None
                record.exc_text = None
                record.stack_info = None
            return record

        factory._aidiy_prediction_redaction = True
        logging.setLogRecordFactory(factory)


@contextmanager
def prediction_private_logs():
    _install_redaction()
    token = _private.set(True)
    try:
        yield
    finally:
        _private.reset(token)
