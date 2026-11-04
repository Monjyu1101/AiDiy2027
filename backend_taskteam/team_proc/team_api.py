# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""backend_taskteam の AIチーム業務 API ルーター（エージェント、要員、依頼）。"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from log_config import get_logger

from . import (
    persona_catalog,
    team_chat,
    team_db,
    team_exp_db,
    team_goal_db,
    team_pdca_db,
    team_status_db,
    team_talk_db,
    team_task_control,
    team_work_db,
)
from .config import AIモデル, 設定読込
from .store import ストア

logger = get_logger("team_api")

router = APIRouter(prefix="/team")


def ok(message: str, data=None) -> dict:
    return {"status": "OK", "message": message, "data": data if data is not None else {}}


def ng(message: str) -> dict:
    return {"status": "NG", "message": message, "data": {}}


class 召喚要求(BaseModel):
    要員ID: str = ""
    エージェント名: str = ""
    役割: str = ""


class 状態変更要求(BaseModel):
    エージェントID: str
    状態: str
    作業内容: str = ""
    ひとこと: str = ""


class 排除要求(BaseModel):
    要員ID: str


class エージェント会話要求(BaseModel):
    # 会話は Aタスクを作らず1回だけ調査する用途なので、使うモデルは plan 用の1つ
    要員ID: str = Field(min_length=1, max_length=persona_catalog.要員ID最大長)
    プロジェクト: str = Field(min_length=1, max_length=1000)
    TASK_AI_NAME: str = Field(min_length=1, max_length=100)
    TASK_AI_MODEL_plan: str = Field(min_length=1, max_length=200)
    要求内容: str = Field(min_length=1, max_length=10000)


class 活動一覧要求(BaseModel):
    limit: int = Field(default=20, ge=1, le=50)


class シミュレーション切替要求(BaseModel):
    有効: bool


class 操作情報(BaseModel):
    操作利用者ID: str = "admin"
    操作利用者名: str = "admin"
    操作端末ID: str = "frontend_web"

    def 操作者(self) -> dict[str, str]:
        return {
            "利用者ID": self.操作利用者ID.strip() or "admin",
            "利用者名": self.操作利用者名.strip() or "admin",
            "端末ID": self.操作端末ID.strip() or "frontend_web",
        }


class 要員一覧要求(BaseModel):
    無効も表示: bool = False


class 要員取得要求(BaseModel):
    要員ID: str


class 要員保存要求(操作情報):
    要員ID: str
    要員名: str
    役割: str = ""
    人格情報: str = ""
    有効: bool = True


class 要員削除要求(操作情報):
    要員ID: str


class チーム依頼一覧要求(BaseModel):
    要員ID: str = "admin"


class チーム依頼取得要求(チーム依頼一覧要求):
    依頼ID: str


class チーム依頼保存要求(操作情報):
    """チーム依頼の登録 / 変更。

    プロジェクト / TEAM_AI_* / TASK_AI_* は None（未指定）可。
    登録（新規）のときは AIチーム_依頼編集ダイアログの新規時と同じ条件で補完する
    （要員IDの更新最終レコードの値 → 無ければ規定値）。
    空文字は「その値を明示指定した」扱いで、プロジェクトは空欄のまま登録する。
    """
    要員ID: str = ""
    依頼ID: str = ""
    プロジェクト: str | None = None
    要求内容: str
    TEAM_AI_NAME: str | None = None
    TASK_AI_NAME: str | None = None
    # モデルは3種ずつ
    TEAM_AI_MODEL_plan: str | None = None
    TEAM_AI_MODEL_do: str | None = None
    TEAM_AI_MODEL_check: str | None = None
    TASK_AI_MODEL_plan: str | None = None
    TASK_AI_MODEL_do: str | None = None
    TASK_AI_MODEL_check: str | None = None
    実行有効: bool = True
    状態: str = "準備開始"


class チーム経験一覧要求(BaseModel):
    """掲示板に出ているプロジェクト（CODE_BASE_PATH）で絞って一覧する。"""
    プロジェクト: str = ""
    要員ID: str = ""
    件数: int = Field(default=team_exp_db.一覧最大件数, ge=1, le=1000)


class チーム経験取得要求(BaseModel):
    経験ID: str


class チーム経験本登録要求(BaseModel):
    """sub_exp.py が AI 出力の検証後に呼ぶ。"""
    経験ID: str
    タイトル: str
    経験値: int = Field(default=0, ge=0, le=100)
    分類: str = ""
    まとめ内容: str = ""
    学び: str = ""


class チーム経験失敗要求(BaseModel):
    経験ID: str
    メッセージ: str = ""


class チーム作業一覧要求(BaseModel):
    """掲示板に出ているプロジェクト（CODE_BASE_PATH）で絞って一覧する。"""
    プロジェクト: str = ""
    件数: int = Field(default=team_pdca_db.一覧最大件数, ge=1, le=1000)


class チーム会話一覧要求(BaseModel):
    """掲示板に出ているプロジェクト（CODE_BASE_PATH）で絞って一覧する。"""
    プロジェクト: str = ""
    件数: int = Field(default=team_talk_db.一覧最大件数, ge=1, le=1000)


class チーム目標取得要求(BaseModel):
    CODE_BASE_PATH: str


class チーム目標保存要求(操作情報):
    CODE_BASE_PATH: str
    チーム目標: str = ""
    自動作業設定: bool = False
    チーム作業: str = ""
    作業ループ: bool = False
    作業ループ回数: int = Field(default=team_goal_db.既定作業ループ回数, ge=1, le=99)
    動員要員数: int = Field(
        default=team_goal_db.既定動員要員数, ge=1, le=team_goal_db.動員要員数上限
    )
    パターン: Literal["SPDCA", "PlanDo"] = team_goal_db.既定パターン
    # 作業ループの各段で使うAI。選択肢は環境依存のため文字列のまま受け、空なら既定値にする。
    # モデルは plan（相談・計画）/ do（実施）/ check（評価・改善）の3種
    TEAM_AI_NAME: str = team_goal_db.既定TEAM_AI_NAME
    TASK_AI_NAME: str = team_goal_db.既定TASK_AI_NAME
    TEAM_AI_MODEL_plan: str | None = None
    TEAM_AI_MODEL_do: str | None = None
    TEAM_AI_MODEL_check: str | None = None
    TASK_AI_MODEL_plan: str | None = None
    TASK_AI_MODEL_do: str | None = None
    TASK_AI_MODEL_check: str | None = None


class チーム目標削除要求(操作情報):
    CODE_BASE_PATH: str


@router.post("/状態/取得", tags=["AIチーム"])
async def 状態取得() -> dict:
    try:
        return ok("チーム状態を取得しました", ストア.スナップショット())
    except Exception as e:
        logger.error(f"チーム状態の取得に失敗: {e}")
        return ng(f"チーム状態の取得に失敗しました: {e}")


@router.post("/設定/取得", tags=["AIチーム"])
async def チーム設定取得() -> dict:
    try:
        config = 設定読込()
        return ok("チーム設定を取得しました", {
            "CODE_BASE_PATH": str(config.CODE_BASE_PATH),
            "TEAM_AI_NAME": str(config.TEAM_AI_NAME),
            "TEAM_AI_MODEL_plan": AIモデル("TEAM", "plan"),
            "TEAM_AI_MODEL_do": AIモデル("TEAM", "do"),
            "TEAM_AI_MODEL_check": AIモデル("TEAM", "check"),
            "TASK_AI_NAME": str(config.TASK_AI_NAME),
            "TASK_AI_MODEL_plan": AIモデル("TASK", "plan"),
            "TASK_AI_MODEL_do": AIモデル("TASK", "do"),
            "TASK_AI_MODEL_check": AIモデル("TASK", "check"),
        })
    except Exception as e:
        logger.error(f"チーム設定の取得に失敗: {e}")
        return ng(f"チーム設定の取得に失敗しました: {e}")


@router.post("/エージェント/一覧", tags=["AIチーム"])
async def エージェント一覧() -> dict:
    try:
        items = ストア.エージェント一覧()
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"エージェント一覧の取得に失敗: {e}")
        return ng(f"エージェント一覧の取得に失敗しました: {e}")


@router.post("/エージェント/召喚", tags=["AIチーム"])
async def エージェント召喚(request: 召喚要求) -> dict:
    try:
        要員ID = request.要員ID.strip() or request.エージェント名.strip()
        item = ストア.召喚(要員ID, request.役割)
        return ok("エージェントを召喚しました", item)
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"エージェントの召喚に失敗: {e}")
        return ng(f"エージェントの召喚に失敗しました: {e}")


@router.post("/エージェント/状態変更", tags=["AIチーム"])
async def エージェント状態変更(request: 状態変更要求) -> dict:
    try:
        item = ストア.状態変更(
            request.エージェントID,
            request.状態,
            request.作業内容,
            request.ひとこと,
        )
        return ok("エージェント状態を変更しました", item)
    except KeyError:
        return ng("対象エージェントが見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"エージェント状態の変更に失敗: {e}")
        return ng(f"エージェント状態の変更に失敗しました: {e}")


@router.post("/エージェント/排除", tags=["AIチーム"])
async def エージェント排除(request: 排除要求) -> dict:
    try:
        item = ストア.排除(request.要員ID)
        return ok("エージェントを排除しました", item)
    except KeyError:
        return ng("対象エージェントが見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"エージェントの排除に失敗: {e}")
        return ng(f"エージェントの排除に失敗しました: {e}")


@router.post("/エージェント/会話", tags=["AIチーム"])
async def エージェント会話(request: エージェント会話要求) -> dict:
    """要員のpersonaを設定し、aidiy_code_agentsへ単発会話を同期依頼する。

    調査モードで依頼するため、AIは対象プロジェクトの入口ドキュメントとソースを実際に読んでから
    回答する。応答まで最大5分程度かかるので、画面側の待機上限も6分に合わせてある。
    """
    try:
        要員ID = request.要員ID.strip()
        プロジェクト = request.プロジェクト.strip()
        task_ai_name = request.TASK_AI_NAME.strip()
        task_ai_model = request.TASK_AI_MODEL_plan.strip()
        要求内容 = request.要求内容.strip()
        if not all((要員ID, プロジェクト, task_ai_name, task_ai_model, 要求内容)):
            return ng("要員ID、プロジェクト、TASK_AI_NAME、TASK_AI_MODEL_plan、要求内容を指定してください")
        item = await asyncio.to_thread(
            team_chat.会話実行,
            要員ID,
            プロジェクト,
            task_ai_name,
            task_ai_model,
            要求内容,
            調査モード=True,
        )
        return ok("エージェントから応答がありました", item)
    except ValueError as exc:
        return ng(str(exc))
    except TimeoutError as exc:
        logger.warning(f"エージェント会話がタイムアウトしました: {exc}")
        return ng(str(exc))
    except Exception as e:
        logger.error(f"エージェント会話に失敗: {e}")
        return ng(f"エージェント会話に失敗しました: {e}")


@router.post("/活動/一覧", tags=["AIチーム"])
async def 活動一覧(request: 活動一覧要求) -> dict:
    try:
        items = ストア.活動一覧(request.limit)
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"活動一覧の取得に失敗: {e}")
        return ng(f"活動一覧の取得に失敗しました: {e}")


@router.post("/シミュレーション/切替", tags=["AIチーム"])
async def シミュレーション切替(request: シミュレーション切替要求) -> dict:
    try:
        有効 = ストア.シミュレーション切替(request.有効)
        return ok("シミュレーション状態を変更しました", {"有効": 有効})
    except Exception as e:
        logger.error(f"シミュレーション状態の変更に失敗: {e}")
        return ng(f"シミュレーション状態の変更に失敗しました: {e}")


@router.post("/召喚要員/一覧", tags=["AIチーム"])
async def 召喚要員一覧() -> dict:
    try:
        items = persona_catalog.召喚要員一覧()
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"召喚要員一覧の取得に失敗: {e}")
        return ng(f"召喚要員一覧の取得に失敗しました: {e}")


@router.post("/要員/一覧", tags=["チーム要員"])
async def 要員一覧(request: 要員一覧要求) -> dict:
    try:
        items = team_db.要員一覧(無効も表示=request.無効も表示)
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"要員一覧の取得に失敗: {e}")
        return ng(f"要員一覧の取得に失敗しました: {e}")


@router.post("/要員/取得", tags=["チーム要員"])
async def 要員取得(request: 要員取得要求) -> dict:
    try:
        item = team_db.要員取得(request.要員ID.strip())
        return ok("要員を取得しました", item) if item else ng("対象要員が見つかりません")
    except Exception as e:
        logger.error(f"要員の取得に失敗: {e}")
        return ng(f"要員の取得に失敗しました: {e}")


def _要員データ(request: 要員保存要求) -> dict:
    要員ID = request.要員ID.strip()
    要員名 = request.要員名.strip()
    if not 要員ID:
        raise ValueError("要員IDを指定してください")
    if not 要員名:
        raise ValueError("要員名を指定してください")
    return {
        "要員ID": 要員ID,
        "要員名": 要員名,
        "役割": request.役割.strip(),
        "人格情報": request.人格情報.strip(),
        "有効": request.有効,
    }


@router.post("/要員/登録", tags=["チーム要員"])
async def 要員登録(request: 要員保存要求) -> dict:
    try:
        item = team_db.要員登録(_要員データ(request), request.操作者())
        ストア.要員再読込()
        return ok("要員を登録しました", item)
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"要員の登録に失敗: {e}")
        return ng(f"要員の登録に失敗しました: {e}")


@router.post("/要員/変更", tags=["チーム要員"])
async def 要員変更(request: 要員保存要求) -> dict:
    try:
        item = team_db.要員変更(_要員データ(request), request.操作者())
        ストア.要員再読込()
        return ok("要員を変更しました", item)
    except KeyError:
        return ng("対象要員が見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"要員の変更に失敗: {e}")
        return ng(f"要員の変更に失敗しました: {e}")


@router.post("/要員/削除", tags=["チーム要員"])
async def 要員削除(request: 要員削除要求) -> dict:
    try:
        team_db.要員削除(request.要員ID.strip())
        ストア.要員再読込()
        return ok("要員を削除しました")
    except KeyError:
        return ng("対象要員が見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"要員の削除に失敗: {e}")
        return ng(f"要員の削除に失敗しました: {e}")


@router.post("/依頼/一覧", tags=["チーム依頼"])
async def チーム依頼一覧(request: チーム依頼一覧要求) -> dict:
    try:
        要員ID = request.要員ID.strip()
        if not 要員ID:
            return ng("要員IDを指定してください")
        items = team_work_db.依頼一覧(要員ID)
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"チーム依頼一覧の取得に失敗: {e}")
        return ng(f"チーム依頼一覧の取得に失敗しました: {e}")


@router.post("/依頼/最大更新日時", tags=["チーム依頼"])
async def チーム依頼最大更新日時(request: チーム依頼一覧要求) -> dict:
    try:
        要員ID = request.要員ID.strip()
        if not 要員ID:
            return ng("要員IDを指定してください")
        return ok(
            "最大更新日時を取得しました",
            {"最大更新日時": team_work_db.依頼最大更新日時(要員ID)},
        )
    except Exception as e:
        logger.error(f"チーム依頼最大更新日時の取得に失敗: {e}")
        return ng(f"チーム依頼最大更新日時の取得に失敗しました: {e}")


@router.post("/依頼/取得", tags=["チーム依頼"])
async def チーム依頼取得(request: チーム依頼取得要求) -> dict:
    try:
        要員ID = request.要員ID.strip()
        依頼ID = request.依頼ID.strip()
        if not 要員ID or not 依頼ID:
            return ng("要員IDと依頼IDを指定してください")
        item = team_work_db.依頼取得(要員ID, 依頼ID)
        return ok("依頼を取得しました", {"item": item}) if item else ng("対象依頼が見つかりません")
    except Exception as e:
        logger.error(f"チーム依頼の取得に失敗: {e}")
        return ng(f"チーム依頼の取得に失敗しました: {e}")


def _依頼データ(request: チーム依頼保存要求, 編集中: bool) -> dict:
    要員ID = request.要員ID.strip() or request.操作利用者ID.strip() or "admin"
    依頼ID = request.依頼ID.strip()
    要求内容 = request.要求内容.strip()
    if 編集中 and not 依頼ID:
        raise ValueError("依頼IDを指定してください")
    if not 要求内容:
        raise ValueError("要求内容を入力してください")
    if request.状態 not in team_work_db.状態入力一覧:
        raise ValueError("状態が正しくありません")
    # 新規は未指定（None）の項目を既定値（更新最終レコード → 規定値）で補完する。
    # 変更は対象行の値をフロントエンドが必ず送るため補完しない（既存挙動を保つ）。
    既定 = {
        "プロジェクト": "",
        "TEAM_AI_NAME": "codex_cli",
        "TASK_AI_NAME": "codex_cli",
        **{カラム: "auto" for カラム in team_work_db.AIモデルカラム},
    }
    if not 編集中:
        既定.update(team_work_db.依頼新規既定値(要員ID))
    # フェーズ別の指定が無い項目は既定値で埋める
    モデル = {
        カラム: (getattr(request, カラム, None) or "").strip() or 既定[カラム]
        for カラム in team_work_db.AIモデルカラム
    }
    return {
        "要員ID": 要員ID,
        "依頼ID": 依頼ID,
        "プロジェクト": 既定["プロジェクト"] if request.プロジェクト is None else request.プロジェクト.strip(),
        "要求内容": 要求内容,
        "TEAM_AI_NAME": (request.TEAM_AI_NAME or "").strip() or 既定["TEAM_AI_NAME"],
        "TASK_AI_NAME": (request.TASK_AI_NAME or "").strip() or 既定["TASK_AI_NAME"],
        **モデル,
        "実行有効": request.実行有効,
        "状態": request.状態,
    }


@router.post("/依頼/登録", tags=["チーム依頼"])
async def チーム依頼登録(request: チーム依頼保存要求) -> dict:
    try:
        item = team_work_db.依頼登録(_依頼データ(request, 編集中=False), request.操作者())
        return ok(f"依頼 {item['依頼ID']} を登録しました", {"item": item})
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"チーム依頼の登録に失敗: {e}")
        return ng(f"チーム依頼の登録に失敗しました: {e}")


@router.post("/依頼/変更", tags=["チーム依頼"])
async def チーム依頼変更(request: チーム依頼保存要求) -> dict:
    try:
        更新 = _依頼データ(request, 編集中=True)
        現行 = team_work_db.依頼取得(更新["要員ID"], 更新["依頼ID"])
        if 現行 is None:
            raise KeyError(更新["依頼ID"])
        await team_task_control.依頼操作反映(現行, 更新)
        item = team_work_db.依頼変更(更新, request.操作者())
        return ok(f"依頼 {item['依頼ID']} を変更しました", {"item": item})
    except KeyError:
        return ng("対象依頼が見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"チーム依頼の変更に失敗: {e}")
        return ng(f"チーム依頼の変更に失敗しました: {e}")


@router.post("/経験/一覧", tags=["チーム経験"])
async def チーム経験一覧(request: チーム経験一覧要求) -> dict:
    """Aチーム経験を完了日時の新しい順で返す（プロジェクト・要員で絞り込み可）。"""
    try:
        プロジェクト = request.プロジェクト.strip()
        要員ID = request.要員ID.strip()
        items = team_exp_db.経験一覧(プロジェクト, 要員ID, request.件数)
        return ok(f"{len(items)}件取得しました", {
            "items": items,
            "total": len(items),
            "経験値合計": team_exp_db.経験合計(プロジェクト, 要員ID),
        })
    except Exception as e:
        logger.error(f"チーム経験一覧の取得に失敗: {e}")
        return ng(f"チーム経験一覧の取得に失敗しました: {e}")


@router.post("/経験/最大更新日時", tags=["チーム経験"])
async def チーム経験最大更新日時(request: チーム経験一覧要求) -> dict:
    """一覧の再取得判定に使う最大更新日時（5秒ポーリング用）。"""
    try:
        return ok("最大更新日時を取得しました", {
            "最大更新日時": team_exp_db.経験最大更新日時(
                request.プロジェクト.strip(), request.要員ID.strip()
            ),
        })
    except Exception as e:
        logger.error(f"チーム経験の最大更新日時の取得に失敗: {e}")
        return ng(f"チーム経験の最大更新日時の取得に失敗しました: {e}")


@router.post("/経験/取得", tags=["チーム経験"])
async def チーム経験取得(request: チーム経験取得要求) -> dict:
    try:
        経験ID = request.経験ID.strip()
        if not 経験ID:
            return ng("経験IDを指定してください")
        item = team_exp_db.経験取得(経験ID)
        return ok("経験を取得しました", {"item": item}) if item else ng("対象の経験が見つかりません")
    except Exception as e:
        logger.error(f"チーム経験の取得に失敗: {e}")
        return ng(f"チーム経験の取得に失敗しました: {e}")


@router.post("/経験/本登録", tags=["チーム経験"])
async def チーム経験本登録(request: チーム経験本登録要求) -> dict:
    """sub_exp.py からの本登録。仮登録済みレコードへ経験値を書き戻して完了にする。"""
    try:
        経験ID = request.経験ID.strip()
        タイトル = request.タイトル.strip()
        if not 経験ID:
            return ng("経験IDを指定してください")
        if not タイトル:
            return ng("タイトルを指定してください")
        item = team_exp_db.経験本登録(経験ID, {
            "タイトル": タイトル,
            "経験値": request.経験値,
            "分類": request.分類.strip(),
            "まとめ内容": request.まとめ内容.strip(),
            "学び": request.学び.strip(),
        })
        return ok(f"経験 {経験ID} を登録しました", {"item": item})
    except KeyError:
        return ng("対象の経験が見つかりません")
    except Exception as e:
        logger.error(f"チーム経験の本登録に失敗: {e}")
        return ng(f"チーム経験の本登録に失敗しました: {e}")


@router.post("/経験/失敗", tags=["チーム経験"])
async def チーム経験失敗(request: チーム経験失敗要求) -> dict:
    """sub_exp.py からの失敗記録。経験をエラー状態にする。"""
    try:
        経験ID = request.経験ID.strip()
        if not 経験ID:
            return ng("経験IDを指定してください")
        team_exp_db.経験失敗記録(経験ID, request.メッセージ.strip() or "経験の生成に失敗しました")
        return ok(f"経験 {経験ID} をエラーにしました")
    except Exception as e:
        logger.error(f"チーム経験の失敗記録に失敗: {e}")
        return ng(f"チーム経験の失敗記録に失敗しました: {e}")


@router.post("/作業/一覧", tags=["チーム作業"])
async def チーム作業一覧(request: チーム作業一覧要求) -> dict:
    """作業ループ（PDCA）の実行状況を、作業IDの新しい順で返す。"""
    try:
        items = team_pdca_db.作業一覧(request.プロジェクト.strip(), request.件数)
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"チーム作業一覧の取得に失敗: {e}")
        return ng(f"チーム作業一覧の取得に失敗しました: {e}")


@router.post("/作業/最大更新日時", tags=["チーム作業"])
async def チーム作業最大更新日時(request: チーム作業一覧要求) -> dict:
    """一覧の再取得判定に使う最大更新日時（5秒ポーリング用）。"""
    try:
        return ok("最大更新日時を取得しました", {
            "最大更新日時": team_pdca_db.作業最大更新日時(request.プロジェクト.strip()),
        })
    except Exception as e:
        logger.error(f"チーム作業の最大更新日時の取得に失敗: {e}")
        return ng(f"チーム作業の最大更新日時の取得に失敗しました: {e}")


@router.post("/会話/一覧", tags=["チーム会話"])
async def チーム会話一覧(request: チーム会話一覧要求) -> dict:
    """プロジェクト内の要員ごとの最終発言を新しい順で返す。"""
    try:
        items = team_talk_db.会話一覧(request.プロジェクト.strip(), request.件数)
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"チーム会話一覧の取得に失敗: {e}")
        return ng(f"チーム会話一覧の取得に失敗しました: {e}")


@router.post("/会話/最大更新日時", tags=["チーム会話"])
async def チーム会話最大更新日時(request: チーム会話一覧要求) -> dict:
    """一覧の再取得判定に使う最大更新日時（5秒ポーリング用）。"""
    try:
        return ok("最大更新日時を取得しました", {
            "最大更新日時": team_talk_db.会話最大更新日時(request.プロジェクト.strip()),
        })
    except Exception as e:
        logger.error(f"チーム会話の最大更新日時の取得に失敗: {e}")
        return ng(f"チーム会話の最大更新日時の取得に失敗しました: {e}")


@router.post("/目標/一覧", tags=["チーム目標"])
async def チーム目標一覧() -> dict:
    """CODE_BASE_PATH ごとのチーム作業を、更新日時の新しい順で返す。"""
    try:
        items = team_goal_db.目標一覧()
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"チーム目標一覧の取得に失敗: {e}")
        return ng(f"チーム目標一覧の取得に失敗しました: {e}")


@router.post("/目標/最終", tags=["チーム目標"])
async def チーム目標最終() -> dict:
    """更新日時が最新のチーム作業と、赤ネオンの点灯状態を返す（掲示板に出す値）。

    掲示板は5秒ごとにこれを読み、`作業実行中` でネオン点灯を切り替える。
    作業ループがオン、かつチーム作業に空白以外の内容があれば true。
    """
    try:
        item = team_goal_db.最終目標取得()
        if not item:
            return ok("チーム作業を取得しました", {"最大更新日時": "", "item": {}, "作業実行中": False})
        作業実行中 = bool(item.get("作業ループ")) and bool(str(item.get("チーム作業", "")).strip())
        return ok("チーム作業を取得しました", {
            "最大更新日時": str(item.get("更新日時", "")),
            "item": item,
            "作業実行中": 作業実行中,
        })
    except Exception as e:
        logger.error(f"チーム作業の取得に失敗: {e}")
        return ng(f"チーム作業の取得に失敗しました: {e}")


@router.post("/目標/取得", tags=["チーム目標"])
async def チーム目標取得(request: チーム目標取得要求) -> dict:
    try:
        パス = request.CODE_BASE_PATH.strip()
        if not パス:
            return ng("CODE_BASE_PATHを指定してください")
        item = team_goal_db.目標取得(パス)
        return ok("チーム作業を取得しました", {"item": item}) if item else ng("対象のチーム作業が見つかりません")
    except Exception as e:
        logger.error(f"チーム作業の取得に失敗: {e}")
        return ng(f"チーム作業の取得に失敗しました: {e}")


@router.post("/目標/保存", tags=["チーム目標"])
async def チーム目標保存(request: チーム目標保存要求) -> dict:
    """CODE_BASE_PATH 単位の登録・変更（同じパスなら上書き）。"""
    try:
        パス = request.CODE_BASE_PATH.strip()
        目標 = request.チーム作業.strip()
        テーマ = request.チーム目標.strip()
        if not パス:
            return ng("CODE_BASE_PATHを指定してください")
        if not 目標 and not bool(request.自動作業設定):
            return ng("チーム作業を入力してください")
        if not テーマ:
            return ng("チーム目標を入力してください")
        変更前 = team_goal_db.目標取得(パス)
        item = team_goal_db.目標保存(
            パス,
            目標,
            テーマ,
            request.操作者(),
            request.自動作業設定,
            request.作業ループ,
            request.作業ループ回数,
            request.動員要員数,
            request.パターン,
            request.TEAM_AI_NAME,
            request.TASK_AI_NAME,
            **{
                カラム: 値
                for カラム in team_goal_db.AIモデルカラム
                if (値 := getattr(request, カラム, None))
            },
        )
        response_data = {"item": item}
        クリア内容: list[str] = []
        if team_goal_db.作業履歴クリア必要(変更前, 目標, request.作業ループ, request.パターン):
            # 作業ループ回数・動員要員数だけの変更では履歴を残し、
            # チーム作業・ループON/OFF・パターンの変更時だけクリアする。
            作業クリア件数 = team_pdca_db.作業クリア(パス)
            response_data["作業クリア件数"] = 作業クリア件数
            クリア内容.append(f"作業ループの記録{作業クリア件数}件")
            logger.info(
                f"チーム作業・作業ループ・パターン変更のためAチーム作業をクリアしました: "
                f"{パス} ({作業クリア件数}件)"
            )
        if team_goal_db.会話クリア必要(変更前, テーマ, request.自動作業設定):
            会話クリア件数 = team_talk_db.会話クリア(パス)
            response_data["会話クリア件数"] = 会話クリア件数
            クリア内容.append(f"会話{会話クリア件数}件")
            logger.info(
                f"チーム目標または自動作業設定変更のためAチーム会話をクリアしました: "
                f"{パス} ({会話クリア件数}件)"
            )
        if クリア内容:
            return ok(
                f"{パス} のチーム作業を保存し、{'、'.join(クリア内容)}をクリアしました",
                response_data,
            )
        return ok(f"{パス} のチーム作業を保存しました", {"item": item})
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"チーム作業の保存に失敗: {e}")
        return ng(f"チーム作業の保存に失敗しました: {e}")


@router.post("/目標/削除", tags=["チーム目標"])
async def チーム目標削除(request: チーム目標削除要求) -> dict:
    try:
        パス = request.CODE_BASE_PATH.strip()
        if not パス:
            return ng("CODE_BASE_PATHを指定してください")
        team_goal_db.目標削除(パス)
        # 目標が消えたら作業ループの記録も残さない
        team_pdca_db.作業クリア(パス)
        return ok(f"{パス} のチーム作業を削除しました")
    except KeyError:
        return ng("対象のチーム作業が見つかりません")
    except ValueError as exc:
        return ng(str(exc))
    except Exception as e:
        logger.error(f"チーム作業の削除に失敗: {e}")
        return ng(f"チーム作業の削除に失敗しました: {e}")


@router.post("/状況/一覧", tags=["チーム状況"])
async def チーム状況一覧() -> dict:
    """要員ごとのAタスク要求と経験生成（待機数・実行数・まとめ中数・完了数・エラー数）を取得する。

    集計自体は Task 処理側（10秒間隔）が行い、Aチーム状況テーブルを作り直している。
    """
    try:
        items = team_status_db.状況一覧()
        return ok(f"{len(items)}件取得しました", {"items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"チーム状況一覧の取得に失敗: {e}")
        return ng(f"チーム状況一覧の取得に失敗しました: {e}")


@router.post("/状況/最大更新日時", tags=["チーム状況"])
async def チーム状況最大更新日時() -> dict:
    """元データ4テーブルの変更確認に使う最大更新日時を返す。"""
    try:
        最大更新日時 = team_status_db.状況最大更新日時()
        return ok(
            "最大更新日時を取得しました",
            {"最大更新日時": 最大更新日時},
        )
    except Exception as e:
        logger.error(f"チーム状況の最大更新日時取得に失敗: {e}")
        return ng(f"チーム状況の最大更新日時取得に失敗しました: {e}")
