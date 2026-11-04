// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム草原の造形に使う、ローポリ調の部品づくりの共通処理。
//
// 球や円柱をそのまま並べると積み木に見えるため、
//   1. 同じ位置の頂点を溶接してから少しずつずらし（面は割れずに形だけが崩れる）
//   2. 面ごとに平らな法線を付け（絵本のような面の陰影）
//   3. 高さと面の向きから頂点色を付ける（光を増やさずに下を暗く、上を明るくする）
// の 3 段で「ローポリ部品」に仕上げ、最後に部品を 1 つのジオメトリへ結合して描画回数を抑える。
// ここで作るのは形と色だけで、位置や動きには関与しない。

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { type 造形ヘルパー } from './AIチーム_NPC型';

export type 乱数関数 = () => number;

/**
 * 面の色を決める。t は部品の高さを 0（下端）〜1（上端）に正規化した値、法線は面の向き、
 * 中心は面の重心（配置後の座標）
 */
export type 面色関数 = (
  t: number,
  法線: THREE.Vector3,
  乱数: 乱数関数,
  中心: THREE.Vector3,
) => THREE.ColorRepresentation;

export type 部品設定 = {
  /** 頂点をずらす最大量（元形の座標系での長さ） */
  揺らぎ?: number;
  /** 揺らぎの前に頂点を動かす（幹の根張りや曲がりなど） */
  変形?: (頂点: THREE.Vector3) => void;
  /** 揺らぎの後にかける配置（位置・回転・拡大） */
  変換?: THREE.Matrix4;
  /** 単色、または [下端の色, 上端の色] のグラデーション */
  色?: THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation];
  /** 色を面ごとに直接決める（指定すると 色 より優先） */
  面色?: 面色関数;
  /** 面ごとの明るさのばらつき（0〜1） */
  ばらつき?: number;
};

const 作業頂点 = new THREE.Vector3();
const 作業色 = new THREE.Color();
const 下色 = new THREE.Color();
const 上色 = new THREE.Color();
const 辺1 = new THREE.Vector3();
const 辺2 = new THREE.Vector3();
const 面法線 = new THREE.Vector3();
const 面中心 = new THREE.Vector3();
const 頂点A = new THREE.Vector3();
const 頂点B = new THREE.Vector3();
const 頂点C = new THREE.Vector3();

/** 配置行列を作る。回転はオイラー角（ラジアン）、拡大は数値なら等倍 */
export const 配置行列 = (
  位置: [number, number, number],
  回転: [number, number, number] = [0, 0, 0],
  拡大: number | [number, number, number] = 1,
): THREE.Matrix4 => {
  const scale = typeof 拡大 === 'number' ? new THREE.Vector3(拡大, 拡大, 拡大) : new THREE.Vector3(...拡大);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...位置),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...回転)),
    scale,
  );
};

/**
 * 元形をローポリ部品（位置・法線・頂点色だけを持つ非インデックス形状）に作り替える。
 * 元形はここで破棄する。
 */
export const ローポリ部品 = (
  元形: THREE.BufferGeometry,
  乱数: 乱数関数,
  設定: 部品設定 = {},
): THREE.BufferGeometry => {
  // UV と法線は捨て、位置だけで溶接する（UV の継ぎ目で頂点が分かれていると、ずらしたときに面が割れる）
  let 形 = new THREE.BufferGeometry();
  形.setAttribute('position', 元形.getAttribute('position').clone());
  if (元形.index) 形.setIndex(元形.index.clone());
  元形.dispose();
  const 溶接済み = mergeVertices(形, 1e-4);
  形.dispose();
  形 = 溶接済み;

  const 位置 = 形.getAttribute('position') as THREE.BufferAttribute;
  const 揺らぎ = 設定.揺らぎ ?? 0;
  for (let index = 0; index < 位置.count; index += 1) {
    作業頂点.fromBufferAttribute(位置, index);
    設定.変形?.(作業頂点);
    if (揺らぎ > 0) {
      作業頂点.x += (乱数() - 0.5) * 2 * 揺らぎ;
      作業頂点.y += (乱数() - 0.5) * 2 * 揺らぎ;
      作業頂点.z += (乱数() - 0.5) * 2 * 揺らぎ;
    }
    位置.setXYZ(index, 作業頂点.x, 作業頂点.y, 作業頂点.z);
  }
  if (設定.変換) 形.applyMatrix4(設定.変換);

  const 平面形 = 形.toNonIndexed();
  形.dispose();
  平面形.computeVertexNormals();
  平面形.computeBoundingBox();

  const 箱 = 平面形.boundingBox!;
  const 高さ = Math.max(箱.max.y - 箱.min.y, 1e-6);
  const 平面位置 = 平面形.getAttribute('position') as THREE.BufferAttribute;
  const 色配列 = new Float32Array(平面位置.count * 3);
  const 色 = 設定.色 ?? 0xffffff;
  if (Array.isArray(色)) {
    下色.set(色[0]);
    上色.set(色[1]);
  } else {
    下色.set(色);
    上色.set(色);
  }
  const ばらつき = 設定.ばらつき ?? 0.08;
  for (let 面 = 0; 面 < 平面位置.count; 面 += 3) {
    頂点A.fromBufferAttribute(平面位置, 面);
    頂点B.fromBufferAttribute(平面位置, 面 + 1);
    頂点C.fromBufferAttribute(平面位置, 面 + 2);
    const t = THREE.MathUtils.clamp(((頂点A.y + 頂点B.y + 頂点C.y) / 3 - 箱.min.y) / 高さ, 0, 1);
    if (設定.面色) {
      辺1.subVectors(頂点B, 頂点A);
      辺2.subVectors(頂点C, 頂点A);
      面法線.crossVectors(辺1, 辺2).normalize();
      面中心.copy(頂点A).add(頂点B).add(頂点C).divideScalar(3);
      作業色.set(設定.面色(t, 面法線, 乱数, 面中心));
    } else {
      作業色.copy(下色).lerp(上色, t);
    }
    const 明るさ = 1 + (乱数() - 0.5) * 2 * ばらつき;
    for (let 頂点 = 0; 頂点 < 3; 頂点 += 1) {
      const 位置番号 = (面 + 頂点) * 3;
      色配列[位置番号] = 作業色.r * 明るさ;
      色配列[位置番号 + 1] = 作業色.g * 明るさ;
      色配列[位置番号 + 2] = 作業色.b * 明るさ;
    }
  }
  平面形.setAttribute('color', new THREE.BufferAttribute(色配列, 3));
  return 平面形;
};

/** ローポリ部品を 1 つのジオメトリへ結合し、部品は破棄する */
export const 部品を結合 = (部品一覧: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const 結合 = mergeGeometries(部品一覧, false);
  部品一覧.forEach((部品) => 部品.dispose());
  if (!結合) throw new Error('ローポリ部品を結合できません');
  結合.computeBoundingSphere();
  return 結合;
};

/**
 * 結合済みの形の法線を、同じ位置の頂点どうしで平均してなめらかにする（頂点色はそのまま）。
 * 人形のようにやわらかく見せたい造形（要員）に使う
 */
export const 法線をなめらかにする = (形: THREE.BufferGeometry): THREE.BufferGeometry => {
  const 位置 = 形.getAttribute('position') as THREE.BufferAttribute;
  const 法線 = 形.getAttribute('normal') as THREE.BufferAttribute;
  const 合計 = new Map<string, THREE.Vector3>();
  const キー = (index: number) =>
    `${位置.getX(index).toFixed(4)},${位置.getY(index).toFixed(4)},${位置.getZ(index).toFixed(4)}`;
  for (let index = 0; index < 位置.count; index += 1) {
    const k = キー(index);
    const 和 = 合計.get(k) ?? new THREE.Vector3();
    和.x += 法線.getX(index);
    和.y += 法線.getY(index);
    和.z += 法線.getZ(index);
    合計.set(k, 和);
  }
  合計.forEach((和) => 和.normalize());
  for (let index = 0; index < 位置.count; index += 1) {
    const 和 = 合計.get(キー(index))!;
    法線.setXYZ(index, 和.x, 和.y, 和.z);
  }
  法線.needsUpdate = true;
  return 形;
};

/** 頂点色で塗るローポリ用マテリアル（色は頂点色が持つので素材色は白） */
export const 頂点色マテリアル = (
  ヘルパー: 造形ヘルパー,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial =>
  ヘルパー.マテリアル(0xffffff, {
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    ...options,
  });

// 分割数を減らした形の作り置き（同じ元形を共有するメッシュは同じ置き換え先を使う）
const 間引き済み = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** 球・カプセル・円柱の分割数を減らした同寸の形。対象外の形は null */
const 分割を減らす = (元形: THREE.BufferGeometry): THREE.BufferGeometry | null => {
  const 減 = (値: number, 下限: number) => Math.max(下限, Math.round(値 * 0.55));
  if (元形 instanceof THREE.SphereGeometry) {
    const p = 元形.parameters;
    return new THREE.SphereGeometry(
      p.radius,
      減(p.widthSegments, 6),
      減(p.heightSegments, 4),
      p.phiStart,
      p.phiLength,
      p.thetaStart,
      p.thetaLength,
    );
  }
  if (元形 instanceof THREE.CapsuleGeometry) {
    const p = 元形.parameters;
    return new THREE.CapsuleGeometry(p.radius, p.height, 減(p.capSegments, 2), 減(p.radialSegments, 6));
  }
  if (元形 instanceof THREE.CylinderGeometry && 元形.parameters.radialSegments > 8) {
    const p = 元形.parameters;
    return new THREE.CylinderGeometry(
      p.radiusTop,
      p.radiusBottom,
      p.height,
      減(p.radialSegments, 6),
      p.heightSegments,
      p.openEnded,
      p.thetaStart,
      p.thetaLength,
    );
  }
  return null;
};

/**
 * 既存の造形（NPC など）を、形と大きさを保ったままローポリ調にそろえる。
 * 照明を受ける材質に面の陰影を付け、丸い形の分割数を減らすだけで、部位の位置や回転には触れない。
 */
export const ローポリ調にそろえる = (対象: THREE.Object3D, ヘルパー: 造形ヘルパー) => {
  対象.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const 材質一覧 = Array.isArray(object.material) ? object.material : [object.material];
    const 照明を受ける = 材質一覧.every((material) => material instanceof THREE.MeshStandardMaterial);
    if (!照明を受ける) return;
    材質一覧.forEach((material: THREE.MeshStandardMaterial) => {
      if (material.flatShading) return;
      material.flatShading = true;
      material.needsUpdate = true;
    });
    const 元形 = object.geometry as THREE.BufferGeometry;
    let 新形 = 間引き済み.get(元形);
    if (!新形) {
      const 作成 = 分割を減らす(元形);
      if (!作成) return;
      新形 = ヘルパー.ジオメトリ(作成);
      間引き済み.set(元形, 新形);
    }
    object.geometry = 新形;
  });
};

/** 2 色を割合で混ぜた色 */
export const 色を混ぜる = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, 割合: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), 割合);
