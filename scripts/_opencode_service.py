# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""OpenCode の常駐サービス（`opencode service`）を止める。setup / start / cleanup の停止処理の最後に使う。

OpenCode のサービスは利用者全体で1つ共有される。この作業コピーの所有ではないため、
停止できなくても各処理は中止せず、警告だけ出す。止めた後に `opencode` を実行すれば自動で再起動する。
"""
from __future__ import annotations

import shutil
import subprocess
import sys

_TIMEOUT = 30


def _find_opencode() -> str | None:
    # Windows の npm は拡張子なしのシェル用ファイルと .cmd を並べて置く。前者は直接起動できないため拡張子を明示する。
    names = ('opencode.cmd', 'opencode.exe') if sys.platform == 'win32' else ('opencode',)
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def _service(command: str, action: str) -> subprocess.CompletedProcess:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    return subprocess.run([command, 'service', action], capture_output=True, text=True,
                          encoding='utf-8', errors='replace', timeout=_TIMEOUT,
                          stdin=subprocess.DEVNULL, creationflags=flags)


def stop_opencode_service(info=print, warn=print) -> bool:
    """未導入・旧版（service なし）・停止済みなら何もしない。停止を確認できたら True。"""
    command = _find_opencode()
    if not command:
        info('OpenCode は未導入のため、常駐サービスの停止は不要です。')
        return True
    try:
        # status は停止中なら "stopped"、起動中なら URL を返す。status 自体はサービスを起動しない。
        status = _service(command, 'status')
        if status.returncode != 0:
            info('OpenCode の常駐サービスの状態を確認できないため、停止は行いません（service 未対応の版）。')
            return True
        if status.stdout.strip().lower() == 'stopped':
            info('OpenCode の常駐サービスは停止済みです。')
            return True
        info('OpenCode の常駐サービスを停止します（利用時に自動で再起動します）。')
        _service(command, 'stop')
        if _service(command, 'status').stdout.strip().lower() == 'stopped':
            info('OpenCode の常駐サービスの停止を確認しました。')
            return True
        warn('OpenCode の常駐サービスの停止を確認できませんでした。')
        return False
    except (OSError, subprocess.SubprocessError) as exc:
        warn(f'OpenCode の常駐サービスを停止できませんでした: {exc}')
        return False
