// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム草原の建物・家具（テント・作業机・雑談テーブル・瞑想の座・石灯籠・ベンチ・
// ハンモック・焚き火跡・道標・柵・池の岸辺）のローポリ造形。
//
// どれも原点を足元の中心にした Group を返し、置き場所と向きは呼び出し側が決める。
// 寸法（座面・天板・座席の高さや大きさ）は従来の造形に合わせてあり、要員の座る位置や
// 生き物の通り道は変わらない。部品は 1 つのジオメトリへ結合し、発光する画面や灯りだけ別にする。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { type 造形ヘルパー, 乱数を作る } from './AIチーム_NPC型';
import {
  type 乱数関数,
  type 面色関数,
  ローポリ部品,
  色を混ぜる,
  部品を結合,
  配置行列,
  頂点色マテリアル,
} from './AIチーム_造形_共通';

type 三つ組 = [number, number, number];
type 色指定 = THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation];

const 木色 = { 明: 0xc4905a, 中: 0xa8743f, 濃: 0x7a5132, 樹皮: 0x5a3e29, 年輪: 0xd9b07a };
const 石色: [number, number] = [0x86857d, 0xc4c1b5];
const 布色 = 0xf3ead6;

/** 上を向いた面にだけ苔をのせた石 */
const 苔石: 面色関数 = (t, 法線, 乱数) =>
  法線.y > 0.55 && 乱数() < 0.4 ? 0x7d9a55 : 色を混ぜる(石色[0], 石色[1], t);

/** 切り株・丸太。上下の切り口は年輪色、側面は樹皮 */
const 切り株: 面色関数 = (_t, 法線) => (Math.abs(法線.y) > 0.8 ? 木色.年輪 : 木色.樹皮);

/** 1 つの家具を組み立てるための部品づくり。乱数は家具ごとに固定のシードで作る */
const 部品工房 = (乱数: 乱数関数) => {
  const 色設定 = (色: 色指定 | 面色関数) => (typeof 色 === 'function' ? { 面色: 色 } : { 色 });
  return {
    /** 角を面取りした箱 */
    箱: (寸法: 三つ組, 位置: 三つ組, 色: 色指定 | 面色関数, 回転: 三つ組 = [0, 0, 0], 面取り = 0.025) => {
      const 半最小 = Math.min(...寸法) / 2;
      return ローポリ部品(
        new RoundedBoxGeometry(寸法[0], 寸法[1], 寸法[2], 1, Math.min(面取り, 半最小 * 0.9)),
        乱数,
        { 変換: 配置行列(位置, 回転), ...色設定(色), ばらつき: 0.06 },
      );
    },
    /** 角柱・円柱（分割数が少ないほど角ばる） */
    柱: (
      上径: number,
      下径: number,
      高さ: number,
      位置: 三つ組,
      色: 色指定 | 面色関数,
      分割 = 6,
      回転: 三つ組 = [0, 0, 0],
      揺らぎ = 0,
    ) =>
      ローポリ部品(new THREE.CylinderGeometry(上径, 下径, 高さ, 分割, 1), 乱数, {
        揺らぎ,
        変換: 配置行列(位置, 回転),
        ...色設定(色),
        ばらつき: 0.06,
      }),
    /** 2 点を結ぶ棒（縄・骨・張り綱） */
    棒: (始点: 三つ組, 終点: 三つ組, 半径: number, 色: 色指定, 分割 = 5) => {
      const a = new THREE.Vector3(...始点);
      const b = new THREE.Vector3(...終点);
      const 方向 = b.clone().sub(a);
      const 長さ = 方向.length();
      const 向き = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), 方向.normalize());
      const 変換 = new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), 向き, new THREE.Vector3(1, 1, 1));
      return ローポリ部品(new THREE.CylinderGeometry(半径, 半径, 長さ, 分割, 1), 乱数, { 変換, 色 });
    },
    /** 崩した十二面体の石。大きさは半径 */
    石: (位置: 三つ組, 大きさ: number | 三つ組) =>
      ローポリ部品(new THREE.DodecahedronGeometry(1, 0), 乱数, {
        揺らぎ: 0.16,
        変換: 配置行列(位置, [乱数(), 乱数() * 3, 乱数()], 大きさ),
        面色: 苔石,
        ばらつき: 0.08,
      }),
    /** 小さな玉（取っ手・飾り・実など） */
    玉: (半径: number, 位置: 三つ組, 色: 色指定, 詳細 = 0, 拡大: number | 三つ組 = 1) =>
      ローポリ部品(new THREE.IcosahedronGeometry(半径, 詳細), 乱数, {
        変換: 配置行列(位置, [0, 0, 0], 拡大),
        色,
        ばらつき: 0.05,
      }),
  };
};

/** 縞模様の傘・屋根。法線の向き（方位）で区切って 2 色を交互に塗る */
const 縞塗り =
  (分割: number, 色A: THREE.ColorRepresentation, 色B: THREE.ColorRepresentation): 面色関数 =>
  (t, 法線) => {
    const 方位 = Math.atan2(法線.x, 法線.z) + Math.PI;
    const 区画 = Math.floor((方位 / (Math.PI * 2)) * 分割) % 2;
    return 色を混ぜる(区画 === 0 ? 色A : 色B, 0x000000, (1 - t) * 0.12);
  };

export type 建物造形 = {
  作業テント: (エリア色: number) => THREE.Group;
  作業机: (種: number) => THREE.Group;
  雑談テーブル: (エリア色: number) => THREE.Group;
  瞑想の座: (種: number) => THREE.Group;
  石灯籠: (種: number) => THREE.Group;
  ベンチ: (種: number) => THREE.Group;
  ハンモック: (布色: number) => THREE.Group;
  焚き火跡: (種: number) => THREE.Group;
  /** 矢印は向き（ラジアン、+z を 0 とした方位）とエリア色の組 */
  道標: (矢印: Array<{ 方位: number; 色: number }>) => THREE.Group;
  柵: (本数: number, 種: number) => THREE.Group;
  池の岸辺: (半径: number, 種: number) => THREE.Group;
};

export const 建物造形を作る = (ヘルパー: 造形ヘルパー): 建物造形 => {
  const 材 = 頂点色マテリアル(ヘルパー);
  const 両面材 = 頂点色マテリアル(ヘルパー, { side: THREE.DoubleSide });
  const 画面材 = ヘルパー.マテリアル(0x1d3c52, { emissive: 0x49d2ff, emissiveIntensity: 0.9, roughness: 0.25 });
  const 灯材 = ヘルパー.マテリアル(0xfff0c4, { emissive: 0xffc861, emissiveIntensity: 1.25, roughness: 0.4 });

  const 結合メッシュ = (部品: THREE.BufferGeometry[], 素材: THREE.Material = 材, 影を落とす = true) => {
    const mesh = new THREE.Mesh(ヘルパー.ジオメトリ(部品を結合(部品)), 素材);
    mesh.castShadow = 影を落とす;
    mesh.receiveShadow = true;
    return mesh;
  };

  const 作業テント = (エリア色: number) => {
    const 乱数 = 乱数を作る(4101);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    const 柱位置: [number, number][] = [
      [-4.4, -3.4],
      [4.4, -3.4],
      [-4.4, 3.6],
      [4.4, 3.6],
    ];
    柱位置.forEach(([px, pz]) => {
      部品.push(
        p.柱(0.075, 0.09, 2.75, [px, 1.375, pz], [木色.濃, 木色.中], 6),
        p.柱(0.17, 0.21, 0.12, [px, 0.06, pz], 石色, 6),
      );
      // 角から外へ張り綱を伸ばし、杭で留める
      const 長さ = Math.hypot(px, pz);
      const 杭: 三つ組 = [px + (px / 長さ) * 1.5, 0.06, pz + (pz / 長さ) * 1.5];
      部品.push(p.棒([px, 2.7, pz], 杭, 0.014, 0xd8c9a3, 3), p.箱([0.08, 0.2, 0.08], 杭, 木色.濃));
    });
    部品.push(
      p.箱([8.95, 0.12, 0.12], [0, 2.68, -3.4], [木色.濃, 木色.中]),
      p.箱([8.95, 0.12, 0.12], [0, 2.68, 3.6], [木色.濃, 木色.中]),
      p.玉(0.13, [0, 4.98, 0], 木色.中, 1),
      p.棒([0, 4.9, 0], [0, 5.65, 0], 0.025, 木色.濃, 4),
      p.箱([0.55, 0.3, 0.02], [0.29, 5.47, 0], エリア色),
    );
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));

    // 屋根: 16 分割の円錐を四角錐に寄せ、面の中ほどをたわませ、縁を波打たせて布に見せる
    const 屋根 = ローポリ部品(new THREE.ConeGeometry(6.4, 2.2, 16, 4, true), 乱数, {
      変形: (頂点) => {
        const 高さ比 = (頂点.y + 1.1) / 2.2;
        const 方位 = Math.atan2(頂点.z, 頂点.x);
        const 半径 = Math.hypot(頂点.x, 頂点.z);
        if (半径 > 1e-4) {
          const 菱形 = 1 / (Math.abs(Math.cos(方位)) + Math.abs(Math.sin(方位)));
          頂点.x *= 菱形;
          頂点.z *= 菱形;
        }
        const 辺の中ほど = 1 - Math.abs(Math.cos(2 * 方位));
        頂点.y -= 0.3 * 辺の中ほど * Math.sin(Math.PI * 高さ比);
        if (高さ比 < 0.02) 頂点.y -= 0.22 * 辺の中ほど;
      },
      変換: 配置行列([0, 3.8, 0], [0, Math.PI / 4, 0]),
      面色: 縞塗り(16, 色を混ぜる(エリア色, 0x2c6379, 0.35), 布色),
      ばらつき: 0.04,
    });
    group.add(結合メッシュ([屋根], 両面材));
    return group;
  };

  const 作業机 = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    // 天板は 3 枚の板を並べる
    [-0.35, 0, 0.35].forEach((z) => {
      const 色 = 色を混ぜる(木色.中, 木色.明, 乱数());
      部品.push(p.箱([2.2, 0.1, 0.34], [0, 0.95, z], [色を混ぜる(色, 0x000000, 0.15), 色], [0, 0, 0], 0.02));
    });
    部品.push(
      p.箱([2.0, 0.1, 0.06], [0, 0.85, -0.44], 木色.濃),
      p.箱([2.0, 0.1, 0.06], [0, 0.85, 0.44], 木色.濃),
      p.箱([1.8, 0.06, 0.06], [0, 0.25, 0], 木色.濃),
      p.箱([0.06, 0.06, 0.7], [-0.9, 0.25, 0], 木色.濃),
      p.箱([0.06, 0.06, 0.7], [0.9, 0.25, 0], 木色.濃),
    );
    [-0.9, 0.9].forEach((x) =>
      [-0.38, 0.38].forEach((z) => 部品.push(p.箱([0.1, 0.9, 0.1], [x, 0.45, z], [木色.樹皮, 木色.濃]))),
    );
    // モニター（縁と台）・キーボード・マウス
    部品.push(
      p.箱([1.16, 0.74, 0.06], [0, 1.42, -0.23], 0x2b3138, [0, 0, 0], 0.025),
      p.箱([0.08, 0.32, 0.06], [0, 1.14, -0.27], 0x3a4148),
      p.箱([0.42, 0.03, 0.22], [0, 1.015, -0.26], 0x3a4148),
      p.箱([0.56, 0.03, 0.2], [0.05, 1.015, 0.25], 0x404850),
      p.箱([0.5, 0.012, 0.15], [0.05, 1.035, 0.25], 0xd8dde2, [0, 0, 0], 0.005),
      p.玉(0.04, [0.45, 1.025, 0.27], 0xd8dde2, 0, [1, 0.55, 1.4]),
    );
    // 机の上の小物（書類・マグ・鉢植え）
    const マグ色 = [0xff8a65, 0x6fb7e8, 0xfdfdfd, 0xffd166][Math.floor(乱数() * 4)] ?? 0xff8a65;
    部品.push(
      p.箱([0.3, 0.02, 0.4], [-0.62, 1.01, -0.12], 0xf7f5ee, [0, 0.25, 0], 0.005),
      p.箱([0.3, 0.02, 0.4], [-0.6, 1.03, -0.1], 0xfffdf6, [0, 0.05, 0], 0.005),
      p.柱(0.055, 0.05, 0.12, [-0.75, 1.06, 0.3], マグ色, 8),
      p.柱(0.075, 0.055, 0.13, [0.85, 1.065, -0.3], [0x9c4f2c, 0xc8703f], 7),
      p.玉(0.12, [0.85, 1.2, -0.3], [0x3f7d3a, 0x7cc456], 1),
    );
    // 切り株の椅子
    部品.push(p.柱(0.3, 0.34, 0.52, [0, 0.26, 1.15], 切り株, 9, [0, 0, 0], 0.012));
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    const 画面 = new THREE.Mesh(ヘルパー.ジオメトリ(new THREE.PlaneGeometry(1.04, 0.62)), 画面材);
    画面.position.set(0, 1.42, -0.195);
    group.add(画面);
    return group;
  };

  const 雑談テーブル = (エリア色: number) => {
    const 乱数 = 乱数を作る(4301);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    部品.push(
      p.柱(1.6, 1.6, 0.1, [0, 0.8, 0], [木色.中, 木色.明], 14),
      p.柱(1.64, 1.6, 0.06, [0, 0.73, 0], 木色.濃, 14),
      p.柱(0.12, 0.18, 0.72, [0, 0.37, 0], 木色.濃, 6),
      p.箱([1.3, 0.08, 0.14], [0, 0.04, 0], 木色.濃),
      p.箱([1.3, 0.08, 0.14], [0, 0.04, 0], 木色.濃, [0, Math.PI / 2, 0]),
      p.柱(0.045, 0.045, 3.0, [0, 1.5, 0], 0xe8e2d0, 6),
      p.玉(0.09, [0, 3.44, 0], 木色.中, 1),
    );
    // パラソルの骨（12 本）
    const 骨数 = 12;
    for (let index = 0; index < 骨数; index += 1) {
      const 角度 = (index / 骨数) * Math.PI * 2;
      部品.push(p.棒([0, 3.36, 0], [Math.sin(角度) * 2.25, 2.4, Math.cos(角度) * 2.25], 0.012, 0xe8e2d0, 3));
    }
    // 丸太スツール（要員の立ち位置の内側）
    (
      [
        [-2.5, -1.1],
        [2.5, -1.1],
        [-2.5, 1.6],
        [2.5, 1.6],
        [0, -2.7],
        [0, 3.0],
      ] as [number, number][]
    ).forEach(([sx, sz]) => 部品.push(p.柱(0.3, 0.32, 0.48, [sx, 0.24, sz], 切り株, 9, [0, 乱数(), 0], 0.012)));
    // テーブルの上: マグ 3 つ、ティーポット、クッキーの皿
    (
      [
        [-0.5, 0.3, 0xff8a65],
        [0.55, -0.18, 0x6fb7e8],
        [0.1, 0.72, 0xfdfdfd],
      ] as [number, number, number][]
    ).forEach(([mx, mz, 色]) => {
      部品.push(p.柱(0.075, 0.065, 0.14, [mx, 0.92, mz], 色, 8), p.箱([0.03, 0.08, 0.06], [mx + 0.085, 0.93, mz], 色));
    });
    部品.push(
      p.玉(0.17, [-0.2, 1.0, -0.5], 0xf1ece0, 1, [1, 0.78, 1]),
      p.玉(0.07, [-0.2, 1.15, -0.5], 0xd9cfb8, 0),
      p.棒([-0.05, 0.98, -0.5], [0.1, 1.08, -0.5], 0.025, 0xf1ece0, 4),
      p.柱(0.24, 0.2, 0.025, [0.55, 0.865, 0.42], 0xfdfdfd, 10),
      p.柱(0.05, 0.05, 0.025, [0.5, 0.89, 0.38], 0xc98a4b, 7),
      p.柱(0.05, 0.05, 0.025, [0.62, 0.89, 0.45], 0xc98a4b, 7),
      p.柱(0.05, 0.05, 0.025, [0.54, 0.89, 0.52], 0xa0622f, 7),
    );
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    // パラソルの布: 骨と骨の間をたわませ、縁を波打たせる
    const 傘 = ローポリ部品(new THREE.ConeGeometry(2.3, 1.0, 骨数 * 2, 3, true), 乱数, {
      変形: (頂点) => {
        const 方位 = Math.atan2(頂点.x, 頂点.z);
        const 骨の間 = Math.abs(Math.sin((方位 * 骨数) / 2));
        const 高さ比 = (頂点.y + 0.5);
        頂点.y -= 0.08 * 骨の間 * (1 - 高さ比);
      },
      変換: 配置行列([0, 2.88, 0]),
      面色: 縞塗り(骨数, エリア色, 布色),
      ばらつき: 0.03,
    });
    group.add(結合メッシュ([傘], 両面材));
    return group;
  };

  const 瞑想の座 = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    部品.push(p.柱(1.75, 1.8, 0.1, [0, 0.05, 0], 苔石, 14, [0, 0, 0], 0.01));
    // 敷石の上に平たい飛び石を並べて、石畳らしい継ぎ目を出す
    for (let index = 0; index < 8; index += 1) {
      const 角度 = (index / 8) * Math.PI * 2 + 乱数() * 0.2;
      const 半径 = 0.3 + 乱数() * 0.12;
      部品.push(
        p.柱(半径, 半径 + 0.02, 0.04, [Math.cos(角度) * 1.18, 0.115, Math.sin(角度) * 1.18], [石色[1], 0xd8d4c8], 6, [0, 乱数(), 0], 0.02),
      );
    }
    // 座布団と丸い座蒲、四隅の房
    部品.push(
      p.箱([1.15, 0.13, 1.0], [0, 0.165, 0], [0xa86a2c, 0xdca25a], [0, 乱数() * 0.3, 0], 0.06),
      p.柱(0.42, 0.46, 0.13, [0, 0.29, 0], [0x8e3b3b, 0xc85a4a], 12),
    );
    [
      [-0.55, -0.48],
      [0.55, -0.48],
      [-0.55, 0.48],
      [0.55, 0.48],
    ].forEach(([tx, tz]) => 部品.push(p.玉(0.045, [tx!, 0.19, tz!], 0xffd27a, 0)));
    for (let index = 0; index < 9; index += 1) {
      const 角度 = (index / 9) * Math.PI * 2;
      const 大きさ = 0.15 + 乱数() * 0.1;
      部品.push(p.石([Math.cos(角度) * 1.62, 0.1, Math.sin(角度) * 1.62], [大きさ, 大きさ * 0.7, 大きさ]));
    }
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  const 石灯籠 = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    部品.push(
      p.柱(0.34, 0.4, 0.16, [0, 0.08, 0], 苔石, 6),
      p.柱(0.13, 0.15, 0.62, [0, 0.47, 0], 苔石, 6),
      p.柱(0.3, 0.16, 0.14, [0, 0.85, 0], 苔石, 6),
      p.箱([0.42, 0.05, 0.42], [0, 0.945, 0], 苔石),
    );
    // 火袋の四隅の柱（中の灯りは別の発光体）
    [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ].forEach(([fx, fz]) => 部品.push(p.箱([0.07, 0.3, 0.07], [fx!, 1.12, fz!], 苔石)));
    // 反りのある笠と宝珠
    部品.push(p.柱(0.08, 0.5, 0.2, [0, 1.37, 0], 苔石, 6));
    for (let index = 0; index < 6; index += 1) {
      const 角度 = (index / 6) * Math.PI * 2;
      部品.push(p.玉(0.05, [Math.sin(角度) * 0.5, 1.31, Math.cos(角度) * 0.5], 石色[1], 0, [1, 0.8, 1]));
    }
    部品.push(p.柱(0.05, 0.08, 0.08, [0, 1.5, 0], 苔石, 6), p.玉(0.075, [0, 1.6, 0], 石色[1], 1, [1, 1.3, 1]));
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    const 灯 = new THREE.Mesh(ヘルパー.ジオメトリ(new THREE.BoxGeometry(0.27, 0.26, 0.27)), 灯材);
    灯.position.y = 1.12;
    group.add(灯);
    return group;
  };

  const ベンチ = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    const 板色 = () => {
      const 色 = 色を混ぜる(木色.中, 木色.明, 乱数());
      return [色を混ぜる(色, 0x000000, 0.12), 色] as [THREE.Color, THREE.Color];
    };
    [-0.2, 0, 0.2].forEach((z) => 部品.push(p.箱([1.9, 0.05, 0.18], [0, 0.47, z], 板色(), [0, 0, 0], 0.015)));
    [0.66, 0.86].forEach((y) => 部品.push(p.箱([1.9, 0.12, 0.04], [0, y, -0.31], 板色(), [-0.12, 0, 0], 0.015)));
    [-0.8, 0.8].forEach((x) => {
      部品.push(
        p.箱([0.07, 0.44, 0.07], [x, 0.22, 0.22], 木色.濃),
        p.箱([0.07, 1.0, 0.07], [x, 0.5, -0.3], 木色.濃, [-0.06, 0, 0]),
        p.箱([0.07, 0.07, 0.6], [x, 0.41, 0], 木色.濃),
        p.箱([0.09, 0.05, 0.64], [x, 0.68, -0.02], 木色.中),
        p.箱([0.06, 0.24, 0.06], [x, 0.56, 0.25], 木色.濃),
      );
    });
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  const ハンモック = (帆布色: number) => {
    const 乱数 = 乱数を作る(4701);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    [-1.5, 1.5].forEach((x) => {
      部品.push(
        p.柱(0.09, 0.11, 1.75, [x, 0.875, 0], [木色.樹皮, 木色.濃], 6),
        p.玉(0.1, [x, 1.78, 0], 木色.中, 0),
        p.棒([x, 1.65, 0], [x * 0.8, 1.18, -0.5], 0.015, 0xd8c9a3, 3),
        p.棒([x, 1.65, 0], [x * 0.8, 1.18, 0.5], 0.015, 0xd8c9a3, 3),
        p.棒([x * 0.8, 1.18, -0.52], [x * 0.8, 1.18, 0.52], 0.025, 木色.中, 5),
      );
    });
    部品.push(p.玉(0.18, [-0.85, 0.98, 0], 布色, 1, [1, 0.5, 1.4]));
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    // 布: 長さ方向に垂れ、幅方向は両端が持ち上がる。帯状の縞を入れる
    const 布形 = new THREE.PlaneGeometry(2.4, 1.0, 16, 6);
    布形.rotateX(-Math.PI / 2);
    const 縞色 = [帆布色, 布色, 0xffb35c, 布色, 帆布色];
    const 布 = ローポリ部品(布形, 乱数, {
      変形: (頂点) => {
        頂点.y = 0.8 + 0.4 * (頂点.x / 1.2) ** 2 + 0.22 * (頂点.z / 0.5) ** 2;
      },
      面色: (_t, _法線, _乱数, 中心) => 縞色[Math.min(4, Math.floor((中心.z + 0.5) * 5))] ?? 帆布色,
      ばらつき: 0.03,
    });
    group.add(結合メッシュ([布], 両面材));
    return group;
  };

  const 焚き火跡 = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [p.柱(0.55, 0.6, 0.03, [0, 0.015, 0], [0x5f5a54, 0x8f8a83], 10)];
    for (let index = 0; index < 7; index += 1) {
      const 角度 = (index / 7) * Math.PI * 2;
      const 大きさ = 0.16 + 乱数() * 0.06;
      部品.push(p.石([Math.cos(角度) * 0.66, 0.09, Math.sin(角度) * 0.66], [大きさ, 大きさ * 0.75, 大きさ]));
    }
    for (let index = 0; index < 3; index += 1) {
      部品.push(
        p.柱(0.07, 0.07, 0.9, [0, 0.14, 0], [0x2b2420, 0x5a4030], 6, [Math.PI / 2.4, (index / 3) * Math.PI, 0]),
      );
    }
    for (let index = 0; index < 5; index += 1) {
      部品.push(p.玉(0.04, [(乱数() - 0.5) * 0.5, 0.04, (乱数() - 0.5) * 0.5], 0x22201e, 0));
    }
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  const 道標 = (矢印: Array<{ 方位: number; 色: number }>) => {
    const 乱数 = 乱数を作る(4901);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [
      p.柱(0.09, 0.11, 2.3, [0, 1.15, 0], [木色.樹皮, 木色.濃], 6),
      p.柱(0.0, 0.15, 0.22, [0, 2.41, 0], 木色.濃, 6),
    ];
    const 先端形 = new THREE.Shape();
    先端形.moveTo(0.74, -0.13);
    先端形.lineTo(0.96, 0);
    先端形.lineTo(0.74, 0.13);
    先端形.closePath();
    矢印.forEach(({ 方位, 色 }, index) => {
      // 板は +x 向きに作るので、方位（+z 基準）から 90° 戻して向ける
      const 向き = new THREE.Matrix4()
        .makeRotationY(方位 - Math.PI / 2)
        .multiply(new THREE.Matrix4().makeTranslation(0, 1.95 - index * 0.32, 0));
      部品.push(
        ローポリ部品(new RoundedBoxGeometry(0.66, 0.2, 0.05, 1, 0.015), 乱数, {
          変換: 向き.clone().multiply(new THREE.Matrix4().makeTranslation(0.42, 0, 0)),
          色: [木色.中, 木色.明],
        }),
        ローポリ部品(new THREE.ExtrudeGeometry(先端形, { depth: 0.05, bevelEnabled: false }), 乱数, {
          変換: 向き.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.025)),
          色,
        }),
      );
    });
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  const 柵 = (本数: number, 種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [];
    const 古び = () => 色を混ぜる(0x8c6c4a, 0xc4a27a, 乱数());
    for (let index = 0; index < 本数; index += 1) {
      const 傾き: 三つ組 = [(乱数() - 0.5) * 0.06, 0, (乱数() - 0.5) * 0.06];
      部品.push(
        p.柱(0.06, 0.07, 0.95, [index * 1.5, 0.475, 0], 古び(), 5, 傾き),
        p.柱(0.0, 0.06, 0.14, [index * 1.5, 1.02, 0], 古び(), 5),
      );
      if (index < 本数 - 1) {
        [0.72, 0.42].forEach((y) =>
          部品.push(
            p.箱([1.55, 0.1, 0.05], [index * 1.5 + 0.75, y + (乱数() - 0.5) * 0.04, 0.05], 古び(), [0, 0, (乱数() - 0.5) * 0.05], 0.015),
          ),
        );
      }
    }
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  const 池の岸辺 = (半径: number, 種: number) => {
    const 乱数 = 乱数を作る(種);
    const p = 部品工房(乱数);
    const 部品: THREE.BufferGeometry[] = [
      // 上面は水面のすぐ下にあるので、頂点を崩すと水面を突き抜ける。岸は崩さない
      p.柱(半径 + 0.35, 半径 + 0.5, 0.12, [0, 0.02, 0], [0xa8986f, 0xcdbd93], 36),
    ];
    for (let index = 0; index < 8; index += 1) {
      const 角度 = (index / 8) * Math.PI * 2 + 乱数();
      const 大きさ = 0.16 + 乱数() * 0.14;
      部品.push(p.石([Math.cos(角度) * (半径 + 0.42), 0.1, Math.sin(角度) * (半径 + 0.42)], [大きさ, 大きさ * 0.7, 大きさ]));
    }
    // 岸の葦とガマの穂
    for (let index = 0; index < 14; index += 1) {
      const 角度 = 乱数() * Math.PI * 2;
      const 距離 = 半径 + 0.15 + 乱数() * 0.5;
      const x = Math.cos(角度) * 距離;
      const z = Math.sin(角度) * 距離;
      const 高さ = 0.7 + 乱数() * 0.45;
      const 先: 三つ組 = [x + (乱数() - 0.5) * 0.15, 高さ, z + (乱数() - 0.5) * 0.15];
      部品.push(p.棒([x, 0, z], 先, 0.014, [0x3b7433, 0x7fb85a], 3));
      if (乱数() > 0.45) {
        部品.push(p.柱(0.035, 0.035, 0.16, [先[0], 高さ - 0.1, 先[2]], 0x6b4a2e, 6));
      }
    }
    // 水に浮かぶ睡蓮の葉（切れ込みのある円）と花
    for (let index = 0; index < 6; index += 1) {
      const 角度 = 乱数() * Math.PI * 2;
      const 距離 = 半径 * (0.3 + 乱数() * 0.5);
      const 大きさ = 0.16 + 乱数() * 0.1;
      const x = Math.cos(角度) * 距離;
      const z = Math.sin(角度) * 距離;
      部品.push(
        ローポリ部品(new THREE.CircleGeometry(大きさ, 9, 0.4, Math.PI * 2 - 0.5), 乱数, {
          変換: 配置行列([x, 0.1, z], [-Math.PI / 2, 0, 乱数() * 6]),
          色: [0x3f7d3a, 0x6fae4f],
        }),
      );
      if (index % 3 === 0) 部品.push(p.玉(0.05, [x, 0.13, z], [0xf08cb0, 0xffd0e0], 0, [1, 0.6, 1]));
    }
    const group = new THREE.Group();
    group.add(結合メッシュ(部品));
    return group;
  };

  return {
    作業テント,
    作業机,
    雑談テーブル,
    瞑想の座,
    石灯籠,
    ベンチ,
    ハンモック,
    焚き火跡,
    道標,
    柵,
    池の岸辺,
  };
};
