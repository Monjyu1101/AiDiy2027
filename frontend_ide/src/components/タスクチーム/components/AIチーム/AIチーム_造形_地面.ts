// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// AIチーム草原の地面（芝の大地・十字の小道・小道の小石）の造形。
//
// 地面の高さは y=0 のまま変えない（要員や生き物の足元はこの高さを前提に動く）。
// 濃淡は頂点色で付け、芝の細かな模様だけをテクスチャで重ねる。

import * as THREE from 'three';

import { type 造形ヘルパー, 乱数を作る } from './AIチーム_NPC型';
import { ローポリ部品, 色を混ぜる, 頂点色マテリアル } from './AIチーム_造形_共通';

/** なめらかな濃淡の値（-1〜1 付近）。周期の違う波を重ねて、繰り返しが目立たないようにする */
const 濃淡 = (x: number, z: number) =>
  Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.051 - 0.7) * 0.5 +
  Math.sin(x * 0.11 + z * 0.083 + 2.1) * 0.3 +
  Math.sin(x * 0.27 - z * 0.23 + 0.4) * 0.15;

/** 乾いた草の斑。値が高いところだけ黄緑へ寄せる */
const 乾き = (x: number, z: number) =>
  Math.max(0, Math.sin(x * 0.031 - 0.9) * Math.sin(z * 0.037 + 1.7) - 0.35) * 1.6;

/** 芝の細かな模様（色は頂点色が持つので、ここは明暗だけのほぼ白いテクスチャ） */
const 芝模様テクスチャ = (異方性: number): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#e4e4e4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const 乱数 = 乱数を作る(777);
  for (let index = 0; index < 3200; index += 1) {
    const x = 乱数() * canvas.width;
    const y = 乱数() * canvas.height;
    const 明るさ = 乱数();
    context.fillStyle =
      明るさ > 0.6 ? 'rgba(255, 255, 240, 0.55)' : 明るさ > 0.3 ? 'rgba(150, 160, 140, 0.4)' : 'rgba(95, 110, 90, 0.35)';
    context.fillRect(x, y, 1 + 乱数() * 2, 2 + 乱数() * 4);
  }
  for (let index = 0; index < 900; index += 1) {
    const x = 乱数() * canvas.width;
    const y = 乱数() * canvas.height;
    context.strokeStyle = 乱数() > 0.5 ? 'rgba(255, 255, 235, 0.45)' : 'rgba(80, 95, 75, 0.35)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (乱数() - 0.5) * 4, y - 3 - 乱数() * 5);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(70, 70);
  texture.anisotropy = 異方性;
  return texture;
};

/** 芝の大地。霧が完全に覆う距離より外まで敷き、縁が見えないようにする */
export const 草原の地面を作る = (ヘルパー: 造形ヘルパー, 異方性: number): THREE.Mesh => {
  const 広さ = 460;
  const 形 = ヘルパー.ジオメトリ(new THREE.PlaneGeometry(広さ, 広さ, 115, 115));
  形.rotateX(-Math.PI / 2);
  const 位置 = 形.getAttribute('position') as THREE.BufferAttribute;
  const 色配列 = new Float32Array(位置.count * 3);
  const 濃 = new THREE.Color(0x56933f);
  const 淡 = new THREE.Color(0x8fc565);
  const 枯 = new THREE.Color(0xb3bd63);
  const 色 = new THREE.Color();
  for (let index = 0; index < 位置.count; index += 1) {
    const x = 位置.getX(index);
    const z = 位置.getZ(index);
    色.copy(濃).lerp(淡, THREE.MathUtils.clamp(0.5 + 濃淡(x, z) * 0.6, 0, 1));
    色.lerp(枯, THREE.MathUtils.clamp(乾き(x, z), 0, 0.55));
    色.toArray(色配列, index * 3);
  }
  形.setAttribute('color', new THREE.BufferAttribute(色配列, 3));

  const texture = 芝模様テクスチャ(異方性);
  if (texture) ヘルパー.テクスチャ登録(texture);
  const 材 = ヘルパー.マテリアル(0xffffff, {
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    ...(texture ? { map: texture } : {}),
  });
  const ground = new THREE.Mesh(形, 材);
  ground.receiveShadow = true;
  return ground;
};

export type 床の種類 = '芝' | 'デッキ' | '砂利' | '石畳';

/**
 * エリアの床（円盤の上面）に貼る模様。円盤の上面の UV は円の外接正方形に収まるので、正方形に描く。
 * デッキは板目と継ぎ目、砂利は小石、石畳は不規則な敷石と目地、芝は刈り込みの縞
 */
export const 床テクスチャを作る = (種類: 床の種類, 異方性: number): THREE.CanvasTexture | null => {
  const 寸法 = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = 寸法;
  canvas.height = 寸法;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const 乱数 = 乱数を作る(種類.charCodeAt(0) * 31 + 7);
  const rgb = (色: THREE.Color) => `rgb(${Math.round(色.r * 255)}, ${Math.round(色.g * 255)}, ${Math.round(色.b * 255)})`;
  const 色 = new THREE.Color();

  if (種類 === 'デッキ') {
    const 板幅 = 寸法 / 18;
    for (let 行 = 0; 行 < 18; 行 += 1) {
      // 板ごとに長さと継ぎ目の位置をずらす
      let x = -乱数() * 寸法 * 0.4;
      while (x < 寸法) {
        const 長さ = 寸法 * (0.35 + 乱数() * 0.4);
        色.set(0xa8743f).lerp(new THREE.Color(0xd09a5e), 乱数()).offsetHSL(0, 0, (乱数() - 0.5) * 0.06);
        context.fillStyle = rgb(色);
        context.fillRect(x, 行 * 板幅, 長さ, 板幅);
        // 木目
        context.strokeStyle = 'rgba(90, 55, 25, 0.22)';
        context.lineWidth = 1.5;
        for (let 筋 = 0; 筋 < 4; 筋 += 1) {
          const y = 行 * 板幅 + 板幅 * (0.2 + 筋 * 0.2 + (乱数() - 0.5) * 0.08);
          context.beginPath();
          context.moveTo(x, y);
          context.bezierCurveTo(x + 長さ * 0.3, y + (乱数() - 0.5) * 6, x + 長さ * 0.7, y + (乱数() - 0.5) * 6, x + 長さ, y);
          context.stroke();
        }
        // 継ぎ目と釘
        context.fillStyle = 'rgba(60, 35, 15, 0.75)';
        context.fillRect(x + 長さ - 2, 行 * 板幅, 3, 板幅);
        context.fillStyle = 'rgba(70, 70, 70, 0.8)';
        context.fillRect(x + 8, 行 * 板幅 + 板幅 * 0.25, 4, 4);
        context.fillRect(x + 8, 行 * 板幅 + 板幅 * 0.7, 4, 4);
        x += 長さ;
      }
      context.fillStyle = 'rgba(55, 32, 14, 0.85)';
      context.fillRect(0, 行 * 板幅, 寸法, 3);
    }
  } else if (種類 === '砂利') {
    context.fillStyle = '#d6c6a0';
    context.fillRect(0, 0, 寸法, 寸法);
    // 小石が多いと床がうるさく見えるので、数と色の差を控えめにする
    for (let index = 0; index < 2400; index += 1) {
      const x = 乱数() * 寸法;
      const y = 乱数() * 寸法;
      const r = 2.5 + 乱数() * 5;
      色.set(0xcbbd9a).lerp(new THREE.Color(乱数() > 0.5 ? 0xece2c8 : 0xa89f8b), 乱数() * 0.7);
      context.fillStyle = 'rgba(90, 75, 55, 0.2)';
      context.beginPath();
      context.ellipse(x + 1.5, y + 2, r, r * 0.75, 乱数() * 3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = rgb(色);
      context.beginPath();
      context.ellipse(x, y, r, r * 0.75, 乱数() * 3, 0, Math.PI * 2);
      context.fill();
    }
  } else if (種類 === '石畳') {
    // ずらした格子に種を置き、いちばん近い種で塗り分けて不規則な敷石にする（境目が目地）
    const 縮小 = 4;
    const 小寸法 = 寸法 / 縮小;
    const 格子 = 9;
    const 種一覧: Array<{ x: number; y: number; 色: THREE.Color }> = [];
    for (let gy = 0; gy < 格子; gy += 1) {
      for (let gx = 0; gx < 格子; gx += 1) {
        種一覧.push({
          x: ((gx + 0.2 + 乱数() * 0.6) / 格子) * 小寸法,
          y: ((gy + 0.2 + 乱数() * 0.6) / 格子) * 小寸法,
          色: new THREE.Color(0xa9a493).lerp(new THREE.Color(0xd8d2c0), 乱数()),
        });
      }
    }
    const 画像 = context.createImageData(小寸法, 小寸法);
    for (let y = 0; y < 小寸法; y += 1) {
      for (let x = 0; x < 小寸法; x += 1) {
        let 一番 = Infinity;
        let 二番 = Infinity;
        let 近い = 種一覧[0]!;
        for (const 種 of 種一覧) {
          const d = (種.x - x) ** 2 + (種.y - y) ** 2;
          if (d < 一番) {
            二番 = 一番;
            一番 = d;
            近い = 種;
          } else if (d < 二番) 二番 = d;
        }
        const 目地 = Math.sqrt(二番) - Math.sqrt(一番) < 1.6;
        const 位置 = (y * 小寸法 + x) * 4;
        const 色味 = 目地 ? new THREE.Color(0x6f7a5a) : 近い.色;
        画像.data[位置] = 色味.r * 255;
        画像.data[位置 + 1] = 色味.g * 255;
        画像.data[位置 + 2] = 色味.b * 255;
        画像.data[位置 + 3] = 255;
      }
    }
    const 小 = document.createElement('canvas');
    小.width = 小寸法;
    小.height = 小寸法;
    小.getContext('2d')?.putImageData(画像, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(小, 0, 0, 寸法, 寸法);
    // 石の表面のざらつき
    for (let index = 0; index < 2500; index += 1) {
      context.fillStyle = 乱数() > 0.5 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(60, 60, 50, 0.12)';
      context.fillRect(乱数() * 寸法, 乱数() * 寸法, 2 + 乱数() * 3, 2 + 乱数() * 3);
    }
  } else {
    // 芝: 刈り込みの縞と、ところどころのクローバー
    for (let 列 = 0; 列 < 12; 列 += 1) {
      context.fillStyle = 列 % 2 === 0 ? '#86c063' : '#79b357';
      context.fillRect((列 * 寸法) / 12, 0, 寸法 / 12 + 1, 寸法);
    }
    for (let index = 0; index < 2600; index += 1) {
      context.strokeStyle = 乱数() > 0.5 ? 'rgba(170, 220, 130, 0.5)' : 'rgba(70, 120, 55, 0.45)';
      const x = 乱数() * 寸法;
      const y = 乱数() * 寸法;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (乱数() - 0.5) * 4, y - 4 - 乱数() * 6);
      context.stroke();
    }
    for (let index = 0; index < 60; index += 1) {
      const x = 乱数() * 寸法;
      const y = 乱数() * 寸法;
      context.fillStyle = 'rgba(80, 140, 60, 0.8)';
      for (let 葉 = 0; 葉 < 3; 葉 += 1) {
        const 角 = (葉 / 3) * Math.PI * 2;
        context.beginPath();
        context.arc(x + Math.cos(角) * 4, y + Math.sin(角) * 4, 4, 0, Math.PI * 2);
        context.fill();
      }
      if (乱数() > 0.7) {
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.beginPath();
        context.arc(x, y, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 異方性;
  return texture;
};

/**
 * 4 エリアの間を通る十字の小道。縁を波打たせて踏み固めた土の道に見せ、小石を散らす。
 * 幅と長さは従来の板と同じにして、通路の位置は変えない。
 */
export const 小道を作る = (
  ヘルパー: 造形ヘルパー,
  寸法: { 幅: number; 長さ: number },
): THREE.Group => {
  const group = new THREE.Group();
  const 土材 = ヘルパー.マテリアル(0xffffff, { vertexColors: true, roughness: 1, metalness: 0 });
  const 土明 = new THREE.Color(0xd9c49a);
  const 土暗 = new THREE.Color(0xae9067);
  const 草際 = new THREE.Color(0x8ea65e);
  const 色 = new THREE.Color();

  const 道を作る = (向き: '縦' | '横', 高さ: number, 種: number) => {
    const 乱数 = 乱数を作る(種);
    const 形 = ヘルパー.ジオメトリ(new THREE.PlaneGeometry(寸法.幅, 寸法.長さ, 6, 96));
    const 位置 = 形.getAttribute('position') as THREE.BufferAttribute;
    const 色配列 = new Float32Array(位置.count * 3);
    const 半幅 = 寸法.幅 / 2;
    for (let index = 0; index < 位置.count; index += 1) {
      const x = 位置.getX(index);
      const y = 位置.getY(index);
      const 縁度 = Math.abs(x) / 半幅;
      // 縁ほど大きく波打たせる（道の長さ方向の位置で決まる波なので、左右の縁は別々にうねる）
      const 波 = Math.sin(y * 0.9 + (x > 0 ? 1.7 : 4.2) + 種) * 0.16 + Math.sin(y * 2.3 + 種 * 0.5) * 0.07;
      位置.setX(index, x + Math.sign(x) * 波 * 縁度 * 縁度 + (乱数() - 0.5) * 0.04 * (1 - 縁度));
      色.copy(土暗).lerp(土明, 0.35 + 乱数() * 0.45 + (1 - 縁度) * 0.2);
      if (縁度 > 0.8) 色.lerp(草際, (縁度 - 0.8) * 2.2);
      色.toArray(色配列, index * 3);
    }
    形.setAttribute('color', new THREE.BufferAttribute(色配列, 3));
    形.rotateX(-Math.PI / 2);
    if (向き === '横') 形.rotateY(Math.PI / 2);
    const 道 = new THREE.Mesh(形, 土材);
    道.position.y = 高さ;
    道.receiveShadow = true;
    group.add(道);
  };
  // 交差点で面が重なってちらつかないよう、横の道を少しだけ上に置く
  道を作る('縦', 0.012, 11);
  道を作る('横', 0.017, 23);

  // 小石。1 つの形を複製して描く
  const 乱数 = 乱数を作る(4242);
  const 石形 = ヘルパー.ジオメトリ(
    ローポリ部品(new THREE.IcosahedronGeometry(0.07, 0), 乱数, {
      揺らぎ: 0.018,
      色: [0x8a857a, 0xc9c2b2],
    }),
  );
  // 多いと道が砂利だらけに見えるので、ところどころに転がる程度にとどめる
  const 石数 = 70;
  const 小石 = new THREE.InstancedMesh(石形, 頂点色マテリアル(ヘルパー), 石数);
  const 行列 = new THREE.Matrix4();
  const 石色 = new THREE.Color();
  for (let index = 0; index < 石数; index += 1) {
    const 長さ方向 = (乱数() - 0.5) * 寸法.長さ * 0.96;
    const 幅方向 = (乱数() - 0.5) * 寸法.幅 * 1.05;
    const 縦の道 = index % 2 === 0;
    const 大きさ = 0.6 + 乱数() * 1.1;
    行列.compose(
      new THREE.Vector3(縦の道 ? 幅方向 : 長さ方向, 0.02, 縦の道 ? 長さ方向 : 幅方向),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(乱数(), 乱数() * 3, 乱数())),
      new THREE.Vector3(大きさ, 大きさ * 0.55, 大きさ),
    );
    小石.setMatrixAt(index, 行列);
    小石.setColorAt(index, 石色.copy(色を混ぜる(0xffffff, 0xd8cdb8, 乱数())));
  }
  小石.instanceMatrix.needsUpdate = true;
  if (小石.instanceColor) 小石.instanceColor.needsUpdate = true;
  小石.computeBoundingSphere();
  小石.receiveShadow = true;
  group.add(小石);
  return group;
};
