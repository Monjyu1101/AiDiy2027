// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPC雲の動作制御。
// 空をゆっくり流れ、端まで来たら反対側へ戻る。塊の数や速さはここだけで調整する。

import * as THREE from 'three';

import {
  type NPC定義,
  type NPC個体,
  乱数を作る,
} from './AIチーム_NPC型';

export type 雲設定 = {
  /** 塊（もこもこ）の数 [最小, 最大] */
  塊数: [number, number];
  /** 塊 1 つの大きさ [横, 縦, 奥行き] の基準 */
  塊寸法: [number, number, number];
  /** 全体の拡大率 [最小, 最大] */
  拡大率: [number, number];
  /** 流れる速さ（1秒あたり）。x+ 方向へ動く */
  流れ速度: number;
  /** この x を越えたら反対側へ戻す */
  折返しX: number;
  /** 色と透け具合 */
  色: number;
  不透明度: number;
};

export const 雲既定設定: 雲設定 = {
  塊数: [3, 5],
  塊寸法: [2.4, 1.3, 1.9],
  拡大率: [0.8, 1.5],
  流れ速度: 0.4,
  折返しX: 86,
  色: 0xffffff,
  不透明度: 1,
};

export const 雲定義: NPC定義<雲設定> = {
  種別: '雲',
  既定設定: 雲既定設定,
  生成: (scene, ヘルパー, 配置, 設定): NPC個体 => {
    const 乱数 = 乱数を作る(配置.種 ?? 1);
    // 半透明の球を重ねると重なり順でちらつくので、不透明度が 1 未満のときだけ透かす。
    // 影の側も白く見えるよう、ほんのり自発光させる
    const 雲材 = new THREE.MeshStandardMaterial({
      color: 設定.色,
      roughness: 1,
      metalness: 0,
      emissive: 設定.色,
      emissiveIntensity: 0.35,
      transparent: 設定.不透明度 < 1,
      opacity: 設定.不透明度,
    });
    ヘルパー.マテリアル登録(雲材);
    const 塊形 = ヘルパー.ジオメトリ(new THREE.SphereGeometry(1, 10, 8));

    const group = new THREE.Group();
    group.position.copy(配置.位置);
    const [最小塊, 最大塊] = 設定.塊数;
    const 個数 = 最小塊 + Math.floor(乱数() * (最大塊 - 最小塊 + 1));
    const [幅, 高, 奥] = 設定.塊寸法;
    for (let index = 0; index < 個数; index += 1) {
      const 塊 = new THREE.Mesh(塊形, 雲材);
      塊.position.set((index - 個数 / 2) * (幅 * 0.88) + 乱数(), 乱数() * 0.9, 乱数() * 1.6);
      塊.scale.set(幅 + 乱数() * 1.5, 高 + 乱数() * 0.6, 奥 + 乱数());
      group.add(塊);
    }
    const [最小率, 最大率] = 設定.拡大率;
    group.scale.setScalar(最小率 + 乱数() * (最大率 - 最小率));
    scene.add(group);

    // 個体ごとに速さを少しずらして、同じ速度で並んで動かないようにする
    const 速さ = 設定.流れ速度 * (0.75 + 乱数() * 0.6);

    return {
      種別: '雲',
      group,
      更新: ({ delta }) => {
        group.position.x += delta * 速さ;
        if (group.position.x > 設定.折返しX) group.position.x = -設定.折返しX;
      },
    };
  },
};
