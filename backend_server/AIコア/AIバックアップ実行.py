# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""接続を止めないバックアップ実行。同一プロセス・対象パスの重複要求は再実行しない。"""
import asyncio
import os
import threading
from concurrent.futures import Future

from AIコア.AIバックアップ import バックアップ実行_共通ログ, コードベース絶対パス取得
from log_config import get_logger

logger = get_logger("バックアップ実行")
_実行中 = {}
_実行中ロック = threading.Lock()


def 対象パスキー(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def バックアップ開始(*, 呼出しロガー=None, アプリ設定=None, backend_dir=None, セッション設定=None):
    """即時に Future を返す。実行中ならその結果を共有し、追加の処理は起動しない。"""
    log = 呼出しロガー or logger
    settings = dict(セッション設定 or {})
    path = コードベース絶対パス取得(アプリ設定, backend_dir, settings)
    key = 対象パスキー(path)
    # 呼出し後にプロジェクト設定が切り替わっても、受付時の対象を処理する。
    settings["CODE_BASE_PATH"] = path
    with _実行中ロック:
        if key in _実行中:
            log.info(f"バックアップ起動を省略(実行中: {path})")
            return _実行中[key]
        future = Future()
        # 待機側のキャンセルで処理中の Future を取り消せないようにする。
        future.set_running_or_notify_cancel()
        _実行中[key] = future

    def run():
        result, error = None, None
        try:
            result = バックアップ実行_共通ログ(
                呼出しロガー=log, アプリ設定=アプリ設定,
                backend_dir=backend_dir, セッション設定=settings,
            )
        except BaseException as exc:
            error = exc
            log.exception("バックアップスレッドでエラーが発生しました")
        finally:
            try:
                # 完了通知を先に発行し、後続バックアップの結果が先に適用される競合を防ぐ。
                # コールバック中の再要求を許すため、ロックを保持して通知しない。
                if error is None:
                    future.set_result(result)
                else:
                    future.set_exception(error)
            finally:
                # asyncio の待機取消ではなく、実際のスレッド終了時だけ解除する。
                with _実行中ロック:
                    if _実行中.get(key) is future:
                        del _実行中[key]

    try:
        threading.Thread(target=run, name="AiDiy-backup", daemon=True).start()
    except BaseException as exc:
        with _実行中ロック:
            if _実行中.get(key) is future:
                del _実行中[key]
        future.set_exception(exc)
        raise
    return future


async def バックアップ完了待機(**kwargs):
    """結果依存の処理は完了を待つが、Core の event loop は止めない。"""
    future = バックアップ開始(**kwargs)
    return await asyncio.shield(asyncio.wrap_future(future))


def セッションバックアップ開始(session, manager, **kwargs):
    """接続は待たず、完了結果のみ生存中の同じセッション・対象へ反映する。"""
    loop = asyncio.get_running_loop()
    settings = dict(session.モデル設定)
    expected_path = 対象パスキー(コードベース絶対パス取得(
        kwargs.get("アプリ設定"), kwargs.get("backend_dir"), settings))
    future = バックアップ開始(セッション設定=settings, **kwargs)

    def apply(result):
        if manager.get_session(session.セッションID) is not session:
            return
        current_path = 対象パスキー(コードベース絶対パス取得(
            kwargs.get("アプリ設定"), kwargs.get("backend_dir"), session.モデル設定))
        if current_path != expected_path or not result:
            return
        session.ソース最終更新日時 = result[0]
        session.全ファイルリスト = result[1]
        session.バックアップベースパス = result[4]

    def completed(done):
        try:
            result = done.result()
        except BaseException:
            return  # 実行側がエラーを記録済み。接続を巻き込まない。
        try:
            loop.call_soon_threadsafe(apply, result)
        except RuntimeError:
            pass  # サーバー終了後は結果を反映しない。

    future.add_done_callback(completed)
    return future


async def セッションバックアップ完了待機(session, manager, **kwargs):
    """完了が必要な要求も、結果は同じセッション・対象にだけ反映する。"""
    future = セッションバックアップ開始(session, manager, **kwargs)
    return await asyncio.shield(asyncio.wrap_future(future))
