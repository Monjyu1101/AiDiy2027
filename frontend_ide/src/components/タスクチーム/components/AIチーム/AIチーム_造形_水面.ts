// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム草原の池の水面（空の映り込み・さざ波・水面そのもののやわらかな光）。
//
// 水面の光は見た目だけの演出で、水場を使うカモなどの動きには関与しない。
// 粒を浮かべると水しぶきに見えるため、光は水面に貼った模様として描き、ゆっくり流すだけにする。
// 時間で変わるのは「さざ波の模様のずれ」と「光の模様のずれ」だけで、毎フレーム 更新() で進める。

import * as THREE from 'three';

import { type 造形ヘルパー, 乱数を作る } from './AIチーム_NPC型';

/** 継ぎ目なく並べられるさざ波の法線マップ（整数周期の波を重ねて高さを作り、傾きを法線にする） */
const さざ波法線マップ = (): THREE.DataTexture => {
  const 寸法 = 128;
  const 高さ = new Float32Array(寸法 * 寸法);
  const 乱数 = 乱数を作る(5150);
  const 波 = Array.from({ length: 9 }, () => ({
    fx: 1 + Math.floor(乱数() * 6),
    fy: 1 + Math.floor(乱数() * 6),
    位相: 乱数() * Math.PI * 2,
    強さ: 0.4 + 乱数() * 0.6,
  }));
  for (let y = 0; y < 寸法; y += 1) {
    for (let x = 0; x < 寸法; x += 1) {
      const u = (x / 寸法) * Math.PI * 2;
      const v = (y / 寸法) * Math.PI * 2;
      高さ[y * 寸法 + x] = 波.reduce((sum, w) => sum + Math.sin(u * w.fx + v * w.fy + w.位相) * w.強さ, 0);
    }
  }
  const データ = new Uint8Array(寸法 * 寸法 * 4);
  const 高 = (x: number, y: number) => 高さ[((y + 寸法) % 寸法) * 寸法 + ((x + 寸法) % 寸法)]!;
  const 法線 = new THREE.Vector3();
  for (let y = 0; y < 寸法; y += 1) {
    for (let x = 0; x < 寸法; x += 1) {
      法線.set(高(x - 1, y) - 高(x + 1, y), 高(x, y - 1) - 高(x, y + 1), 6).normalize();
      const 位置 = (y * 寸法 + x) * 4;
      データ[位置] = Math.round((法線.x * 0.5 + 0.5) * 255);
      データ[位置 + 1] = Math.round((法線.y * 0.5 + 0.5) * 255);
      データ[位置 + 2] = Math.round((法線.z * 0.5 + 0.5) * 255);
      データ[位置 + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(データ, 寸法, 寸法, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/**
 * 水面に重ねるやわらかな光の模様（自発光の強さとして使う）。
 * ぼかした細長い光をまばらに置き、端で折り返して描いて継ぎ目なく並べられるようにする
 */
const 光の模様 = (): THREE.CanvasTexture | null => {
  const 寸法 = 256;
  const canvas = document.createElement('canvas');
  canvas.width = 寸法;
  canvas.height = 寸法;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, 寸法, 寸法);
  const 乱数 = 乱数を作る(6262);
  for (let index = 0; index < 14; index += 1) {
    const x = 乱数() * 寸法;
    const y = 乱数() * 寸法;
    const 幅 = 18 + 乱数() * 34;
    const 明るさ = 0.25 + 乱数() * 0.35;
    for (const ox of [-寸法, 0, 寸法]) {
      for (const oy of [-寸法, 0, 寸法]) {
        const 光 = context.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, 幅);
        光.addColorStop(0, `rgba(255, 255, 255, ${明るさ})`);
        光.addColorStop(1, 'rgba(255, 255, 255, 0)');
        context.save();
        context.translate(x + ox, y + oy);
        context.scale(1, 0.35);
        context.translate(-(x + ox), -(y + oy));
        context.fillStyle = 光;
        context.fillRect(x + ox - 幅, y + oy - 幅, 幅 * 2, 幅 * 2);
        context.restore();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

export type 水面造形 = {
  /** 半径 radius の丸い水面。y=0 基準で置く */
  水面: (半径: number, 種: number) => THREE.Group;
  /** 毎フレーム呼ぶ。さざ波と光の模様をゆっくり流す */
  更新: (経過時間: number) => void;
};

/**
 * 池の水面をまとめて作る。環境 には空のグラデーションを正距円筒として渡し、水面に映り込ませる。
 */
export const 水面造形を作る = (ヘルパー: 造形ヘルパー, 環境: THREE.Texture | null): 水面造形 => {
  const 法線マップ = さざ波法線マップ();
  ヘルパー.テクスチャ登録(法線マップ);
  const 光 = 光の模様();
  if (光) ヘルパー.テクスチャ登録(光);
  const 水材 = new THREE.MeshPhysicalMaterial({
    color: 0x3b9ccb,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    normalMap: 法線マップ,
    normalScale: new THREE.Vector2(0.55, 0.55),
    envMap: 環境,
    envMapIntensity: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    specularIntensity: 1,
    // 水面そのものが、ところどころやわらかく明るむ
    ...(光 ? { emissive: 0xfff6dc, emissiveMap: 光, emissiveIntensity: 0.55 } : {}),
  });
  ヘルパー.マテリアル登録(水材);

  const 水面 = (半径: number, _種: number) => {
    const group = new THREE.Group();
    const 水形 = ヘルパー.ジオメトリ(new THREE.CircleGeometry(半径, 48));
    // さざ波の細かさを池の大きさに合わせる（1 枚の模様がおよそ 1.6m）
    const uv = 水形.getAttribute('uv') as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, (uv.getX(index) * (半径 * 2)) / 1.6, (uv.getY(index) * (半径 * 2)) / 1.6);
    }
    const water = new THREE.Mesh(水形, 水材);
    water.rotation.x = -Math.PI / 2;
    water.receiveShadow = true;
    group.add(water);
    return group;
  };

  return {
    水面,
    更新: (経過時間) => {
      法線マップ.offset.set(経過時間 * 0.018, 経過時間 * 0.011);
      // 光の模様はさざ波と別の向きへ、さらにゆっくり流す
      光?.offset.set(-経過時間 * 0.007, 経過時間 * 0.005);
    },
  };
};
