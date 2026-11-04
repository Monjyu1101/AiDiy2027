// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPC蝶の動作制御。
// 配置位置を中心に円を描いて飛び、上下に揺れながら羽ばたく。

import * as THREE from 'three';

import {
  type NPC定義,
  type NPC個体,
  乱数を作る,
} from './AIチーム_NPC型';

export type 蝶設定 = {
  /** 羽の大きさ */
  羽半径: number;
  /** 旋回半径 [最小, 最大] */
  旋回半径: [number, number];
  /** 旋回の速さ [最小, 最大] */
  旋回速度: [number, number];
  /** 上下の揺れ幅 */
  上下幅: number;
  /** 羽ばたきの速さと角度 */
  羽ばたき速度: number;
  羽ばたき角: number;
  /** 羽の色 */
  色: number;
  不透明度: number;
};

export const 蝶既定設定: 蝶設定 = {
  羽半径: 0.16,
  旋回半径: [1.6, 3.8],
  旋回速度: [0.5, 1.0],
  上下幅: 0.45,
  羽ばたき速度: 0.02,
  羽ばたき角: 0.9,
  色: 0xfff0a0,
  不透明度: 0.92,
};

export const 蝶定義: NPC定義<蝶設定> = {
  種別: '蝶',
  既定設定: 蝶既定設定,
  生成: (scene, ヘルパー, 配置, 設定): NPC個体 => {
    const 乱数 = 乱数を作る(配置.種 ?? 1);
    const 翼材 = new THREE.MeshStandardMaterial({
      color: 設定.色,
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 設定.不透明度,
    });
    ヘルパー.マテリアル登録(翼材);
    const 翼形 = ヘルパー.ジオメトリ(new THREE.CircleGeometry(設定.羽半径, 8, 0, Math.PI));

    const group = new THREE.Group();
    const 左 = new THREE.Mesh(翼形, 翼材);
    const 右 = new THREE.Mesh(翼形, 翼材);
    左.rotation.set(-Math.PI / 2, 0, 0);
    右.rotation.set(-Math.PI / 2, 0, Math.PI);
    group.add(左, 右);
    group.position.copy(配置.位置);
    scene.add(group);

    const 中心 = 配置.位置.clone();
    const [最小半径, 最大半径] = 設定.旋回半径;
    const 半径 = 最小半径 + 乱数() * (最大半径 - 最小半径);
    const [最小速度, 最大速度] = 設定.旋回速度;
    const 速さ = 最小速度 + 乱数() * (最大速度 - 最小速度);
    const 位相 = 乱数() * Math.PI * 2;

    return {
      種別: '蝶',
      group,
      更新: ({ 経過時間, 時刻 }) => {
        const t = 経過時間 * 速さ + 位相;
        group.position.set(
          中心.x + Math.cos(t) * 半径,
          中心.y + Math.sin(t * 1.7) * 設定.上下幅,
          中心.z + Math.sin(t) * 半径,
        );
        group.rotation.y = -t;
        const 羽ばたき = Math.sin(時刻 * 設定.羽ばたき速度 + 位相) * 設定.羽ばたき角;
        左.rotation.y = 羽ばたき;
        右.rotation.y = -羽ばたき;
      },
    };
  },
};
