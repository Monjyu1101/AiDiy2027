// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import * as THREE from 'three'

type 腕制御設定 = {
  node: THREE.Object3D | null
  初期姿勢: THREE.Quaternion
  目標姿勢: THREE.Quaternion
}

export type 自立身体制御設定 = {
  回転振幅: number
  回転速度: number
  上下振幅: number
  上下速度: number
  腕補間率: number
  左上腕: 腕制御設定 | null
  右上腕: 腕制御設定 | null
  左前腕: 腕制御設定 | null
  右前腕: 腕制御設定 | null
}

export type 自立身体制御結果 = {
  rotationY: number
  positionY: number
}

function 腕制御作成(node: THREE.Object3D | null | undefined, 回転差分: THREE.Euler): 腕制御設定 | null {
  if (!node) return null
  const 初期姿勢 = node.quaternion.clone()
  const 差分 = new THREE.Quaternion().setFromEuler(回転差分)
  const 目標姿勢 = 初期姿勢.clone().multiply(差分)
  return {
    node,
    初期姿勢,
    目標姿勢,
  }
}

export function 自立身体制御初期化(vrm: any, _modelSize: THREE.Vector3): 自立身体制御設定 {
  const humanoid = vrm?.humanoid
  return {
    回転振幅: 0.08,
    回転速度: 0.28,
    上下振幅: 0.01,
    上下速度: 0.9,
    腕補間率: 0.035,
    左上腕: 腕制御作成(humanoid?.getNormalizedBoneNode?.('leftUpperArm') ?? null, new THREE.Euler(0.04, 0, -0.16)),
    右上腕: 腕制御作成(humanoid?.getNormalizedBoneNode?.('rightUpperArm') ?? null, new THREE.Euler(0.04, 0, 0.16)),
    左前腕: 腕制御作成(humanoid?.getNormalizedBoneNode?.('leftLowerArm') ?? null, new THREE.Euler(0.02, 0, -0.06)),
    右前腕: 腕制御作成(humanoid?.getNormalizedBoneNode?.('rightLowerArm') ?? null, new THREE.Euler(0.02, 0, 0.06)),
  }
}

function 腕姿勢反映(設定: 腕制御設定 | null, 補間率: number) {
  if (!設定?.node) return
  設定.node.quaternion.slerp(設定.目標姿勢, 補間率)
}

export function 自立身体制御リセット(設定: 自立身体制御設定): void {
  const 腕一覧 = [設定.左上腕, 設定.右上腕, 設定.左前腕, 設定.右前腕]
  for (const 腕 of 腕一覧) {
    if (!腕?.node) continue
    腕.node.quaternion.copy(腕.初期姿勢)
  }
}

export function 自立身体制御適用(
  elapsed: number,
  設定: 自立身体制御設定,
): 自立身体制御結果 {
  腕姿勢反映(設定.左上腕, 設定.腕補間率)
  腕姿勢反映(設定.右上腕, 設定.腕補間率)
  腕姿勢反映(設定.左前腕, 設定.腕補間率)
  腕姿勢反映(設定.右前腕, 設定.腕補間率)

  return {
    rotationY: Math.sin(elapsed * 設定.回転速度) * 設定.回転振幅,
    positionY: Math.sin(elapsed * 設定.上下速度) * 設定.上下振幅,
  }
}
