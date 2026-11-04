# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの監視ループとプロセス管理。

タイマーは2本（team_proc/team_watcher.py と同じ構成、詳細は各ループの docstring 参照）。

- 起動監視タイマー = 起動監視ループ（5秒間隔）: タスク要求を確認し、PID未設定の仮登録
  （準備開始）を見つけたら temp/input/<利用者ID>.<タスクID>.json を出力して sub_init.py を
  subprocess 起動する。起動時に準備中へ進め、PID・開始日時・実行回数を記録する。
  実行待ちのタスク明細も同様に sub_do.py 等を起動する（対象は AI 分解済みのタスクだけで、
  判定は DB の明細に要求内容があるかで行う。temp のファイル有無は見ない）。
- 状態監視タイマー = 状態監視ループ（10秒間隔、実行条件の発火判定とタイムアウト確認は
  hh:mm 変化時＝毎分1回）: 実行開始条件を確認して満たせば「待機」に戻し、進捗が止まったまま
  実行タイムアウト分（既定60分）以上経過した実行をエラーにする。
  AIタスク要求の 状態='準備中'（sub_init.py による明細分解）だけは準備タイムアウト分（既定30分）。
- システム開始時（再起動含む）は、テーブルに残った PID をエラーとして記録しクリアする
  （PID は再利用され得るため、プロセスの強制停止はしない）。
"""

from __future__ import annotations

import asyncio
import calendar
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta

from . import tasks_db

起動監視間隔秒 = 5
状態監視間隔秒 = 10
実行回数上限 = 3
# AIタスク要求（タスク全体）が無進捗のまま放置されたときの打ち切り。
# 明細を 1 つ終えるたびに更新日時が動くので、進捗が続く限りここには掛からない。
実行タイムアウト分 = 60
# 明細 1 ステップの打ち切り。予測分数 × 倍率で見る。
# 見積りが極端に短い明細と未見積りの明細を即座に打ち切らないよう、最低分は必ず確保する。
# 失敗して再試行に入るときは予測分数自体が引き上げ書き換えされる（tasks_db.再試行予測分数）ため、
# 試行を重ねるほどここの打ち切り時間も自動的に伸びる。
明細タイムアウト倍率 = 2
明細最低タイムアウト分 = 10
# 同一タスク内で同時に走らせる code agent 明細の上限。
# 先行SEQ で並行と定義された明細（フロー図の分岐）を実際に並行実行するための設定。
# 1 にすると従来どおりタスク単位の直列実行になる。増やすほど CLI プロセスが同時に動き負荷が上がる。
# タスクをまたぐ並行はこの上限の対象外（従来どおり制限なし）。
明細並行上限 = 3
# AIタスク要求の 状態='準備中'（sub_init.py による明細分解）は、AI の応答待ちを含む。
# 実運用で10分を超えて正常に続く分解があるため、通常の要求より短い30分で打ち切る。
準備タイムアウト分 = 30
# 間隔実行の初回だけ、間隔を待たずに走らせるまでの猶予（分）。
# 0 にすると保存した瞬間の分に載り、発火確認（毎分 1 回）を取りこぼすことがある。
# 秒を切り捨てて分に丸めるため、実際の開始は最大でもこの分数以内になる。
初回即時猶予分 = 2
# 繰り返し実行（間隔実行 / 定時実行）が 1 周期エラーで終わったときに、次の周期を
# 自動で始め直す連続回数の上限。監視タスクのように「回り続けること」が目的のタスクが、
# 1 度のエラーで永久に止まってしまうのを防ぐ。上限まで連続で失敗したら繰り返しを止め、
# 利用者が原因を直すまで待つ。1 周期でも成功すれば数え直す。
繰り返し自動復旧上限 = 3

# AI が完了を報告してDBのPIDが消えても、HTTP応答と後処理は残り得る。
# 起動時のPopenを保持し、前周期の実プロセス終了前に明細をリセットしない。
_所有明細プロセス: dict[str, list[subprocess.Popen]] = {}


def _前周期の処理が残る(タスクID: str) -> bool:
    for key, processes in list(_所有明細プロセス.items()):
        alive = [proc for proc in processes if proc.poll() is None]
        if alive:
            _所有明細プロセス[key] = alive
        else:
            _所有明細プロセス.pop(key, None)
    return bool(_所有明細プロセス.get(タスクID))

# 実行開始条件は hh:mm が変わった確認回だけ処理する（毎分 1 回）
_前回確認分 = ""
# エラーで終わった周期から自動で再開した連続回数（タスクID 単位）。
# 上限判定にしか使わないので DB へは持たず、PG 再起動でリセットされてよい。
_自動復旧連続回数: dict[str, int] = {}
_曜日番号 = {"月": 0, "火": 1, "水": 2, "木": 3, "金": 4, "土": 5, "日": 6}

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SUB_INITパス = os.path.join(_BASE_DIR, "task_sub", "sub_init.py")
_SUB_STARTパス = os.path.join(_BASE_DIR, "task_sub", "sub_start.py")
_SUB_DOパス = os.path.join(_BASE_DIR, "task_sub", "sub_do.py")
_SUB_IFパス = os.path.join(_BASE_DIR, "task_sub", "sub_if.py")
_SUB_ORパス = os.path.join(_BASE_DIR, "task_sub", "sub_or.py")
_SUB_ENDパス = os.path.join(_BASE_DIR, "task_sub", "sub_end.py")

# 明細タイプ → 起動するサブプロセス
_タイプ別サブプロセス = {
    "start": _SUB_STARTパス,
    "do": _SUB_DOパス,
    "if": _SUB_IFパス,
    "or": _SUB_ORパス,
    "end": _SUB_ENDパス,
}
# temp/input は sub_init.py へ分解の入力値を渡すためだけに使う。
# 分解結果の temp/output/<タスクID>.json は sub_init.py が本登録に使うもので、
# 監視側は参照しない（実行可否は DB の明細だけで判定する）。
_入力DIR = os.path.join(_BASE_DIR, "temp", "input")


def _サブプロセス環境() -> dict:
    """サブプロセスの標準出力を UTF-8 にする環境変数を足して返す。

    Windows では既定が cp932 になり、AI応答に含まれる — や絵文字を print した時点で
    UnicodeEncodeError になってステップが失敗するため（変換できない文字は置換する）。
    """
    return {**os.environ, "PYTHONIOENCODING": "utf-8:replace"}


def _タスクファイル名(タスクID: str) -> str:
    return f"{タスクID}.json"


def _プロセス強制停止(pid: int, logger: logging.Logger) -> None:
    """PID のプロセスを子プロセスごと強制停止する。python 以外は誤爆防止のため停止しない。"""
    try:
        if os.name == "nt":
            確認 = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=15,
            )
            if f'"{pid}"' not in 確認.stdout:
                return  # 既に存在しない
            if "python" not in 確認.stdout.lower():
                logger.warning(f"PID {pid} は python プロセスではないため停止しません")
                return
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, timeout=15)
            logger.info(f"残存プロセスを強制停止しました: PID={pid}")
        else:
            import signal
            os.kill(pid, signal.SIGKILL)
            logger.info(f"残存プロセスを強制停止しました: PID={pid}")
    except ProcessLookupError:
        pass
    except Exception as e:
        logger.warning(f"PID {pid} の停止に失敗しました: {e}")


def _プロセス生存(pid: int) -> bool:
    """PID のプロセスが生きているかを返す。判定できないときは True（生存扱い）にする。

    PID は OS に再利用され得るため、Windows では python プロセスかどうかまで確認する。
    誤って「死んでいる」と判断すると実行中の明細を横取りしてしまうので、迷ったら生存側に倒す。
    """
    try:
        if os.name == "nt":
            確認 = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=15,
            )
            if f'"{pid}"' not in 確認.stdout:
                return False
            return "python" in 確認.stdout.lower()
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except Exception:
        return True


def _残存PIDクリーンアップ(logger: logging.Logger) -> None:
    """DB に PID が残っているのにプロセスが生きていない明細を待機へ戻す。

    明細の PID が残ったままだと `_起動監視1回` のタスク単位の直列化判定に引っかかり、
    同一タスクの後続明細が実行タイムアウト（既定60分）まで一切起動できずに停滞する。
    画面からの強制停止やプロセスの異常終了で起こり得るため、起動監視のたびに確認する。

    AIタスク要求側の PID は準備タイムアウト（既定30分）で回復するうえ、後続をブロックしないため対象外。
    """
    try:
        for 行 in tasks_db.実行中明細一覧():
            pid = str(行.get("PID", "")).strip()
            if not pid.isdigit() or _プロセス生存(int(pid)):
                continue
            タスクID = str(行["タスクID"])
            明細SEQ = int(行["明細SEQ"])
            if tasks_db.明細PID解放(タスクID, 明細SEQ):
                logger.warning(
                    f"プロセスが消えているため明細を待機へ戻しました: {タスクID} SEQ={明細SEQ} "
                    f"タイトル={行.get('タイトル', '')} PID={pid}"
                )
    except Exception:
        logger.exception("残存 PID の確認でエラーが発生しました")


def 起動時クリーンアップ(logger: logging.Logger) -> None:
    """システム開始時: テーブルに残った PID をエラーとして記録しクリアする。

    PID は OS に再利用され得るため、別プロセスを誤って停止する恐れがあり強制停止はしない。
    """
    try:
        残存 = tasks_db.残存PID一覧()
        for 行 in 残存:
            logger.info(
                f"起動時クリーンアップ: {行['テーブル']} {行.get('利用者ID', '')}/{行['タスクID']} "
                f"PID={行.get('PID', '')}"
            )
        if 残存:
            tasks_db.PID全クリア()
            logger.info(f"PID を {len(残存)} 件エラーにしてクリアしました")
    except Exception:
        logger.exception("起動時クリーンアップでエラーが発生しました")


def _タスク実行開始(行: dict, logger: logging.Logger) -> None:
    """仮登録 1 件について入力 JSON を出力し、sub_init.py を起動して PID を記録する。"""
    利用者ID = str(行["利用者ID"])
    タスクID = str(行["タスクID"])
    os.makedirs(_入力DIR, exist_ok=True)
    入力JSONパス = os.path.join(_入力DIR, _タスクファイル名(タスクID))
    with open(入力JSONパス, "w", encoding="utf-8") as f:
        json.dump({
            "利用者ID": 利用者ID,
            "タスクID": タスクID,
            "プロジェクト": str(行.get("プロジェクト", "")),
            "要求内容": str(行.get("要求内容", "")),
            "TASK_AI_NAME": str(行.get("TASK_AI_NAME", "codex_cli")),
            # 分解は plan、生成する明細へ引き継ぐのは do（check は終了明細が使う）
            **{
                カラム: str(行.get(カラム, "auto") or "auto")
                for カラム in tasks_db.AIモデルカラム
            },
        }, f, ensure_ascii=False, indent=2)

    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(
        [sys.executable, _SUB_INITパス, 入力JSONパス],
        cwd=_BASE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
        env=_サブプロセス環境(),
    )
    tasks_db.実行開始記録(タスクID, proc.pid)
    logger.info(f"AIタスク生成を開始しました: {利用者ID}/{タスクID} PID={proc.pid}")


def _明細実行開始(行: dict, logger: logging.Logger) -> None:
    """実行可能なタスク明細 1 件についてサブプロセスを起動して PID を記録する。"""
    タスクID = str(行["タスクID"])
    明細SEQ = int(行["明細SEQ"])
    タイトル = str(行.get("タイトル", ""))
    # 起動先は明細タイプで決める。タイトルは表示名なので判定に使わない
    # （if / or はタイトルが自由なため、文字列一致では分岐できない）
    タイプ = tasks_db.明細タイプ(明細SEQ, 行.get("タイプ"))
    サブプロセスパス = _タイプ別サブプロセス[タイプ]
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(
        [sys.executable, サブプロセスパス, タスクID, str(明細SEQ)],
        cwd=_BASE_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
        env=_サブプロセス環境(),
    )
    _所有明細プロセス.setdefault(str(タスクID), []).append(proc)
    tasks_db.明細実行開始記録(タスクID, 明細SEQ, proc.pid)
    logger.info(
        f"ステップ実行を開始しました: {タスクID} SEQ={明細SEQ} タイプ={タイプ} "
        f"タイトル={タイトル} PID={proc.pid}"
    )


def _軽量並行明細か(行: dict) -> bool:
    """code agent を使わず短時間で完了する明細は並行起動を許可する。"""
    タイトル = str(行.get("タイトル", ""))
    return "通知音" in タイトル


def _時刻適用(基準日: datetime, 時刻: str) -> datetime | None:
    """datetime に 'HH:MM' を適用する。形式不正は None。"""
    try:
        h, m = 時刻.split(":")
        return 基準日.replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    except (ValueError, AttributeError):
        return None


def _次回実行日時計算(条件: dict, 基準: datetime) -> str:
    """実行開始条件から基準より後の次回実行日時を求める（計算不能は空文字）。"""
    区分 = str(条件.get("実行区分", ""))
    開始時刻 = str(条件.get("開始時刻", ""))
    try:
        if 区分 == "時間指定":
            候補 = _時刻適用(基準, 開始時刻)
            if 候補 is None:
                return ""
            if 候補 <= 基準:
                候補 += timedelta(days=1)
            return 候補.strftime("%Y-%m-%d %H:%M:%S")
        if 区分 == "間隔実行":
            値 = max(1, int(条件.get("間隔値", 0) or 0))
            単位 = str(条件.get("間隔区分", ""))
            if 単位 == "分":
                候補 = 基準 + timedelta(minutes=値)
            elif 単位 == "時":
                候補 = 基準 + timedelta(hours=値)
            elif 単位 == "日":
                日候補 = _時刻適用(基準 + timedelta(days=値), 開始時刻)
                if 日候補 is None:
                    return ""
                候補 = 日候補
            else:
                return ""
            return 候補.replace(second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
        if 区分 == "定時実行":
            定時 = str(条件.get("定時区分", ""))
            if 定時 == "毎日":
                候補 = _時刻適用(基準, 開始時刻)
                if 候補 is None:
                    return ""
                if 候補 <= 基準:
                    候補 += timedelta(days=1)
            elif 定時 == "毎週":
                番号 = _曜日番号.get(str(条件.get("実行曜日", "")))
                候補 = _時刻適用(基準, 開始時刻)
                if 番号 is None or 候補 is None:
                    return ""
                候補 += timedelta(days=(番号 - 候補.weekday()) % 7)
                if 候補 <= 基準:
                    候補 += timedelta(days=7)
            elif 定時 == "毎月":
                日 = int(条件.get("実行日", 0) or 0)
                if not (1 <= 日 <= 31):
                    return ""

                def 月内(y: int, m: int) -> datetime | None:
                    末日 = calendar.monthrange(y, m)[1]
                    return _時刻適用(datetime(y, m, min(日, 末日)), 開始時刻)

                月候補 = 月内(基準.year, 基準.month)
                if 月候補 is None:
                    return ""
                if 月候補 <= 基準:
                    y, m = (基準.year + 1, 1) if 基準.month == 12 else (基準.year, 基準.month + 1)
                    月候補 = 月内(y, m)
                    if 月候補 is None:
                        return ""
                候補 = 月候補
            else:
                return ""
            return 候補.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""
    return ""


def _初回即時対象(条件: dict) -> bool:
    """間隔実行でまだ一度も実行していない（準備完了 かつ 未実行）かを返す。

    間隔実行は登録時点から間隔後ではなく、初回だけ即時に走らせる。
    2 回目以降は発火時刻 + 間隔（前回実行から間隔経過後）で回る。

    「未実行」は 前回実行日時なし だけでは足りない。一度動いたタスクを
    修正ダイアログで 準備完了 へ戻すと 明細全件有効待機化 が明細の実行回数を
    0 に戻し、実質「これから初回を走らせる」状態になる。ところが前回実行日時は
    残るため、そのままでは次回が「今 + 間隔」になり、10 分条件なら
    保存しても 10 分待たされる。明細が 1 件も動いていなければ初回として扱う。
    """
    if str(条件.get("実行区分", "")) != "間隔実行":
        return False
    if str(条件.get("要求状態", "")) != "準備完了":
        return False
    if str(条件.get("前回実行日時", "")) == "":
        return True
    try:
        return int(条件.get("実行済明細数") or 0) == 0
    except (TypeError, ValueError):
        return False


def _次回算出(条件: dict, 基準: datetime) -> str:
    """発火前に使う次回実行日時（初回の間隔実行は 初回即時猶予分 後＝ほぼ即時）。"""
    if _初回即時対象(条件):
        候補 = 基準 + timedelta(minutes=初回即時猶予分)
        return 候補.replace(second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
    return _次回実行日時計算(条件, 基準)


def _次回繰り越し(条件: dict, 基準: datetime) -> str:
    """発火せずに次周期へ送るときの次回実行日時（時間指定は一回限りなので空にする）。"""
    if str(条件.get("実行区分", "")) == "時間指定":
        return ""
    return _次回算出(条件, 基準)


def _発火可能状態(条件: dict) -> bool:
    """発火してよい状態（実行有効 かつ 要求が 準備完了 / 完了）かを返す。"""
    try:
        有効 = int(条件.get("要求実行有効") or 0) == 1
    except (TypeError, ValueError):
        有効 = False
    return 有効 and str(条件.get("要求状態", "")) in ("準備完了", "完了")


def _保持可能状態(条件: dict) -> bool:
    """次回実行日時を保持してよい状態（実行有効 かつ 要求が 待機/実行中/準備完了/完了）かを返す。

    待機・実行中は自タスクの実行サイクル途中なので次回実行日時は消さない
    （期限が到来しても発火せず次周期へスキップする）。クリアするのは
    無効・準備開始・準備中・エラー・中止などの発火対象外だけ。
    """
    try:
        有効 = int(条件.get("要求実行有効") or 0) == 1
    except (TypeError, ValueError):
        有効 = False
    return 有効 and str(条件.get("要求状態", "")) in ("待機", "実行中", "準備完了", "完了")


def _繰り返し自動復旧対象(条件: dict) -> bool:
    """エラーで終わった周期を、次の周期の頭で自動再開してよい条件かを返す。

    対象は 間隔実行 / 定時実行 で要求が エラー、かつ次回実行日時が残っているものだけ。
    エラー時は 実行有効 が必ず 0 になる（明細失敗 / タスク失敗）ので、実行有効は見ない。

    次回実行日時が残っていることを「ループ運用の途中で落ちた」目印として使う。
    以前のエラーで既に日時が消えているタスクは対象外のままにして、この仕組みを
    足したことで古いエラータスクが勝手に動き出さないようにする。
    """
    if str(条件.get("実行区分", "")) not in ("間隔実行", "定時実行"):
        return False
    if str(条件.get("要求状態", "")) != "エラー":
        return False
    return str(条件.get("次回実行日時", "")) != ""


def 実行条件再計算(タスクID: str) -> str:
    """実行条件の編集・実行有効切替・状態変更時に次回実行日時を計算し直す。

    保持可能状態（実行有効 かつ 要求が 待機/実行中/準備完了/完了）の時間駆動条件だけ
    次回を計算し、それ以外（無効・準備開始・準備中・エラー・中止や即時など）は空に戻す。
    未実行の間隔実行（準備完了 かつ 前回実行日時なし）は現在時刻を入れて初回を即時にする。
    """
    条件 = tasks_db.実行条件監視取得(タスクID)
    if 条件 is None:
        return ""
    時間駆動 = str(条件.get("実行区分", "")) in ("時間指定", "間隔実行", "定時実行")
    新次回 = _次回算出(条件, datetime.now()) if 時間駆動 and _保持可能状態(条件) else ""
    if 新次回 != str(条件.get("次回実行日時", "")):
        tasks_db.次回実行日時更新(タスクID, 新次回)
    return 新次回


def 起動時実行条件初期化(logger: logging.Logger) -> None:
    """PG 起動時（タイマー起動前）の実行条件初期化。

    発火対象外（時間駆動でない・保持可能状態でない）の条件は次回実行日時を一括で空にする。
    停止中に期限が到来した条件（次回実行日時 <= now）は発火させずに次周期へ更新し、
    起動直後のまとめて発火を防ぐ。未計算（空）の時間駆動条件はここで初回計算する。
    """
    try:
        クリア件数 = tasks_db.発火対象外次回実行日時クリア()
        if クリア件数:
            logger.info(f"発火対象外の次回実行日時をクリアしました: {クリア件数} 件")
    except Exception:
        logger.exception("発火対象外の次回実行日時クリアでエラーが発生しました")
    now = datetime.now()
    now文字 = now.strftime("%Y-%m-%d %H:%M:%S")
    for 条件 in tasks_db.実行条件監視一覧():
        利用者ID = str(条件["利用者ID"])
        タスクID = str(条件["タスクID"])
        try:
            if str(条件.get("実行区分", "")) not in ("時間指定", "間隔実行", "定時実行"):
                continue
            if not _保持可能状態(条件) and not _繰り返し自動復旧対象(条件):
                continue  # 次回実行日時は一括クリア済み
            次回 = str(条件.get("次回実行日時", ""))
            if 次回 == "":
                初回 = _次回算出(条件, now)
                if 初回:
                    tasks_db.次回実行日時更新(タスクID, 初回)
                continue
            if 次回 <= now文字:
                新次回 = _次回繰り越し(条件, now)
                tasks_db.次回実行日時更新(タスクID, 新次回)
                logger.info(
                    f"起動時に期限切れの次回実行日時を更新しました: {利用者ID}/{タスクID} {次回} -> {新次回 or 'なし'}"
                )
        except Exception:
            logger.exception(f"起動時実行条件初期化でエラーが発生しました: {利用者ID}/{タスクID}")


def _フォルダ状態取得(パス: str) -> tuple[int, str] | None:
    """監視フォルダ直下のファイル数と最新更新日時を返す。参照不能は None。"""
    try:
        件数 = 0
        最終 = 0.0
        with os.scandir(パス) as it:
            for entry in it:
                if entry.is_file():
                    件数 += 1
                    最終 = max(最終, entry.stat().st_mtime)
        最終日時 = datetime.fromtimestamp(最終).strftime("%Y-%m-%d %H:%M:%S") if 件数 else ""
        return 件数, 最終日時
    except OSError:
        return None


def _即時実行条件確認(logger: logging.Logger) -> None:
    """即時実行（実行区分='即時'）かつ実行有効・準備完了の要求を待機に戻す。

    条件無しの即時実行は _実行条件確認 の対象外（1 分ゲートの対象にもならない）ため、
    状態監視ループの先頭で毎回（10 秒ごとに）確認し、他の処理より先に待機へ戻す。
    フォルダ変化条件付きの即時実行は、この経路ではなく毎分の条件監視で判定する。
    """
    for 行 in tasks_db.即時発火対象一覧():
        利用者ID = str(行["利用者ID"])
        タスクID = str(行["タスクID"])
        try:
            if _前周期の処理が残る(タスクID):
                continue
            if tasks_db.タスク発火(タスクID):
                logger.info(f"即時実行のため待機に戻しました: {利用者ID}/{タスクID}")
        except Exception:
            logger.exception(f"即時実行の待機化でエラーが発生しました: {利用者ID}/{タスクID}")


def _実行条件確認(logger: logging.Logger) -> None:
    """次回実行日時と実行条件を確認して発火する。

    状態監視ループ（hh:mm 変化時、毎分 1 回）から呼ばれる。
    発火条件: 要求が 準備完了 / 完了 かつ実行有効で、明細が全件待機または全件完了。
    保持可能状態でない条件（無効・準備開始・準備中・エラー・中止など）は次回実行日時を空にする。
    自タスクの実行サイクル途中（待機/実行中）や条件不成立の回（フォルダ変化なし等）は
    発火せず次回実行日時だけ次周期へ更新する（スキップ。消さない）。
    発火時は 明細 → 要求 の順で 待機 に戻し、次回実行日時を更新する。
    間隔実行の初回（準備完了 かつ 未実行）は間隔を待たず 初回即時猶予分 後に発火する。
    繰り返し実行（間隔実行/定時実行）の周期がエラーで終わっていた場合は、次の周期の頭で
    エラーの要求・明細を待機へ戻してから発火する（_繰り返し自動復旧対象）。
    連続 繰り返し自動復旧上限 回まで。それを超えたら次回実行日時を消して繰り返しを止める。
    """
    now = datetime.now()
    now文字 = now.strftime("%Y-%m-%d %H:%M:%S")

    for 条件 in tasks_db.実行条件監視一覧():
        利用者ID = str(条件["利用者ID"])
        タスクID = str(条件["タスクID"])
        try:
            区分 = str(条件.get("実行区分", ""))
            時間駆動 = 区分 in ("時間指定", "間隔実行", "定時実行")
            自動復旧対象 = _繰り返し自動復旧対象(条件)

            if not 自動復旧対象 and not _保持可能状態(条件):
                # 発火対象外（無効・準備開始・準備中・エラー・中止など）は次回実行日時を空にする
                if 時間駆動 and str(条件.get("次回実行日時", "")):
                    tasks_db.次回実行日時更新(タスクID, "")
                    logger.info(
                        f"発火対象外のため次回実行日時をクリアしました: {利用者ID}/{タスクID} "
                        f"状態={条件.get('要求状態', '')} 実行有効={条件.get('要求実行有効', '')}"
                    )
                continue

            def 次回送り() -> None:
                """発火せずに次周期へ進める（時間指定は一回限りなので空にする）。"""
                if 時間駆動:
                    tasks_db.次回実行日時更新(タスクID, _次回繰り越し(条件, now))

            if 時間駆動:
                次回 = str(条件.get("次回実行日時", ""))
                if 次回 == "":
                    # 初回は次回実行日時の計算だけ行う
                    初回次回 = _次回算出(条件, now)
                    if 初回次回:
                        tasks_db.次回実行日時更新(タスクID, 初回次回)
                    continue
                if 次回 > now文字:
                    continue

            エラー再開 = False
            if not _発火可能状態(条件):
                if not 自動復旧対象:
                    # 自タスクが待機/実行中（実行サイクル途中）: 発火せず次周期へスキップ
                    次回送り()
                    continue
                # 前の周期がエラーで終わった繰り返し実行。上限まではこの周期で再開させる
                if _自動復旧連続回数.get(タスクID, 0) >= 繰り返し自動復旧上限:
                    tasks_db.次回実行日時更新(タスクID, "")
                    logger.warning(
                        f"エラーからの自動復旧が {繰り返し自動復旧上限} 回続いたため繰り返しを止めました: "
                        f"{利用者ID}/{タスクID} 原因を確認して実行有効を戻してください"
                    )
                    continue
                エラー再開 = True

            # フォルダ変化条件の確認（実行区分=即時 + フォルダ変化 は毎分確認）
            スナップショット: tuple[int, str] | None = None
            if str(条件.get("実行条件", "")) == "フォルダ変化":
                スナップショット = _フォルダ状態取得(str(条件.get("監視フォルダ", "")))
                if スナップショット is None:
                    logger.warning(
                        f"監視フォルダを確認できません: {利用者ID}/{タスクID} {条件.get('監視フォルダ', '')}"
                    )
                    次回送り()
                    continue
                try:
                    保存ファイル数 = int(条件.get("フォルダ内ファイル数"))
                except (TypeError, ValueError):
                    保存ファイル数 = -1
                if 保存ファイル数 < 0:
                    # 初回はスナップショット取得のみ（登録直後の誤発火防止）
                    tasks_db.フォルダ状態記録(タスクID, スナップショット[0], スナップショット[1])
                    次回送り()
                    continue
                if スナップショット == (保存ファイル数, str(条件.get("フォルダ内最終日時", ""))):
                    次回送り()  # 変化なし: 発火せず次周期へ
                    continue

            if _前周期の処理が残る(タスクID):
                # 報告済みでも呼出元の後処理が終わるまで次周期へ進めない。
                # 予定を保持し、次の監視で終了を確認してから発火する。
                continue

            if not tasks_db.タスク発火(タスクID, エラー再開=エラー再開):
                # 明細が実行途中など: 発火せずに次周期へスキップ（消さない）
                次回送り()
                continue

            if エラー再開:
                回数 = _自動復旧連続回数[タスクID] = _自動復旧連続回数.get(タスクID, 0) + 1
                logger.warning(
                    f"前回の周期がエラーで終わったため自動復旧して再開します: {利用者ID}/{タスクID} "
                    f"（連続 {回数}/{繰り返し自動復旧上限} 回目）"
                )
            else:
                # エラーを挟まずに発火できた周期は、連続失敗の数え直し
                _自動復旧連続回数.pop(タスクID, None)

            if スナップショット is not None:
                tasks_db.フォルダ状態記録(タスクID, スナップショット[0], スナップショット[1])
            # 発火後は必ず通常計算（間隔実行は発火時刻 + 間隔。ここで _次回算出 を使うと初回即時が続く）
            次回 = _次回実行日時計算(条件, now) if 時間駆動 and 区分 != "時間指定" else ""
            tasks_db.次回実行日時更新(タスクID, 次回, 前回実行日時=now文字)
            logger.info(
                f"実行開始条件により再実行します: {利用者ID}/{タスクID} 区分={区分} 次回={次回 or 'なし'}"
            )
        except Exception:
            logger.exception(f"実行条件確認でエラーが発生しました: {利用者ID}/{タスクID}")


def _タイムアウト確認(logger: logging.Logger) -> None:
    """進捗が止まったまま制限分以上経過した実行を強制停止してエラーにする。

    状態監視ループ（hh:mm 変化時、毎分 1 回）から呼ばれる。
    明細は 1 件ずつ制限が変わる（予測分数 × 倍率、未見積りを含む下限は最低分）。
    AIタスク要求の 状態='準備中'（sub_init.py による明細分解）だけは準備タイムアウト分で見る。
    """
    try:
        タイムアウト対象 = tasks_db.タイムアウト対象一覧(
            実行タイムアウト分,
            準備タイムアウト分,
            明細最低タイムアウト分,
            明細タイムアウト倍率,
        )
        for 行 in タイムアウト対象:
            pid = str(行.get("PID", "")).strip()
            状態 = str(行.get("状態", ""))
            制限分 = int(行.get("制限分") or 実行タイムアウト分)
            予測 = 行.get("予測分数")
            見積り = f" 予測={予測}分" if 予測 else ""
            logger.warning(
                f"実行タイムアウト({制限分}分{見積り})のためキャンセルします: "
                f"{行['テーブル']} {行.get('利用者ID', '')}/{行.get('タスクID', '')} "
                f"SEQ={行.get('明細SEQ', '')} 状態={状態} "
                f"開始日時={行.get('開始日時', '')} PID={pid}"
            )
            if pid.isdigit():
                _プロセス強制停止(int(pid), logger)
        if タイムアウト対象:
            更新件数 = tasks_db.タイムアウト対象エラー化(タイムアウト対象)
            logger.warning(f"実行タイムアウト対象をエラーにしました: {更新件数} 件")
    except Exception:
        logger.exception("実行タイムアウト処理でエラーが発生しました")


def _チーム状況確認(logger: logging.Logger) -> None:
    """有効なAチーム要員×実行有効なAタスク要求（24時間以内更新）を要員IDで集計し、Aチーム状況を更新する。

    状態監視ループ（10秒間隔）の最後に毎回呼ばれる。
    """
    try:
        tasks_db.チーム状況更新()
    except Exception:
        logger.exception("Aチーム状況の更新でエラーが発生しました")


# 自動実行の対象外として読み飛ばしたタスク。5 秒ごとの監視で同じ警告を出し続けないよう、
# タスクごとに 1 回だけ記録する（黙って continue すると原因調査の手がかりが残らない）。
_未定義タスク通知済み: set[str] = set()


def _未定義タスク通知(タスクID: str, logger: logging.Logger) -> None:
    """AI 分解を通っていないタスクを読み飛ばしたことを 1 回だけ記録する。"""
    if タスクID in _未定義タスク通知済み:
        return
    _未定義タスク通知済み.add(タスクID)
    logger.warning(
        f"AI 分解を通っていないため自動実行の対象外にしました: {タスクID}"
        "（明細の要求内容が全て空です。修正ダイアログの 準備開始 で再分解してください）"
    )


def _起動監視1回(logger: logging.Logger) -> None:
    # 繰り返し要求が無くても終了したPopen参照を定期的に解放する。
    _前周期の処理が残る("")
    # --- 死んだ PID の解放（残したままだと同一タスクの後続明細が起動できない） ---
    _残存PIDクリーンアップ(logger)

    # --- 仮登録（準備開始・PIDなし）→ 準備中 + sub_init.pyでAIタスク分解 ---
    for 行 in tasks_db.実行待ち一覧():
        利用者ID = str(行["利用者ID"])
        タスクID = str(行["タスクID"])
        try:
            if int(行.get("実行回数", 0) or 0) >= 実行回数上限:
                tasks_db.タスク失敗(タスクID, f"実行回数が上限({実行回数上限}回)に達しました")
                logger.warning(f"実行回数上限のため失敗にしました: {利用者ID}/{タスクID}")
                continue
            _タスク実行開始(行, logger)
        except Exception as e:
            logger.exception(f"タスク実行開始に失敗しました: {利用者ID}/{タスクID}")
            try:
                tasks_db.タスク失敗(タスクID, f"実行開始エラー: {e}")
            except Exception:
                logger.exception(f"失敗登録もエラー: {利用者ID}/{タスクID}")

    # --- if 分岐で選ばれなかった枝を パス にして、待機のまま滞留させない ---
    try:
        パス件数 = tasks_db.明細パス伝播()
        if パス件数:
            logger.info(f"分岐条件により {パス件数} 件の明細をパスにしました")
    except Exception:
        logger.exception("明細パス伝播でエラーが発生しました")

    # --- 未実行のタスク明細（先行完了済み）→ タイプ別サブプロセスで 1 ステップ実行 ---
    # 先行SEQ を満たした明細は、同一タスク内でも 明細並行上限 まで同時に起動する
    # （フロー図の分岐どおりに並行実行するため）。タスクをまたぐ並行は従来どおり制限しない。
    # 通知音などの軽量明細は code agent を使わないので、上限の対象外として常に同時起動する。
    code_agent実行中数: dict[str, int] = {}
    for 行 in tasks_db.実行中明細一覧():
        if _軽量並行明細か(行):
            continue
        タスクID = str(行["タスクID"])
        code_agent実行中数[タスクID] = code_agent実行中数.get(タスクID, 0) + 1

    for 行 in tasks_db.実行待ち明細一覧():
        タスクID = str(行["タスクID"])
        明細SEQ = int(行["明細SEQ"])
        # 自動実行の対象は「AI 分解を通ったタスク」だけ。判定は DB の明細（要求内容の有無）で行う。
        # temp/output/<タスクID>.json は初回分解（sub_init.py）が本登録するための中継ファイルで、
        # 本登録が済めば役目が終わる。temp は掃除される場所なので、実行判定には一切使わない。
        if not int(行.get("定義済明細数") or 0):
            _未定義タスク通知(タスクID, logger)
            continue
        軽量並行明細 = _軽量並行明細か(行)
        if not 軽量並行明細 and code_agent実行中数.get(タスクID, 0) >= 明細並行上限:
            continue  # このタスクは上限まで動いている。次の監視回で改めて起動する
        try:
            if int(行.get("実行回数", 0) or 0) >= 実行回数上限:
                tasks_db.明細失敗(タスクID, 明細SEQ, f"実行回数が上限({実行回数上限}回)に達しました")
                logger.warning(f"実行回数上限のため失敗にしました: {タスクID} SEQ={明細SEQ}")
                continue
            _明細実行開始(行, logger)
            if not 軽量並行明細:
                code_agent実行中数[タスクID] = code_agent実行中数.get(タスクID, 0) + 1
        except Exception as e:
            logger.exception(f"ステップ実行開始に失敗しました: {タスクID} SEQ={明細SEQ}")
            try:
                tasks_db.明細失敗(タスクID, 明細SEQ, f"実行開始エラー: {e}")
            except Exception:
                logger.exception(f"失敗登録もエラー: {タスクID} SEQ={明細SEQ}")


async def 起動監視ループ(logger: logging.Logger) -> None:
    """起動監視タイマー：仮登録・実行待ち明細を見つけて sub_init.py 等を起動する（5秒間隔）。"""
    logger.info(f"AIタスクの起動監視ループを開始しました (interval={起動監視間隔秒}s)")
    while True:
        try:
            await asyncio.to_thread(_起動監視1回, logger)
        except Exception:
            logger.exception("AIタスクの起動監視ループでエラーが発生しました")
        await asyncio.sleep(起動監視間隔秒)


async def 状態監視ループ(logger: logging.Logger) -> None:
    """状態監視タイマー：実行開始条件の確認ループ。

    起動（5 秒間隔の 起動監視ループ）とは分離して 10 秒間隔で回し、フォルダ走査などで
    時間がかかっても起動を遅らせない。実行条件の発火確認とタイムアウト確認は
    hh:mm が変わった監視回だけ（毎分 1 回）行い、Aチーム状況の更新は毎回（10秒ごと）の最後に行う。
    """
    global _前回確認分
    logger.info(f"AIタスクの状態監視ループを開始しました (interval={状態監視間隔秒}s)")
    while True:
        try:
            await asyncio.to_thread(_即時実行条件確認, logger)
            現在分 = datetime.now().strftime("%Y-%m-%d %H:%M")
            if 現在分 != _前回確認分:
                _前回確認分 = 現在分
                await asyncio.to_thread(_実行条件確認, logger)
                await asyncio.to_thread(_タイムアウト確認, logger)
            await asyncio.to_thread(_チーム状況確認, logger)
        except Exception:
            logger.exception("AIタスクの状態監視ループでエラーが発生しました")
        await asyncio.sleep(状態監視間隔秒)
