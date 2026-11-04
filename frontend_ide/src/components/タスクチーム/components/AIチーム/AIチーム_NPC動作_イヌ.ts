// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPCイヌの動作制御。
// 体格・色・歩く速さ・滞在時間・次の状態の出やすさ・姿勢はここだけで調整する。
// 歩く / やすむ / 眠る の共通処理は AIチーム_NPC四足.ts にある。

import { 基本姿勢表, 四足NPCを生成, type 四足設定 } from './AIチーム_NPC四足';
import type { NPC定義 } from './AIチーム_NPC型';

export const イヌ既定設定: 四足設定 = {
  歩く速度: 1.35,
  旋回追従: 0.16,
  // イヌはよく歩き回り、休むのは短め
  滞在時間: { 歩く: [9, 18], やすむ: [5, 10], 眠る: [10, 20] },
  遷移重み: {
    歩く: { 歩く: 4, やすむ: 4, 眠る: 2 },
    やすむ: { 歩く: 6, 眠る: 2 },
    眠る: { 歩く: 5, やすむ: 3 },
  },
  移動距離: [4, 13],
  徘徊半径: 22,
  歩調微調整: 1,
  脚振り角: 0.62,
  // 尾はネコより速く大きく振る
  尾速度: 7.5,
  尾振り角: 0.6,
  // 普段は後ろへ自然に垂らし、ときどき嬉しそうに振る
  尾基準角: Math.PI * 0.72,
  尾を時々振る: true,
  体長: 0.74,
  体幅: 0.3,
  体高: 0.29,
  頭径: 0.19,
  脚長: 0.3,
  耳形: '垂れ耳',
  姿勢: 基本姿勢表,
  体色: 0xc98b4b,
  腹色: 0xf0dcbb,
  鼻色: 0x4a3b32,
  寝息文字: 'zZzZ.',
};

export const イヌ定義: NPC定義<四足設定> = {
  種別: 'イヌ',
  既定設定: イヌ既定設定,
  生成: (scene, ヘルパー, 配置, 設定) => 四足NPCを生成('イヌ', scene, ヘルパー, 配置, 設定),
};
