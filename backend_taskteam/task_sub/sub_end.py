# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの終了明細を処理するサブプロセス。

終了明細（DB上の操作検証フラグ、他のいずれかの明細でファイル操作があれば true）に
応じて処理を分岐する。
- 操作検証=false: ファイル操作を伴う明細が無いため、AIを介さずそのまま終了完了にする
- 操作検証=true : sub_do と同様の内容（処理目標と実行済ステップの記録）を指定
  プロジェクトフォルダ・指定 AI へ渡し、最終検証と結論の task_check_okng 報告を依頼する。
  AI が報告せずに戻ってきた場合は、明細を強制的にエラーで確定する。
ローカルの temp/input・temp/output JSON には依存せず、タスクID と SEQ だけで完結する。
標準ライブラリのみで動作する。

処理の流れ:
1. /task/タスク要求/取得 でタスク全体（タイトル・プロジェクト）を取得する
2. /task/タスク明細/一覧 から全明細（完了済みの応答内容、対象行の操作検証フラグ）を取得する
3. 操作検証=false なら /task/タスク明細/終了完了 を呼んで終了する
4. 操作検証=true なら aidiy_code_agents MCP へ最終検証を依頼し、結論は AI 自身が
   http://127.0.0.1:8093/task_check_okng へ直接報告する
5. AI 応答後に明細の状態を確認し、完了/エラーのいずれにも更新されていなければ
   /task/タスク明細/失敗 で強制的にエラーにする
"""

from __future__ import annotations

import json
import os
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json, report_instruction
import traceback

_SELF_DIR = os.path.dirname(os.path.abspath(__file__))
if _SELF_DIR not in sys.path:
    sys.path.insert(0, _SELF_DIR)
from sub_context import 差し込み  # noqa: E402  同フォルダの定型コンテキスト読込

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASK_API = "http://127.0.0.1:8093/task"
MCP_URL = "http://127.0.0.1:8095/aidiy_code_agents/run"
TASK_AI_NAME既定 = "codex_cli"
TASK_AI_MODEL既定 = "auto"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
# 終了明細（最終検証）のタイムアウト。sub_do.py と同じ計算で、終了明細の 予測分数 から求める。
# 同期元: tasks_watcher.py の 明細タイムアウト倍率 / 明細最低タイムアウト分。
# 渡さないと aidiy_code_agents 側の既定値（30分）が使われ、監視側の打ち切りと食い違う。
CODEタイムアウト倍率 = 2
CODE最低タイムアウト分 = 10
CODE実行マージン秒 = 60
CODE実行HTTP余裕秒 = 300


def CODE実行タイムアウト秒(予測分数) -> int:
    """明細の予測分数（分）から code_agents へ渡すタイムアウト秒を求める（sub_do.py と同じ規則）。"""
    try:
        分 = int(str(予測分数).strip())
    except (TypeError, ValueError):
        分 = 0
    制限分 = max(CODE最低タイムアウト分, 分 * CODEタイムアウト倍率)
    return max(60, 制限分 * 60 - CODE実行マージン秒)


タスクID = ""
明細SEQ = 0
ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_end.log")


def _標準出力をUTF8化() -> None:
    """AI応答に含まれる — や絵文字で print が落ちないようにする。

    サブプロセスの標準出力は Windows では cp932 になるため、変換できない文字があると
    UnicodeEncodeError で処理全体が失敗してしまう。UTF-8（変換不可は置換）へ切り替える。
    """
    for ストリーム in (sys.stdout, sys.stderr):
        try:
            ストリーム.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_標準出力をUTF8化()


def 要求モデル(要求: dict, フェーズ: str) -> str:
    """AIタスク要求レコードから指定フェーズのモデルを取り出す。

    フェーズは plan（準備）/ do（各ステップ）/ check（終了時の最終確認）。
    レコード側に指定が無ければ `AiDiy_key.json` のフェーズ別規定値を使う。
    """
    値 = str(要求.get(f"TASK_AI_MODEL_{フェーズ}", "") or "").strip()
    return 値 or TASK_AIモデル(フェーズ)


def TASK_AIモデル(フェーズ: str) -> str:
    """`AiDiy_key.json` の `TASK_AI_MODEL_<フェーズ>` を返す。

    フェーズは plan / do / check。
    """
    path = os.path.normpath(os.path.join(BASE_DIR, DEFAULT_CONFIG_PATH))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        値 = data.get(f"TASK_AI_MODEL_{フェーズ}", TASK_AI_MODEL既定)
        return str(値 or TASK_AI_MODEL既定).strip() or TASK_AI_MODEL既定
    except Exception:
        return TASK_AI_MODEL既定


def ログ(メッセージ: str) -> None:
    print(メッセージ, flush=True)
    os.makedirs(os.path.dirname(ログパス), exist_ok=True)
    with open(ログパス, "a", encoding="utf-8") as f:
        f.write(メッセージ + "\n")


def POST送信(url: str, payload: dict, timeout: int = 3600) -> dict:
    return post_json(url, payload, timeout=timeout)


def タスク要求取得() -> dict:
    res = POST送信(f"{TASK_API}/タスク要求/取得", {
        "タスクID": タスクID,
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"AIタスク要求の取得に失敗しました: {res.get('message')}")
    return res.get("data", {}).get("item", {})


def 明細一覧取得() -> list[dict]:
    """AIタスク明細の全件（状態フィルタなし）を返す。DB上の操作検証フラグもここから取れる。"""
    res = POST送信(f"{TASK_API}/タスク明細/一覧", {
        "タスクID": タスクID,
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"タスク明細一覧の取得に失敗しました: {res.get('message')}")
    return res.get("data", {}).get("items", [])


def 明細1件取得(全明細: list[dict], 対象SEQ: int) -> dict:
    for 行 in 全明細:
        if int(行.get("明細SEQ", -1)) == 対象SEQ:
            return 行
    return {}


def 実行済ブロック生成(完了明細: list[dict]) -> str:
    """完了済み明細の応答内容を、実行済み記録のブロックへ組み立てる"""
    実行済: list[str] = []
    for 行 in sorted(完了明細, key=lambda 行: int(行["明細SEQ"])):
        seq = int(行["明細SEQ"])
        タイトル = str(行.get("タイトル", "")).strip()
        応答内容 = str(行.get("応答内容", "")).strip()
        見出し = f"ステップ{seq} {タイトル} " + ("処理目標" if seq == 0 else "実行済")
        実行済.append(f"``` {見出し}\n{応答内容}\n```")
    return "\n".join(実行済) if 実行済 else "（実行済ステップはまだありません）"


def 全ステップ生成(全明細: list[dict]) -> str:
    """全明細を、依存関係つきのステップ一覧テキストへ組み立てる"""
    return "\n".join(
        f"  {int(行['明細SEQ'])}. {str(行['タイトル']).strip()}（先行SEQ: {str(行['先行SEQ']).strip() or 'なし'}）"
        for 行 in 全明細
    )


def プロンプト生成(タスクタイトル: str, 全明細: list[dict], 対象: dict, 完了明細: list[dict]) -> str:
    """check フェーズ。定型部は _config/AiDiy_task__context.json から読む。

    外枠（common_instruction_lines）は do と共通。直前の do ステップと先頭が
    一致するため、最終検証でもプロンプトキャッシュが効く。
    """
    今回要求ブロック = 差し込み("check_request_lines", {
        "明細SEQ": 対象["明細SEQ"],
        "明細タイトル": 対象["タイトル"],
        "タスクID": タスクID,
    })
    今回要求ブロック += report_instruction()
    今回要求ブロック += (
        "\n【回数制約の優先】全体要求が照合・読取り等の回数を制限し、実行済み記録にその照合結果がある場合は、同じ成果物を再読込せず記録から判断してください。\n"
        "これは実作業の重複を避けるための優先条件です。必要な証拠が記録にない場合は一致を推測せず、不足を報告してください。\n"
    )
    return 差し込み("common_instruction_lines", {
        "タスクタイトル": タスクタイトル,
        "全ステップ": 全ステップ生成(全明細),
        "実行済ブロック": 実行済ブロック生成(完了明細),
        "今回要求ブロック": 今回要求ブロック,
    })


def 検証実行(
    タスクタイトル: str,
    全明細: list[dict],
    対象: dict,
    完了明細: list[dict],
    プロジェクト: str,
    要求: dict,
) -> str:
    """code_agents で各実行ステップと最終結果を検証させる（結論は AI が task_check_okng へ報告する）。

    失敗しても例外にはしない。呼び出し元は AI 応答後に明細の状態を見て成否を判定する。
    """
    try:
        task_ai_name = str(対象.get("TASK_AI_NAME", "") or TASK_AI_NAME既定).strip()
        # 終了時の最終確認は check フェーズ。AIタスク要求の TASK_AI_MODEL_check を使う
        task_ai_model = 要求モデル(要求, "check")
        実行秒 = CODE実行タイムアウト秒(対象.get("予測分数"))
        ログ(
            f"code_agents run 呼び出し (検証, ai={task_ai_name}, model={task_ai_model}, "
            f"予測={対象.get('予測分数') or '未見積り'}, timeout={実行秒}秒, project_path={プロジェクト})"
        )
        payload = {
            "prompt": プロンプト生成(タスクタイトル, 全明細, 対象, 完了明細),
            "ai_name": task_ai_name,
            "ai_model": task_ai_model,
            "timeout_sec": 実行秒,
        }
        if プロジェクト:
            payload["project_path"] = プロジェクト
        res = POST送信(MCP_URL, payload, timeout=実行秒 + CODE実行HTTP余裕秒)
        ログ(f"code_agents run 応答: {json.dumps(res, ensure_ascii=False)[:500]}")
        if res.get("error") or res.get("status") != "OK":
            raise RuntimeError(f"code_agents の実行に失敗しました: {res.get('error') or res.get('result')}")
        return str(res.get("result") or "").strip()
    except Exception as e:
        ログ(f"検証実行失敗: {e}")
        return f"[注意] 検証実行失敗: {e}"


def 失敗報告(メッセージ: str) -> None:
    if not タスクID or not 明細SEQ:
        return
    try:
        POST送信(f"{TASK_API}/タスク明細/失敗", {
            "タスクID": タスクID,
            "明細SEQ": 明細SEQ,
            "メッセージ": メッセージ[:500],
        }, timeout=60)
    except Exception as e:
        ログ(f"失敗報告もエラー: {e}")


def main() -> int:
    global タスクID, 明細SEQ, ログパス
    try:
        if len(sys.argv) < 3:
            raise ValueError("使い方: python sub_end.py <タスクID> <SEQ>")
        タスクID = str(sys.argv[1]).strip()
        明細SEQ = int(sys.argv[2])
        if not タスクID:
            raise ValueError("タスクIDが指定されていません")
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{タスクID}.step{明細SEQ}.log")

        ログ(f"=== 終了処理: {タスクID} SEQ={明細SEQ} ===")

        # 1. AIタスク要求 からタイトル・プロジェクトを取得
        要求 = タスク要求取得()
        タスクタイトル = str(要求.get("タイトル", "")).strip()
        プロジェクト = str(要求.get("プロジェクト", "")).strip()

        # 2. 全明細を取得（対象＝終了明細の特定、完了済み明細の応答内容、DB上の操作検証フラグ）
        全明細 = 明細一覧取得()
        対象 = 明細1件取得(全明細, 明細SEQ)
        if not 対象:
            raise ValueError(f"タスク明細に SEQ={明細SEQ} がありません")
        完了明細 = [行 for 行 in 全明細 if str(行.get("状態", "")).strip() == "完了"]
        操作検証 = bool(対象.get("操作検証", False))
        ログ(f"完了明細取得: {len(完了明細)} 件, 操作検証={操作検証}")

        if not 操作検証:
            # 4a. ファイル操作を伴う明細が無いため、AIを介さずそのまま終了完了にする
            res = POST送信(f"{TASK_API}/タスク明細/終了完了", {
                "タスクID": タスクID,
                "明細SEQ": 明細SEQ,
                "応答内容": "操作検証対象のファイル操作がないため、終了処理を完了しました。",
            }, timeout=60)
            if res.get("status") != "OK":
                raise RuntimeError(f"終了完了報告に失敗しました: {res.get('message')}")
            ログ("終了処理 完了（操作検証なし）")
            return 0

        # 4b. 操作検証あり: これまでの応答結果を全て渡し、AIに最終検証と
        #     task_check_okng による状態報告を依頼する（状態更新は AI 自身が行う）
        結論 = 検証実行(タスクタイトル, 全明細, 対象, 完了明細, プロジェクト, 要求)
        ログ(f"検証結果: {結論[:300]}")

        # 5. AIが task_check_okng で状態を更新したか確認する
        最終行 = 明細1件取得(明細一覧取得(), 明細SEQ)
        最終状態 = str(最終行.get("状態", "")).strip()

        # 6. 完了/エラーのいずれにも更新されていなければ、強制的にエラーで確定する
        if 最終状態 not in ("完了", "エラー"):
            ログ(f"AIによる状態報告がありませんでした（現状態={最終状態 or '不明'}）。強制的にエラーにします。")
            失敗報告("操作検証の結果がAIから報告されませんでした（task_check_okng 未呼び出し）。")
            return 1

        # 7. 応答内容は AI が task_check_okng のメッセージへ書く。省かれると結論が残らず、
        #    画面にも次周期の実行済み記録にも何も出ない。空なら検証結果で埋め直しておく。
        if 最終状態 == "完了" and not str(最終行.get("応答内容", "")).strip():
            res = POST送信(f"{TASK_API}/タスク明細/完了", {
                "タスクID": タスクID,
                "明細SEQ": 明細SEQ,
                "応答内容": 結論,
            }, timeout=60)
            if res.get("status") == "OK":
                ログ("応答内容が空だったため検証結果で補完しました")
            else:
                ログ(f"応答内容の補完に失敗しました: {res.get('message')}")

        ログ(f"終了処理 完了（操作検証あり、状態={最終状態}）")
        return 0 if 最終状態 == "完了" else 1

    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗報告(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
