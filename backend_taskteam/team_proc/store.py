# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from __future__ import annotations

import asyncio
import random
from copy import deepcopy
from datetime import datetime
from threading import RLock
from uuid import uuid4

from . import persona_catalog, team_db, team_status_db

状態候補 = ("作業中", "相談中", "雑談中", "瞑想中", "移動中", "休憩中")
作業候補 = (
    "要件を小さなタスクへ分解中",
    "既存コードの影響範囲を調査中",
    "実装案を組み立て中",
    "テストケースを追加中",
    "レビューコメントを整理中",
    "次のタスクを自主選択中",
)
雑談候補 = (
    "この実装、もう少し軽くできそう",
    "瞑想を終えたら一緒にレビューしよう",
    "さっきの発見、共有しておいたよ",
    "次はどのタスクを拾う？",
)

色候補 = ("#5bd9ff", "#9d91ff", "#5ce3a1", "#ff8fc2", "#ffd078", "#78afff", "#d893ff", "#74e9dc")


def 現在日時ISO() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class チームストア:
    """AIチーム表示（アバター）用のインメモリ状態。位置・雑談演出は非永続だが、
    状態そのものは team_status_db の実データ（実行中・まとめ中など）に連動する。
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._simulation_enabled = True
        self._revision = 0
        self._agents: list[dict] = []
        self._activities: list[dict] = []
        self.要員再読込(活動記録=False)
        self._活動記録("admin", "AIチームの見守りを開始しました", "#5bd9ff")

    def _活動記録(self, 名前: str, 内容: str, 色: str) -> None:
        self._revision += 1
        self._activities.insert(0, {
            "活動ID": uuid4().hex,
            "発生日時": 現在日時ISO(),
            "エージェント名": 名前,
            "内容": 内容,
            "色": 色,
        })
        del self._activities[50:]

    def _要員追加(
        self,
        要員: dict,
        番号: int,
        状態: str = "召喚中",
        活動記録: bool = True,
        要員種別: str = "DB",
    ) -> dict:
        名前 = str(要員["要員名"])
        役割 = str(要員["役割"])
        色 = 色候補[番号 % len(色候補)]
        エージェント = {
            "エージェントID": str(要員["要員ID"]),
            "エージェント名": 名前,
            "要員種別": 要員種別,
            "役割": 役割,
            "人格情報": str(要員["人格情報"]),
            "色": 色,
            "状態": 状態,
            "作業内容": 作業候補[番号 % len(作業候補)] if 状態 == "作業中" else "次の行動を考えています",
            "ひとこと": 雑談候補[番号 % len(雑談候補)] if 状態 == "相談中" else "",
            "位置": (
                {"x": 0.3, "y": 0.66, "z": 5.35}
                if 状態 == "召喚中"
                else {"x": 0.0, "y": 0.66, "z": 0.0}
            ),
            "更新日時": 現在日時ISO(),
        }
        self._agents.append(エージェント)
        if 活動記録:
            self._活動記録(名前, f"{役割}エージェントを召喚しました", 色)
        return エージェント

    def 要員再読込(self, 活動記録: bool = True) -> None:
        with self._lock:
            要員一覧 = team_db.要員一覧()
            要員ID集合 = {str(要員["要員ID"]) for 要員 in 要員一覧}
            self._agents = [
                エージェント
                for エージェント in self._agents
                if エージェント.get("要員種別") != "DB"
                or エージェント["エージェントID"] in 要員ID集合
            ]
            現在 = {
                エージェント["エージェントID"]: エージェント
                for エージェント in self._agents
                if エージェント.get("要員種別") == "DB"
            }
            for 番号, 要員 in enumerate(要員一覧):
                要員ID = str(要員["要員ID"])
                if 要員ID not in 現在:
                    状態 = "作業中" if 要員ID == team_db.管理者要員ID else "召喚中"
                    self._要員追加(
                        要員,
                        番号,
                        状態,
                        活動記録,
                        要員種別="DB",
                    )
                else:
                    現在[要員ID]["エージェント名"] = str(要員["要員名"])
                    現在[要員ID]["役割"] = str(要員["役割"])
                    現在[要員ID]["人格情報"] = str(要員["人格情報"])

    def スナップショット(self) -> dict:
        self.要員再読込()
        with self._lock:
            return {
                "revision": self._revision,
                "シミュレーション中": self._simulation_enabled,
                "エージェント": deepcopy(self._agents),
                "活動": deepcopy(self._activities[:10]),
                "集計": {
                    "召喚数": len(self._agents),
                    "作業中": sum(agent["状態"] == "作業中" for agent in self._agents),
                    "相談中": sum(agent["状態"] == "相談中" for agent in self._agents),
                    "雑談中": sum(agent["状態"] == "雑談中" for agent in self._agents),
                    "瞑想中": sum(agent["状態"] == "瞑想中" for agent in self._agents),
                    "休憩中": sum(agent["状態"] == "休憩中" for agent in self._agents),
                },
            }

    def エージェント一覧(self) -> list[dict]:
        self.要員再読込()
        with self._lock:
            return deepcopy(self._agents)

    def 活動一覧(self, 件数: int) -> list[dict]:
        with self._lock:
            return deepcopy(self._activities[:件数])

    def 召喚(self, 要員ID: str, 依頼役割: str = "") -> dict:
        if not 要員ID.strip():
            raise ValueError("召喚する要員を選択してください")
        要員 = persona_catalog.召喚要員取得(要員ID)
        if 要員 is None:
            raise ValueError("personaフォルダに対象要員が見つかりません")
        del 依頼役割
        with self._lock:
            if any(
                エージェント["エージェントID"] == 要員["要員ID"]
                for エージェント in self._agents
            ):
                raise ValueError("対象要員は既に召喚されています")
            要員 = team_db.要員召喚登録(
                要員,
                {
                    "利用者ID": "system",
                    "利用者名": "システム",
                    "端末ID": "backend_team",
                },
            )
            return deepcopy(
                self._要員追加(
                    要員,
                    len(self._agents),
                    状態="召喚中",
                    要員種別="DB",
                )
            )

    def 排除(self, 要員ID: str) -> dict:
        要員ID = 要員ID.strip()
        if 要員ID == team_db.管理者要員ID:
            raise ValueError("admin要員は排除できません")
        with self._lock:
            エージェント = next(
                (
                    row
                    for row in self._agents
                    if row["エージェントID"] == 要員ID
                ),
                None,
            )
            if エージェント is None:
                raise KeyError(要員ID)
            item = team_db.要員排除(
                要員ID,
                {
                    "利用者ID": "system",
                    "利用者名": "システム",
                    "端末ID": "backend_team",
                },
            )
            self._agents = [
                row
                for row in self._agents
                if row["エージェントID"] != 要員ID
            ]
            self._活動記録(
                エージェント["エージェント名"],
                "チーム空間から排除しました",
                エージェント["色"],
            )
            return item

    def 状態変更(self, エージェントID: str, 状態: str, 作業内容: str = "", ひとこと: str = "") -> dict:
        if 状態 not in (*状態候補, "召喚中"):
            raise ValueError(f"未対応の状態です: {状態}")
        with self._lock:
            エージェント = next((row for row in self._agents if row["エージェントID"] == エージェントID), None)
            if エージェント is None:
                raise KeyError(エージェントID)
            エージェント["状態"] = 状態
            エージェント["作業内容"] = 作業内容.strip() or self._既定作業内容(状態)
            エージェント["ひとこと"] = ひとこと.strip() or (random.choice(雑談候補) if 状態 in ("相談中", "雑談中") else "")
            エージェント["更新日時"] = 現在日時ISO()
            self._活動記録(エージェント["エージェント名"], f"{状態}: {エージェント['作業内容']}", エージェント["色"])
            return deepcopy(エージェント)

    def シミュレーション切替(self, 有効: bool) -> bool:
        with self._lock:
            self._simulation_enabled = 有効
            self._revision += 1
            return self._simulation_enabled

    def _既定作業内容(self, 状態: str) -> str:
        return {
            "作業中": random.choice(作業候補),
            "相談中": "仲間とアイデア交換",
            "雑談中": "雑談エリアで仲間とアイデア交換",
            "瞑想中": "静かに思考と文脈を整理中",
            "移動中": "オフィスを気ままに移動中",
            "休憩中": "休憩エリアでひと息ついている",
            "召喚中": "雑談エリアでチームに合流中",
        }[状態]

    @staticmethod
    def _待機時状態(経験最終更新日時: str, タスク最終更新日時: str = "") -> str:
        """作業・経験の更新後1分は休憩し、その後は更新日時の秒で待機場所を切り替える。
        経験・タスクの更新履歴が無い要員（新規召喚直後など）は雑談中からスタートする。
        """
        現在 = datetime.now()
        更新日時一覧: list[datetime] = []
        for 更新日時 in (経験最終更新日時, タスク最終更新日時):
            if not 更新日時:
                continue
            try:
                更新日時一覧.append(datetime.fromisoformat(更新日時))
            except ValueError:
                continue
        if 更新日時一覧 and min(max(0, (現在 - 更新日時).total_seconds()) for 更新日時 in 更新日時一覧) <= 60:
            return "休憩中"
        # 経験が未生成の要員は、依頼の更新日時をトグルの基準時刻として代用する
        基準日時 = 経験最終更新日時 or タスク最終更新日時
        if not 基準日時:
            return "雑談中"
        try:
            最終更新 = datetime.fromisoformat(基準日時)
        except ValueError:
            return "雑談中"
        経過秒 = max(0, (現在 - 最終更新).total_seconds())
        秒一桁 = 最終更新.second % 10
        切替分 = 秒一桁 if 秒一桁 else 10
        区間 = int(経過秒 // (切替分 * 60))
        return "雑談中" if 区間 % 2 == 1 else "休憩中"

    @classmethod
    def _状況連動状態(cls, 状況: dict | None) -> str:
        if 状況 and int(状況.get("実行数", 0) or 0) > 0:
            return "作業中"
        if 状況 and int(状況.get("まとめ中数", 0) or 0) > 0:
            return "瞑想中"
        return cls._待機時状態(
            str((状況 or {}).get("経験最終更新日時", "") or ""),
            str((状況 or {}).get("最終更新日時", "") or ""),
        )

    def 進行(self) -> None:
        with self._lock:
            if not self._simulation_enabled or not self._agents:
                return
            状況マップ = {str(row["要員ID"]): row for row in team_status_db.状況一覧()}
            for エージェント in self._agents:
                状況 = 状況マップ.get(エージェント["エージェントID"])
                # Aチーム状況を取得できなかった要員は、推測で状態を変えず現在値を維持する
                if 状況 is None:
                    continue
                状態 = self._状況連動状態(状況)
                if エージェント["状態"] != 状態:
                    self.状態変更(エージェント["エージェントID"], 状態)


ストア = チームストア()


async def シミュレーションループ(logger) -> None:
    logger.info("backend_taskteam のAIチーム表示シミュレーションを開始しました")
    try:
        while True:
            await asyncio.sleep(8)
            ストア.進行()
    except asyncio.CancelledError:
        logger.info("backend_taskteam のAIチーム表示シミュレーションを停止しました")
        raise
