# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム経験を生成するサブプロセス。

team_watcher.py（1分ごとの処理）が temp/team/exp/<経験ID>.json に入力値を書き、
このスクリプトを `python sub_exp.py <入力JSONパス>` で起動する。
task_sub/sub_init.py と同じ 2 段構えで動く。

処理の流れ:
1. 入力 JSON（経験ID / 依頼ID / タスクID / 要員ID / プロジェクト / 要求内容）を読み込む
2. backend_taskteam の Task API から AIタスク明細の一覧を取得する
3. 第1ステップ: 対象プロジェクトのフォルダで AI が明細内容を読み、経験値をまとめて
   応答本文へ返す（ファイル書き込みなし）
4. 第2ステップ: AiDiy ルート（"../"）で AI がその結果を既定形式の JSON として
   temp/team/exp/output/<経験ID>.json へ書き込む
5. 出力 JSON を検証し、backend_taskteam へ本登録する（失敗時は経験をエラーにする）
"""

from __future__ import annotations

import json
import os
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json
import traceback

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AIDIYルート = os.path.normpath(os.path.join(BASE_DIR, ".."))

# 定型コンテキストの読込だけ team_proc を使う（DB には触らない）
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
from team_proc import team_context  # noqa: E402
TEAM_API = "http://127.0.0.1:8093/team"
TASK_API = "http://127.0.0.1:8093/task"
MCP_URL = "http://127.0.0.1:8095/aidiy_code_agents/run"
TEAM_AI_NAME既定 = "claude_cli"
TEAM_AI_MODEL既定 = "auto"
TASK_AI_NAME既定 = "claude_cli"
TASK_AI_MODEL既定 = "auto"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
JSON保存最大試行回数 = 2
明細最大件数 = 40

経験ID = ""
ログパス = os.path.join(BASE_DIR, "temp", "team", "exp", "sub_exp.log")


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


def 入力モデル(入力: dict, 接頭辞: str, フェーズ: str, 既定: str = "auto") -> str:
    """入力 JSON（Aチーム依頼レコードの値）から指定フェーズのモデルを取り出す。

    依頼側が `auto`（モデル指定なし）なら共通設定のフェーズ別値へ落とす。
    """
    値 = str(入力.get(f"{接頭辞}_AI_MODEL_{フェーズ}", "") or "").strip()
    return 値 if 値 and 値 != "auto" else AIモデル(接頭辞, フェーズ, 既定)


def AIモデル(接頭辞: str, フェーズ: str, 既定: str = "auto") -> str:
    """`AiDiy_key.json` の `<接頭辞>_AI_MODEL_<フェーズ>` を返す。

    接頭辞は TASK / TEAM、フェーズは plan / do / check。
    """
    path = os.path.normpath(os.path.join(BASE_DIR, DEFAULT_CONFIG_PATH))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        値 = data.get(f"{接頭辞}_AI_MODEL_{フェーズ}", 既定)
        return str(値 or 既定).strip() or 既定
    except Exception:
        return 既定


def ログ(メッセージ: str) -> None:
    print(メッセージ, flush=True)
    os.makedirs(os.path.dirname(ログパス), exist_ok=True)
    with open(ログパス, "a", encoding="utf-8") as f:
        f.write(メッセージ + "\n")


def POST送信(url: str, payload: dict, timeout: int = 3600) -> dict:
    return post_json(url, payload, timeout=timeout)


def タスク明細を取得(タスクID: str) -> list[dict]:
    """backend_taskteam の Task API からAIタスク明細の一覧を取得する。"""
    res = POST送信(f"{TASK_API}/タスク明細/一覧", {"タスクID": タスクID}, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"AIタスク明細の取得に失敗しました: {res.get('message')}")
    items = res.get("data", {}).get("items", [])
    if not isinstance(items, list) or not items:
        raise RuntimeError(f"AIタスク明細が0件です: タスクID={タスクID}")
    return items


def 明細テキスト(明細: list[dict]) -> str:
    """AI へ渡す明細の要約テキストを作る（開始・終了行は除く）。"""
    行: list[str] = []
    for 項目 in 明細:
        seq = int(項目.get("明細SEQ", 0) or 0)
        if seq in (0, 9999):
            continue
        タイトル = str(項目.get("タイトル", "")).strip()
        要求内容 = str(項目.get("要求内容", "")).strip()
        状態 = str(項目.get("状態", "")).strip()
        応答内容 = str(項目.get("応答内容", "")).strip()
        行.append(
            f"- 明細SEQ {seq} / 状態 {状態} / タイトル: {タイトル}\n"
            f"  要求内容: {要求内容}\n"
            f"  実行結果: {応答内容[:600] or '（記録なし）'}"
        )
        if len(行) >= 明細最大件数:
            break
    return "\n".join(行)


def JSON形式サンプル(経験ID: str, 依頼ID: str) -> str:
    return f"""{{
  "経験ID": "{経験ID}",
  "依頼ID": "{依頼ID}",
  "タイトル": "この経験を一言で表すタイトル（40文字以内）",
  "経験値": 35,
  "分類": "実装",
  "まとめ内容": "何をどう進めて、どこまで到達したかの具体的なまとめ",
  "学び": "次の依頼に活かせる判断基準や注意点"
}}"""


def プロンプト生成_経験まとめ(
    経験ID: str, 依頼ID: str, 要員ID: str, プロジェクト: str, 要求内容: str, 明細本文: str
) -> str:
    """定型部は _config/AiDiy_team__exp_context.json から読む。"""
    return team_context.差し込み("exp", "summary_instruction_lines", {
        "要員ID": 要員ID,
        "プロジェクト or '（未指定）'": プロジェクト or "（未指定）",
        "要求内容": 要求内容,
        "明細本文": 明細本文,
        "JSON形式サンプル": JSON形式サンプル(経験ID, 依頼ID),
    })


def プロンプト生成_JSON保存(まとめ結果: str, 出力JSONパス: str, 経験ID: str, 依頼ID: str) -> str:
    """定型部は _config/AiDiy_team__exp_context.json から読む。"""
    return team_context.差し込み("exp", "save_instruction_lines", {
        "出力JSONパス": 出力JSONパス,
        "JSON形式サンプル": JSON形式サンプル(経験ID, 依頼ID),
        "まとめ結果": まとめ結果,
    })


def JSON検証(データ: dict, 依頼ID: str) -> dict:
    """出力 JSON を検証して本登録用の dict に整える。不正なら ValueError。"""
    if not isinstance(データ, dict):
        raise ValueError("JSON のルートがオブジェクトではありません")
    for キー in ("経験ID", "依頼ID", "タイトル", "経験値", "分類", "まとめ内容", "学び"):
        if キー not in データ:
            raise ValueError(f"キー '{キー}' がありません")
    if str(データ["経験ID"]).strip() != 経験ID:
        raise ValueError("経験IDが入力 JSON と一致していません")
    if str(データ["依頼ID"]).strip() != 依頼ID:
        raise ValueError("依頼IDが入力 JSON と一致していません")
    タイトル = str(データ["タイトル"]).strip()
    まとめ内容 = str(データ["まとめ内容"]).strip()
    if not タイトル:
        raise ValueError("タイトルが空です")
    if not まとめ内容:
        raise ValueError("まとめ内容が空です")
    try:
        経験値 = int(str(データ["経験値"]).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"経験値が整数ではありません: {データ['経験値']!r}") from exc
    if not 1 <= 経験値 <= 100:
        raise ValueError(f"経験値が 1〜100 の範囲外です: {経験値}")
    return {
        "タイトル": タイトル[:120],
        "経験値": 経験値,
        "分類": str(データ["分類"]).strip()[:40],
        "まとめ内容": まとめ内容,
        "学び": str(データ["学び"]).strip(),
    }


def JSON保存と検証(
    まとめ結果: str,
    出力JSONパス: str,
    依頼ID: str,
    team_ai_name: str,
    team_ai_model: str,
) -> dict:
    """第2ステップ（JSON保存）と第3ステップ（検証）を実行する。失敗時は例外を送出する。"""
    if os.path.exists(出力JSONパス):
        os.remove(出力JSONパス)

    ログ(
        f"第2ステップ: JSON保存 (ai={team_ai_name}, model={team_ai_model}, "
        f"project_path={AIDIYルート})"
    )
    res = POST送信(MCP_URL, {
        "prompt": プロンプト生成_JSON保存(まとめ結果, 出力JSONパス, 経験ID, 依頼ID),
        "ai_name": team_ai_name,
        "ai_model": team_ai_model,
        "project_path": AIDIYルート,
    })
    ログ(f"第2ステップ応答: {json.dumps(res, ensure_ascii=False)[:300]}")
    if res.get("error") or res.get("status") != "OK":
        raise RuntimeError(f"第2ステップ（JSON保存）に失敗しました: {res.get('error') or res.get('result')}")

    if not os.path.isfile(出力JSONパス):
        raise RuntimeError(f"出力 JSON が生成されませんでした: {出力JSONパス}")
    with open(出力JSONパス, "r", encoding="utf-8-sig") as f:
        データ = json.load(f)
    整形 = JSON検証(データ, 依頼ID)
    ログ(f"JSON 検証 OK: 経験値 {整形['経験値']} / {整形['タイトル']}")
    return 整形


def 本登録(整形: dict) -> None:
    res = POST送信(f"{TEAM_API}/経験/本登録", {"経験ID": 経験ID, **整形}, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"本登録に失敗しました: {res.get('message')}")


def 失敗登録(メッセージ: str) -> None:
    if not 経験ID:
        return
    try:
        POST送信(
            f"{TEAM_API}/経験/失敗",
            {"経験ID": 経験ID, "メッセージ": メッセージ[:500]},
            timeout=60,
        )
    except Exception as e:
        ログ(f"失敗登録もエラー: {e}")


def main() -> int:
    global 経験ID, ログパス
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_exp.py <temp/team/exp/経験ID.json>")
        入力パス = os.path.abspath(sys.argv[1])
        with open(入力パス, "r", encoding="utf-8-sig") as f:
            入力 = json.load(f)
        経験ID = str(入力.get("経験ID", "")).strip()
        依頼ID = str(入力.get("依頼ID", "")).strip()
        タスクID = str(入力.get("タスクID", "")).strip()
        要員ID = str(入力.get("要員ID", "")).strip()
        プロジェクト = str(入力.get("プロジェクト", "")).strip()
        要求内容 = str(入力.get("要求内容", "")).strip()
        team_ai_name = str(
            入力.get("TEAM_AI_NAME", TEAM_AI_NAME既定) or TEAM_AI_NAME既定
        ).strip()
        task_ai_name = str(
            入力.get("TASK_AI_NAME", TASK_AI_NAME既定) or TASK_AI_NAME既定
        ).strip()
        # 経験まとめは計画（plan）扱い。依頼レコードの plan 用モデルを使う
        team_ai_model = 入力モデル(入力, "TEAM", "plan", TEAM_AI_MODEL既定)
        task_ai_model = 入力モデル(入力, "TASK", "plan", TASK_AI_MODEL既定)
        if not 経験ID or not 依頼ID or not タスクID:
            raise ValueError("入力 JSON に 経験ID、依頼ID または タスクID がありません")

        ファイルステム = os.path.splitext(os.path.basename(入力パス))[0]
        ログパス = os.path.join(BASE_DIR, "temp", "team", "exp", f"{ファイルステム}.log")
        ログ(f"=== AIチーム経験 生成開始: {経験ID} (依頼={依頼ID} / タスク={タスクID}) ===")

        出力DIR = os.path.join(BASE_DIR, "temp", "team", "exp", "output")
        os.makedirs(出力DIR, exist_ok=True)
        出力JSONパス = os.path.join(出力DIR, f"{ファイルステム}.json").replace("\\", "/")
        if os.path.exists(出力JSONパス):
            os.remove(出力JSONパス)

        # 1. AIタスク明細を取得
        明細 = タスク明細を取得(タスクID)
        明細本文 = 明細テキスト(明細)
        if not 明細本文:
            raise RuntimeError("経験化できる明細（開始・終了以外）がありません")
        ログ(f"明細取得: {len(明細)} 件")

        # 2. 第1ステップ: 対象プロジェクトで経験値をまとめる（ファイル書き込みなし）
        ログ(
            f"第1ステップ: 経験まとめ (ai={task_ai_name}, model={task_ai_model}, "
            f"project_path={プロジェクト or '既定'})"
        )
        payload = {
            "prompt": プロンプト生成_経験まとめ(経験ID, 依頼ID, 要員ID, プロジェクト, 要求内容, 明細本文),
            "ai_name": task_ai_name,
            "ai_model": task_ai_model,
        }
        if プロジェクト:
            payload["project_path"] = プロジェクト
        res = POST送信(MCP_URL, payload)
        ログ(f"第1ステップ応答: {json.dumps(res, ensure_ascii=False)[:300]}")
        if res.get("error") or res.get("status") != "OK":
            raise RuntimeError(f"第1ステップ（経験まとめ）に失敗しました: {res.get('error') or res.get('result')}")
        まとめ結果 = str(res.get("result") or "").strip()
        if not まとめ結果 or まとめ結果 == "（応答なし）":
            raise RuntimeError("第1ステップ（経験まとめ）の応答が空です")

        # 3. 第2ステップ（JSON保存）と第3ステップ（検証）。AI 応答の揺れで失敗することがあるため1回リトライする
        for 試行 in range(1, JSON保存最大試行回数 + 1):
            try:
                整形 = JSON保存と検証(
                    まとめ結果,
                    出力JSONパス,
                    依頼ID,
                    team_ai_name,
                    team_ai_model,
                )
                break
            except Exception as e:
                ログ(f"第2/第3ステップ 試行{試行}回目 失敗: {e}")
                if 試行 >= JSON保存最大試行回数:
                    raise
                ログ("自動リカバリー: 第2ステップ（JSON保存）を再試行します")

        # 4. backend_taskteam へ本登録
        本登録(整形)
        ログ("本登録 完了")
        return 0

    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗登録(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
