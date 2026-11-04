# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの HTTP API ルーター。

フロントエンドの AIタスク画面から Vite proxy 経由（/task/*）で呼ばれる。
レスポンスは status / message / data の統一形式。
"""

from __future__ import annotations

import json
import os
import re

from fastapi import APIRouter
from pydantic import BaseModel

from log_config import get_logger

from . import tasks_db
from . import tasks_watcher

logger = get_logger("tasks_api")

router = APIRouter(prefix="/task")

# AIエージェント（code_agents 実行中の AI 自身）が curl 等で直接呼べるよう、
# 日本語パスの percent-encode を避けた ASCII 専用の無プレフィックスルーター
check_router = APIRouter()

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class タスク要求登録リクエスト(BaseModel):
    利用者ID: str
    タイトル: str
    要求内容: str = ""


class タスク要求一覧リクエスト(BaseModel):
    利用者ID: str
    全ユーザー: bool = False


class タスク要求取得リクエスト(BaseModel):
    タスクID: str
    利用者ID: str = ""  # 空ならタスクIDだけで引く（タスクIDはAIタスク要求の単独主キー）


class タスク明細一覧リクエスト(BaseModel):
    タスクID: str


class タスク実行条件入力(BaseModel):
    """タスク要求ダイアログ右側の実行開始条件（区分は文字値）。"""
    実行区分: str = "即時"
    間隔区分: str = ""
    間隔値: int = 0
    定時区分: str = ""
    実行曜日: str = ""
    実行日: int = 0
    開始時刻: str = ""
    実行条件: str = "無し"
    監視フォルダ: str = ""


class タスク要求AI登録リクエスト(BaseModel):
    """AI登録（新規の仮登録）。

    プロジェクト / TASK_AI_NAME / TASK_AI_MODEL_plan・_do・_check は None（未指定）のとき、
    AIタスク_要求編集ダイアログの新規時と同じ条件で補完する
    （利用者IDの更新最終レコードの値 → 無ければ規定値）。
    空文字は「その値を明示指定した」扱いで、プロジェクトは空欄のまま登録する。
    """
    利用者ID: str
    タスクID: str = ""
    プロジェクト: str | None = None
    要求内容: str
    TASK_AI_NAME: str | None = None
    TASK_AI_MODEL_plan: str | None = None
    TASK_AI_MODEL_do: str | None = None
    TASK_AI_MODEL_check: str | None = None
    実行有効: bool = True
    実行条件: タスク実行条件入力 | None = None


class タスク要求更新登録リクエスト(BaseModel):
    利用者ID: str = ""  # キーはタスクID単独。互換のため受け取るだけで使わない
    タスクID: str
    プロジェクト: str = ""
    要求内容: str
    TASK_AI_NAME: str = tasks_db.TASK_AI_NAME既定
    TASK_AI_MODEL_plan: str | None = None
    TASK_AI_MODEL_do: str | None = None
    TASK_AI_MODEL_check: str | None = None
    実行有効: bool = True
    状況: str = "準備開始"  # 準備開始 / 準備完了 / 中止 / 更新前の状態
    実行条件: タスク実行条件入力 | None = None


class タスク明細全消去リクエスト(BaseModel):
    タスクID: str


class タスク実行有効切替リクエスト(BaseModel):
    利用者ID: str = ""  # キーはタスクID単独。互換のため受け取るだけで使わない
    タスクID: str
    実行有効: bool


class タスク停止検査リクエスト(BaseModel):
    """タスクが止まっていないかを読み取り専用で調べるためのリクエスト。

    タスクIDを省略すると全タスクを対象にする。停止のみ=True で止まっているものだけ返す。
    """
    タスクID: str = ""
    停止のみ: bool = False


class タスク停止復旧リクエスト(BaseModel):
    """途中停止したタスクを再開できる状態へ戻すためのリクエスト。

    復旧モード=auto は停止検査の推奨操作に従う。強制=False（既定）では
    実行中プロセスを止めず、タイムアウト中のタスクも巻き戻さない。
    """
    タスクID: str
    強制: bool = False
    復旧モード: str = "auto"  # auto / 再開 / 再分解


class タスク明細実行有効切替リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    実行有効: bool


class タスク明細更新登録リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    # do（通常実行）/ if（Y・N 判定の分岐）/ or（合流点）。開始行・終了行は SEQ で確定するので無視される
    タイプ: str = "do"
    タイトル: str
    要求内容: str = ""
    先行SEQ: str = ""
    TASK_AI_NAME: str = tasks_db.TASK_AI_NAME既定
    # 明細は各ステップの実行なので do 用モデルだけを持つ
    TASK_AI_MODEL_do: str = "auto"
    操作検証: bool = False
    実行有効: bool = True
    状態: str = "待機"


class タスク要求本登録リクエスト(BaseModel):
    利用者ID: str = ""  # 仮登録が無い場合に記録する所有者（通常は仮登録の値を引き継ぐ）
    タスクID: str
    タイトル: str
    要求内容: str = ""
    マーメイド記号: str = ""
    明細: list[dict]
    応答内容: str = ""


class タスク要求AI失敗リクエスト(BaseModel):
    利用者ID: str = ""  # キーはタスクID単独。互換のため受け取るだけで使わない
    タスクID: str
    メッセージ: str = ""


class タスク明細完了リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    応答内容: str = ""


class タスク明細開始完了リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    応答内容: str = ""


class タスク明細終了完了リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    応答内容: str = ""


class タスク明細失敗リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    メッセージ: str = ""


class タスク明細再試行リクエスト(BaseModel):
    タスクID: str
    明細SEQ: int
    PID: int = 0  # 再試行を継続する sub_do.py 自身の PID（旧クライアントは省略可）


class タスク検証OKNGリクエスト(BaseModel):
    """AIエージェントが操作検証の結果を直接報告するためのリクエスト（task_check_okng 用）。"""
    タスクID: str
    SEQ: int
    状態: str
    メッセージ: str = ""


_時刻形式 = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_間隔上限 = {"分": 600, "時": 24, "日": 7}


def _実行条件検証(条件: タスク実行条件入力) -> str:
    """実行条件の入力値を検証し、問題があればエラーメッセージを返す（正常は空文字）。"""
    if 条件.実行区分 not in tasks_db.実行区分値:
        return f"実行区分は {' / '.join(tasks_db.実行区分値)} から選択してください。"
    if 条件.実行区分 == "時間指定":
        if not _時刻形式.match(条件.開始時刻):
            return "時間指定の開始時刻は HH:MM 形式で入力してください。"
    if 条件.実行区分 == "間隔実行":
        if 条件.間隔区分 not in tasks_db.間隔区分値:
            return f"間隔区分は {' / '.join(tasks_db.間隔区分値)} から選択してください。"
        上限 = _間隔上限[条件.間隔区分]
        if not (1 <= 条件.間隔値 <= 上限):
            return f"間隔値（{条件.間隔区分}）は 1〜{上限} で入力してください。"
        if 条件.間隔区分 == "日" and not _時刻形式.match(条件.開始時刻):
            return "日間隔の開始時刻は HH:MM 形式で入力してください。"
    if 条件.実行区分 == "定時実行":
        if 条件.定時区分 not in tasks_db.定時区分値:
            return f"定時区分は {' / '.join(tasks_db.定時区分値)} から選択してください。"
        if 条件.定時区分 == "毎週" and 条件.実行曜日 not in tasks_db.実行曜日値:
            return "毎週の実行曜日を選択してください。"
        if 条件.定時区分 == "毎月" and not (1 <= 条件.実行日 <= 31):
            return "毎月の実行日は 1〜31 で入力してください。"
        if not _時刻形式.match(条件.開始時刻):
            return "定時実行の開始時刻は HH:MM 形式で入力してください。"
    if 条件.実行条件 not in tasks_db.実行条件値:
        return f"実行条件は {' / '.join(tasks_db.実行条件値)} から選択してください。"
    if 条件.実行条件 == "フォルダ変化" and not 条件.監視フォルダ.strip():
        return "フォルダ変化の監視フォルダを指定してください。"
    return ""


def _OK(data: dict, message: str = "") -> dict:
    return {"status": "OK", "message": message, "data": data}


def _NG(message: str) -> dict:
    return {"status": "NG", "message": message, "data": {}}


def _モデル3種(request, 既定: dict) -> dict:
    """リクエストから TASK_AI_MODEL_plan / _do / _check を決める。

    未指定（None・空文字）の項目は既定値で埋める。
    """
    return {
        カラム: (getattr(request, カラム, None) or "").strip()
        or str(既定.get(カラム, "") or tasks_db.TASK_AI_MODEL既定)
        for カラム in tasks_db.AIモデルカラム
    }


@router.post("/タスク要求/一覧", tags=["タスク要求"])
async def タスク要求一覧(request: タスク要求一覧リクエスト) -> dict:
    try:
        利用者ID = request.利用者ID.strip()
        if not 利用者ID:
            return _NG("利用者IDを指定してください。")
        # 全ユーザー表示は管理者のみ許可（クライアント指定の真偽値は信用せずサーバー側で確認する）
        全ユーザー = request.全ユーザー and tasks_db.管理者判定(利用者ID)
        items = tasks_db.タスク要求一覧(利用者ID, 全ユーザー)
        return _OK({"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"タスク要求一覧の取得に失敗: {e}")
        return _NG(f"タスク要求一覧の取得に失敗しました: {e}")


@router.post("/タスク要求/新規既定値", tags=["タスク要求"])
async def タスク要求新規既定値(request: タスク要求一覧リクエスト) -> dict:
    """同じ利用者の更新最終レコード、未登録ならconfから新規画面の既定値を返す。"""
    try:
        利用者ID = request.利用者ID.strip()
        if not 利用者ID:
            return _NG("利用者IDを指定してください。")
        return _OK(tasks_db.タスク要求新規既定値(利用者ID))
    except Exception as e:
        logger.error(f"タスク要求の新規既定値取得に失敗: {e}")
        return _NG(f"タスク要求の新規既定値取得に失敗しました: {e}")


@router.post("/タスク要求/取得", tags=["タスク要求"])
async def タスク要求取得(request: タスク要求取得リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        # CRUDのキーはタスクID単独。リクエストの利用者IDは互換のため受け取るだけで使わない
        item = tasks_db.タスク要求取得(タスクID)
        if not item:
            return _NG(f"タスク {タスクID} が見つかりません。")
        return _OK({"item": item})
    except Exception as e:
        logger.error(f"タスク要求の取得に失敗: {e}")
        return _NG(f"タスク要求の取得に失敗しました: {e}")


@router.post("/タスク実行条件/取得", tags=["タスク要求"])
async def タスク実行条件取得(request: タスク要求取得リクエスト) -> dict:
    """タスク要求に紐づく実行開始条件を返す。未設定なら空 item（即時扱い）。

    キーはタスクID単独。利用者IDは互換のため受け取るだけで使わない。
    """
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        return _OK({"item": tasks_db.実行条件取得(タスクID)})
    except Exception as e:
        logger.error(f"タスク実行条件の取得に失敗: {e}")
        return _NG(f"タスク実行条件の取得に失敗しました: {e}")


@router.post("/タスク要求/最大更新日時", tags=["タスク要求"])
async def タスク要求最大更新日時(request: タスク要求一覧リクエスト) -> dict:
    try:
        利用者ID = request.利用者ID.strip()
        if not 利用者ID:
            return _NG("利用者IDを指定してください。")
        全ユーザー = request.全ユーザー and tasks_db.管理者判定(利用者ID)
        return _OK({"最大更新日時": tasks_db.タスク要求最大更新日時(利用者ID, 全ユーザー)})
    except Exception as e:
        logger.error(f"タスク要求最大更新日時の取得に失敗: {e}")
        return _NG(f"タスク要求最大更新日時の取得に失敗しました: {e}")


@router.post("/タスク要求/登録", tags=["タスク要求"])
async def タスク要求登録(request: タスク要求登録リクエスト) -> dict:
    タイトル = request.タイトル.strip()
    利用者ID = request.利用者ID.strip()
    if not 利用者ID:
        return _NG("利用者IDを指定してください。")
    if not タイトル:
        return _NG("タイトルを入力してください。")
    try:
        item = tasks_db.タスク要求登録(利用者ID, タイトル, request.要求内容.strip())
        return _OK({"item": item}, f"タスク {item['タスクID']} を登録しました。")
    except Exception as e:
        logger.error(f"タスク要求の登録に失敗: {e}")
        return _NG(f"タスク要求の登録に失敗しました: {e}")


@router.post("/タスク明細/一覧", tags=["タスク明細"])
async def タスク明細一覧(request: タスク明細一覧リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        items = tasks_db.タスク明細一覧(タスクID)
        return _OK({"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"タスク明細一覧の取得に失敗: {e}")
        return _NG(f"タスク明細一覧の取得に失敗しました: {e}")


@router.post("/タスク明細/最大更新日時", tags=["タスク明細"])
async def タスク明細最大更新日時(request: タスク明細一覧リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        return _OK({"最大更新日時": tasks_db.タスク明細最大更新日時(タスクID)})
    except Exception as e:
        logger.error(f"タスク明細最大更新日時の取得に失敗: {e}")
        return _NG(f"タスク明細最大更新日時の取得に失敗しました: {e}")


# ==================================================
# プロジェクト選択肢（backend_server の外部プロジェクト探索と同等）
# ==================================================

def _プロジェクト選択肢取得() -> dict[str, str]:
    """AiDiy 実行ルートと、2 階層上から探索した _AIDIY.md 保有フォルダを返す。"""
    選択肢: dict[str, str] = {"../": "AiDiy 実行ルート"}
    探索ルート = os.path.abspath(os.path.join(_BASE_DIR, "..", ".."))

    def 追加(パス: str) -> None:
        if os.path.isfile(os.path.join(パス, "_AIDIY.md")):
            正規パス = os.path.abspath(パス).replace("\\", "/")
            if not 正規パス.endswith("/"):
                正規パス += "/"
            選択肢.setdefault(正規パス, os.path.basename(os.path.abspath(パス)))

    try:
        for entry in os.scandir(探索ルート):
            if not entry.is_dir():
                continue
            追加(entry.path)
            try:
                for sub in os.scandir(entry.path):
                    if sub.is_dir():
                        追加(sub.path)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError) as e:
        logger.warning(f"プロジェクト探索エラー: {e}")
    return 選択肢


@router.post("/プロジェクト選択肢", tags=["タスク要求"])
async def プロジェクト選択肢() -> dict:
    try:
        return _OK({"選択肢": _プロジェクト選択肢取得()})
    except Exception as e:
        logger.error(f"プロジェクト選択肢の取得に失敗: {e}")
        return _NG(f"プロジェクト選択肢の取得に失敗しました: {e}")


# ==================================================
# AI タスク登録（仮登録 → 定型 python 生成 → subprocess 起動）
# ==================================================

@router.post("/タスク要求/AI登録", tags=["タスク要求"])
async def タスク要求AI登録(request: タスク要求AI登録リクエスト) -> dict:
    要求内容 = request.要求内容.strip()
    利用者ID = request.利用者ID.strip()
    if not 利用者ID:
        return _NG("利用者IDを指定してください。")
    if not 要求内容:
        return _NG("要求内容を入力してください。")
    指定タスクID = request.タスクID.strip()
    if 指定タスクID and not re.fullmatch(r"[0-9A-Za-z._-]{1,64}", 指定タスクID):
        return _NG("タスクIDは64文字以内の半角英数字・ピリオド・ハイフン・アンダースコアで指定してください。")
    実行条件 = request.実行条件 or タスク実行条件入力()
    エラー = _実行条件検証(実行条件)
    if エラー:
        return _NG(エラー)
    try:
        # 仮登録のみ行う（タスクID: TASK.mmdd.hhmmss、状態: 準備開始）。
        # 実行は起動監視ループが 5 秒間隔で PID 未設定の仮登録を拾って開始する。
        タスクID = 指定タスクID or tasks_db.新規タスクID()
        # タスクIDは単独主キーなので、他利用者が使っている場合も重複として弾く
        if tasks_db.タスク要求取得(タスクID):
            return _NG(f"タスク {タスクID} は既に登録されています。")
        タイトル = 要求内容.splitlines()[0][:40]
        # 未指定（None）の項目は新規時の既定値（更新最終レコード → 規定値）で補完する
        既定 = tasks_db.タスク要求新規既定値(利用者ID)
        プロジェクト = 既定["プロジェクト"] if request.プロジェクト is None else request.プロジェクト.strip()
        TASK_AI_NAME = (request.TASK_AI_NAME or "").strip() or 既定["TASK_AI_NAME"]
        モデル = _モデル3種(request, 既定)
        item = tasks_db.仮タスク登録(
            タスクID,
            タイトル,
            要求内容,
            利用者ID,
            プロジェクト,
            TASK_AI_NAME,
            モデル["TASK_AI_MODEL_plan"],
            モデル["TASK_AI_MODEL_do"],
            モデル["TASK_AI_MODEL_check"],
            request.実行有効,
        )
        tasks_db.実行条件登録(タスクID, 実行条件.model_dump(), 利用者ID)
        tasks_watcher.実行条件再計算(タスクID)
        return _OK({"item": item}, f"タスク {タスクID} を準備開始として登録しました。")
    except Exception as e:
        logger.error(f"タスク要求のAI登録に失敗: {e}")
        return _NG(f"タスク要求のAI登録に失敗しました: {e}")


@router.post("/タスク要求/更新登録", tags=["タスク要求"])
async def タスク要求更新登録(request: タスク要求更新登録リクエスト) -> dict:
    """修正ダイアログからの更新。実行中プロセス（要求側・明細側）を全て停止してから更新する。

    状況=準備開始 は同じ状態で保存し、監視開始後に準備中へ進めて再分解
    （明細の消去は sub_init.py が行う）、
    状況=中止 は 状態=中止 で停止したままにする。
    状況=準備完了 はタスク明細がある場合だけ許可し、状態=準備完了で更新する
    （実行有効フラグの状態に関わらず、全明細は実行有効・待機に戻して再起動可能にする）。
    実行有効かつ実行条件が即時（条件なし）の場合は、状態監視ループが
    10 秒ごとに準備完了を待機へ戻して即座に実行を開始する（ここでは待機にしない）。
    状況=それ以外（更新前の状態など）は最新の状態を保持して内容だけ更新する
    （ダイアログ表示中に状態が変わっていても NG にしない）。
    """
    タスクID = request.タスクID.strip()
    要求内容 = request.要求内容.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    if not 要求内容:
        return _NG("要求内容を入力してください。")
    実行条件 = request.実行条件
    if 実行条件 is not None:
        エラー = _実行条件検証(実行条件)
        if エラー:
            return _NG(エラー)
    try:
        # CRUDのキーはタスクID単独。利用者IDは所有者を表す属性なので更新条件には使わない
        現行 = tasks_db.タスク要求取得(タスクID)
        if not 現行:
            return _NG(f"タスク {タスクID} が見つかりません。")
        状況 = request.状況.strip()
        明細再開 = False
        if 状況 == "準備開始":
            状態 = "準備開始"
        elif 状況 == "中止":
            状態 = "中止"
        elif 状況 == "準備完了":
            if not tasks_db.タスク明細一覧(タスクID):
                return _NG("タスク明細が無いため 準備完了 には戻せません。準備開始で再分解してください。")
            状態 = "準備完了"
            明細再開 = True
        else:
            # 更新前の状態を保持（内容だけ更新）。ダイアログ表示中に状態が
            # 変わっていた場合も NG にせず、最新の状態を採用する
            状態 = str(現行.get("状態", ""))
        for pid in tasks_db.タスクPID一覧(タスクID):
            tasks_watcher._プロセス強制停止(pid, logger)
        tasks_db.タスクPIDクリア(タスクID)
        # 未指定の項目は更新前のレコード値を保つ
        モデル = _モデル3種(request, 現行)
        item = tasks_db.タスク要求更新登録(
            タスクID,
            request.プロジェクト.strip(),
            要求内容,
            request.TASK_AI_NAME.strip() or tasks_db.TASK_AI_NAME既定,
            モデル["TASK_AI_MODEL_plan"],
            モデル["TASK_AI_MODEL_do"],
            モデル["TASK_AI_MODEL_check"],
            request.実行有効,
            状態,
        )
        if not item:
            return _NG(f"タスク {タスクID} が見つかりません。")
        if bool(現行.get("実行有効")) != request.実行有効:
            # 編集でON/OFFを変えた場合も一覧の切替と同じく全明細へ反映する。
            # 値を変えていない保存では、個別に無効化した明細を保持する。
            item = tasks_db.タスク実行有効更新(タスクID, request.実行有効)
            状態 = str(item.get("状態", 状態))
        if 明細再開:
            # 準備完了: 実行有効フラグの状態に関わらず全明細を 実行有効・待機 に戻して再起動可能にする
            tasks_db.明細全件有効待機化(タスクID)
        if 実行条件 is not None:
            tasks_db.実行条件登録(タスクID, 実行条件.model_dump())
        # 実行条件・状態・実行有効のどれが変わっても次回実行日時を計算し直す
        次回実行日時 = tasks_watcher.実行条件再計算(タスクID)
        # 間隔実行の初回は間隔を待たずに走る。画面で待たされたと誤解されないよう伝える
        条件 = tasks_db.実行条件監視取得(タスクID)
        初回即時 = bool(条件) and tasks_watcher._初回即時対象(条件)
        message = f"タスク {タスクID} を {状態} として更新しました。"
        if 初回即時:
            message += f"初回は {tasks_watcher.初回即時猶予分} 分以内に開始します。"
        elif 次回実行日時:
            message += f"次回実行は {次回実行日時} です。"
        return _OK(
            {"item": item, "次回実行日時": 次回実行日時, "初回即時": 初回即時},
            message,
        )
    except Exception as e:
        logger.error(f"タスク要求の更新登録に失敗: {e}")
        return _NG(f"タスク要求の更新登録に失敗しました: {e}")


@router.post("/タスク要求/実行有効切替", tags=["タスク要求"])
async def タスク要求実行有効切替(request: タスク実行有効切替リクエスト) -> dict:
    """タスク要求と全タスク明細の実行有効フラグをまとめて更新する。

    有効化のときは、エラーで止まっている要求・明細を 待機 に戻して再実行できるようにする。
    """
    タスクID = request.タスクID.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    try:
        # 更新登録と同じく、対象はタスクIDだけで引く
        item = tasks_db.タスク実行有効更新(タスクID, request.実行有効)
        if not item:
            return _NG(f"タスク {タスクID} が見つかりません。")
        tasks_watcher.実行条件再計算(タスクID)
        表示 = "有効化" if request.実行有効 else "無効化"
        return _OK({"item": item}, f"タスク {タスクID} を{表示}しました。")
    except Exception as e:
        logger.error(f"タスク実行有効切替に失敗: {e}")
        return _NG(f"タスク実行有効切替に失敗しました: {e}")


@router.post("/タスク要求/停止検査", tags=["タスク要求"])
async def タスク要求停止検査(request: タスク停止検査リクエスト) -> dict:
    """タスクが止まっていないかを調べる（読み取り専用。DB は一切変更しない）。

    「止まっている」と判定するのは次のいずれかに当たる場合。
      1. 要求がエラー
      2. 要求の実行有効が外れていて未完了明細が残っている
      3. エラーの明細がある
      4. 未完了なのに実行有効が外れている明細がある
      5. 実行中のまま打ち切り時間を超えている明細がある
      6. 準備中・実行中の要求自体が無進捗で打ち切り時間を超えている
      7. 実行対象なのにAI分解済み明細が無い
      8. 先行SEQの循環・欠番で実行可能な明細が無い

    エラー・無効化は通常の再開、明細なし・未定義は再分解で自動復旧できる。
    タイムアウトは実行プロセスを止めるため 強制=true が必要になる。
    DAG の循環・欠番は安全に自動修正できないため、手動修正を推奨する。

    タスクIDを省略すると全タスクを見る。停止のみ=true と組み合わせれば
    「いま止まっているタスクの一覧」になる。
    """
    タスクID = request.タスクID.strip()
    try:
        # 停止のみ=true で正常な1件が除外された場合と、存在しないタスクIDを区別する。
        # AI が「該当なし」を「正常」と誤認しないため、存在確認はフィルタ前に行う。
        if タスクID and not tasks_db.タスク要求取得(タスクID):
            return _NG(f"タスク {タスクID} が見つかりません。")
        items = tasks_db.タスク停止検査(タスクID, request.停止のみ)
        停止件数 = sum(1 for x in items if x["停止"])
        if タスクID and items:
            対象 = items[0]
            message = (
                f"タスク {タスクID} は停止しています（{' / '.join(対象['停止理由'])}）。"
                if 対象["停止"] else f"タスク {タスクID} は停止していません。"
            )
        else:
            message = f"{len(items)} 件を検査し、停止は {停止件数} 件でした。"
        return _OK({"件数": len(items), "停止件数": 停止件数, "items": items}, message)
    except Exception as e:
        logger.error(f"タスクの停止検査に失敗: {e}")
        return _NG(f"タスクの停止検査に失敗しました: {e}")


@router.post("/タスク要求/停止復旧", tags=["タスク要求"])
async def タスク要求停止復旧(request: タスク停止復旧リクエスト) -> dict:
    """途中停止したタスクを、止まった明細から再開できる状態へ戻す。

    復旧モード=auto は停止検査の推奨操作に従う。エラー・無効化は止まった
    明細から再開し、明細なし・未定義明細は再分解へ戻す。完了済み明細は残す。
    タイムアウト中の実行プロセスを止めて再開するときだけ強制=trueを使う。

    応答の data には復旧前後の状態を入れる。復旧前.エラー明細 は応答内容つきなので、
    監視タスクはこの 1 回の呼び出しだけで原因分析と復旧結果の確認まで済ませられる。

    DAGの循環・欠番は自動書換えせず 復旧実施=false と 推奨操作=手動修正 を返す。
    """
    タスクID = request.タスクID.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    復旧モード = request.復旧モード.strip() or "auto"
    if 復旧モード not in ("auto", "再開", "再分解"):
        return _NG("復旧モードは auto / 再開 / 再分解 のいずれかを指定してください。")
    try:
        if not tasks_db.タスク要求取得(タスクID):
            return _NG(f"タスク {タスクID} が見つかりません。")

        診断 = tasks_db.タスク停止検査(タスクID)[0]
        再分解選択 = 復旧モード == "再分解" or (
            復旧モード == "auto"
            and (
                "NO_DETAILS" in 診断["状態コード"]
                or "UNDEFINED_DETAILS" in 診断["状態コード"]
                or (
                    "REQUEST_TIMEOUT" in 診断["状態コード"]
                    and 診断["要求状態"] == "準備中"
                )
            )
        )
        モード不整合 = 復旧モード == "再開" and (
            "NO_DETAILS" in 診断["状態コード"]
            or "UNDEFINED_DETAILS" in 診断["状態コード"]
        )

        # 強制復旧だけは実行中プロセスを先に止める。ただし、停止検査で実際に
        # 停止と判定されたタスクだけに限る。AI が健全な実行中タスクへ誤って
        # 強制=trueを送っても、プロセスを止めてPIDだけ残す事故を起こさない。
        停止PID: list[int] = []
        強制適用 = bool(
            request.強制
            and 診断["停止"]
            and 診断["推奨操作"] != "手動修正"
            and not モード不整合
            and (診断["強制復旧必要"] or 再分解選択)
        )
        if 強制適用:
            停止PID = tasks_db.タスクPID一覧(タスクID)
            for pid in 停止PID:
                tasks_watcher._プロセス強制停止(pid, logger)

        結果 = tasks_db.タスク停止復旧(
            タスクID,
            強制=強制適用,
            復旧モード=復旧モード,
        )
        結果["停止PID"] = 停止PID
        結果["強制適用"] = 強制適用
        if not 結果["復旧実施"] and 結果["理由"] == "タスクIDが見つかりません":
            return _NG(f"タスク {タスクID} が見つかりません。")
        if 結果["復旧実施"]:
            # 待機へ戻した分の次回実行日時を計算し直す（実行有効切替と同じ扱い）
            tasks_watcher.実行条件再計算(タスクID)
            件数 = 結果["復旧前"].get("エラー明細件数", 0)
            message = (
                f"タスク {タスクID} を復旧しました"
                f"（モード={結果['適用モード']}、エラー明細={件数} 件、再開SEQ={結果['再開SEQ']}）。"
            )
        else:
            message = f"タスク {タスクID} は復旧不要です（{結果['理由']}）。"
        return _OK(結果, message)
    except Exception as e:
        logger.error(f"タスクの停止復旧に失敗: {e}")
        return _NG(f"タスクの停止復旧に失敗しました: {e}")


@router.post("/タスク明細/実行有効切替", tags=["タスク明細"])
async def タスク明細実行有効切替(request: タスク明細実行有効切替リクエスト) -> dict:
    """タスク明細 1 行の実行有効フラグを更新する。

    有効化のときは、その明細が エラー / 完了 なら 待機 に戻して再実行できるようにする
    （親のタスク要求も エラー / 完了 なら 待機 へ戻す）。完了を戻すのは、
    仕上がりが気に入らないステップだけを選んで実行し直せるようにするため。
    """
    タスクID = request.タスクID.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    try:
        if not tasks_db.明細実行有効更新(タスクID, request.明細SEQ, request.実行有効):
            return _NG(f"タスク明細 {タスクID} SEQ={request.明細SEQ} が見つかりません。")
        # 要求の状態が エラー から 待機 へ戻ることがあるので、次回実行日時を計算し直す
        tasks_watcher.実行条件再計算(タスクID)
        表示 = "有効化" if request.実行有効 else "無効化"
        return _OK({}, f"タスク明細 SEQ={request.明細SEQ} を{表示}しました。")
    except Exception as e:
        logger.error(f"タスク明細実行有効切替に失敗: {e}")
        return _NG(f"タスク明細実行有効切替に失敗しました: {e}")


@router.post("/タスク明細/更新登録", tags=["タスク明細"])
async def タスク明細更新登録(request: タスク明細更新登録リクエスト) -> dict:
    """明細編集ダイアログからの更新。実行中なら該当明細のプロセスを停止してから更新する。"""
    タスクID = request.タスクID.strip()
    タイトル = request.タイトル.strip()
    要求内容 = request.要求内容.strip()
    先行SEQ = request.先行SEQ.strip()
    状態 = request.状態.strip() or "待機"
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    if not タイトル:
        return _NG("タイトルを入力してください。")
    try:
        先行一覧 = tasks_db.先行SEQ解析(先行SEQ)
    except ValueError:
        return _NG("先行SEQは数値のカンマ区切りで入力してください（分岐の後続は 2=Y のように指定します）。")
    for seq, _条件 in 先行一覧:
        if seq == request.明細SEQ:
            return _NG("先行SEQに自分自身は指定できません。")
    try:
        現行 = tasks_db.タスク明細取得(タスクID, request.明細SEQ)
        if not 現行:
            return _NG(f"タスク明細 {タスクID} SEQ={request.明細SEQ} が見つかりません。")
        # 更新前の状態（実行中など）はそのまま維持できる。ダイアログ表示中に
        # 状態が変わっていた場合も NG にせず、最新の状態を採用して内容だけ更新する
        if 状態 not in {"待機", "完了", "エラー", "中止"} and 状態 != str(現行.get("状態", "")):
            状態 = str(現行.get("状態", "")) or "待機"
        pid = str(現行.get("PID", "")).strip()
        if pid.isdigit():
            tasks_watcher._プロセス強制停止(int(pid), logger)
        item = tasks_db.明細更新登録(
            タスクID,
            request.明細SEQ,
            タイトル,
            要求内容,
            先行SEQ,
            request.TASK_AI_NAME.strip() or tasks_db.TASK_AI_NAME既定,
            request.TASK_AI_MODEL_do.strip() or "auto",
            request.操作検証,
            request.実行有効,
            状態,
            request.タイプ,
        )
        if not item:
            return _NG(f"タスク明細 {タスクID} SEQ={request.明細SEQ} が見つかりません。")
        return _OK({"item": item}, f"タスク明細 SEQ={request.明細SEQ} を更新しました。")
    except Exception as e:
        logger.error(f"タスク明細更新登録に失敗: {e}")
        return _NG(f"タスク明細更新登録に失敗しました: {e}")


@router.post("/タスク明細/全消去", tags=["タスク明細"])
async def タスク明細全消去(request: タスク明細全消去リクエスト) -> dict:
    """指定タスクの AIタスク明細を全消去する（sub_init.py の再生成前クリア用）。

    明細に PID が残っていれば処理を停止してから消去する。
    """
    タスクID = request.タスクID.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    try:
        for 行 in tasks_db.タスク明細一覧(タスクID):
            pid = str(行.get("PID", "")).strip()
            if pid.isdigit():
                tasks_watcher._プロセス強制停止(int(pid), logger)
        件数 = tasks_db.タスク明細全削除(タスクID)
        return _OK({"削除件数": 件数}, f"タスク {タスクID} の明細を {件数} 件消去しました。")
    except Exception as e:
        logger.error(f"タスク明細の全消去に失敗: {e}")
        return _NG(f"タスク明細の全消去に失敗しました: {e}")


@router.post("/タスク要求/本登録", tags=["タスク要求"])
async def タスク要求本登録(request: タスク要求本登録リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        # 所有者は仮登録の値を引き継ぐ。リクエストの利用者IDは仮登録が無い場合の予備
        item = tasks_db.タスク本登録(
            request.利用者ID.strip(),
            タスクID,
            request.タイトル.strip(),
            request.要求内容.strip(),
            request.マーメイド記号.strip(),
            request.明細,
            request.応答内容.strip(),
        )
        return _OK({"item": item}, f"タスク {request.タスクID} を本登録しました。")
    except Exception as e:
        logger.error(f"タスク要求の本登録に失敗: {e}")
        return _NG(f"タスク要求の本登録に失敗しました: {e}")


@router.post("/タスク要求/AI失敗", tags=["タスク要求"])
async def タスク要求AI失敗(request: タスク要求AI失敗リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        item = tasks_db.タスク失敗(タスクID, request.メッセージ)
        return _OK({"item": item}, f"タスク {request.タスクID} を失敗として登録しました。")
    except Exception as e:
        logger.error(f"タスク要求のAI失敗登録に失敗: {e}")
        return _NG(f"タスク要求のAI失敗登録に失敗しました: {e}")


@router.post("/タスク明細/完了", tags=["タスク明細"])
async def タスク明細完了(request: タスク明細完了リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        item = tasks_db.明細完了(タスクID, request.明細SEQ, request.応答内容)
        return _OK({"item": item}, f"タスク {タスクID} SEQ{request.明細SEQ} を完了しました。")
    except Exception as e:
        logger.error(f"タスク明細の完了登録に失敗: {e}")
        return _NG(f"タスク明細の完了登録に失敗しました: {e}")


@router.post("/タスク明細/開始完了", tags=["タスク明細"])
async def タスク明細開始完了(request: タスク明細開始完了リクエスト) -> dict:
    """開始明細を完了し、AIタスク要求を実行中にする（sub_start.py 用）。"""
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        応答内容 = request.応答内容 or "開始処理を完了しました。"
        item = tasks_db.開始明細完了(タスクID, request.明細SEQ, 応答内容)
        return _OK({"item": item}, f"タスク {タスクID} SEQ{request.明細SEQ} の開始処理を完了しました。")
    except Exception as e:
        logger.error(f"タスク明細の開始完了登録に失敗: {e}")
        return _NG(f"タスク明細の開始完了登録に失敗しました: {e}")


@router.post("/タスク明細/終了完了", tags=["タスク明細"])
async def タスク明細終了完了(request: タスク明細終了完了リクエスト) -> dict:
    """終了明細を完了し、AIタスク要求を完了にする（sub_end.py 用）。"""
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        応答内容 = request.応答内容 or "終了処理を完了しました。"
        item = tasks_db.終了明細完了(タスクID, request.明細SEQ, 応答内容)
        return _OK({"item": item}, f"タスク {タスクID} SEQ{request.明細SEQ} の終了処理を完了しました。")
    except Exception as e:
        logger.error(f"タスク明細の終了完了登録に失敗: {e}")
        return _NG(f"タスク明細の終了完了登録に失敗しました: {e}")


@router.post("/タスク明細/失敗", tags=["タスク明細"])
async def タスク明細失敗(request: タスク明細失敗リクエスト) -> dict:
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        item = tasks_db.明細失敗(タスクID, request.明細SEQ, request.メッセージ)
        return _OK({"item": item}, f"タスク {タスクID} SEQ{request.明細SEQ} を失敗として登録しました。")
    except Exception as e:
        logger.error(f"タスク明細の失敗登録に失敗: {e}")
        return _NG(f"タスク明細の失敗登録に失敗しました: {e}")


@router.post("/タスク明細/再試行", tags=["タスク明細"])
async def タスク明細再試行(request: タスク明細再試行リクエスト) -> dict:
    """自動リカバリーの再試行前に、明細とタスク要求の状態を実行中へ戻す（sub_do.py 用）。

    予測分数は再試行用に引き上げて書き換える（tasks_db.再試行予測分数）。
    呼び出し側はこの応答の 予測分数 を使って次の実行タイムアウトを取り直す。
    """
    try:
        タスクID = request.タスクID.strip()
        if not タスクID:
            return _NG("タスクIDを指定してください。")
        結果 = tasks_db.明細再試行(タスクID, request.明細SEQ, request.PID)
        予測分数 = 結果["予測分数"]
        return _OK(
            {"item": 結果["item"], "予測分数": 予測分数},
            f"タスク {タスクID} SEQ{request.明細SEQ} を再試行のため実行中に戻しました（予測分数={予測分数}分）。",
        )
    except Exception as e:
        logger.error(f"タスク明細の再試行登録に失敗: {e}")
        return _NG(f"タスク明細の再試行登録に失敗しました: {e}")


@check_router.post("/task_check_okng", tags=["タスク明細"])
async def task_check_okng(request: タスク検証OKNGリクエスト) -> dict:
    """操作検証の結果を AI エージェントから直接報告してもらうための ASCII エンドポイント。

    http://127.0.0.1:8093/task_check_okng で日本語パスの percent-encode なしに呼べる。
    状態='完了' は 明細完了 と同じ扱い、状態='エラー' は 明細失敗 と同じ扱いで DB を更新する。

    報告できるのは 状態='実行中' の明細（＝いま自分が実行を任されている 1 行）だけに限る。
    制限が無いと、AI が「他のステップも実行済みだから」とまとめて完了報告してしまい、
    実際には走っていない明細が 実行回数0・開始日時なし のまま完了になる。
    後段の最終検証で辻褄が合わずエラーになるため、ここで受け付けない。
    """
    タスクID = request.タスクID.strip()
    状態 = request.状態.strip()
    if not タスクID:
        return _NG("タスクIDを指定してください。")
    if 状態 not in ("完了", "エラー"):
        return _NG("状態は 完了 または エラー を指定してください。")
    try:
        現行 = tasks_db.明細1件取得(タスクID, request.SEQ)
        if 現行 is None:
            return _NG(f"タスク {タスクID} SEQ{request.SEQ} が見つかりません。")
        現状態 = str(現行.get("状態", "")).strip()
        if 現状態 != "実行中":
            logger.warning(
                f"実行中でない明細への報告を拒否しました: {タスクID} SEQ{request.SEQ} "
                f"状態={現状態 or '不明'} 報告={状態}"
            )
            return _NG(
                f"タスク {タスクID} SEQ{request.SEQ} は実行中ではありません（現在: {現状態 or '不明'}）。"
                "いま実行を任されている明細だけが報告できます。他の明細の状態は変更できません。"
            )
        if 状態 == "完了":
            # メッセージはそのまま明細の応答内容になり、後続ステップと最終検証へ
            # 「実行済み記録」として渡る唯一の手段。空の完了報告を通すと、実際には
            # 動いていたステップが記録なし扱いになり、最終検証が成果物なしでエラーにする。
            メッセージ = request.メッセージ.strip()
            if not メッセージ:
                logger.warning(f"メッセージなしの完了報告を拒否しました: {タスクID} SEQ{request.SEQ}")
                return _NG(
                    f"タスク {タスクID} SEQ{request.SEQ} の完了報告にはメッセージが必要です。"
                    "実行した内容・確認したこと・結果をメッセージに書いて報告し直してください。"
                    "この本文がそのまま実行済み記録になり、後続ステップと最終検証はこれだけを読んで判断します。"
                )
            item = tasks_db.明細完了(タスクID, request.SEQ, メッセージ)
            return _OK({"item": item}, f"タスク {タスクID} SEQ{request.SEQ} を完了として登録しました。")
        item = tasks_db.明細失敗(タスクID, request.SEQ, request.メッセージ or "操作検証NG")
        return _OK({"item": item}, f"タスク {タスクID} SEQ{request.SEQ} をエラーとして登録しました。")
    except Exception as e:
        logger.error(f"task_check_okng の更新に失敗: {e}")
        return _NG(f"task_check_okng の更新に失敗しました: {e}")
