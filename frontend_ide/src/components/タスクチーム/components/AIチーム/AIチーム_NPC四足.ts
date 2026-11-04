// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// ネコ・イヌ共通の四足 NPC エンジン。
//
// 歩く / やすむ / 眠る の 3 状態を時間で切り替え、眠っているときだけ「zZzZ.」の吹き出しを出す。
// 種別ごとの数値（体格・色・速度・滞在時間・姿勢）は AIチーム_NPC動作_ネコ.ts / _イヌ.ts が持つ。

import * as THREE from 'three';

import {
  type NPC個体,
  type NPC更新引数,
  type NPC配置,
  type 手動操作状態,
  type 造形ヘルパー,
  乱数を作る,
  範囲乱数,
} from './AIチーム_NPC型';
import { ローポリ部品, 色を混ぜる, 部品を結合, 配置行列, 頂点色マテリアル } from './AIチーム_造形_共通';

export type 四足状態 = '歩く' | 'やすむ' | '眠る';

/** 状態ごとの姿勢。胴下げは脚長に対する割合、ほかはラジアン */
export type 姿勢値 = {
  /** 胴を下げる量（脚長の割合。1 でほぼ地面） */
  胴下げ: number;
  /** 胴の傾き（+ で前が上がり、お尻が下がる） */
  胴傾き: number;
  /** 前脚の折りたたみ（+ で前へ倒す） */
  前脚: number;
  /** 後脚の折りたたみ（- で後ろへ倒す） */
  後脚: number;
  /** 頭の下げ（+ で下を向く） */
  頭傾き: number;
  /** 尾を下げる量（+ で後ろへ倒れる） */
  尾傾き: number;
};

/** 立つ→座る→伏せるの基本姿勢。種別ごとに一部だけ差し替えて使う */
export const 基本姿勢表: Record<四足状態, 姿勢値> = {
  歩く: { 胴下げ: 0, 胴傾き: 0, 前脚: 0, 後脚: 0, 頭傾き: 0, 尾傾き: 0 },
  やすむ: { 胴下げ: 0.36, 胴傾き: 0.26, 前脚: 0.12, 後脚: 1.15, 頭傾き: 0, 尾傾き: 0.35 },
  眠る: { 胴下げ: 0.92, 胴傾き: -0.02, 前脚: 1.32, 後脚: -1.28, 頭傾き: 0.45, 尾傾き: 0.72 },
};

export type 四足設定 = {
  /** 歩く速さ（1秒あたりの移動距離） */
  歩く速度: number;
  /** 進行方向へ向き直る補間の強さ（0〜1、大きいほど機敏） */
  旋回追従: number;
  /** 各状態の滞在時間 [最小秒, 最大秒] */
  滞在時間: Record<四足状態, [number, number]>;
  /** 状態が終わったときの次状態の重み（合計は任意） */
  遷移重み: Record<四足状態, Partial<Record<四足状態, number>>>;
  /** 1回の移動で選ぶ距離 [最小, 最大] */
  移動距離: [number, number];
  /** 初期位置を中心とした徘徊半径 */
  徘徊半径: number;
  /**
   * 足の運びの微調整。1 なら足が地面を蹴る距離と実際に進む距離がぴったり合い、地面を滑らない。
   * 大きくすると小刻みに、小さくするとゆったり運ぶ（滑って見えるので 1 から大きく離さない）。
   */
  歩調微調整: number;
  /** 脚を振る角度 */
  脚振り角: number;
  /** 尾を振る速さと角度 */
  尾速度: number;
  尾振り角: number;
  /** 尾の付け根から先が向く基準角。正の大角度で後方へ垂れる */
  尾基準角: number;
  /** true の場合、常時ではなく間欠的に尾を振る */
  尾を時々振る: boolean;
  /** 体格 */
  体長: number;
  体幅: number;
  体高: number;
  頭径: number;
  脚長: number;
  /** 耳の形 */
  耳形: '立ち耳' | '垂れ耳';
  /** 状態ごとの姿勢 */
  姿勢: Record<四足状態, 姿勢値>;
  /** 色 */
  体色: number;
  腹色: number;
  鼻色: number;
  /** 眠りの吹き出しに出す文字 */
  寝息文字: string;
};

type 四足部位 = {
  胴: THREE.Group;
  頭: THREE.Group;
  脚: THREE.Group[];
  尾: THREE.Group;
};

/** 重み付きで次の状態を選ぶ */
const 次状態を選ぶ = (設定: 四足設定, 現在: 四足状態): 四足状態 => {
  const 候補 = Object.entries(設定.遷移重み[現在] ?? {}) as [四足状態, number][];
  const 合計 = 候補.reduce((sum, [, 重み]) => sum + 重み, 0);
  if (合計 <= 0) return 現在;
  let くじ = Math.random() * 合計;
  for (const [状態, 重み] of 候補) {
    くじ -= 重み;
    if (くじ <= 0) return 状態;
  }
  return 候補[候補.length - 1]?.[0] ?? 現在;
};

const 寝息テクスチャを作る = (
  文字: string,
  ヘルパー: 造形ヘルパー,
): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 255, 255, 0.92)';
  context.strokeStyle = 'rgba(90, 120, 100, 0.55)';
  context.lineWidth = 4;
  const 角 = 26;
  context.beginPath();
  context.moveTo(20 + 角, 14);
  context.lineTo(236 - 角, 14);
  context.quadraticCurveTo(236, 14, 236, 14 + 角);
  context.lineTo(236, 82 - 角);
  context.quadraticCurveTo(236, 82, 236 - 角, 82);
  context.lineTo(120, 82);
  context.lineTo(104, 112);
  context.lineTo(96, 82);
  context.lineTo(20 + 角, 82);
  context.quadraticCurveTo(20, 82, 20, 82 - 角);
  context.lineTo(20, 14 + 角);
  context.quadraticCurveTo(20, 14, 20 + 角, 14);
  context.closePath();
  context.fill();
  context.stroke();
  context.font = '700 52px "Yu Gothic", "Meiryo", sans-serif';
  context.fillStyle = '#3f5a49';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(文字, 128, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  ヘルパー.テクスチャ登録(texture);
  return texture;
};

/** 四足の体（胴・頭・脚・尾）を組む。動かすのは各 Group で、形はローポリ部品を結合したメッシュ */
const 体を組む = (
  設定: 四足設定,
  ヘルパー: 造形ヘルパー,
): { group: THREE.Group; 部位: 四足部位 } => {
  const 材 = 頂点色マテリアル(ヘルパー, { roughness: 0.85 });
  const 乱数 = 乱数を作る(Math.round(設定.体長 * 1000 + 設定.体色));
  const 縞あり = 設定.耳形 === '立ち耳';
  const h = 設定.頭径;
  const 濃い体色 = 色を混ぜる(設定.体色, 0x000000, 0.22);
  const メッシュ = (部品: THREE.BufferGeometry[]) =>
    new THREE.Mesh(ヘルパー.ジオメトリ(部品を結合(部品)), 材);
  const 玉 = (半径: number, 位置: [number, number, number], 色: THREE.ColorRepresentation | [THREE.ColorRepresentation, THREE.ColorRepresentation], 拡大: number | [number, number, number] = 1, 詳細 = 1) =>
    ローポリ部品(new THREE.IcosahedronGeometry(半径, 詳細), 乱数, {
      変換: 配置行列(位置, [0, 0, 0], 拡大),
      色,
      ばらつき: 0.04,
    });

  const group = new THREE.Group();

  // 胴（脚の付け根の高さに置き、伏せるときはこの Group を下げる）。
  // 背は体色、下側は腹色。ネコは背に縞を入れる
  const 胴 = new THREE.Group();
  胴.position.y = 設定.脚長 + 設定.体高 * 0.5;
  胴.add(
    メッシュ([
      ローポリ部品(new THREE.CapsuleGeometry(設定.体高 * 0.5, 設定.体長 - 設定.体高, 3, 9), 乱数, {
        変換: 配置行列([0, 0, 0], [Math.PI / 2, 0, 0], [設定.体幅 / 設定.体高, 1, 1]),
        面色: (t, _法線, _乱数, 中心) => {
          if (中心.y < -設定.体高 * 0.14) return 設定.腹色;
          if (縞あり && 中心.y > 0 && Math.sin(中心.z * 38) > 0.55) return 濃い体色;
          return 色を混ぜる(濃い体色, 設定.体色, Math.min(1, t * 1.6));
        },
        ばらつき: 0.04,
      }),
      // 胸のふくらみ
      玉(設定.体高 * 0.36, [0, -設定.体高 * 0.08, -設定.体長 * 0.36], 設定.腹色, [1, 1, 0.9]),
    ]),
  );
  group.add(胴);

  // 頭（胴の前側 = -z 方向）
  const 頭 = new THREE.Group();
  頭.position.set(0, 設定.体高 * 0.42, -(設定.体長 * 0.5 + h * 0.35));
  const 頭部品: THREE.BufferGeometry[] = [
    玉(h, [0, 0, 0], [濃い体色, 設定.体色], [1, 0.94, 1.02]),
    玉(h * 0.44, [0, -h * 0.3, -h * 0.66], 設定.腹色, [0.95, 0.72, 1.1]),
    玉(h * 0.17, [0, -h * 0.2, -h * 1.15], 設定.鼻色, [1.3, 0.8, 1], 0),
  ];
  [-1, 1].forEach((向き) => {
    頭部品.push(
      玉(h * 0.13, [向き * h * 0.42, h * 0.18, -h * 0.74], 0x23303d, [1, 1.15, 0.8]),
      玉(h * 0.045, [向き * h * 0.42 + h * 0.04, h * 0.24, -h * 0.84], 0xffffff, 1, 0),
    );
    if (設定.耳形 === '立ち耳') {
      // 三角の耳と、内側の桃色
      頭部品.push(
        ローポリ部品(new THREE.ConeGeometry(h * 0.42, h * 0.72, 4), 乱数, {
          変換: 配置行列([向き * h * 0.55, h * 0.78, h * 0.1], [0, Math.PI / 4, 向き * 0.24]),
          色: [濃い体色, 設定.体色],
        }),
        ローポリ部品(new THREE.ConeGeometry(h * 0.24, h * 0.46, 4), 乱数, {
          変換: 配置行列([向き * h * 0.53, h * 0.74, -h * 0.02], [0, Math.PI / 4, 向き * 0.24]),
          色: 0xf2b8c0,
        }),
      );
      // ひげ（3 本ずつ）
      [-0.08, 0, 0.08].forEach((傾き) => {
        const 根元: [number, number, number] = [向き * h * 0.3, -h * 0.3, -h * 0.9];
        const 長さ = h * 0.9;
        const 方向 = new THREE.Vector3(向き, 傾き * 3, -0.15).normalize();
        const 中点 = new THREE.Vector3(...根元).addScaledVector(方向, 長さ / 2);
        頭部品.push(
          ローポリ部品(new THREE.CylinderGeometry(h * 0.012, h * 0.012, 長さ, 3), 乱数, {
            変換: new THREE.Matrix4().compose(
              中点,
              new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), 方向),
              new THREE.Vector3(1, 1, 1),
            ),
            色: 0xf7f3ea,
          }),
        );
      });
    } else {
      // 垂れ耳（体色より少し濃い）
      頭部品.push(
        ローポリ部品(new THREE.IcosahedronGeometry(h * 0.44, 1), 乱数, {
          変換: 配置行列([向き * h * 0.82, h * 0.26, h * 0.05], [0, 0, 向き * 0.3], [0.42, 1.1, 0.72]),
          色: [色を混ぜる(設定.体色, 0x000000, 0.35), 濃い体色],
        }),
      );
    }
  });
  頭.add(メッシュ(頭部品));
  胴.add(頭);

  // 脚（前左・前右・後左・後右の順。Group を回して振る）。足先は腹色の靴下
  const 脚: THREE.Group[] = [];
  const 前後 = [-(設定.体長 * 0.3), 設定.体長 * 0.3];
  const 左右 = [-(設定.体幅 * 0.42), 設定.体幅 * 0.42];
  前後.forEach((oz) => {
    左右.forEach((ox) => {
      const 脚Group = new THREE.Group();
      脚Group.position.set(ox, -設定.体高 * 0.44, oz);
      脚Group.add(
        メッシュ([
          ローポリ部品(
            new THREE.CylinderGeometry(設定.脚長 * 0.2, 設定.脚長 * 0.15, 設定.脚長 * 0.82, 6, 1),
            乱数,
            { 変換: 配置行列([0, -設定.脚長 * 0.41, 0]), 色: [設定.体色, 濃い体色], ばらつき: 0.04 },
          ),
          玉(設定.脚長 * 0.2, [0, -設定.脚長 * 0.82, -設定.脚長 * 0.03], 設定.腹色, [1, 0.7, 1.25]),
        ]),
      );
      胴.add(脚Group);
      脚.push(脚Group);
    });
  });

  // 尾は「付け根の Group（尾）→ 傾きの Group（尾軸）→ 本体」の入れ子にする。
  // こうしておくと、姿勢で 尾 を回しても付け根から離れない。
  const 尾 = new THREE.Group();
  尾.position.set(0, 設定.体高 * 0.34, 設定.体長 * 0.44);
  const 尾長 = 設定.体長 * 0.42;
  const 尾軸 = new THREE.Group();
  尾軸.rotation.x = 設定.尾基準角;
  尾軸.add(
    メッシュ([
      ローポリ部品(new THREE.CylinderGeometry(設定.体高 * 0.07, 設定.体高 * 0.11, 尾長, 6, 3), 乱数, {
        変換: 配置行列([0, 尾長 * 0.5, 0]),
        面色: (t) => (縞あり && Math.sin(t * 18) > 0.4 ? 濃い体色 : 設定.体色),
        ばらつき: 0.04,
      }),
      玉(設定.体高 * 0.1, [0, 尾長 + 設定.体高 * 0.03, 0], 縞あり ? 濃い体色 : 設定.腹色),
    ]),
  );
  尾.add(尾軸);
  胴.add(尾);

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return { group, 部位: { 胴, 頭, 脚, 尾 } };
};

/**
 * 四足 NPC を 1 匹つくってシーンに追加する。
 * 配置.位置 が徘徊の中心になり、配置.禁止円 に入る場所は目的地に選ばない。
 */
export const 四足NPCを生成 = (
  種別: string,
  scene: THREE.Scene,
  ヘルパー: 造形ヘルパー,
  配置: NPC配置,
  設定: 四足設定,
): NPC個体 => {
  const { group, 部位 } = 体を組む(設定, ヘルパー);
  group.position.set(配置.位置.x, 0, 配置.位置.z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);

  const 吹き出し材 = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const texture = 寝息テクスチャを作る(設定.寝息文字, ヘルパー);
  if (texture) 吹き出し材.map = texture;
  ヘルパー.マテリアル登録(吹き出し材);
  const 吹き出し = new THREE.Mesh(
    ヘルパー.ジオメトリ(new THREE.PlaneGeometry(0.86, 0.43)),
    吹き出し材,
  );
  吹き出し.visible = false;
  scene.add(吹き出し);

  const 中心 = new THREE.Vector3(配置.位置.x, 0, 配置.位置.z);
  const 禁止円 = 配置.禁止円 ?? [];
  let 状態: 四足状態 = '歩く';
  let 状態終了時刻 = 範囲乱数(設定.滞在時間.歩く);
  const 現在姿勢: 姿勢値 = { ...設定.姿勢.歩く };
  const 位相 = Math.random() * Math.PI * 2;
  let 歩調 = 0;

  /** 徘徊半径の内側で、禁止円（池など）を避けた次の目的地を選ぶ */
  const 目的地を選ぶ = (): THREE.Vector3 => {
    for (let 試行 = 0; 試行 < 8; 試行 += 1) {
      const 角度 = Math.random() * Math.PI * 2;
      const 距離 = 範囲乱数(設定.移動距離);
      const 候補 = new THREE.Vector3(
        group.position.x + Math.cos(角度) * 距離,
        0,
        group.position.z + Math.sin(角度) * 距離,
      );
      const 中心差 = 候補.clone().sub(中心);
      中心差.y = 0;
      if (中心差.length() > 設定.徘徊半径) {
        中心差.setLength(設定.徘徊半径 * 0.85);
        候補.copy(中心).add(中心差);
      }
      const 禁止に入る = 禁止円.some(
        ([x, z, r]) => Math.hypot(候補.x - x, 候補.z - z) < r,
      );
      if (!禁止に入る) return 候補;
    }
    return 中心.clone();
  };

  let 目的地 = 目的地を選ぶ();

  // 脚の付け根から接地点までを振り子とみなしたときの、足が地面を蹴る 1 歩ぶんの長さ。
  // 歩調をこの長さと実際の移動量から進めることで、速度をいくつにしても足が滑らない。
  const 一歩の長さ = Math.max(2 * 設定.脚長 * Math.sin(設定.脚振り角), 0.01);

  // 一人称視点で操作されているあいだは、位置と向きを画面側に任せて見た目だけ合わせる
  let 手動: 手動操作状態 | null = null;

  const 更新 = ({ 経過時間, delta, 時刻, camera }: NPC更新引数) => {
    // 状態の切り替え
    if (!手動 && delta > 0 && 経過時間 >= 状態終了時刻) {
      状態 = 次状態を選ぶ(設定, 状態);
      状態終了時刻 = 経過時間 + 範囲乱数(設定.滞在時間[状態]);
      目的地 = 状態 === '歩く' ? 目的地を選ぶ() : group.position.clone();
    }

    // 移動（歩く状態のみ。着いたら残り時間で次の場所へ向かう）
    let 歩行中 = false;
    let 進んだ = 0;
    if (手動) {
      状態 = '歩く';
      // 解除した直後に行き先を選び直せるよう、自律用の予定はいったん先送りしておく
      状態終了時刻 = 経過時間 + 0.5;
      進んだ = 手動.速さ * delta;
      歩行中 = 進んだ > 1e-4;
    } else if (状態 === '歩く' && delta > 0) {
      const 差 = 目的地.clone().sub(group.position);
      差.y = 0;
      const 距離 = 差.length();
      if (距離 < 0.12) {
        目的地 = 目的地を選ぶ();
      } else {
        差.normalize();
        進んだ = Math.min(距離, delta * 設定.歩く速度);
        group.position.addScaledVector(差, 進んだ);
        group.rotation.y = THREE.MathUtils.lerp(
          group.rotation.y,
          Math.atan2(差.x, 差.z) + Math.PI,
          設定.旋回追従,
        );
        歩行中 = true;
      }
    }

    // 姿勢（歩く→やすむ→眠る）を各部位ごとに滑らかに近づける
    const 目標姿勢 = 設定.姿勢[状態];
    const 補間率 = Math.min(1, Math.max(delta, 1 / 60) * 2.5);
    (Object.keys(目標姿勢) as (keyof 姿勢値)[]).forEach((項目) => {
      現在姿勢[項目] = THREE.MathUtils.lerp(現在姿勢[項目], 目標姿勢[項目], 補間率);
    });

    const 呼吸 = Math.sin(時刻 * 0.0022 + 位相);
    部位.胴.position.y =
      設定.脚長 + 設定.体高 * 0.5 - 現在姿勢.胴下げ * 設定.脚長 + 呼吸 * 0.006;
    部位.胴.rotation.x = 現在姿勢.胴傾き;

    // 頭は伏せるほど下がる。休み中はゆっくり見回す
    部位.頭.rotation.x = 現在姿勢.頭傾き;
    部位.頭.rotation.y =
      状態 === 'やすむ' ? Math.sin(時刻 * 0.0012 + 位相) * 0.5 : 呼吸 * 0.05;

    // 脚（歩行中は前後で位相を反転させて振り、休む・眠るときは姿勢表の角度へ折りたたむ）
    // 歩調は経過時間ではなく「実際に進んだ距離」で進める。対角の2組が交互に地面を蹴るので、
    // 1周期（2π）で 2 歩ぶん進む勘定になる
    if (歩行中) 歩調 += (進んだ / 一歩の長さ) * Math.PI * 設定.歩調微調整;
    部位.脚.forEach((脚, index) => {
      const 前脚 = index < 2;
      const 位相差 = (前脚 ? 0 : Math.PI) + (index % 2 === 0 ? 0 : Math.PI);
      const 振り = 歩行中 ? Math.sin(歩調 + 位相差) * 設定.脚振り角 : 0;
      const 折りたたみ = 前脚 ? 現在姿勢.前脚 : 現在姿勢.後脚;
      脚.rotation.x = THREE.MathUtils.lerp(脚.rotation.x, 振り + 折りたたみ, 0.35);
    });

    // 尾（歩行中はよく振り、眠ると止まって体へ寄せる）
    const 間欠振り = !設定.尾を時々振る || Math.sin(時刻 * 0.00036 + 位相) > 0.48;
    const 尾勢い = 状態 === '眠る' ? 0.08 : 間欠振り ? (歩行中 ? 1 : 0.7) : 0.06;
    部位.尾.rotation.y =
      Math.sin(時刻 * 0.001 * 設定.尾速度 + 位相) * 設定.尾振り角 * 尾勢い;
    部位.尾.rotation.x = -現在姿勢.尾傾き;

    // 眠っているときだけ zZzZ. の吹き出しを出す
    const 材質 = 吹き出し.material as THREE.MeshBasicMaterial;
    材質.opacity = THREE.MathUtils.lerp(材質.opacity, 状態 === '眠る' ? 0.95 : 0, 0.06);
    吹き出し.visible = 材質.opacity > 0.02;
    if (吹き出し.visible) {
      const 浮き = (Math.sin(時刻 * 0.0016 + 位相) + 1) * 0.5;
      吹き出し.position.set(
        group.position.x + 0.34,
        設定.脚長 + 設定.体高 + 0.42 + 浮き * 0.16,
        group.position.z + 0.34,
      );
      吹き出し.lookAt(camera.position.x, 吹き出し.position.y, camera.position.z);
    }
  };

  return {
    種別,
    group,
    更新,
    手動操作: (状態: 手動操作状態 | null) => {
      手動 = 状態;
      if (!状態) 目的地 = group.position.clone();
    },
  };
};
