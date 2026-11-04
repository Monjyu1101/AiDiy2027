// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPCネコの動作制御。
// 体格・色・歩く速さ・滞在時間・次の状態の出やすさ・姿勢はここだけで調整する。
// 歩く / やすむ / 眠る の共通処理は AIチーム_NPC四足.ts にある。

import { 基本姿勢表, 四足NPCを生成, type 四足設定 } from './AIチーム_NPC四足';
import type { NPC定義 } from './AIチーム_NPC型';

export const ネコ既定設定: 四足設定 = {
  歩く速度: 0.85,
  旋回追従: 0.12,
  // ネコはよく寝て、あまり長く歩かない
  滞在時間: { 歩く: [6, 13], やすむ: [7, 14], 眠る: [16, 30] },
  遷移重み: {
    歩く: { やすむ: 5, 眠る: 3, 歩く: 2 },
    やすむ: { 歩く: 5, 眠る: 4 },
    眠る: { やすむ: 4, 歩く: 3 },
  },
  移動距離: [2.5, 8],
  徘徊半径: 15,
  歩調微調整: 1,
  脚振り角: 0.5,
  尾速度: 2.2,
  尾振り角: 0.35,
  尾基準角: -Math.PI / 3.2,
  尾を時々振る: false,
  体長: 0.52,
  体幅: 0.22,
  体高: 0.22,
  頭径: 0.17,
  脚長: 0.2,
  耳形: '立ち耳',
  姿勢: {
    ...基本姿勢表,
    やすむ: { ...基本姿勢表.やすむ, 後脚: 1.3 },
    // 眠るときは尾を体に寄せて丸くなる
    眠る: { ...基本姿勢表.眠る, 尾傾き: 0.85 },
  },
  体色: 0xb9b1a4,
  腹色: 0xece5d8,
  鼻色: 0xe79aa6,
  寝息文字: 'zZzZ.',
};

export const ネコ定義: NPC定義<四足設定> = {
  種別: 'ネコ',
  既定設定: ネコ既定設定,
  生成: (scene, ヘルパー, 配置, 設定) => 四足NPCを生成('ネコ', scene, ヘルパー, 配置, 設定),
};
