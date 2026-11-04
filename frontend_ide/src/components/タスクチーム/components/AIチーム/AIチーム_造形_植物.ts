// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム草原の植物と石（木・サボテン・茂み・花畑・石）のローポリ造形。
//
// 木は 広葉樹 / 実のなる木 / 針葉樹 / 白樺 の 4 種 × 4 形を作り置きして使い回す。
// どの種・形にするかはシードで決まるので、同じシードなら毎回同じ木になる。
// 置き場所・大きさ・向きは呼び出し側（AIチーム_空間表示.vue）が決め、ここは形と色だけを持つ。

import * as THREE from 'three';

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

type 木の種類 = '広葉樹' | '実のなる木' | '針葉樹' | '白樺';

const 木の形数 = 4;
const 種類番号: Record<木の種類, number> = { 広葉樹: 1, 実のなる木: 2, 針葉樹: 3, 白樺: 4 };

const 幹色: [number, number] = [0x4a3221, 0x8a6446];
const 花びら色 = [0xffe066, 0xff9ec0, 0xfdfdfd, 0xc79bff, 0xff8a65, 0x9fd0ff];

/** 枝を付け根から外へ傾けて生やす配置 */
const 枝の配置 = (根元: THREE.Vector3, 方角: number, 傾き: number, 長さ: number) =>
  new THREE.Matrix4()
    .makeTranslation(根元.x, 根元.y, 根元.z)
    .multiply(new THREE.Matrix4().makeRotationY(方角))
    .multiply(new THREE.Matrix4().makeRotationZ(-傾き))
    .multiply(new THREE.Matrix4().makeTranslation(0, 長さ / 2, 0));

/** 根張りと曲がりのある幹。高さ方向の割合 t（0〜1）に応じて頂点を動かす */
const 幹を作る = (
  乱数: 乱数関数,
  寸法: { 上径: number; 下径: number; 高さ: number; 曲がり: number; 方角: number; 根張り: number },
  色: 面色関数 | [number, number] = 幹色,
) => {
  const { 上径, 下径, 高さ, 曲がり, 方角, 根張り } = 寸法;
  return ローポリ部品(new THREE.CylinderGeometry(上径, 下径, 高さ, 7, 6), 乱数, {
    変形: (頂点) => {
      const t = (頂点.y + 高さ / 2) / 高さ;
      const 張り = t < 0.16 ? 1 + ((0.16 - t) / 0.16) * 根張り : 1;
      頂点.x = 頂点.x * 張り + Math.cos(方角) * 曲がり * t * t;
      頂点.z = 頂点.z * 張り + Math.sin(方角) * 曲がり * t * t;
      頂点.y += 高さ / 2;
    },
    揺らぎ: 0.02,
    ...(typeof 色 === 'function' ? { 面色: 色 } : { 色 }),
    ばらつき: 0.1,
  });
};

/** 幹の先端（曲がりを反映した位置） */
const 幹の先端 = (高さ: number, 曲がり: number, 方角: number) =>
  new THREE.Vector3(Math.cos(方角) * 曲がり, 高さ, Math.sin(方角) * 曲がり);

/** もこもこした葉の塊（崩した二十面体） */
const 葉の塊 = (
  乱数: 乱数関数,
  中心: THREE.Vector3,
  半径: number,
  色: [THREE.ColorRepresentation, THREE.ColorRepresentation],
  縦横比 = 0.88,
) =>
  ローポリ部品(new THREE.IcosahedronGeometry(1, 1), 乱数, {
    揺らぎ: 0.11,
    変換: 配置行列([中心.x, 中心.y, 中心.z], [乱数(), 乱数() * 3, 乱数()], [半径, 半径 * 縦横比, 半径]),
    色,
    ばらつき: 0.09,
  });

const 広葉樹の形 = (乱数: 乱数関数, 実あり: boolean) => {
  const 部品: THREE.BufferGeometry[] = [];
  const 方角 = 乱数() * Math.PI * 2;
  const 曲がり = 0.08 + 乱数() * 0.16;
  const 幹高 = 2.1;
  部品.push(幹を作る(乱数, { 上径: 0.11, 下径: 0.2, 高さ: 幹高, 曲がり, 方角, 根張り: 0.75 }));
  const 枝数 = 2 + Math.floor(乱数() * 2);
  for (let index = 0; index < 枝数; index += 1) {
    const 長さ = 0.65 + 乱数() * 0.35;
    const 枝方角 = (index / 枝数) * Math.PI * 2 + 乱数() * 0.8;
    const 根元 = 幹の先端(1.15 + 乱数() * 0.45, 曲がり * 0.5, 方角);
    部品.push(
      ローポリ部品(new THREE.CylinderGeometry(0.035, 0.065, 長さ, 5), 乱数, {
        変換: 枝の配置(根元, 枝方角, 0.75 + 乱数() * 0.35, 長さ),
        色: 幹色,
      }),
    );
  }
  // 葉は下を暗く上を明るく。木ごとに緑の色味を少しずらす
  const 色味 = 乱数();
  const 葉色: [THREE.Color, THREE.Color] = [
    色を混ぜる(0x2c6431, 0x47722a, 色味),
    色を混ぜる(0x78c257, 0xa9d65f, 色味),
  ];
  const 頂 = 幹の先端(幹高, 曲がり, 方角);
  部品.push(葉の塊(乱数, 頂.clone().add(new THREE.Vector3(0, 0.45, 0)), 1.0, 葉色));
  const 塊数 = 4 + Math.floor(乱数() * 3);
  for (let index = 0; index < 塊数; index += 1) {
    const 角度 = (index / 塊数) * Math.PI * 2 + 乱数() * 0.6;
    const 距離 = 0.55 + 乱数() * 0.35;
    const 中心 = new THREE.Vector3(
      頂.x + Math.cos(角度) * 距離,
      2.1 + 乱数() * 0.85,
      頂.z + Math.sin(角度) * 距離,
    );
    部品.push(葉の塊(乱数, 中心, 0.5 + 乱数() * 0.3, 葉色));
  }
  if (実あり) {
    const 実数 = 6 + Math.floor(乱数() * 4);
    for (let index = 0; index < 実数; index += 1) {
      const 角度 = 乱数() * Math.PI * 2;
      const 仰角 = -0.2 + 乱数() * 0.9;
      const 位置 = 頂.clone().add(
        new THREE.Vector3(
          Math.cos(角度) * Math.cos(仰角) * 1.05,
          0.45 + Math.sin(仰角) * 0.92,
          Math.sin(角度) * Math.cos(仰角) * 1.05,
        ),
      );
      部品.push(
        ローポリ部品(new THREE.IcosahedronGeometry(0.075, 0), 乱数, {
          変換: 配置行列([位置.x, 位置.y, 位置.z]),
          色: [0xa8261c, 0xe0503a],
          ばらつき: 0.05,
        }),
      );
    }
  }
  return 部品を結合(部品);
};

const 針葉樹の形 = (乱数: 乱数関数) => {
  const 部品: THREE.BufferGeometry[] = [];
  部品.push(
    幹を作る(乱数, { 上径: 0.08, 下径: 0.17, 高さ: 1.5, 曲がり: 0.03, 方角: 乱数() * 6, 根張り: 0.6 }),
  );
  const 段数 = 4;
  const 色味 = 乱数();
  for (let index = 0; index < 段数; index += 1) {
    const 半径 = 1.25 * (1 - index * 0.2) * (0.92 + 乱数() * 0.16);
    const 高さ = 1.25 - index * 0.08;
    const 底 = 0.75 + index * 0.62;
    部品.push(
      ローポリ部品(new THREE.ConeGeometry(半径, 高さ, 8, 2), 乱数, {
        揺らぎ: 0.06,
        変換: 配置行列(
          [(乱数() - 0.5) * 0.08, 底 + 高さ / 2, (乱数() - 0.5) * 0.08],
          [(乱数() - 0.5) * 0.08, 乱数() * 3, (乱数() - 0.5) * 0.08],
        ),
        色: [
          色を混ぜる(0x1e4a33, 0x2f5a2e, 色味).lerp(new THREE.Color(0x3c7a45), index * 0.08),
          色を混ぜる(0x4f8f52, 0x6f9f4c, 色味).lerp(new THREE.Color(0x86b866), index * 0.08),
        ],
        ばらつき: 0.07,
      }),
    );
  }
  return 部品を結合(部品);
};

const 白樺の形 = (乱数: 乱数関数) => {
  const 部品: THREE.BufferGeometry[] = [];
  // 白い樹皮に、ところどころ黒い横筋（皮目）を入れる
  const 樹皮 = (_t: number, _法線: THREE.Vector3, 面乱数: 乱数関数) =>
    面乱数() < 0.17 ? 0x3b3833 : 0xebe7dc;
  const 方角 = 乱数() * Math.PI * 2;
  const 曲がり = 0.1 + 乱数() * 0.12;
  const 幹高 = 2.7;
  部品.push(幹を作る(乱数, { 上径: 0.07, 下径: 0.13, 高さ: 幹高, 曲がり, 方角, 根張り: 0.4 }, 樹皮));
  if (乱数() > 0.45) {
    // 根元から細い 2 本目の幹を斜めに出す
    const 副幹 = 幹を作る(
      乱数,
      { 上径: 0.05, 下径: 0.09, 高さ: 2.0, 曲がり: 0.1, 方角: 方角 + Math.PI, 根張り: 0.2 },
      樹皮,
    );
    副幹.applyMatrix4(配置行列([0.12, 0, 0.05], [0.12, 方角, -0.18]));
    部品.push(副幹);
  }
  const 頂 = 幹の先端(幹高, 曲がり, 方角);
  const 葉色: [number, number] = [0x5a9440, 0xc2dc72];
  const 塊数 = 5 + Math.floor(乱数() * 2);
  for (let index = 0; index < 塊数; index += 1) {
    const 角度 = (index / 塊数) * Math.PI * 2 + 乱数() * 0.7;
    const 距離 = index === 0 ? 0 : 0.35 + 乱数() * 0.3;
    部品.push(
      葉の塊(
        乱数,
        new THREE.Vector3(
          頂.x + Math.cos(角度) * 距離,
          2.35 + 乱数() * 0.95,
          頂.z + Math.sin(角度) * 距離,
        ),
        0.42 + 乱数() * 0.22,
        葉色,
        1.05,
      ),
    );
  }
  return 部品を結合(部品);
};

const サボテンの形 = (乱数: 乱数関数) => {
  const 部品: THREE.BufferGeometry[] = [];
  const 色: [number, number] = [0x2c6640, 0x62a466];
  // 8 角の縦割りがそのまま畝に見えるよう、面の平らな陰影を生かす
  部品.push(
    ローポリ部品(new THREE.CapsuleGeometry(0.22, 0.9, 3, 8), 乱数, {
      揺らぎ: 0.012,
      変換: 配置行列([0, 0.67, 0]),
      色,
      ばらつき: 0.05,
    }),
  );
  const 腕数 = Math.floor(乱数() * 3);
  for (let index = 0; index < 腕数; index += 1) {
    const 向き = index === 0 ? 1 : -1;
    const 高さ = 0.6 + 乱数() * 0.3;
    const 立ち上がり = 0.32 + 乱数() * 0.2;
    // 横へ出てから上へ曲がる L 字の腕
    部品.push(
      ローポリ部品(new THREE.CapsuleGeometry(0.11, 0.22, 2, 7), 乱数, {
        変換: 配置行列([向き * 0.3, 高さ, 0], [0, 0, Math.PI / 2]),
        色,
        ばらつき: 0.05,
      }),
      ローポリ部品(new THREE.CapsuleGeometry(0.11, 立ち上がり, 2, 7), 乱数, {
        変換: 配置行列([向き * 0.44, 高さ + 立ち上がり / 2 + 0.02, 0]),
        色,
        ばらつき: 0.05,
      }),
    );
  }
  if (乱数() > 0.5) {
    部品.push(
      ローポリ部品(new THREE.IcosahedronGeometry(0.1, 0), 乱数, {
        変換: 配置行列([0, 1.36, 0], [0, 0, 0], [1, 0.6, 1]),
        色: [0xe0568a, 0xff9ec0],
      }),
    );
  }
  return 部品を結合(部品);
};

const 茂みの形 = (乱数: 乱数関数) => {
  const 部品: THREE.BufferGeometry[] = [];
  const 色味 = 乱数();
  const 葉色: [THREE.Color, THREE.Color] = [
    色を混ぜる(0x2a6030, 0x3f6b2a, 色味),
    色を混ぜる(0x6fb84f, 0x9ccc5a, 色味),
  ];
  const 塊数 = 3 + Math.floor(乱数() * 3);
  const 中心一覧: THREE.Vector3[] = [];
  for (let index = 0; index < 塊数; index += 1) {
    const 中心 = new THREE.Vector3((乱数() - 0.5) * 0.8, 0.3 + 乱数() * 0.16, (乱数() - 0.5) * 0.8);
    中心一覧.push(中心);
    部品.push(葉の塊(乱数, 中心, 0.42 + 乱数() * 0.22, 葉色, 0.8));
  }
  if (乱数() < 0.4) {
    // ときどき実や小花を付ける
    const 実色 = [0xd8323a, 0xfdfdfd, 0xff9ec0][Math.floor(乱数() * 3)] ?? 0xd8323a;
    for (let index = 0; index < 7; index += 1) {
      const 基準 = 中心一覧[index % 中心一覧.length]!;
      const 角度 = 乱数() * Math.PI * 2;
      部品.push(
        ローポリ部品(new THREE.IcosahedronGeometry(0.05, 0), 乱数, {
          変換: 配置行列([
            基準.x + Math.cos(角度) * 0.42,
            基準.y + 0.1 + 乱数() * 0.2,
            基準.z + Math.sin(角度) * 0.42,
          ]),
          色: 実色,
        }),
      );
    }
  }
  return 部品を結合(部品);
};

const 石の形 = (乱数: 乱数関数) =>
  ローポリ部品(new THREE.DodecahedronGeometry(0.42, 0), 乱数, {
    揺らぎ: 0.08,
    // 上を向いた面にだけ、ところどころ苔をのせる
    面色: (t, 法線, 面乱数) =>
      法線.y > 0.55 && 面乱数() < 0.45 ? 0x7d9a55 : 色を混ぜる(0x767d78, 0xb8bdb6, t),
    ばらつき: 0.08,
  });

export type 植物造形 = {
  木: (種: number) => THREE.Mesh;
  サボテン: (種: number) => THREE.Mesh;
  茂み: (種: number) => THREE.Mesh;
  花畑: (半径: number, 本数: number, 種: number) => THREE.Mesh;
  石: (種: number) => THREE.Mesh;
};

export const 植物造形を作る = (ヘルパー: 造形ヘルパー): 植物造形 => {
  const 材 = 頂点色マテリアル(ヘルパー);
  const 花材 = 頂点色マテリアル(ヘルパー, { roughness: 0.75 });
  const 石材 = 頂点色マテリアル(ヘルパー, { roughness: 0.92 });
  const 形キャッシュ = new Map<string, THREE.BufferGeometry>();

  // 種類と形番号ごとに 1 度だけ作り、同じ形の木はジオメトリを共有する
  const 形を取得 = (キー: string, シード: number, 作る: (乱数: 乱数関数) => THREE.BufferGeometry) => {
    const 既存 = 形キャッシュ.get(キー);
    if (既存) return 既存;
    const 形 = ヘルパー.ジオメトリ(作る(乱数を作る(シード)));
    形キャッシュ.set(キー, 形);
    return 形;
  };

  const 影付き = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const 木 = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const くじ = 乱数();
    const 種類: 木の種類 =
      くじ < 0.55 ? '広葉樹' : くじ < 0.68 ? '実のなる木' : くじ < 0.86 ? '針葉樹' : '白樺';
    const 形番号 = Math.floor(乱数() * 木の形数);
    const 形 = 形を取得(`木-${種類}-${形番号}`, 種類番号[種類] * 1000 + 形番号 * 17 + 3, (形乱数) => {
      if (種類 === '針葉樹') return 針葉樹の形(形乱数);
      if (種類 === '白樺') return 白樺の形(形乱数);
      return 広葉樹の形(形乱数, 種類 === '実のなる木');
    });
    const mesh = 影付き(new THREE.Mesh(形, 材));
    mesh.rotation.y = 乱数() * Math.PI * 2;
    return mesh;
  };

  const サボテン = (種: number) => {
    const 乱数 = 乱数を作る(種);
    const 形番号 = Math.floor(乱数() * 3);
    const 形 = 形を取得(`サボテン-${形番号}`, 5000 + 形番号 * 17, サボテンの形);
    const mesh = 影付き(new THREE.Mesh(形, 材));
    mesh.rotation.y = 乱数() * Math.PI * 2;
    return mesh;
  };

  const 茂み = (種: number) => {
    const 形 = 形を取得(`茂み-${種}`, 種, 茂みの形);
    return 影付き(new THREE.Mesh(形, 材));
  };

  const 花畑 = (半径: number, 本数: number, 種: number) => {
    const 乱数 = 乱数を作る(種);
    const 部品: THREE.BufferGeometry[] = [];
    for (let index = 0; index < 本数; index += 1) {
      const 角度 = 乱数() * Math.PI * 2;
      const 距離 = 乱数() * 半径;
      const fx = Math.cos(角度) * 距離;
      const fz = Math.sin(角度) * 距離;
      const 茎高 = 0.22 + 乱数() * 0.16;
      const 花色 = 花びら色[Math.floor(乱数() * 花びら色.length)] ?? 0xffe066;
      const 傾き: [number, number, number] = [(乱数() - 0.5) * 0.25, 0, (乱数() - 0.5) * 0.25];
      部品.push(
        ローポリ部品(new THREE.CylinderGeometry(0.012, 0.016, 茎高, 3), 乱数, {
          変換: 配置行列([fx, 茎高 / 2, fz], 傾き),
          色: [0x3e7a38, 0x5d9b45],
        }),
        // 逆さの円錐を花びらの杯に見立て、中心に花芯を置く
        ローポリ部品(new THREE.ConeGeometry(0.1, 0.07, 6, 1), 乱数, {
          揺らぎ: 0.01,
          変換: 配置行列([fx, 茎高 + 0.02, fz], [Math.PI + 傾き[0], 乱数() * 3, 傾き[2]], 0.9 + 乱数() * 0.5),
          色: [色を混ぜる(花色, 0x000000, 0.25), 花色],
          ばらつき: 0.05,
        }),
        ローポリ部品(new THREE.IcosahedronGeometry(0.032, 0), 乱数, {
          変換: 配置行列([fx, 茎高 + 0.05, fz]),
          色: 花色 === 0xffe066 ? 0xd9822b : 0xffd23f,
        }),
      );
      if (乱数() > 0.4) {
        部品.push(
          ローポリ部品(new THREE.ConeGeometry(0.05, 0.32, 3, 1), 乱数, {
            変換: 配置行列(
              [fx + (乱数() - 0.5) * 0.3, 0.15, fz + (乱数() - 0.5) * 0.3],
              [(乱数() - 0.5) * 0.5, 乱数() * 3, (乱数() - 0.5) * 0.5],
            ),
            色: [0x3b7433, 0x8fcb5f],
          }),
        );
      }
    }
    const mesh = new THREE.Mesh(ヘルパー.ジオメトリ(部品を結合(部品)), 花材);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const 石 = (種: number) => {
    const 形番号 = 種 % 6;
    const 形 = 形を取得(`石-${形番号}`, 6000 + 形番号 * 17, 石の形);
    return 影付き(new THREE.Mesh(形, 石材));
  };

  return { 木, サボテン, 茂み, 花畑, 石 };
};
