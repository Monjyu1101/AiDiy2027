# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム依頼の監視ループとプロセス管理。

タイマーは2本（task_proc/tasks_watcher.py と同じ構成、詳細は各ループの docstring 参照）。

- 起動監視タイマー = 起動監視ループ（5秒間隔）: 投入待ち（準備開始・未投入）を見つけたら
  temp/team/input/<依頼ID>.json を出力して sub_init.py を subprocess 起動する。
  起動時に準備中へ進め、PID・開始日時・実行回数を記録する。
- 状態監視タイマー = 状態監視ループ（10秒間隔、実際の確認は hh:mm 変化時＝毎分1回）:
  - 開始してから無進捗タイムアウト分（既定30分）以上ひとつも進捗が無い依頼を強制停止してエラーにする。
    状態='準備中'（sub_init.py による担当選択とAIタスク投入）だけは準備無進捗タイムアウト分（既定10分）で見る。
  - 終わった Aチーム依頼に対応する未終了の作業レコードを回収する
    （作業ループのオン・オフに関わらず行う）。
  - Aチーム目標の作業ループ（PDCA）も確認する。実行中の要員がいない空き時間で、
    前の段が終わっていれば次の段を、目標のパターン（SPDCA/PlanDo）に対応する
    sub_SPDCA_*.py / sub_PlanDo_*.py で投入する。
  - Aチーム目標（最終更新1件）の自動作業設定がオンなら、雑談エリア（状態=雑談中）の
    要員から1名を選んで sub_self_talk.py を起動し、分の下一桁1〜9の回にAチーム会話へ
    「今やるべきこと」の発言を1件集める（雑談確認）。下一桁0の回は、有効要員数の50%以上の
    意見があれば sub_self_work.py を起動し、admin人格でチーム作業へ取りまとめる。
- システム開始時（再起動含む）は、テーブルに残った未投入の依頼をエラーとして記録しクリアする
  （PID は再利用され得るため、プロセスの強制停止はしない）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from . import team_db, team_exp_db, team_goal_db, team_pdca_db, team_status_db, team_talk_db, team_work_db
from .config import AIモデル
from .store import ストア

起動監視間隔秒 = 5
状態監視間隔秒 = 10
実行回数上限 = 3

_BASE_DIR = Path(__file__).resolve().parents[1]
_SUB_INITパス = _BASE_DIR / "team_sub" / "sub_init.py"
_入力DIR = _BASE_DIR / "temp" / "team" / "input"
_SUB_EXPパス = _BASE_DIR / "team_sub" / "sub_exp.py"
_経験入力DIR = _BASE_DIR / "temp" / "team" / "exp"
_SUB_PDCAパス = {
    "SPDCA": {
        "S": _BASE_DIR / "team_sub" / "sub_SPDCA_soudan.py",
        "P": _BASE_DIR / "team_sub" / "sub_SPDCA_plan.py",
        "D": _BASE_DIR / "team_sub" / "sub_SPDCA_do.py",
        "C": _BASE_DIR / "team_sub" / "sub_SPDCA_check.py",
        "A": _BASE_DIR / "team_sub" / "sub_SPDCA_action.py",
    },
    "PlanDo": {
        "P": _BASE_DIR / "team_sub" / "sub_PlanDo_plan.py",
        "D": _BASE_DIR / "team_sub" / "sub_PlanDo_do.py",
    },
}
_作業入力DIR = _BASE_DIR / "temp" / "team" / "pdca"
_SUB_ENDパス = _BASE_DIR / "team_sub" / "sub_PlanDo_end.py"
_SUB_SELF_TALKパス = _BASE_DIR / "team_sub" / "sub_self_talk.py"
_SUB_SELF_WORKパス = _BASE_DIR / "team_sub" / "sub_self_work.py"
_雑談入力DIR = _BASE_DIR / "temp" / "team" / "talk"

# 状態監視タイマーの本処理は hh:mm が変わった確認回だけ処理する（毎分 1 回）
_前回確認分 = ""
# 起動中の作業ループ投入プロセス（前回分が動いている間は次を投入しない）
_作業プロセス: subprocess.Popen | None = None
# 起動中のPlanDo／SPDCA共通終了フック
_終了プロセス: subprocess.Popen | None = None
# 起動中プロセスが正常終了したときに完了済みへ移すキー
_終了処理中キー: tuple[str, str, int, int, str] | None = None
# 同じ完了状態で毎分終了フックを繰り返さないための識別キー
_終了処理済みキー: set[tuple[str, str, int, int, str]] = set()
# 未実装区分の案内は毎分繰り返さず、プロジェクト×区分ごとに1回だけ出す
_作業未実装通知済み: set[tuple[str, str]] = set()
# 起動中の雑談発言プロセス（前回分が動いている間は次を投入しない。
# sub_self_talk.py はソースを読んでから発言する調査モードのため最大6分程度かかる）
_雑談プロセス: subprocess.Popen | None = None
# 起動中のチーム作業取りまとめプロセス（分の下一桁0の回にだけ投入を確認する）
_自己作業プロセス: subprocess.Popen | None = None


def _サブプロセス環境() -> dict:
    """サブプロセスの標準出力を UTF-8 にする環境変数を足して返す。

    Windows では既定が cp932 になり、AI応答に含まれる — や絵文字を print した時点で
    UnicodeEncodeError になって処理が失敗するため（変換できない文字は置換する）。
    """
    return {**os.environ, "PYTHONIOENCODING": "utf-8:replace"}


def _安全ファイル名部品(値: str) -> str:
    return re.sub(r"[^0-9A-Za-z_.\-぀-ヿ㐀-鿿]", "_", 値)


def _入力パス(依頼ID: str) -> Path:
    return _入力DIR / f"{_安全ファイル名部品(依頼ID)}.json"


def _経験入力パス(経験ID: str) -> Path:
    return _経験入力DIR / f"{_安全ファイル名部品(経験ID)}.json"


def _作業入力パス(プロジェクト: str, 区分: str) -> Path:
    時刻 = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _作業入力DIR / f"{_安全ファイル名部品(プロジェクト)}_{_安全ファイル名部品(区分)}_{時刻}.json"


def _終了入力パス(プロジェクト: str) -> Path:
    時刻 = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _作業入力DIR / f"{_安全ファイル名部品(プロジェクト)}_terminate_{時刻}.json"


def _雑談入力パス(プロジェクト: str) -> Path:
    時刻 = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _雑談入力DIR / f"{_安全ファイル名部品(プロジェクト)}_{時刻}.json"


def _自己作業入力パス(プロジェクト: str) -> Path:
    時刻 = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _雑談入力DIR / f"{_安全ファイル名部品(プロジェクト)}_self_work_{時刻}.json"


def _プロセス強制停止(pid: int, logger: logging.Logger) -> None:
    """PID のプロセスを強制停止する。python 以外は誤爆防止のため停止しない。"""
    try:
        if os.name == "nt":
            確認 = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if f'"{pid}"' not in 確認.stdout:
                return
            if "python" not in 確認.stdout.lower():
                logger.warning(f"PID {pid} はpythonプロセスではないため停止しません")
                return
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=15,
            )
        else:
            import signal

            os.kill(pid, signal.SIGKILL)
        logger.info(f"残存sub_initを停止しました: PID={pid}")
    except ProcessLookupError:
        pass
    except Exception as e:
        logger.warning(f"PID {pid} の停止に失敗しました: {e}")


def 起動時クリーンアップ(logger: logging.Logger) -> None:
    """システム開始時: 未投入のまま残った依頼をエラーとして記録しクリアする。

    PID は OS に再利用され得るため、別プロセスを誤って停止する恐れがあり強制停止はしない。
    """
    try:
        残存 = team_work_db.残存PID一覧()
        for 行 in 残存:
            logger.info(f"起動時クリーンアップ: 依頼ID={行.get('依頼ID', '')} PID={行.get('PID', '')}")
        更新件数 = team_work_db.PID全クリア()
        if 更新件数:
            logger.info(f"残存依頼を{更新件数}件エラーにしてクリアしました")
    except Exception:
        logger.exception("チーム依頼の起動時クリーンアップに失敗しました")
    try:
        for 行 in team_exp_db.生成中一覧():
            logger.info(f"起動時クリーンアップ: 経験ID={行.get('経験ID', '')} PID={行.get('PID', '')}")
        経験件数 = team_exp_db.生成中をエラー化("システム再起動のため中断しました")
        if 経験件数:
            logger.info(f"生成中の経験を{経験件数}件エラーにしてクリアしました")
    except Exception:
        logger.exception("Aチーム経験の起動時クリーンアップに失敗しました")
    try:
        作業件数 = team_pdca_db.取り残し終了()
        if 作業件数:
            logger.info(f"終了済み依頼に対応する作業レコードを{作業件数}件回収しました")
    except Exception:
        logger.exception("Aチーム作業の起動時クリーンアップに失敗しました")


_依頼プロセス: dict[str, subprocess.Popen] = {}


def 準備プロセス停止(依頼ID: str, logger: logging.Logger) -> None:
    """このサーバーが所有する生存プロセスだけを停止する。"""
    proc = _依頼プロセス.pop(依頼ID, None)
    if proc is not None and proc.poll() is None:
        _プロセス強制停止(proc.pid, logger)
        proc.wait(timeout=15)


def _依頼実行開始(行: dict, logger: logging.Logger) -> None:
    """投入待ち依頼 1 件について入力 JSON を出力し、sub_init.py を起動して PID を記録する。"""
    依頼ID = str(行["依頼ID"])
    if not team_work_db.依頼確保(依頼ID):
        return
    if int(行.get("実行回数", 0) or 0) >= 実行回数上限:
        team_work_db.投入失敗記録(依頼ID, f"実行回数が上限({実行回数上限}回)に達しました")
        logger.warning(f"実行回数上限のため失敗にしました: {依頼ID}")
        return

    try:
        _入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _入力パス(依頼ID)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "要員ID": str(行.get("要員ID", "")),
                    "依頼ID": 依頼ID,
                    "プロジェクト": str(行.get("プロジェクト", "")),
                    "要求内容": str(行.get("要求内容", "")),
                    "TEAM_AI_NAME": str(行.get("TEAM_AI_NAME", "claude_cli")),
                    "TASK_AI_NAME": str(行.get("TASK_AI_NAME", "claude_cli")),
                    **{
                        カラム: str(行.get(カラム, "auto") or "auto")
                        for カラム in team_work_db.AIモデルカラム
                    },
                    "実行有効": int(行.get("実行有効", 1) or 0),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(_SUB_INITパス), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        for key, previous in list(_依頼プロセス.items()):
            if previous.poll() is not None:
                _依頼プロセス.pop(key, None)
        _依頼プロセス[依頼ID] = proc
        現行 = team_work_db.依頼取得(str(行.get("要員ID", "")), 依頼ID)
        if not 現行 or 現行["状態"] != "準備中":
            準備プロセス停止(依頼ID, logger)
            return
        team_work_db.実行開始記録(依頼ID, proc.pid)
        logger.info(f"チーム依頼のタスク投入を開始しました: {依頼ID} PID={proc.pid}")
    except Exception as e:
        team_work_db.投入失敗記録(依頼ID, f"sub_init起動エラー: {e}")
        logger.exception(f"チーム依頼sub_initの起動に失敗しました: {依頼ID}")


def _タイムアウト確認(logger: logging.Logger) -> None:
    """開始してから無進捗タイムアウト分以上ひとつも進捗が無い依頼を強制停止してエラーにする。

    状態監視ループ（hh:mm が変わった回だけ、毎分1回）から呼ばれる。
    """
    try:
        タイムアウト対象 = team_work_db.依頼タイムアウト対象一覧(
            team_work_db.無進捗タイムアウト分, team_work_db.準備無進捗タイムアウト分
        )
        for 行 in タイムアウト対象:
            pid = str(行.get("PID", "")).strip()
            状態 = str(行.get("状態", ""))
            制限分 = (
                team_work_db.準備無進捗タイムアウト分
                if 状態 == "準備中"
                else team_work_db.無進捗タイムアウト分
            )
            logger.warning(
                f"無進捗タイムアウト({制限分}分)のためキャンセルします: "
                f"{行.get('依頼ID', '')} (要員ID={行.get('要員ID', '')} 状態={状態}) "
                f"開始日時={行.get('開始日時', '')} 最終進捗={行.get('最終進捗日時', '')} PID={pid}"
            )
            if pid.isdigit():
                _プロセス強制停止(int(pid), logger)
        if タイムアウト対象:
            更新件数 = team_work_db.依頼タイムアウト対象エラー化(タイムアウト対象)
            logger.warning(f"無進捗タイムアウト対象をエラーにしました: {更新件数} 件")
    except Exception:
        logger.exception("無進捗タイムアウト処理でエラーが発生しました")


def _経験生成開始(対象: dict, logger: logging.Logger) -> None:
    """完了した依頼 1 件を経験化する。仮登録 → sub_exp.py 起動まで行う。"""
    依頼ID = str(対象["依頼ID"])
    経験 = team_exp_db.経験仮登録(対象)
    if not 経験:
        # 同時実行などで既に登録済み
        return
    経験ID = str(経験["経験ID"])
    try:
        _経験入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _経験入力パス(経験ID)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "経験ID": 経験ID,
                    "依頼ID": 依頼ID,
                    "タスクID": str(対象.get("タスクID", "")),
                    "要員ID": str(対象.get("要員ID", "")),
                    "プロジェクト": str(対象.get("プロジェクト", "")),
                    "要求内容": str(対象.get("要求内容", "")),
                    "TEAM_AI_NAME": str(対象.get("TEAM_AI_NAME", "claude_cli")),
                    "TASK_AI_NAME": str(対象.get("TASK_AI_NAME", "claude_cli")),
                    # 経験まとめは plan 扱い。sub_exp.py が依頼の plan 用モデルを使う
                    **{
                        カラム: str(対象.get(カラム, "auto") or "auto")
                        for カラム in team_work_db.AIモデルカラム
                    },
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(_SUB_EXPパス), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        team_exp_db.生成開始記録(経験ID, proc.pid)
        logger.info(f"Aチーム経験の生成を開始しました: {経験ID} (依頼={依頼ID}) PID={proc.pid}")
    except Exception as e:
        team_exp_db.経験失敗記録(経験ID, f"sub_exp起動エラー: {e}")
        logger.exception(f"Aチーム経験のsub_exp起動に失敗しました: {経験ID}")


def _経験生成確認(logger: logging.Logger) -> None:
    """完了から1時間以内で経験未登録の依頼を経験化する（1分ごと）。"""
    try:
        # 生成が長引いたものはエラーにして次回に持ち越さない
        for 行 in team_exp_db.生成タイムアウト対象一覧():
            pid = str(行.get("PID", "")).strip()
            logger.warning(
                f"経験生成タイムアウト({team_exp_db.生成タイムアウト分}分): "
                f"{行.get('経験ID', '')} 開始日時={行.get('開始日時', '')} PID={pid}"
            )
            if pid.isdigit():
                _プロセス強制停止(int(pid), logger)
            team_exp_db.経験失敗記録(
                str(行["経験ID"]), f"生成が{team_exp_db.生成タイムアウト分}分を超えたため中断しました"
            )
        for 対象 in team_exp_db.経験対象一覧():
            _経験生成開始(対象, logger)
    except Exception:
        logger.exception("Aチーム経験の生成確認でエラーが発生しました")


def _作業実行開始(目標: dict, 区分: str, logger: logging.Logger) -> subprocess.Popen | None:
    """PDCA 1段分の入力 JSON を出力し、パターン・区分に対応する sub_SPDCA_*.py / sub_PlanDo_*.py を起動する。"""
    プロジェクト = str(目標.get("CODE_BASE_PATH", ""))
    パターン = str(目標.get("パターン") or team_pdca_db.既定パターン)
    スクリプト = _SUB_PDCAパス.get(パターン, {}).get(区分)
    if スクリプト is None:
        logger.warning(f"作業ループ({パターン}/{区分})に対応するスクリプトがありません: プロジェクト={プロジェクト}")
        return None
    try:
        _作業入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _作業入力パス(プロジェクト, 区分)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "プロジェクト": プロジェクト,
                    "チーム目標": str(目標.get("チーム目標", "")),
                    "チーム作業": str(目標.get("チーム作業", "")),
                    "パターン": パターン,
                    "PDCA区分": 区分,
                    "作業ループ回数": max(1, min(99, int(目標.get("作業ループ回数", 1) or 1))),
                    "動員要員数": max(
                        1,
                        min(
                            team_goal_db.動員要員数上限,
                            int(目標.get("動員要員数", team_goal_db.既定動員要員数)
                                or team_goal_db.既定動員要員数),
                        ),
                    ),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(スクリプト), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        logger.info(
            f"作業ループ({区分})の投入を開始しました: プロジェクト={プロジェクト} PID={proc.pid}"
        )
        return proc
    except Exception:
        logger.exception(f"作業ループ({区分})の起動に失敗しました: プロジェクト={プロジェクト}")
        return None


def _作業回収(logger: logging.Logger) -> None:
    """Aチーム依頼が終わっているのに未終了で残った作業レコードを回収する（1分ごと）。

    作業ループのオン・オフや空き時間の有無とは無関係に毎分行う。作業ループがオンの
    プロジェクトだけを対象にしていると、起動時のオフ解除（team_goal_db.起動時作業ループをオフ）
    直後にタイムアウトやエラーで確定した依頼を誰も回収できず、作業レコードが未終了のまま
    固着してしまうため。
    """
    try:
        回収件数 = team_pdca_db.取り残し終了()
        if 回収件数:
            logger.info(f"終了済みのAチーム依頼に対応する作業レコードを{回収件数}件回収しました")
    except Exception:
        logger.exception("Aチーム作業の回収でエラーが発生しました")


def _作業ループ確認(logger: logging.Logger) -> None:
    """作業ループがオンの目標について、空き時間なら次の PDCA 段を投入する（1分ごと）。

    投入するのは次のすべてを満たすときだけ。
    - 前回の投入プロセスが残っていない
    - Aチーム状況で実行中（準備中・実行中）の要員が 1 人もいない＝空き時間
    - そのプロジェクトの Aチーム作業に未終了レコードが無く、次の区分が実装済み

    未終了レコードの回収は _作業回収() が毎分行うため、ここでは行わない。
    """
    global _作業プロセス
    try:
        if _作業プロセス is not None and _作業プロセス.poll() is None:
            return
        _作業プロセス = None
        対象一覧 = [
            目標
            for 目標 in team_goal_db.作業ループ対象一覧()
            if bool(目標.get("作業ループ")) and str(目標.get("チーム作業", "")).strip()
        ]
        if not 対象一覧:
            return
        実行中人数 = team_status_db.実行中要員数()
        if 実行中人数 > 0:
            return
        for 目標 in 対象一覧:
            プロジェクト = str(目標.get("CODE_BASE_PATH", ""))
            パターン = str(目標.get("パターン") or team_pdca_db.既定パターン)
            区分一覧 = team_pdca_db.パターン区分一覧.get(パターン, team_pdca_db.パターン区分一覧[team_pdca_db.既定パターン])
            区分 = team_pdca_db.次のPDCA区分(プロジェクト, パターン)
            if not 区分:
                continue
            作業ループ回数 = max(1, min(99, int(目標.get("作業ループ回数", 1) or 1)))
            現在ループ = team_pdca_db.ループ最大値(プロジェクト)
            if 区分 == 区分一覧[0] and 作業ループ回数 != 99 and 現在ループ >= 作業ループ回数:
                # 止まったのか、やり切って終わったのかを区別できるよう1回だけ記録する
                if (プロジェクト, "完了") not in _作業未実装通知済み:
                    _作業未実装通知済み.add((プロジェクト, "完了"))
                    logger.info(
                        f"作業ループは作業ループ回数に達したため終了しました: "
                        f"プロジェクト={プロジェクト} 完了={現在ループ}周 設定={作業ループ回数}周"
                    )
                continue
            _作業未実装通知済み.discard((プロジェクト, "完了"))
            if 区分 not in 区分一覧 or 区分 not in _SUB_PDCAパス.get(パターン, {}):
                if (プロジェクト, 区分) not in _作業未実装通知済み:
                    _作業未実装通知済み.add((プロジェクト, 区分))
                    logger.info(
                        f"作業ループの次の区分({区分})は未実装のため投入しません: プロジェクト={プロジェクト}"
                    )
                continue
            _作業未実装通知済み.discard((プロジェクト, 区分))
            _作業プロセス = _作業実行開始(目標, 区分, logger)
            # 空き時間を埋めるのは1サイクルにつき1プロジェクトだけにする
            break
    except Exception:
        logger.exception("作業ループの確認でエラーが発生しました")


def _終了実行開始(目標: dict, logger: logging.Logger) -> subprocess.Popen | None:
    """作業ループ終了時の入力JSONを出力し、PlanDo／SPDCA共通終了フックを起動する。"""
    プロジェクト = str(目標.get("CODE_BASE_PATH", "")).strip()
    パターン = str(目標.get("パターン") or team_pdca_db.既定パターン)
    try:
        _作業入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _終了入力パス(プロジェクト)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "プロジェクト": プロジェクト,
                    "チーム目標": str(目標.get("チーム目標", "")),
                    "チーム作業": str(目標.get("チーム作業", "")),
                    "自動作業設定": bool(目標.get("自動作業設定")),
                    "パターン": パターン,
                    "作業ループ回数": max(1, min(99, int(目標.get("作業ループ回数", 1) or 1))),
                    "現在ループ": team_pdca_db.ループ最大値(プロジェクト),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(_SUB_ENDパス), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        logger.info(
            f"作業ループ終了フックを開始しました: プロジェクト={プロジェクト} "
            f"パターン={パターン} PID={proc.pid}"
        )
        return proc
    except Exception:
        logger.exception(f"作業ループ終了フックの起動に失敗しました: プロジェクト={プロジェクト} パターン={パターン}")
        return None


def _作業ループ終了確認(logger: logging.Logger) -> None:
    """毎分用の終了判定で作業完了を検知し、PlanDo／SPDCA共通終了フックを1回起動する。"""
    global _終了プロセス, _終了処理中キー
    try:
        if _終了プロセス is not None:
            終了コード = _終了プロセス.poll()
            if 終了コード is None:
                return
            if 終了コード == 0 and _終了処理中キー is not None:
                _終了処理済みキー.add(_終了処理中キー)
            _終了プロセス = None
            _終了処理中キー = None
        for 目標 in team_goal_db.作業ループ対象一覧():
            プロジェクト = str(目標.get("CODE_BASE_PATH", "")).strip()
            チーム作業 = str(目標.get("チーム作業", "")).strip()
            if not プロジェクト or not bool(目標.get("作業ループ")) or not チーム作業:
                continue
            パターン = str(目標.get("パターン") or team_pdca_db.既定パターン)
            作業ループ回数 = max(1, min(99, int(目標.get("作業ループ回数", 1) or 1)))
            if not team_pdca_db.作業ループ終了済み(プロジェクト, パターン, 作業ループ回数):
                continue
            現在ループ = team_pdca_db.ループ最大値(プロジェクト)
            終了キー = (
                プロジェクト,
                パターン,
                作業ループ回数,
                現在ループ,
                str(目標.get("更新日時", "")),
            )
            if 終了キー in _終了処理済みキー:
                continue
            _終了プロセス = _終了実行開始(目標, logger)
            if _終了プロセス is not None:
                _終了処理中キー = 終了キー
            # 1分の確認につき1プロジェクトだけ起動する
            break
    except Exception:
        logger.exception("作業ループ終了フックの確認でエラーが発生しました")


def _雑談発言者を選ぶ(候補: list[str], プロジェクト: str) -> str | None:
    """発言の無い1名（複数いればランダム）、全員発言済みなら最も古い発言者を選ぶ。"""
    if not 候補:
        return None
    発言済み = team_talk_db.発言状況一覧(プロジェクト)
    未発言 = [要員ID for 要員ID in 候補 if 要員ID not in 発言済み]
    if 未発言:
        return random.choice(未発言)
    return min(候補, key=lambda 要員ID: 発言済み.get(要員ID, ""))


def _10分以内の発言か(最終発言日時: str, 現在日時: datetime | None = None) -> bool:
    """最終発言日時が現在から10分以内なら True。解釈できない日時は False。"""
    if not 最終発言日時:
        return False
    try:
        最終発言 = datetime.strptime(最終発言日時, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    現在 = 現在日時 or datetime.now()
    return 最終発言 >= 現在 - timedelta(minutes=10)


def _目標のTASKモデル(目標: dict, フェーズ: str) -> str:
    """目標のフェーズ別モデルを返す。`auto`（指定なし）なら共通設定のフェーズ別値を使う。"""
    値 = str(目標.get(f"TASK_AI_MODEL_{フェーズ}", "") or "").strip()
    if 値 and 値 != "auto":
        return 値
    return AIモデル("TASK", フェーズ)


def _雑談実行開始(
    会話: dict,
    目標: dict,
    他者意見一覧: list[dict],
    自身の前回発言: str,
    logger: logging.Logger,
) -> subprocess.Popen | None:
    """雑談1件分の入力 JSON を出力し、sub_self_talk.py を起動する。"""
    プロジェクト = str(会話.get("プロジェクト", ""))
    要員ID = str(会話.get("要員ID", ""))
    try:
        _雑談入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _雑談入力パス(プロジェクト)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "プロジェクト": プロジェクト,
                    "要員ID": 要員ID,
                    "チーム目標": str(目標.get("チーム目標", "")),
                    "TASK_AI_NAME": str(目標.get("TASK_AI_NAME", "claude_cli")),
                    # 雑談は意見出し（相談）なので plan フェーズのモデルを使う
                    "TASK_AI_MODEL_plan": _目標のTASKモデル(目標, "plan"),
                    "他者意見": [
                        {"要員ID": str(行.get("要員ID", "")), "発言内容": str(行.get("発言内容", ""))}
                        for 行 in 他者意見一覧
                    ],
                    "自身の1回前の発言": 自身の前回発言,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(_SUB_SELF_TALKパス), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        logger.info(f"雑談の発言を開始しました: 要員ID={要員ID} プロジェクト={プロジェクト} PID={proc.pid}")
        return proc
    except Exception:
        logger.exception(f"雑談の発言起動に失敗しました: 要員ID={要員ID} プロジェクト={プロジェクト}")
        return None


def _雑談確認(logger: logging.Logger, 現在日時: datetime | None = None) -> None:
    """目標を協議中なら、雑談エリアの要員から1名を選んで発言させる（毎分、下一桁0分を除く）。

    投入するのは次のすべてを満たすときだけ。
    - 前回の発言投入プロセスが残っていない（sub_self_talk.py は調査モードで最大6分程度かかる）
    - Aチーム目標の最終更新（掲示板に出ている目標）でチーム目標が入力済み
    - 自動作業設定がオン
    - チーム作業が空欄（作業内容を協議中）
    - Aチーム会話に発言内容が空の行（他者の発言処理中）が無い
    - 雑談エリア（状態=雑談中、admin以外）の要員が1名以上いる
    - 発言予定の要員が直近10分以内に発言していない

    選ぶのは、Aチーム会話に発言（発言内容あり）の無い要員を優先し、
    全員発言済みなら最も古い発言者。選んだプロジェクト・要員IDの会話行を空にして
    発言シーケンスに入ったことをマーキングしてから sub_self_talk.py を起動する。
    AIへ渡す意見には他者の最終発言に加え、対象要員自身の1回前の発言も含める。
    """
    global _雑談プロセス
    try:
        現在 = 現在日時 or datetime.now()
        if 現在.minute % 10 == 0:
            return
        if _雑談プロセス is not None and _雑談プロセス.poll() is None:
            return
        _雑談プロセス = None
        目標 = team_goal_db.最終目標取得()
        if not 目標:
            return
        if not str(目標.get("チーム目標", "")).strip():
            return
        if not bool(目標.get("自動作業設定")):
            return
        if str(目標.get("チーム作業", "")).strip():
            return
        プロジェクト = str(目標.get("CODE_BASE_PATH", ""))
        if not プロジェクト:
            return
        if team_talk_db.発言中あり():
            return
        候補 = [
            str(エージェント["エージェントID"])
            for エージェント in ストア.エージェント一覧()
            if エージェント.get("状態") == "雑談中"
            and str(エージェント["エージェントID"]) != team_db.管理者要員ID
        ]
        要員ID = _雑談発言者を選ぶ(候補, プロジェクト)
        if not 要員ID:
            return
        自身の前回会話 = team_talk_db.会話取得(プロジェクト, 要員ID) or {}
        if _10分以内の発言か(str(自身の前回会話.get("更新日時", ""))):
            return
        自身の前回発言 = str(自身の前回会話.get("発言内容", "")).strip()
        他者意見一覧 = [
            行 for 行 in team_talk_db.最新発言一覧(プロジェクト)
            if str(行.get("要員ID", "")) != 要員ID
        ]
        操作者 = {"利用者ID": "system", "利用者名": "システム", "端末ID": "backend_team"}
        会話 = team_talk_db.発言登録(プロジェクト, 要員ID, 操作者)
        _雑談プロセス = _雑談実行開始(
            会話,
            目標,
            他者意見一覧,
            自身の前回発言,
            logger,
        )
        if _雑談プロセス is None:
            team_talk_db.発言更新(
                プロジェクト,
                要員ID,
                "",
                "(発言プロセスを起動できませんでした)",
            )
    except Exception:
        logger.exception("雑談の確認でエラーが発生しました")


def _自己作業実行開始(目標: dict, 意見一覧: list[dict], logger: logging.Logger) -> subprocess.Popen | None:
    """各要員の意見をJSONへ出力し、adminによるsub_self_work.pyを起動する。"""
    プロジェクト = str(目標.get("CODE_BASE_PATH", "")).strip()
    try:
        _雑談入力DIR.mkdir(parents=True, exist_ok=True)
        入力パス = _自己作業入力パス(プロジェクト)
        with 入力パス.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "プロジェクト": プロジェクト,
                    "チーム目標": str(目標.get("チーム目標", "")),
                    "TASK_AI_NAME": str(目標.get("TASK_AI_NAME", "claude_cli")),
                    # 自己作業はソースを変更する実施なので do フェーズのモデルを使う
                    "TASK_AI_MODEL_do": _目標のTASKモデル(目標, "do"),
                    "意見一覧": [
                        {"要員ID": str(行.get("要員ID", "")), "発言内容": str(行.get("発言内容", ""))}
                        for 行 in 意見一覧
                    ],
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            [sys.executable, str(_SUB_SELF_WORKパス), str(入力パス)],
            cwd=str(_BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            env=_サブプロセス環境(),
        )
        logger.info(
            f"チーム作業の取りまとめを開始しました: プロジェクト={プロジェクト} "
            f"意見数={len(意見一覧)} PID={proc.pid}"
        )
        return proc
    except Exception:
        logger.exception(f"チーム作業の取りまとめ起動に失敗しました: プロジェクト={プロジェクト}")
        return None


def _自己作業確認(logger: logging.Logger, 現在日時: datetime | None = None) -> None:
    """分の下一桁0の回に、十分な意見があればadminのチーム作業取りまとめを起動する。

    チーム目標あり・自動作業設定オン・チーム作業空欄を前提とし、有効要員ID数
    （adminを含む）の50%以上にあたる要員から発言が集まった場合だけ起動する。
    """
    global _自己作業プロセス
    try:
        現在 = 現在日時 or datetime.now()
        if 現在.minute % 10 != 0:
            return
        if _自己作業プロセス is not None and _自己作業プロセス.poll() is None:
            return
        _自己作業プロセス = None
        if _雑談プロセス is not None and _雑談プロセス.poll() is None:
            return

        目標 = team_goal_db.最終目標取得()
        if not 目標:
            return
        if not str(目標.get("チーム目標", "")).strip():
            return
        if not bool(目標.get("自動作業設定")):
            return
        if str(目標.get("チーム作業", "")).strip():
            return
        プロジェクト = str(目標.get("CODE_BASE_PATH", "")).strip()
        if not プロジェクト or team_talk_db.発言中あり():
            return

        有効要員ID一覧 = [
            str(要員.get("要員ID", "")).strip()
            for 要員 in team_db.要員一覧()
            if str(要員.get("要員ID", "")).strip()
        ]
        if not 有効要員ID一覧:
            return
        有効要員ID集合 = set(有効要員ID一覧)
        意見一覧 = [
            行
            for 行 in team_talk_db.最新発言一覧(プロジェクト)
            if str(行.get("要員ID", "")) in 有効要員ID集合
            and str(行.get("発言内容", "")).strip()
        ]
        必要意見数 = (len(有効要員ID一覧) + 1) // 2
        if len(意見一覧) < 必要意見数:
            return

        _自己作業プロセス = _自己作業実行開始(目標, 意見一覧, logger)
    except Exception:
        logger.exception("チーム作業の取りまとめ確認でエラーが発生しました")


def _起動監視1回(logger: logging.Logger) -> None:
    # --- 投入待ち（準備開始・未投入）→ 準備中 + sub_init.pyでAIタスク投入 ---
    for 行 in team_work_db.投入待ち一覧():
        _依頼実行開始(行, logger)


def _状態監視1回(logger: logging.Logger) -> None:
    global _前回確認分
    現在分 = datetime.now().strftime("%Y-%m-%d %H:%M")
    if 現在分 == _前回確認分:
        return
    _前回確認分 = 現在分
    _タイムアウト確認(logger)
    _経験生成確認(logger)
    # 回収は作業ループのオン・オフに関わらず行い、そのうえで次の段の投入を判断する
    _作業回収(logger)
    _作業ループ確認(logger)
    _作業ループ終了確認(logger)
    _雑談確認(logger)
    _自己作業確認(logger)


async def 起動監視ループ(logger: logging.Logger) -> None:
    """起動監視タイマー：投入待ちの依頼を見つけて sub_init.py を起動する（5秒間隔）。"""
    logger.info(f"チーム依頼の起動監視ループを開始しました (interval={起動監視間隔秒}s)")
    while True:
        try:
            await asyncio.to_thread(_起動監視1回, logger)
        except Exception:
            logger.exception("チーム依頼の起動監視ループでエラーが発生しました")
        await asyncio.sleep(起動監視間隔秒)


async def 状態監視ループ(logger: logging.Logger) -> None:
    """状態監視タイマー：無進捗タイムアウト・経験生成・作業ループを確認する。

    起動（5 秒間隔の 起動監視ループ）とは分離して 10 秒間隔で回すが、本処理は
    hh:mm が変わった監視回だけ（毎分 1 回）行う。
    """
    logger.info(f"チーム依頼の状態監視ループを開始しました (interval={状態監視間隔秒}s)")
    while True:
        try:
            await asyncio.to_thread(_状態監視1回, logger)
        except Exception:
            logger.exception("チーム依頼の状態監視ループでエラーが発生しました")
        await asyncio.sleep(状態監視間隔秒)
