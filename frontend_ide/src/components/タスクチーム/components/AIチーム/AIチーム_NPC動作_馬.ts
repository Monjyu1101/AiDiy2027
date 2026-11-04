// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// NPC馬の造形と周回動作。
// カメラから見て4エリアの向こう側を放牧エリアにし、黒馬・白馬が自由に行動する。
// 白馬は普段は独立して動き、黒馬から離れたときだけ走って追従する。

import * as THREE from 'three';

import type {
  NPC定義,
  NPC個体,
  NPC更新引数,
  NPC配置,
  手動操作状態,
  造形ヘルパー,
} from './AIチーム_NPC型';
import { 乱数を作る } from './AIチーム_NPC型';
import { ローポリ部品, 色を混ぜる, 部品を結合, 配置行列, 頂点色マテリアル } from './AIチーム_造形_共通';

type 馬状態 = '走る' | '歩く' | 'とどまる';

type 馬設定 = {
  役割: '先導' | '追従';
  体色: number;
  たてがみ色: number;
  蹄色: number;
  基準距離: number;
  放牧半径: number;
  追従開始距離: number;
  追従終了距離: number;
  追跡対象: THREE.Group | null;
};

const 共通設定: Omit<馬設定, '役割' | '体色' | 'たてがみ色' | '蹄色'> = {
  基準距離: 34,
  放牧半径: 10,
  追従開始距離: 14,
  追従終了距離: 7,
  追跡対象: null,
};

const 最小中心距離 = 27;

/** 首の付け根の基準姿勢。歩くリズムに合わせてこの前後に振る */
const 首基準角 = -0.46;
const 首基準Z = -0.72;

/** 俯瞰カメラから見て4エリアの向こう側にある放牧エリア中心 */
const 基準位置 = (俯瞰位置: THREE.Vector3, 設定: 馬設定) => {
  const カメラ方向 = new THREE.Vector3(俯瞰位置.x, 0, 俯瞰位置.z);
  if (カメラ方向.lengthSq() < 0.01) カメラ方向.set(0, 0, 1);
  return カメラ方向.normalize().multiplyScalar(-設定.基準距離);
};

/** 中央の4エリアへ近づきすぎない、基準位置周辺のランダムな目的地 */
const 放牧目的地 = (基準: THREE.Vector3, 設定: 馬設定, 広がり = 1) => {
  const 角度 = Math.random() * Math.PI * 2;
  const 距離 = (2 + Math.random() * (設定.放牧半径 - 2)) * 広がり;
  const 目的地 = 基準.clone().add(new THREE.Vector3(Math.cos(角度) * 距離, 0, Math.sin(角度) * 距離));
  if (目的地.length() < 最小中心距離) 目的地.setLength(最小中心距離);
  return 目的地;
};

const 馬体を作る = (ヘルパー: 造形ヘルパー, 設定: 馬設定) => {
  const 材 = 頂点色マテリアル(ヘルパー, { roughness: 0.8 });
  const 乱数 = 乱数を作る(設定.体色 % 100000);
  const 体色 = new THREE.Color(設定.体色);
  const 影色 = 色を混ぜる(体色, 0x000000, 0.25);
  const 明色 = 色を混ぜる(体色, 0xffffff, 0.12);
  const 鼻面色 = 色を混ぜる(体色, 0x5a4a44, 0.35);
  const メッシュ = (部品: THREE.BufferGeometry[]) => new THREE.Mesh(ヘルパー.ジオメトリ(部品を結合(部品)), 材);
  const 玉 = (
    半径: number,
    位置: [number, number, number],
    色: THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation],
    拡大: number | [number, number, number] = 1,
    回転: [number, number, number] = [0, 0, 0],
    詳細 = 1,
  ) =>
    ローポリ部品(new THREE.IcosahedronGeometry(半径, 詳細), 乱数, {
      変換: 配置行列(位置, 回転, 拡大),
      色,
      ばらつき: 0.04,
    });
  const 筒 = (
    上径: number,
    下径: number,
    高さ: number,
    位置: [number, number, number],
    色: THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation],
    回転: [number, number, number] = [0, 0, 0],
    分割 = 7,
  ) =>
    ローポリ部品(new THREE.CylinderGeometry(上径, 下径, 高さ, 分割, 2), 乱数, {
      変換: 配置行列(位置, 回転),
      色,
      ばらつき: 0.04,
    });

  const group = new THREE.Group();
  group.scale.setScalar(1.18);

  // 胴（上下に弾ませるのはこの Group）。樽形の胴に、胸と尻の張りを足す
  const 胴 = new THREE.Group();
  胴.position.y = 1.42;
  胴.add(
    メッシュ([
      ローポリ部品(new THREE.CapsuleGeometry(0.48, 1.45, 3, 10), 乱数, {
        変換: 配置行列([0, 0, 0], [Math.PI / 2, 0, 0], [0.78, 1, 1]),
        色: [影色, 明色],
        ばらつき: 0.04,
      }),
      玉(0.42, [0, 0.06, -0.78], [影色, 体色], [0.82, 0.98, 0.78]),
      玉(0.46, [0, 0.12, 0.66], [影色, 明色], [0.86, 0.94, 0.86]),
    ]),
  );
  group.add(胴);

  // 首と頭（首の付け根の Group を前後に振る）
  const 首 = new THREE.Group();
  首.position.set(0, 1.62, 首基準Z);
  首.rotation.x = 首基準角;
  const 首部品: THREE.BufferGeometry[] = [
    筒(0.2, 0.3, 0.98, [0, 0.42, 0], [体色, 明色], [0.08, 0, 0]),
    // 頭は鼻先へ向かって細くなる筒。上径（細い側）が -z を向くよう倒す
    筒(0.15, 0.24, 0.62, [0, 0.9, -0.36], [影色, 体色], [-Math.PI / 2, 0, 0]),
    玉(0.2, [0, 0.85, -0.62], 鼻面色, [1, 0.76, 1.1]),
    玉(0.24, [0, 0.98, -0.12], 体色, [0.9, 0.85, 0.9]),
  ];
  [-1, 1].forEach((左右) => {
    首部品.push(
      玉(0.05, [左右 * 0.2, 1.02, -0.33], 0x151719, [0.8, 1, 1]),
      玉(0.016, [左右 * 0.215, 1.035, -0.37], 0xffffff, 1, [0, 0, 0], 0),
      玉(0.03, [左右 * 0.08, 0.86, -0.82], 0x1a1412, [1, 0.6, 0.6], [0, 0, 0], 0),
      ローポリ部品(new THREE.ConeGeometry(0.09, 0.32, 5), 乱数, {
        変換: 配置行列([左右 * 0.15, 1.25, -0.06], [0.15, 0, 左右 * 0.14]),
        色: [体色, 明色],
      }),
    );
  });
  // たてがみ: 首の後ろに沿って房を並べ、額にも前髪をのせる
  for (let index = 0; index < 7; index += 1) {
    const y = 0.05 + index * 0.15;
    首部品.push(
      玉(0.15, [0, y, 0.25 - index * 0.012], 設定.たてがみ色, [0.4, 1.05, 0.95], [0.25, 0, (乱数() - 0.5) * 0.3]),
    );
  }
  首部品.push(玉(0.1, [0, 1.17, -0.22], 設定.たてがみ色, [0.7, 0.5, 1.1]));
  首.add(メッシュ(首部品));
  group.add(首);

  // 脚（付け根の Group を振る）。太もも・膝・細い管・蹄の毛・蹄
  const 脚: THREE.Group[] = [];
  [-0.56, 0.56].forEach((前後) => {
    [-0.28, 0.28].forEach((左右) => {
      const 脚Group = new THREE.Group();
      脚Group.position.set(左右, 1.22, 前後);
      脚Group.add(
        メッシュ([
          筒(0.12, 0.15, 0.5, [0, -0.22, 0], [体色, 明色]),
          玉(0.1, [0, -0.5, 0], 体色, [1, 1.1, 1.05]),
          筒(0.075, 0.085, 0.42, [0, -0.72, 0], [影色, 体色], [0, 0, 0], 6),
          玉(0.1, [0, -0.93, 0.01], 設定.たてがみ色, [1, 0.8, 1.05]),
          筒(0.12, 0.14, 0.14, [0, -1.02, -0.02], 設定.蹄色, [0, 0, 0], 8),
        ]),
      );
      group.add(脚Group);
      脚.push(脚Group);
    });
  });

  // 尾（尻から後方へ出て自然に下へ垂れる）。根元は細く、先はふさふさに広がる
  const 尾 = new THREE.Group();
  尾.position.set(0, 1.58, 0.93);
  尾.rotation.x = Math.PI * 0.73;
  尾.add(
    メッシュ([
      ローポリ部品(new THREE.CylinderGeometry(0.17, 0.08, 0.86, 7, 4), 乱数, {
        変形: (頂点) => {
          頂点.x += Math.sin(頂点.y * 4) * 0.03;
        },
        揺らぎ: 0.015,
        変換: 配置行列([0, 0.43, 0]),
        色: [設定.たてがみ色, 色を混ぜる(設定.たてがみ色, 0xffffff, 0.12)],
        ばらつき: 0.05,
      }),
      玉(0.17, [0, 0.86, 0], 設定.たてがみ色, [0.85, 1.15, 0.85]),
    ]),
  );
  group.add(尾);

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return { group, 胴, 首, 脚, 尾 };
};
const 馬を生成 = (
  種別: string,
  scene: THREE.Scene,
  ヘルパー: 造形ヘルパー,
  配置: NPC配置,
  設定: 馬設定,
): NPC個体 => {
  const 部位 = 馬体を作る(ヘルパー, 設定);
  const { group } = 部位;
  let 状態: 馬状態 = 設定.役割 === '先導' ? '走る' : '歩く';
  let 状態残り = 1 + Math.random() * 3;
  let 歩調 = 0;
  let 目的地 = new THREE.Vector3(0, 0, -設定.基準距離);
  let 前回基準 = 目的地.clone();
  let 追従中 = false;
  group.position.copy(目的地).add(new THREE.Vector3(設定.役割 === '追従' ? 6 : 0, 配置.位置.y, 0));
  scene.add(group);

  const 次の自由行動 = (基準: THREE.Vector3) => {
    const くじ = Math.random();
    状態 = くじ < 0.3 ? '走る' : くじ < 0.76 ? '歩く' : 'とどまる';
    状態残り = 状態 === '走る' ? 3 + Math.random() * 6 : 状態 === '歩く' ? 5 + Math.random() * 10 : 2 + Math.random() * 7;
    if (状態 !== 'とどまる') 目的地 = 放牧目的地(基準, 設定, 状態 === '走る' ? 1.15 : 0.85);
  };

  /** 脚・胴・首・尾の動き。自律行動でも一人称操作でも、いまの速度から同じように作る */
  const 見た目を更新 = (速度: number, delta: number, 時刻: number) => {
    if (速度 > 0) 歩調 += delta * (状態 === '走る' ? 12.5 : 7.2);
    部位.脚.forEach((脚, index) => {
      const 対角位相 = index === 0 || index === 3 ? 0 : Math.PI;
      const 振幅 = 状態 === '走る' ? 0.72 : 状態 === '歩く' ? 0.42 : 0.03;
      脚.rotation.x = THREE.MathUtils.lerp(脚.rotation.x, Math.sin(歩調 + 対角位相) * 振幅, 0.32);
    });
    const 弾み = 速度 > 0 ? Math.abs(Math.sin(歩調 * 2)) * (状態 === '走る' ? 0.1 : 0.045) : 0;
    部位.胴.position.y = 1.42 + 弾み;
    部位.首.rotation.z = Math.sin(歩調 * 2) * (速度 > 0 ? 0.025 : 0.008);
    // 首は一歩ごとに前後へ大きく波打つ。走るほど深く伸び縮みする
    const 首振り = 状態 === '走る' ? 0.19 : 状態 === '歩く' ? 0.085 : 0.014;
    const 首波 = Math.sin(歩調);
    部位.首.rotation.x = THREE.MathUtils.lerp(部位.首.rotation.x, 首基準角 + 首波 * 首振り, 0.4);
    部位.首.position.z = THREE.MathUtils.lerp(
      部位.首.position.z,
      首基準Z + 首波 * (状態 === '走る' ? 0.11 : 状態 === '歩く' ? 0.05 : 0.008),
      0.4,
    );
    // 普段は静かに垂らし、間欠的に左右へ強く叩いて虫を払う
    const 尾叩き中 = Math.sin(時刻 * 0.00043 + (設定.役割 === '先導' ? 0 : 2.1)) > 0.68;
    const 尾振幅 = 尾叩き中 ? 0.62 : 0.035;
    const 尾速度 = 尾叩き中 ? 0.012 : 0.0018;
    部位.尾.rotation.y = THREE.MathUtils.lerp(
      部位.尾.rotation.y,
      Math.sin(時刻 * 尾速度) * 尾振幅,
      尾叩き中 ? 0.28 : 0.06,
    );
  };

  // 一人称視点で操作されているあいだは、位置と向きを画面側に任せて見た目だけ合わせる
  let 手動: 手動操作状態 | null = null;

  const 更新 = ({ delta, 時刻, 俯瞰位置 }: NPC更新引数) => {
    if (delta <= 0) return;

    if (手動) {
      状態 = 手動.速さ < 0.05 ? 'とどまる' : 手動.全力 ? '走る' : '歩く';
      状態残り = 1;
      追従中 = false;
      目的地.copy(group.position);
      前回基準.copy(基準位置(俯瞰位置, 設定));
      見た目を更新(手動.速さ, delta, 時刻);
      return;
    }

    const 基準 = 基準位置(俯瞰位置, 設定);
    const 基準移動量 = 基準.distanceTo(前回基準);
    前回基準.lerp(基準, Math.min(1, delta * 1.4));
    let 速度 = 0;

    const 基準からの距離 = group.position.distanceTo(基準);
    const 視点変更で帰還 = 基準移動量 > 2.5 || 基準からの距離 > 設定.放牧半径 * 1.7;
    if (視点変更で帰還) {
      状態 = '走る';
      状態残り = 2;
      // 視点回転中にランダム目的地を毎フレーム引き直すと蛇行するため、移動中の基準そのものを追う
      目的地.copy(基準);
    }

    if (設定.役割 === '追従' && 設定.追跡対象) {
      const 黒馬距離 = group.position.distanceTo(設定.追跡対象.position);
      if (黒馬距離 > 設定.追従開始距離) 追従中 = true;
      if (黒馬距離 < 設定.追従終了距離) 追従中 = false;
      if (追従中) {
        状態 = '走る';
        状態残り = 1.5;
        const 横ずれ = new THREE.Vector3(Math.sin(時刻 * 0.0007) * 2.2, 0, Math.cos(時刻 * 0.0009) * 2.2);
        目的地 = 設定.追跡対象.position.clone().add(横ずれ);
      }
    }

    状態残り -= delta;
    const 目的地到着 = group.position.distanceTo(目的地) < 0.7;
    if (!追従中 && (状態残り <= 0 || (目的地到着 && 状態 !== 'とどまる'))) 次の自由行動(基準);
    速度 = 状態 === '走る' ? (追従中 ? 5.4 : 4.4 + Math.random() * 0.35) : 状態 === '歩く' ? 1.25 + Math.random() * 0.25 : 0;

    if (速度 > 0) {
      const 向き = 目的地.clone().sub(group.position);
      向き.y = 0;
      const 距離 = 向き.length();
      if (距離 > 0.05) {
        向き.normalize();
        group.position.addScaledVector(向き, Math.min(距離, 速度 * delta));
        group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, Math.atan2(向き.x, 向き.z) + Math.PI, 0.14);
      }
    }

    見た目を更新(速度, delta, 時刻);
  };

  return {
    種別,
    group,
    更新,
    手動操作: (状態指定: 手動操作状態 | null) => {
      手動 = 状態指定;
      if (!状態指定) {
        状態 = '歩く';
        状態残り = 0;
        目的地.copy(group.position);
      }
    },
  };
};

export const 黒馬定義: NPC定義<馬設定> = {
  種別: '黒馬',
  既定設定: { ...共通設定, 役割: '先導', 体色: 0x17191c, たてがみ色: 0x050607, 蹄色: 0x08090a },
  生成: (scene, ヘルパー, 配置, 設定) => 馬を生成('黒馬', scene, ヘルパー, 配置, 設定),
};

export const 白馬定義: NPC定義<馬設定> = {
  種別: '白馬',
  既定設定: { ...共通設定, 役割: '追従', 体色: 0xf2f0e8, たてがみ色: 0xd7d3c8, 蹄色: 0x8c8982 },
  生成: (scene, ヘルパー, 配置, 設定) => 馬を生成('白馬', scene, ヘルパー, 配置, 設定),
};
