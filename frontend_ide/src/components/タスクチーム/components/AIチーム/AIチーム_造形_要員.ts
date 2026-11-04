// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム要員（人型）のローポリ造形。
//
// 歩行・腕振り・首振りは AIチーム_空間表示.vue が leftLeg / rightLeg / leftArm / rightArm / head の
// 各グループを回して作る。ここではその支点の位置（脚の付け根・肩・首）を従来どおりに保ち、
// グループの中身（服・顔・髪）だけを作る。髪型と髪色は要員ごとに種で決まる。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { type 造形ヘルパー, 乱数を作る } from './AIチーム_NPC型';
import {
  type 乱数関数,
  ローポリ部品,
  色を混ぜる,
  部品を結合,
  法線をなめらかにする,
  配置行列,
  頂点色マテリアル,
} from './AIチーム_造形_共通';

type 三つ組 = [number, number, number];
type 色指定 = THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation];

const 肌色 = 0xf3d9be;
const ズボン色: [number, number] = [0x2f3a4a, 0x46566c];
const 白 = 0xf7fbff;
const 髪色一覧 = [0x4a3b32, 0x2b2522, 0x7a4a2a, 0xc98f4a, 0x5a5f6a, 0x8a3b2e];

export type 要員の部位 = {
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  head: THREE.Group;
};

/** 文字列から決まった種を作る（同じ要員は毎回同じ髪型になる） */
export const 文字列の種 = (text: string) => {
  let 値 = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    値 ^= text.charCodeAt(index);
    値 = Math.imul(値, 16777619);
  }
  return (値 >>> 0) % 1000000;
};

// 要員はデフォルメした人形の質感にするため、草原の造形より分割を細かくし、面のばらつきも付けない
const 部品工房 = (乱数: 乱数関数) => ({
  玉: (半径: number, 位置: 三つ組, 色: 色指定, 詳細 = 2, 拡大: number | 三つ組 = 1) =>
    ローポリ部品(new THREE.IcosahedronGeometry(半径, Math.max(詳細, 2)), 乱数, {
      変換: 配置行列(位置, [0, 0, 0], 拡大),
      色,
      ばらつき: 0,
    }),
  柱: (上径: number, 下径: number, 高さ: number, 位置: 三つ組, 色: 色指定, 分割 = 14, 回転: 三つ組 = [0, 0, 0]) =>
    ローポリ部品(new THREE.CylinderGeometry(上径, 下径, 高さ, Math.max(分割, 12), 1), 乱数, {
      変換: 配置行列(位置, 回転),
      色,
      ばらつき: 0,
    }),
  箱: (寸法: 三つ組, 位置: 三つ組, 色: 色指定, 回転: 三つ組 = [0, 0, 0], 面取り = 0.02) =>
    ローポリ部品(
      new RoundedBoxGeometry(寸法[0], 寸法[1], 寸法[2], 3, Math.min(面取り, (Math.min(...寸法) / 2) * 0.9)),
      乱数,
      { 変換: 配置行列(位置, 回転), 色, ばらつき: 0 },
    ),
  /** 半球の帽子形（髪）。前の開き（ラジアン）を指定すると顔の前を空ける */
  帽子: (半径: number, 深さ: number, 位置: 三つ組, 色: 色指定, 前の開き = 0, 拡大: number | 三つ組 = 1) =>
    ローポリ部品(
      new THREE.SphereGeometry(
        半径,
        24,
        12,
        Math.PI / 2 + 前の開き / 2,
        Math.PI * 2 - 前の開き,
        0,
        深さ,
      ),
      乱数,
      { 変換: 配置行列(位置, [0, 0, 0], 拡大), 色, ばらつき: 0 },
    ),
});

/** 腰から首までの胴（回転体）。肩幅と腰のくびれを持たせる */
const 胴の形 = (乱数: 乱数関数, 上着: THREE.Color) => {
  const 断面 = [
    // 裾はズボンの腰回りより少し上・外に出し、重なってちらつかないようにする
    [0.0, 0.64],
    [0.278, 0.64],
    [0.255, 0.72],
    [0.235, 0.82],
    [0.27, 1.0],
    [0.29, 1.12],
    [0.25, 1.24],
    [0.13, 1.3],
    [0.0, 1.31],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  return ローポリ部品(new THREE.LatheGeometry(断面, 20), 乱数, {
    色: [色を混ぜる(上着, 0x000000, 0.18), 色を混ぜる(上着, 0xffffff, 0.1)],
    ばらつき: 0,
  });
};

export type 要員造形 = {
  部位を作る: (要員色: number, 種: number) => 要員の部位;
};

export const 要員造形を作る = (ヘルパー: 造形ヘルパー): 要員造形 => {
  // 面の角を立てない、なめらかな陰影（デフォルメした人形らしく）
  const 材 = 頂点色マテリアル(ヘルパー, { roughness: 0.7, flatShading: false });
  // 前髪の影で顔が沈まないよう、肌にだけほんのり自発光を足す
  const 肌材 = ヘルパー.マテリアル(肌色, { roughness: 0.7, emissive: 肌色, emissiveIntensity: 0.14 });

  const メッシュ = (部品: THREE.BufferGeometry[]) => {
    const mesh = new THREE.Mesh(ヘルパー.ジオメトリ(法線をなめらかにする(部品を結合(部品))), 材);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const 部位を作る = (要員色: number, 種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 上着 = new THREE.Color(要員色);
    const 髪色 = 髪色一覧[種 % 髪色一覧.length] ?? 髪色一覧[0]!;
    const 髪型 = Math.floor(種 / 7) % 4;

    // 脚: 付け根（グループ原点）から下へ。ズボンと、底の白い靴
    const 脚を作る = (x: number, name: string) => {
      const 脚 = new THREE.Group();
      脚.name = name;
      脚.position.set(x, 0.62, 0);
      脚.add(
        メッシュ([
          p.玉(0.11, [0, -0.02, 0], ズボン色[1]),
          p.柱(0.1, 0.088, 0.5, [0, -0.27, 0], ズボン色),
          // 丸いつま先の靴と白い靴底
          p.玉(0.125, [0, -0.545, 0.05], [0x4a3426, 0x7a5638], 2, [0.82, 0.62, 1.3]),
          p.玉(0.125, [0, -0.6, 0.05], 0xe8e2d6, 2, [0.86, 0.2, 1.34]),
        ]),
      );
      return 脚;
    };

    // 胴: 上着・腰回り・ベルト・襟
    const body = new THREE.Group();
    body.name = 'body';
    body.add(
      メッシュ([
        胴の形(乱数, 上着),
        p.柱(0.27, 0.25, 0.14, [0, 0.6, 0], ズボン色, 10),
        p.柱(0.268, 0.274, 0.06, [0, 0.7, 0], 0x2a2420),
        p.箱([0.07, 0.05, 0.03], [0, 0.7, 0.272], 0xe2b64a, [0, 0, 0], 0.008),
        p.柱(0.15, 0.18, 0.08, [0, 1.27, 0], 白, 10),
      ]),
    );

    // 腕: 肩（グループ原点）から下へ。袖・白い袖口・手
    const 腕を作る = (x: number, name: string, 傾き: number) => {
      const 腕 = new THREE.Group();
      腕.name = name;
      腕.position.set(x, 1.19, 0);
      腕.rotation.z = 傾き;
      腕.add(
        メッシュ([
          p.玉(0.1, [0, 0, 0], 上着),
          p.柱(0.09, 0.078, 0.38, [0, -0.2, 0], [色を混ぜる(上着, 0x000000, 0.12), 上着]),
          p.柱(0.085, 0.085, 0.05, [0, -0.39, 0], 白),
          // 指を描かない丸いミトンの手
          p.玉(0.092, [0, -0.47, 0], 肌色, 2, [1, 1.12, 0.92]),
        ]),
      );
      return 腕;
    };

    // 頭: 顔・耳・目（白い光点つき）・眉・頬・口・髪
    const head = new THREE.Group();
    head.name = 'head';
    head.position.set(0, 1.34, 0);
    // 顔だけは面の陰影を付けず、なめらかな球にする（ローポリの肌は汚れて見えるため）
    const 顔 = new THREE.Mesh(ヘルパー.ジオメトリ(new THREE.SphereGeometry(0.27, 24, 18)), 肌材);
    顔.position.y = 0.27;
    顔.scale.set(1, 1.06, 0.96);
    顔.castShadow = true;
    顔.receiveShadow = true;
    head.add(顔);
    const 顔部品: THREE.BufferGeometry[] = [
      p.玉(0.06, [-0.265, 0.26, 0], 肌色, 1, [0.6, 1, 1]),
      p.玉(0.06, [0.265, 0.26, 0], 肌色, 1, [0.6, 1, 1]),
    ];
    [-1, 1].forEach((向き) => {
      顔部品.push(
        // デフォルメの大きな黒目と、大小 2 つの光点
        p.玉(0.056, [向き * 0.098, 0.27, 0.226], 0x23303d, 2, [0.9, 1.25, 0.45]),
        p.玉(0.019, [向き * 0.098 + 0.017, 0.298, 0.252], 0xffffff),
        p.玉(0.009, [向き * 0.098 - 0.014, 0.248, 0.25], 0xffffff),
        p.箱([0.075, 0.016, 0.02], [向き * 0.1, 0.355, 0.235], 髪色, [0, 0, -向き * 0.12], 0.006),
        p.玉(0.045, [向き * 0.155, 0.2, 0.2], 0xf2a3a0, 1, [1, 0.55, 0.4]),
      );
    });
    顔部品.push(p.箱([0.07, 0.014, 0.02], [0, 0.155, 0.248], 0x8a4a42, [0, 0, 0], 0.006));
    // 髪型: 0 短髪 / 1 ボブ / 2 ポニーテール / 3 耳の下の二つ結び（頭の上に結い上げる形は付けない）
    顔部品.push(
      p.帽子(0.29, Math.PI / 2.05, [0, 0.28, -0.005], [色を混ぜる(髪色, 0x000000, 0.15), 髪色], 0, [1, 0.95, 1]),
      // 前髪は大きめの 2 房にして、額の上へ流す
      p.玉(0.15, [-0.08, 0.45, 0.13], 髪色, 1, [1.15, 0.45, 0.6]),
      p.玉(0.13, [0.1, 0.44, 0.14], 髪色, 1, [1.1, 0.42, 0.58]),
    );
    if (髪型 === 1) {
      // ボブ: 後頭部から耳の下までを包む（顔の前は顔の球が隠すので、髪は後ろへずらした塊にする）
      顔部品.push(p.玉(0.3, [0, 0.24, -0.075], [色を混ぜる(髪色, 0x000000, 0.15), 髪色], 1, [1.08, 1, 0.92]));
    } else if (髪型 === 2) {
      顔部品.push(
        p.玉(0.05, [0, 0.36, -0.27], 要員色, 0),
        p.柱(0.08, 0.045, 0.34, [0, 0.22, -0.33], 髪色, 7, [-0.45, 0, 0]),
      );
    } else if (髪型 === 3) {
      [-1, 1].forEach((向き) => {
        顔部品.push(
          p.玉(0.035, [向き * 0.26, 0.16, -0.1], 要員色),
          p.玉(0.085, [向き * 0.29, 0.06, -0.1], 髪色, 2, [0.8, 1.3, 0.8]),
        );
      });
    }
    head.add(メッシュ(顔部品));

    return {
      leftLeg: 脚を作る(-0.15, 'leftLeg'),
      rightLeg: 脚を作る(0.15, 'rightLeg'),
      body,
      leftArm: 腕を作る(-0.36, 'leftArm', 0.16),
      rightArm: 腕を作る(0.36, 'rightArm', -0.16),
      head,
    };
  };

  return { 部位を作る };
};
