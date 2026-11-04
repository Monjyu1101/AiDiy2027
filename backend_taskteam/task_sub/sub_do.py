# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""タスク明細の 1 ステップ実行サブプロセス。

起動監視ループが `python sub_do.py <タスクID> <SEQ>` で起動する。
ローカルの temp/input・temp/output JSON には依存せず、タスクID と SEQ だけで完結する。
標準ライブラリのみで動作する。

処理の流れ:
1. /task/タスク要求/取得 でタスク全体（タイトル・プロジェクト）を取得する
2. /task/タスク明細/一覧 で全明細を取得し、対象 SEQ のステップを特定する
   （完了済み明細の応答内容は実行済み記録として渡す。ステップ0 開始 の応答内容は処理目標）
3. aidiy_code_agents MCP へ、指定プロジェクトフォルダ・指定 AI で「このステップだけ実行」を依頼する
4. 正常時は /task/タスク明細/完了、エラー時は /task/タスク明細/失敗 を呼ぶ
   （操作検証ありの明細は、AI が /task_check_okng で報告した状態を確認する。
   　書き込みなし・エラーのいずれかの場合は、検証結果を踏まえて最大2回まで自動リトライする。
   　リトライのたびに予測分数が引き上げ書き換えされ、実行タイムアウトもその値で取り直す）
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
通知音URL = "http://127.0.0.1:8095/aidiy_notification_sounds/play"
TASK_AI_NAME既定 = "codex_cli"
TASK_AI_MODEL既定 = "auto"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
# 1ステップの実行タイムアウト。明細ごとに 予測分数 から求める。
# 同期元: tasks_watcher.py の 明細タイムアウト倍率 / 明細最低タイムアウト分。
# sub_*.py は tasks_db を直接 import しない疎結合方針のため、同じ値をここにも持つ。
# 明示的に渡さないと aidiy_code_agents 側の既定値（30分）で先に打ち切られる。
CODEタイムアウト倍率 = 2
CODE最低タイムアウト分 = 10
# 操作検証ありの明細で、失敗（タイムアウト・操作検証NG・未報告）したときに自動で入り直す回数。
# 初回 + この回数が 1 ステップの最大試行回数になる。
# 再試行のたびに予測分数がサーバー側で引き上げられるため、後の試行ほど長い時間で走る
# （書き換え規則は tasks_db.py の 再試行予測分数）。
再試行上限回数 = 2
# 監視側の打ち切り（毎分判定）より先に自分で諦めるための前倒し分。
# こちらが先に切れると、AI の失敗理由を応答内容へ残したうえで終われる。
CODE実行マージン秒 = 60
# HTTP 側は code_agents のタイムアウトが先に効くよう少し長く取る
# （HTTP が先に切れると、AI からの結果もエラー理由も受け取れないため）
CODE実行HTTP余裕秒 = 300


def CODE実行タイムアウト秒(予測分数) -> int:
    """明細の予測分数（分）から code_agents へ渡すタイムアウト秒を求める。

    予測分数 × 倍率（未見積り 0 を含め、最低分は必ず確保）。
    そこから監視側より先に諦めるためのマージンを引く。
    """
    try:
        分 = int(str(予測分数).strip())
    except (TypeError, ValueError):
        分 = 0
    制限分 = max(CODE最低タイムアウト分, 分 * CODEタイムアウト倍率)
    return max(60, 制限分 * 60 - CODE実行マージン秒)

タスクID = ""
明細SEQ = 0
ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_do.log")


def _標準出力をUTF8化() -> None:
    """AI応答に含まれる — や絵文字で print が落ちないようにする。

    サブプロセスの標準出力は Windows では cp932 になるため、変換できない文字があると
    UnicodeEncodeError でステップ全体が失敗してしまう。UTF-8（変換不可は置換）へ切り替える。
    """
    for ストリーム in (sys.stdout, sys.stderr):
        try:
            ストリーム.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_標準出力をUTF8化()


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
    """AIタスク明細の全件（状態フィルタなし）を返す。"""
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


def プロンプト生成(タスクタイトル: str, 全明細: list[dict], 対象: dict, 完了明細: list[dict], 前回失敗理由: str = "") -> str:
    """do フェーズ。定型部は _config/AiDiy_task__context.json から読む。

    外枠（common_instruction_lines）は check と共通で、役割や do 固有の指示は
    末尾の [今回要求] 側に入れる。こうするとステップが進んでも先頭が変わらず、
    最終検証（check）も同じ先頭を再利用できる。
    """
    操作検証ブロック = ""
    if 対象.get("操作検証"):
        操作検証ブロック = 差し込み("do_verify_lines", {
            "タスクID": タスクID,
            "明細SEQ": 対象["明細SEQ"],
        })
    if 対象.get("操作検証"):
        操作検証ブロック += (
            "\n【回数制約の優先】全体要求に読取り・照合・保存の回数上限が明記されている場合は、操作検証もその上限内で行ってください。\n"
            "後続に独立した照合ステップがある場合、この書込ステップでは書込APIの成功・書込バイト数などで実施を確認し、読み戻しは後続へ任せて重複しないでください。\n"
            "task_check_okngには、実際に確認した書込結果と、内容照合は後続で行うことを正確に報告してください。未照合なのに内容一致とは報告しないでください。\n"
        )
    再試行ブロック = ""
    if 前回失敗理由:
        再試行ブロック = 差し込み("do_retry_lines", {"前回失敗理由": 前回失敗理由})
    今回要求ブロック = 差し込み("do_request_lines", {
        "明細SEQ": 対象["明細SEQ"],
        "明細タイトル": 対象["タイトル"],
        "明細要求内容": 対象["要求内容"],
        "再試行ブロック": 再試行ブロック,
        "操作検証ブロック": 操作検証ブロック,
    })
    今回要求ブロック += report_instruction()
    return 差し込み("common_instruction_lines", {
        "タスクタイトル": タスクタイトル,
        "全ステップ": 全ステップ生成(全明細),
        "実行済ブロック": 実行済ブロック生成(完了明細),
        "今回要求ブロック": 今回要求ブロック,
    })


def 通知音種別取得(対象: dict) -> str:
    """通知音を鳴らすだけの軽量明細かを判定し、その種別を返す（該当なしは空文字）。

    判定はタイトルに「通知音」が入るかどうかだけで行う。
    tasks_watcher._軽量並行明細か と同じ条件にそろえてある。ここがずれると、
    片方だけ軽量扱いになって並行上限の数え方が合わなくなる。

    以前は「準備」「確認」「再生」を含むタイトルも通知音扱いにしていたが、
    「初期確認実行」「中間確認実行」「最終確認実行」「ブラウザ再生確認」「確認と処理」
    といった通常のステップまで一致してしまい、code agent を一度も呼ばずに
    「再生完了確認を完了しました」だけ返して完了になっていた。
    実処理が飛ぶうえ完了扱いなので気づけない。通知音に限定する。
    """
    タイトル = str(対象.get("タイトル", "")).upper()
    if "通知音" not in タイトル:
        return ""
    if "終了" in タイトル:
        return "終了"
    if "NG" in タイトル:
        return "注意"
    if "OK" in タイトル:
        return "完了"
    # 種別を書いていない通知音明細は完了音にする。ここで "" を返すと
    # code agent 実行に回るのに tasks_watcher 側は軽量扱いのままになり、
    # 明細並行上限の数え方が合わなくなる。
    return "完了"


def 通知音直接再生(通知種別: str) -> dict:
    return POST送信(通知音URL, {
        "notification_type": 通知種別,
        "scene": "auto",
    }, timeout=60)


def 完了報告(応答内容: str) -> None:
    res = POST送信(f"{TASK_API}/タスク明細/完了", {
        "タスクID": タスクID,
        "明細SEQ": 明細SEQ,
        "応答内容": 応答内容,
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"完了報告に失敗しました: {res.get('message')}")


def 再試行登録():
    """自動リカバリーの再試行前に、明細とタスク要求の状態を実行中へ戻す。

    サーバー側で予測分数が再試行用に引き上げられる（tasks_db.再試行予測分数）。
    書き換え後の予測分数を返すので、呼び出し側は次の実行タイムアウトを取り直す。
    """
    res = POST送信(f"{TASK_API}/タスク明細/再試行", {
        "タスクID": タスクID,
        "明細SEQ": 明細SEQ,
        # task_check_okng の NG 報告は DB の PID を空にする。再試行を続ける
        # このプロセス自身を再登録し、監視・並行上限・強制停止の対象から外れないようにする。
        "PID": os.getpid(),
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"明細の再試行登録に失敗しました: {res.get('message')}")
    return (res.get("data") or {}).get("予測分数")


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
            raise ValueError("使い方: python sub_do.py <タスクID> <SEQ>")
        タスクID = str(sys.argv[1]).strip()
        明細SEQ = int(sys.argv[2])
        if not タスクID:
            raise ValueError("タスクIDが指定されていません")
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{タスクID}.step{明細SEQ}.log")
        ログ(f"=== ステップ実行 開始: {タスクID} SEQ={明細SEQ} ===")

        # 1. AIタスク要求 からタイトル・プロジェクトを取得
        要求 = タスク要求取得()
        タスクタイトル = str(要求.get("タイトル", "")).strip()
        プロジェクト = str(要求.get("プロジェクト", "")).strip()

        # 2. 全明細を取得し、対象ステップを特定する
        全明細 = 明細一覧取得()
        対象 = 明細1件取得(全明細, 明細SEQ)
        if not 対象:
            raise ValueError(f"タスク明細に SEQ={明細SEQ} がありません")

        # 3. 定型通知音は AI を経由せず直接再生する
        通知種別 = 通知音種別取得(対象)
        if 通知種別:
            ログ(f"通知音直接再生: type={通知種別}")
            res = 通知音直接再生(通知種別)
            if res.get("error"):
                raise RuntimeError(f"通知音再生に失敗しました: {res.get('error')}")
            応答内容 = json.dumps(res, ensure_ascii=False)
            完了報告(応答内容)
            ログ("ステップ完了")
            return 0

        # 4. 完了済み明細の応答内容を取得（ステップ0 の処理目標と実行済ステップの記録）
        完了明細 = [行 for 行 in 全明細 if str(行.get("状態", "")).strip() == "完了"]
        ログ(f"完了明細取得: {len(完了明細)} 件")

        # 5. code_agents へステップ実行を依頼（指定プロジェクトフォルダ・指定 AI）
        # 6. 操作検証ありの明細は、AI が task_check_okng で報告した状態を確認する。
        #    書き込みなし・エラーのいずれかの場合は、検証結果を踏まえて 再試行上限回数 まで自動リトライする
        task_ai_name = 対象.get("TASK_AI_NAME") or TASK_AI_NAME既定
        # 明細実行は do フェーズ。明細に指定が無いときだけ共通設定の TASK_AI_MODEL_do を使う
        task_ai_model = 対象.get("TASK_AI_MODEL_do") or TASK_AIモデル("do")
        最大試行回数 = (1 + 再試行上限回数) if 対象.get("操作検証") else 1
        前回失敗理由 = ""
        予測分数 = 対象.get("予測分数")
        for 試行 in range(1, 最大試行回数 + 1):
            # 予測分数は再試行のたびにサーバー側で引き上げられる。実行秒は毎回取り直す
            実行秒 = CODE実行タイムアウト秒(予測分数)
            ログ(
                f"code_agents run 呼び出し (試行{試行}/{最大試行回数}, タイトル={対象['タイトル']}, "
                f"ai={task_ai_name}, model={task_ai_model}, 予測={予測分数 or '未見積り'}, "
                f"timeout={実行秒}秒, project_path={プロジェクト})"
            )
            payload = {
                "prompt": プロンプト生成(タスクタイトル, 全明細, 対象, 完了明細, 前回失敗理由),
                "ai_name": task_ai_name,
                "ai_model": task_ai_model,
                "timeout_sec": 実行秒,
            }
            if プロジェクト:
                payload["project_path"] = プロジェクト
            res = POST送信(MCP_URL, payload, timeout=実行秒 + CODE実行HTTP余裕秒)
            ログ(f"code_agents run 応答: {json.dumps(res, ensure_ascii=False)[:500]}")

            失敗理由 = ""
            if res.get("error") or res.get("status") != "OK":
                失敗理由 = f"code_agents の実行に失敗しました: {res.get('error') or res.get('result')}"
            elif not 対象.get("操作検証"):
                # 操作検証なし: そのまま完了報告
                応答内容 = str(res.get("result") or json.dumps(res, ensure_ascii=False))
                完了報告(応答内容)
                ログ("ステップ完了")
                return 0
            else:
                # 操作検証あり: AI が task_check_okng で報告した状態を確認する
                最終行 = 明細1件取得(明細一覧取得(), 明細SEQ)
                最終状態 = str(最終行.get("状態", "")).strip()
                if 最終状態 == "完了":
                    # 応答内容は AI が task_check_okng のメッセージへ書く。省かれると空のまま
                    # 完了になり、後続ステップと最終検証（sub_end.py）へ「実行済み記録なし」として
                    # 渡ってエラー判定の原因になる。空なら実行結果で埋め直しておく。
                    if not str(最終行.get("応答内容", "")).strip():
                        完了報告(str(res.get("result") or json.dumps(res, ensure_ascii=False)))
                        ログ("応答内容が空だったため実行結果で補完しました")
                    ログ("ステップ完了（操作検証OK）")
                    return 0
                elif 最終状態 == "エラー":
                    失敗理由 = str(最終行.get("応答内容", "")).strip() or "操作検証でNGと判定されました。"
                else:
                    失敗理由 = f"操作検証の結果がAIから報告されませんでした（task_check_okng 未呼び出し、現状態={最終状態 or '不明'}）。"

            if 試行 >= 最大試行回数:
                raise RuntimeError(失敗理由)
            ログ(f"試行{試行}回目 失敗: {失敗理由}")
            ログ("自動リカバリー: 検証結果を踏まえてステップを再試行します")
            前回失敗理由 = 失敗理由
            新予測分数 = 再試行登録()
            if 新予測分数:
                ログ(f"再試行の予測分数: {予測分数 or '未見積り'} -> {新予測分数}分")
                予測分数 = 新予測分数

    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗報告(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
