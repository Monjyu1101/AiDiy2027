// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import * as THREE from 'three'

export type 自動カメラワーク設定 = {
  基準半径: number
  半径: number
  目標半径: number
  最小半径: number
  最大半径: number
  注視Y: number
  角速度: number
  高さ振幅: number
  初期角度: number
  半径補間速度: number
  角度補間速度: number
  注視補間速度: number
  最終更新時刻: number
  追従角度補正: number
  基準注視Y: number
}

export type 自動カメラ追従入力 = {
  アバター向きY: number
  身体中心Y: number
  頭位置Y: number
}

export function 自動カメラワーク初期化(基準Y: number, 基準Z: number, modelSize: THREE.Vector3): 自動カメラワーク設定 {
  const baseRadius = Math.max(1.1, Math.abs(基準Z))
  const angleSpeed = (Math.PI * 2) / 9
  const rotationDuration = (Math.PI * 2) / angleSpeed
  return {
    基準半径: baseRadius,
    半径: baseRadius,
    目標半径: baseRadius,
    最小半径: Math.max(0.12, baseRadius * 0.12),
    最大半径: baseRadius * 3.2,
    注視Y: 基準Y,
    // 約9秒で1周
    角速度: angleSpeed,
    高さ振幅: Math.max(0.015, modelSize.y * 0.018),
    初期角度: 0,
    // 1周でほぼ基準距離へ戻る
    半径補間速度: -Math.log(0.05) / rotationDuration,
    角度補間速度: 1.6,
    注視補間速度: 2.2,
    最終更新時刻: 0,
    追従角度補正: 0,
    基準注視Y: 基準Y,
  }
}

function 角度差正規化(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function 角度線形補間(from: number, to: number, t: number): number {
  return 角度差正規化(from + 角度差正規化(to - from) * t)
}

function 追従目標更新(
  camera: THREE.PerspectiveCamera,
  設定: 自動カメラワーク設定,
  elapsed: number,
  現在カメラ角度: number,
  角度追従有効: boolean,
  追従入力?: 自動カメラ追従入力,
): number {
  if (!追従入力) {
    設定.目標半径 = 設定.基準半径
    設定.追従角度補正 = 0
    設定.注視Y = THREE.MathUtils.lerp(設定.注視Y, 設定.基準注視Y, 0.08)
    return 現在カメラ角度
  }

  const 正面目標角 = 角度差正規化(追従入力.アバター向きY - Math.PI)
  const 向き差 = 角度差正規化(正面目標角 - 現在カメラ角度)
  const 追従開始角 = THREE.MathUtils.degToRad(30)
  const 追従率 = THREE.MathUtils.clamp(
    (Math.abs(向き差) - 追従開始角) / (Math.PI - 追従開始角),
    0,
    1,
  )
  const targetRadius = THREE.MathUtils.lerp(
    設定.基準半径,
    Math.min(設定.最大半径, 設定.基準半径 * 3),
    追従率,
  )
  設定.目標半径 = targetRadius

  const delta = Math.max(0, elapsed - 設定.最終更新時刻)
  const effectiveAngleSpeed = 角度追従有効 ? 設定.角度補間速度 * 0.25 : 設定.角度補間速度
  const angleBlend = delta > 0 ? 1 - Math.exp(-delta * effectiveAngleSpeed) : 0
  const nextAngle = 角度追従有効
    ? 角度線形補間(現在カメラ角度, 正面目標角, angleBlend)
    : 現在カメラ角度
  設定.追従角度補正 = 角度差正規化(nextAngle - 現在カメラ角度)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const desiredHeadNdcY = 0.5
  const desiredHeadAngle = Math.atan(Math.tan(verticalFov / 2) * desiredHeadNdcY)
  const 追従時注視Y = THREE.MathUtils.clamp(
    追従入力.頭位置Y - Math.tan(desiredHeadAngle) * Math.max(設定.半径, 設定.基準半径),
    追従入力.身体中心Y,
    追従入力.頭位置Y - 0.04,
  )
  const targetLookAtY = THREE.MathUtils.lerp(設定.基準注視Y, 追従時注視Y, 追従率)
  const yBlend = delta > 0 ? 1 - Math.exp(-delta * 設定.注視補間速度) : 0
  設定.注視Y = THREE.MathUtils.lerp(設定.注視Y, targetLookAtY, yBlend)
  return nextAngle
}

function 半径補間更新(設定: 自動カメラワーク設定, elapsed: number): void {
  const delta = Math.max(0, elapsed - 設定.最終更新時刻)
  設定.最終更新時刻 = elapsed
  if (delta <= 0) return

  const 補間速度 = 設定.目標半径 < 設定.半径
    ? 設定.半径補間速度 * 0.6
    : 設定.半径補間速度 * 2
  const blend = 1 - Math.exp(-delta * 補間速度)
  設定.半径 = THREE.MathUtils.lerp(設定.半径, 設定.目標半径, blend)
}

export function カメラ周回位置適用(
  camera: THREE.PerspectiveCamera,
  設定: 自動カメラワーク設定,
  angle: number,
  高さオフセット = 0,
): void {
  camera.position.x = Math.sin(angle) * 設定.半径
  camera.position.z = -Math.cos(angle) * 設定.半径
  camera.position.y = 設定.注視Y + 高さオフセット
  camera.lookAt(0, 設定.注視Y, 0)
  camera.updateProjectionMatrix()
}

export function 自動カメラワーク適用(
  camera: THREE.PerspectiveCamera,
  elapsed: number,
  設定: 自動カメラワーク設定,
  手動角度オフセット = 0,
  手動高さオフセット = 0,
  追従入力?: 自動カメラ追従入力,
): void {
  const baseAngle = 設定.初期角度 + elapsed * 設定.角速度 + 手動角度オフセット
  追従目標更新(camera, 設定, elapsed, baseAngle, false, 追従入力)
  半径補間更新(設定, elapsed)
  const angle = baseAngle
  const 高さオフセット = Math.sin(angle * 0.5) * 設定.高さ振幅 + 手動高さオフセット
  カメラ周回位置適用(camera, 設定, angle, 高さオフセット)
}

export function 追従カメラワーク適用(
  camera: THREE.PerspectiveCamera,
  elapsed: number,
  設定: 自動カメラワーク設定,
  追従入力: 自動カメラ追従入力,
  手動角度オフセット = 0,
  手動高さオフセット = 0,
): void {
  const currentAngle = 設定.初期角度 + 手動角度オフセット
  const angle = 追従目標更新(camera, 設定, elapsed, currentAngle, true, 追従入力)
  設定.初期角度 = 角度差正規化(angle - 手動角度オフセット)
  半径補間更新(設定, elapsed)
  カメラ周回位置適用(camera, 設定, angle, 手動高さオフセット)
}

export function 手動カメラ周回適用(
  camera: THREE.PerspectiveCamera,
  設定: 自動カメラワーク設定,
  手動角度オフセット = 0,
  手動高さオフセット = 0,
  elapsed = 設定.最終更新時刻,
): void {
  半径補間更新(設定, elapsed)
  const angle = 設定.初期角度 + 手動角度オフセット
  カメラ周回位置適用(camera, 設定, angle, 手動高さオフセット)
}

export function カメラ距離倍率適用(
  設定: 自動カメラワーク設定,
  距離倍率: number,
): 自動カメラワーク設定 {
  設定.目標半径 = THREE.MathUtils.clamp(
    設定.基準半径 * 距離倍率,
    設定.最小半径,
    設定.最大半径,
  )
  return 設定
}

export function カメラ距離倍率即時適用(
  設定: 自動カメラワーク設定,
  距離倍率: number,
): 自動カメラワーク設定 {
  カメラ距離倍率適用(設定, 距離倍率)
  設定.半径 = 設定.目標半径
  return 設定
}
