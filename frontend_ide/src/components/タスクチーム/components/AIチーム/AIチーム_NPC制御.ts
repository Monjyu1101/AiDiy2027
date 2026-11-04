// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPC制御。種別ごとの動作モジュールを登録し、配置と毎フレーム更新の入口をまとめる。
//
// 画面（AIチーム_空間表示.vue）はこのファイルだけを使い、
// 個々の見た目や動きは AIチーム_NPC動作_*.ts 側で調整する。

import type * as THREE from 'three';

import { イヌ定義 } from './AIチーム_NPC動作_イヌ';
import { ネコ定義 } from './AIチーム_NPC動作_ネコ';
import { 蝶定義 } from './AIチーム_NPC動作_蝶';
import { 雲定義 } from './AIチーム_NPC動作_雲';
import { カモ大定義, カモ小定義 } from './AIチーム_NPC動作_カモ';
import { 飛行船定義 } from './AIチーム_NPC動作_飛行船';
import { 白うさぎ定義, 黒うさぎ定義 } from './AIチーム_NPC動作_うさぎ';
import { うさぎ穴定義 } from './AIチーム_NPC動作_うさぎ穴';
import { 白馬定義, 黒馬定義 } from './AIチーム_NPC動作_馬';
import type { NPC個体, NPC更新引数, NPC配置, 造形ヘルパー } from './AIチーム_NPC型';
import { ローポリ調にそろえる } from './AIチーム_造形_共通';

/** 種別 → 動作モジュールの登録表。NPC を増やすときはここへ 1 行追加する */
const NPC定義一覧 = {
  ネコ: ネコ定義,
  イヌ: イヌ定義,
  雲: 雲定義,
  蝶: 蝶定義,
  飛行船: 飛行船定義,
  黒馬: 黒馬定義,
  白馬: 白馬定義,
  黒うさぎ: 黒うさぎ定義,
  白うさぎ: 白うさぎ定義,
  うさぎ穴: うさぎ穴定義,
  カモ大: カモ大定義,
  カモ小: カモ小定義,
} as const;

export type NPC種別 = keyof typeof NPC定義一覧;
/** 種別ごとの設定型（上書きしたい項目だけ渡せる） */
export type NPC設定<T extends NPC種別> = (typeof NPC定義一覧)[T]['既定設定'];

export type { NPC個体, NPC更新引数, NPC配置, 造形ヘルパー };

/** NPC を 1 体つくってシーンへ追加する */
export const NPCを配置 = <T extends NPC種別>(
  scene: THREE.Scene,
  種別: T,
  ヘルパー: 造形ヘルパー,
  配置: NPC配置,
  上書き: Partial<NPC設定<T>> = {},
): NPC個体 => {
  const 定義 = NPC定義一覧[種別];
  const 設定 = { ...定義.既定設定, ...上書き };
  const 個体 = 定義.生成(scene, ヘルパー, 配置, 設定 as never);
  // 草原の木や建物と同じローポリ調にそろえる（形・大きさ・動きはそのまま）
  ローポリ調にそろえる(個体.group, ヘルパー);
  return 個体;
};

/**
 * 配置済みの NPC をまとめて 1 フレーム進める。
 * 更新は必ず配列順に行う（カモの子が親の最新位置を見られるように、親を先に置いてある）。
 * そのあとで、寿命が尽きた NPC（うさぎ穴など）を一覧から取り除く。
 */
export const NPC群を更新 = (一覧: NPC個体[], 引数: NPC更新引数): void => {
  一覧.forEach((npc) => npc.更新(引数));
  for (let index = 一覧.length - 1; index >= 0; index -= 1) {
    if (一覧[index]?.寿命切れ?.()) 一覧.splice(index, 1);
  }
};
