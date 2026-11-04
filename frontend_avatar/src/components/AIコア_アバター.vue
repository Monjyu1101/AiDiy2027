<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import {
  DEFAULT_VRM_MODEL_URL,
  SAMPLE_VRMA_FOLDER_NAME,
  SAMPLE_VRMA_FILES,
  STANDARD_VRMA_FOLDER_NAME,
  STANDARD_VRMA_FILES,
} from '@/api/config'
import {
  自立身体制御初期化,
  自立身体制御リセット,
  自立身体制御適用,
  type 自立身体制御設定,
} from '@/components/AIコア_自立身体制御'
import {
  カメラ距離倍率適用,
  カメラ距離倍率即時適用,
  自動カメラワーク初期化,
  自動カメラワーク適用,
  追従カメラワーク適用,
  手動カメラ周回適用,
  type 自動カメラ追従入力,
  type 自動カメラワーク設定,
} from '@/components/AIコア_自動カメラワーク'

const props = withDefaults(defineProps<{
  sessionId: string;
  userName: string;
  liveModel: string;
  inputConnected: boolean;
  audioConnected: boolean;
  micEnabled: boolean;
  speakerEnabled: boolean;
  micLevel: number;
  speakerLevel: number;
  uiVisible: boolean;
  controlsVisible?: boolean;
  transparentMode?: boolean;
  subtitleText?: string;
}>(), {
  controlsVisible: true,
  transparentMode: false,
  subtitleText: '',
})

const mountRef = ref<HTMLDivElement | null>(null)
const loadError = ref('')
const currentMotion = ref('待機')
const loading = ref(true)
const dragging = ref(false)
const 自立身体制御有効 = ref(false)
const 自動カメラワーク有効 = ref(false)
const カメラモード = ref<'追従' | '回転'>('追従')
const 実効自立身体制御有効 = computed(() => 自立身体制御有効.value)
const 実効カメラモード = computed<'停止' | '追従' | '回転'>(() => (
  自動カメラワーク有効.value ? カメラモード.value : '停止'
))


let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let clock: THREE.Clock | null = null
let frameHandle = 0
let currentVrm: any = null
let motionLoader: GLTFLoader | null = null
let modelLoader: GLTFLoader | null = null
let mixer: THREE.AnimationMixer | null = null
let currentAction: THREE.AnimationAction | null = null
let 最後に終了したアクション: THREE.AnimationAction | null = null
let modelSize: THREE.Vector3 | null = null
let destroyed = false
let lipCurrent = 0
const _lookAtPos = new THREE.Vector3()
let manualCameraAngle = 0
let manualCameraHeight = 0
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let dragStartCameraAngle = 0
let dragStartCameraHeight = 0
let cameraBaseY = 0
let cameraBaseZ = -1.1
let cameraDistanceScale = 1
let autoBodySettings: 自立身体制御設定 | null = null
let autoCameraSettings: 自動カメラワーク設定 | null = null
let stageResizeObserver: ResizeObserver | null = null

const モーション補間秒数 = 0.3
const 体姿勢補正秒数 = 0.42
const 体姿勢誤差許容 = 0.0001
const 視線補間速度 = 10
const カメラ高さ戻し速度 = 1.4
const カメラ目線オフセット = 0.18
const 視線補助最大ヨー角 = 48
const 視線補助最大ピッチ角 = 26

type 視線補助骨設定 = {
  node: THREE.Object3D
  初期姿勢: THREE.Quaternion
  ヨー倍率: number
  ピッチ倍率: number
}

type 視線補助設定 = {
  首: 視線補助骨設定 | null
  頭: 視線補助骨設定 | null
}

type 体姿勢状態 = {
  rotationY: number
  positionY: number
}

type 体姿勢補正設定 = {
  開始時刻: number
  開始回転Y: number
  開始位置Y: number
  完了後処理: (() => void) | null
}

type カメラ表示状態 = {
  angle: number
  radius: number
  displayedHeightOffset: number
  lookAtY: number
}

type VRMA再生設定 = {
  フォルダ名: string
  連続再生: boolean
  選択モード: 'サンプル巡回' | '標準巡回'
}

const _cameraPos = new THREE.Vector3()
const _cameraForward = new THREE.Vector3()
const _gazeEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const _gazeQuat = new THREE.Quaternion()
const _baseQuat = new THREE.Quaternion()
const _headWorldPos = new THREE.Vector3()
const _avatarWorldQuat = new THREE.Quaternion()
const _avatarWorldEuler = new THREE.Euler(0, 0, 0, 'YXZ')
let lookAtTarget: THREE.Object3D | null = null
let gazeAssistSettings: 視線補助設定 | null = null
let vrma再生準備中 = false
let vrma再生中 = false
let vrma連続再生有効 = false
let 体姿勢補正状態: 体姿勢補正設定 | null = null
let 現在VRMA再生設定: VRMA再生設定 | null = null
let 最後に再生したVRMAファイル: string | null = null
let シャッフル済みVRMAキュー: string[] = []
let vrma再生要求番号 = 0
let カメラ目線一時解除中 = false

function 視線補助骨作成(
  node: THREE.Object3D | null | undefined,
  ヨー倍率: number,
  ピッチ倍率: number,
): 視線補助骨設定 | null {
  if (!node) return null
  return {
    node,
    初期姿勢: node.quaternion.clone(),
    ヨー倍率,
    ピッチ倍率,
  }
}

function 視線補助初期化(vrm: any): 視線補助設定 | null {
  const humanoid = vrm?.humanoid
  if (!humanoid) return null

  const 首 = 視線補助骨作成(humanoid.getNormalizedBoneNode?.('neck') ?? null, 0.48, 0.3)
  const 頭 = 視線補助骨作成(humanoid.getNormalizedBoneNode?.('head') ?? null, 0.68, 0.4)
  if (!首 && !頭) return null

  return { 首, 頭 }
}

function 視線補助骨リセット(骨: 視線補助骨設定 | null) {
  if (!骨) return
  骨.node.quaternion.copy(骨.初期姿勢)
}

function 視線補助リセット(設定: 視線補助設定 | null) {
  if (!設定) return
  視線補助骨リセット(設定.首)
  視線補助骨リセット(設定.頭)
}

function 視線補助骨適用(骨: 視線補助骨設定 | null, yaw: number, pitch: number, blend: number) {
  if (!骨) return

  _gazeEuler.set(
    THREE.MathUtils.degToRad(pitch * 骨.ピッチ倍率),
    THREE.MathUtils.degToRad(yaw * 骨.ヨー倍率),
    0,
    'YXZ',
  )
  _gazeQuat.setFromEuler(_gazeEuler)
  骨.node.quaternion.slerp(_baseQuat.copy(骨.初期姿勢).multiply(_gazeQuat), blend)
}

function 目線ターゲット更新() {
  if (!camera || !lookAtTarget) return

  camera.getWorldPosition(_cameraPos)
  camera.getWorldDirection(_cameraForward)
  lookAtTarget.position.copy(_cameraPos).addScaledVector(_cameraForward, -カメラ目線オフセット)
  lookAtTarget.updateMatrixWorld()
  _lookAtPos.copy(lookAtTarget.position)
}

function 視線補助適用(delta: number) {
  if (!gazeAssistSettings || !currentVrm?.lookAt) return

  const yaw = THREE.MathUtils.clamp(currentVrm.lookAt.yaw ?? 0, -視線補助最大ヨー角, 視線補助最大ヨー角)
  const pitch = THREE.MathUtils.clamp(currentVrm.lookAt.pitch ?? 0, -視線補助最大ピッチ角, 視線補助最大ピッチ角)
  const blend = 1 - Math.exp(-delta * 視線補間速度)

  視線補助骨適用(gazeAssistSettings.首, yaw, pitch, blend)
  視線補助骨適用(gazeAssistSettings.頭, yaw, pitch, blend)
}

function 目線制御状態同期(enabled: boolean) {
  if (!currentVrm?.lookAt) return

  currentVrm.lookAt.autoUpdate = enabled
  currentVrm.lookAt.target = enabled ? lookAtTarget : null

  if (!enabled) {
    currentVrm.lookAt.reset()
    視線補助リセット(gazeAssistSettings)
  }
}

function 首顔カメラ目線有効(): boolean {
  return !カメラ目線一時解除中 && !vrma再生中
}

function 体姿勢取得(): 体姿勢状態 {
  if (!currentVrm?.scene) {
    return { rotationY: 0, positionY: 0 }
  }
  return {
    rotationY: currentVrm.scene.rotation.y,
    positionY: currentVrm.scene.position.y,
  }
}

function 体姿勢補正開始(完了後処理: (() => void) | null = null) {
  const 現在姿勢 = 体姿勢取得()
  if (
    Math.abs(現在姿勢.rotationY) <= 体姿勢誤差許容
    && Math.abs(現在姿勢.positionY) <= 体姿勢誤差許容
  ) {
    体姿勢補正状態 = null
    完了後処理?.()
    return
  }

  体姿勢補正状態 = {
    開始時刻: clock?.elapsedTime ?? 0,
    開始回転Y: 現在姿勢.rotationY,
    開始位置Y: 現在姿勢.positionY,
    完了後処理,
  }
  currentMotion.value = '体補正'
}

function 体姿勢補正更新(elapsed: number): 体姿勢状態 | null {
  if (!体姿勢補正状態) return null

  const progress = THREE.MathUtils.clamp(
    (elapsed - 体姿勢補正状態.開始時刻) / 体姿勢補正秒数,
    0,
    1,
  )
  const bodyState = {
    rotationY: THREE.MathUtils.lerp(体姿勢補正状態.開始回転Y, 0, progress),
    positionY: THREE.MathUtils.lerp(体姿勢補正状態.開始位置Y, 0, progress),
  }

  if (progress >= 1) {
    const 完了後処理 = 体姿勢補正状態.完了後処理
    体姿勢補正状態 = null
    完了後処理?.()
  }

  return bodyState
}

function 現在カメラ状態取得(設定: 自動カメラワーク設定, autoEnabled: boolean, elapsed: number): カメラ表示状態 {
  if (camera) {
    return {
      angle: Math.atan2(camera.position.x, -camera.position.z),
      radius: Math.hypot(camera.position.x, camera.position.z),
      displayedHeightOffset: camera.position.y - 設定.注視Y,
      lookAtY: 設定.注視Y,
    }
  }

  const angle = 設定.初期角度 + manualCameraAngle + (autoEnabled ? elapsed * 設定.角速度 : 0)
  const displayedHeightOffset = manualCameraHeight + (autoEnabled ? Math.sin(angle * 0.5) * 設定.高さ振幅 : 0)
  return {
    angle,
    radius: 設定.半径,
    displayedHeightOffset,
    lookAtY: 設定.注視Y,
  }
}

function カメラ自動有効(モード: '停止' | '追従' | '回転'): boolean {
  return モード !== '停止'
}

function カメラ回転モード(モード: '停止' | '追従' | '回転'): boolean {
  return モード === '回転'
}

function カメラ状態復元(
  設定: 自動カメラワーク設定,
  状態: カメラ表示状態,
  autoEnabled: boolean,
  elapsed: number,
) {
  設定.初期角度 = 状態.angle - manualCameraAngle - (autoEnabled ? elapsed * 設定.角速度 : 0)
  設定.半径 = 状態.radius
  設定.目標半径 = 状態.radius
  設定.注視Y = 状態.lookAtY
  manualCameraHeight = 状態.displayedHeightOffset - (autoEnabled ? Math.sin(状態.angle * 0.5) * 設定.高さ振幅 : 0)
}

function カメラ位置反映(mode: '停止' | '追従' | '回転', elapsed = clock?.elapsedTime ?? 0) {
  if (!camera || !autoCameraSettings) return
  if (mode === '回転') {
    自動カメラワーク適用(
      camera,
      elapsed,
      autoCameraSettings,
      manualCameraAngle,
      manualCameraHeight,
    )
  } else if (mode === '追従') {
    const 追従入力 = 自動カメラ追従入力取得()
    if (追従入力) {
      追従カメラワーク適用(
        camera,
        elapsed,
        autoCameraSettings,
        追従入力,
        manualCameraAngle,
        manualCameraHeight,
      )
    } else {
      手動カメラ周回適用(camera, autoCameraSettings, manualCameraAngle, manualCameraHeight, elapsed)
    }
  } else {
    手動カメラ周回適用(camera, autoCameraSettings, manualCameraAngle, manualCameraHeight, elapsed)
  }
}

function 追従角度差取得(追従入力: 自動カメラ追従入力): number {
  if (camera) {
    const 現在カメラ角度 = Math.atan2(camera.position.x, -camera.position.z)
    const 正面目標角 = THREE.MathUtils.euclideanModulo(追従入力.アバター向きY - Math.PI + Math.PI, Math.PI * 2) - Math.PI
    return Math.atan2(
      Math.sin(正面目標角 - 現在カメラ角度),
      Math.cos(正面目標角 - 現在カメラ角度),
    )
  }

  const 現在カメラ角度 = autoCameraSettings
    ? autoCameraSettings.初期角度 + manualCameraAngle
    : manualCameraAngle
  const 正面目標角 = THREE.MathUtils.euclideanModulo(追従入力.アバター向きY - Math.PI + Math.PI, Math.PI * 2) - Math.PI
  return Math.atan2(
    Math.sin(正面目標角 - 現在カメラ角度),
    Math.cos(正面目標角 - 現在カメラ角度),
  )
}

function カメラ高さ標準化更新(
  mode: '停止' | '追従' | '回転',
  delta: number,
  追従入力?: 自動カメラ追従入力,
) {
  if (delta <= 0) return

  let 高さ戻し有効 = mode === '回転'
  if (mode === '追従' && 追従入力) {
    高さ戻し有効 = Math.abs(追従角度差取得(追従入力)) <= THREE.MathUtils.degToRad(30)
  }
  if (!高さ戻し有効) return

  const blend = 1 - Math.exp(-delta * カメラ高さ戻し速度)
  manualCameraHeight = THREE.MathUtils.lerp(manualCameraHeight, 0, blend)
}

function 自動カメラ追従入力取得(): 自動カメラ追従入力 | undefined {
  if (!currentVrm || !modelSize) return undefined

  const 身体中心Y = currentVrm.scene.position.y + modelSize.y * 0.5
  const 頭node = gazeAssistSettings?.頭?.node
  const 頭位置Y = 頭node
    ? 頭node.getWorldPosition(_headWorldPos).y
    : currentVrm.scene.position.y + modelSize.y * 0.88
  currentVrm.scene.getWorldQuaternion(_avatarWorldQuat)
  _avatarWorldEuler.setFromQuaternion(_avatarWorldQuat, 'YXZ')

  return {
    アバター向きY: _avatarWorldEuler.y,
    身体中心Y,
    頭位置Y,
  }
}

function カメラ手動基準更新(autoEnabled: boolean) {
  if (!autoCameraSettings) return

  const elapsed = clock?.elapsedTime ?? 0
  const currentState = 現在カメラ状態取得(autoCameraSettings, autoEnabled, elapsed)
  manualCameraAngle = 0
  manualCameraHeight = 0
  カメラ状態復元(autoCameraSettings, currentState, autoEnabled, elapsed)
  autoCameraSettings.最終更新時刻 = elapsed
  if (autoEnabled) {
    cameraDistanceScale = autoCameraSettings.基準半径 > 0
      ? autoCameraSettings.半径 / autoCameraSettings.基準半径
      : cameraDistanceScale
    return
  }
  autoCameraSettings.目標半径 = autoCameraSettings.半径
  cameraDistanceScale = autoCameraSettings.基準半径 > 0
    ? autoCameraSettings.半径 / autoCameraSettings.基準半径
    : cameraDistanceScale
}

function fitCamera() {
  if (!camera || !modelSize) return

  const elapsed = clock?.elapsedTime ?? 0
  const cameraMode = 実効カメラモード.value
  const autoEnabled = カメラ回転モード(cameraMode)
  const previousSettings = autoCameraSettings
  const previousState = previousSettings
    ? 現在カメラ状態取得(previousSettings, autoEnabled, elapsed)
    : null

  const padding = 1.06
  const halfHeight = Math.max(0.1, modelSize.y * 0.5)
  const halfWidth = Math.max(0.1, modelSize.x * 0.5)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const distanceForHeight = halfHeight / Math.tan(verticalFov / 2)
  const distanceForWidth = halfWidth / Math.tan(horizontalFov / 2)
  const distance = Math.max(distanceForHeight, distanceForWidth) * padding * 0.54

  cameraBaseY = modelSize.y * 0.76
  cameraBaseZ = -Math.max(1.1, distance)
  autoBodySettings = currentVrm ? 自立身体制御初期化(currentVrm, modelSize) : null
  autoCameraSettings = 自動カメラワーク初期化(cameraBaseY, cameraBaseZ, modelSize)
  カメラ距離倍率適用(autoCameraSettings, cameraDistanceScale)
  if (previousState) {
    カメラ状態復元(autoCameraSettings, previousState, autoEnabled, elapsed)
  }
  カメラ位置反映(cameraMode, elapsed)
}

function resizeStage() {
  if (!renderer || !camera || !mountRef.value) return

  const width = mountRef.value.clientWidth || 1
  const height = mountRef.value.clientHeight || 1
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  fitCamera()
}

function stageResize監視開始() {
  if (!mountRef.value || typeof ResizeObserver === 'undefined') return

  stageResizeObserver?.disconnect()
  stageResizeObserver = new ResizeObserver(() => {
    resizeStage()
  })
  stageResizeObserver.observe(mountRef.value)
}

function モーション終了時処理(event: THREE.Event & { action?: THREE.AnimationAction }) {
  if (!event.action || event.action !== currentAction) return
  vrma再生中 = false
  最後に終了したアクション = event.action
  currentAction = null

  if (vrma連続再生有効 && 現在VRMA再生設定) {
    void VRMA再生開始(現在VRMA再生設定)
    return
  }

  if (実効自立身体制御有効.value) {
    currentMotion.value = '自立'
  }
}

function 配列シャッフル<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i] as T
    shuffled[i] = shuffled[j] as T
    shuffled[j] = temp
  }
  return shuffled
}

async function VRMAファイル一覧取得(設定: VRMA再生設定): Promise<string[]> {
  const files = await window.desktopApi?.listVrmaFiles?.(設定.フォルダ名)
  if (files && files.length > 0) {
    return files.filter((file) => file.toLowerCase().endsWith('.vrma'))
  }
  if (設定.フォルダ名 === SAMPLE_VRMA_FOLDER_NAME) {
    return [...SAMPLE_VRMA_FILES]
  }
  if (設定.フォルダ名 === STANDARD_VRMA_FOLDER_NAME) {
    return [...STANDARD_VRMA_FILES]
  }
  return []
}

async function 巡回キューからVRMAファイル選択(設定: VRMA再生設定): Promise<string> {
  if (シャッフル済みVRMAキュー.length === 0) {
    const files = await VRMAファイル一覧取得(設定)
    if (files.length === 0) return ''
    const reshuffled = 配列シャッフル(files)
    if (reshuffled.length > 1 && reshuffled[0] === 最後に再生したVRMAファイル) {
      const first = reshuffled.shift()
      if (first) reshuffled.push(first)
    }
    シャッフル済みVRMAキュー = reshuffled
  }

  const nextMotion = シャッフル済みVRMAキュー.shift() || ''
  最後に再生したVRMAファイル = nextMotion || null
  return nextMotion
}

async function サンプルVRMAファイル選択(設定: VRMA再生設定): Promise<string> {
  return 巡回キューからVRMAファイル選択(設定)
}

async function 標準VRMAファイル選択(設定: VRMA再生設定): Promise<string> {
  return 巡回キューからVRMAファイル選択(設定)
}

async function VRMAファイル選択(設定: VRMA再生設定): Promise<string> {
  if (設定.選択モード === '標準巡回') {
    return 標準VRMAファイル選択(設定)
  }
  return サンプルVRMAファイル選択(設定)
}

async function VRMA再生実行(設定: VRMA再生設定, requestId: number) {
  if (!motionLoader || !currentVrm || destroyed) return
  if (!mixer) {
    mixer = new THREE.AnimationMixer(currentVrm.scene)
    mixer.addEventListener('finished', モーション終了時処理)
  }

  const nextMotion = await VRMAファイル選択(設定)
  if (requestId !== vrma再生要求番号 || destroyed) return

  if (!nextMotion) {
    vrma再生準備中 = false
    vrma再生中 = false
    currentMotion.value = 'motion error'
    return
  }
  currentMotion.value = nextMotion.split('/').pop() || 'motion'

  motionLoader.load(
    nextMotion,
    (gltf: any) => {
      if (destroyed || requestId !== vrma再生要求番号 || !currentVrm || !mixer) return

      const vrmAnimation = gltf.userData?.vrmAnimations?.[0]
      if (!vrmAnimation) {
        vrma再生準備中 = false
        vrma再生中 = false
        カメラ目線一時解除中 = false
        目線制御状態同期(true)
        currentMotion.value = 'motion error'
        return
      }

      const clip = createVRMAnimationClip(vrmAnimation, currentVrm)
      const action = mixer.clipAction(clip)
      const previousAction = currentAction ?? 最後に終了したアクション

      action.reset()
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.enabled = true
      action.setEffectiveTimeScale(1)
      action.setEffectiveWeight(1)
      action.play()

      if (previousAction && previousAction !== action) {
        action.crossFadeFrom(previousAction, モーション補間秒数, false)
      }

      vrma再生準備中 = false
      vrma再生中 = true
      カメラ目線一時解除中 = false
      mixer.timeScale = 1
      最後に終了したアクション = null
      currentAction = action
      目線制御状態同期(true)
    },
    undefined,
    () => {
      if (requestId !== vrma再生要求番号) return
      vrma再生準備中 = false
      vrma再生中 = false
      カメラ目線一時解除中 = false
      目線制御状態同期(true)
      currentMotion.value = 'motion error'
    },
  )
}

async function VRMA再生開始(options: VRMA再生設定) {
  if (!motionLoader || !currentVrm || destroyed) return

  const requestId = ++vrma再生要求番号
  現在VRMA再生設定 = {
    フォルダ名: options.フォルダ名,
    連続再生: options.連続再生,
    選択モード: options.選択モード,
  }
  vrma連続再生有効 = options.連続再生
  vrma再生準備中 = true
  カメラ目線一時解除中 = true
  目線制御状態同期(false)

  体姿勢補正開始(() => {
    if (!現在VRMA再生設定) return
    void VRMA再生実行(現在VRMA再生設定, requestId)
  })
}

function サンプルVRMA再生開始() {
  シャッフル済みVRMAキュー = []
  void VRMA再生開始({
    フォルダ名: SAMPLE_VRMA_FOLDER_NAME,
    連続再生: true,
    選択モード: 'サンプル巡回',
  })
}

function 標準VRMA再生開始() {
  シャッフル済みVRMAキュー = []
  void VRMA再生開始({
    フォルダ名: STANDARD_VRMA_FOLDER_NAME,
    連続再生: true,
    選択モード: '標準巡回',
  })
}

function initScene() {
  if (!mountRef.value) return

  loading.value = true
  loadError.value = ''

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  mountRef.value.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  lookAtTarget = new THREE.Object3D()
  lookAtTarget.visible = false
  scene.add(lookAtTarget)
  camera = new THREE.PerspectiveCamera(28, 1, 0.01, 40)
  clock = new THREE.Clock()

  const ambient = new THREE.AmbientLight(0xffffff, 1.25)
  const keyLight = new THREE.DirectionalLight(0xfff5e6, Math.PI * 0.74)
  keyLight.position.set(1.2, 1.5, 1.1)
  const rimLight = new THREE.DirectionalLight(0xdde8ff, 1.05)
  rimLight.position.set(-1.3, 0.7, 1.3)

  const container = new THREE.Group()
  container.rotation.y = Math.PI

  scene.add(ambient, keyLight, rimLight, container)

  modelLoader = new GLTFLoader()
  modelLoader.register((parser: any) => new VRMLoaderPlugin(parser))

  motionLoader = new GLTFLoader()
  motionLoader.register((parser: any) => new VRMAnimationLoaderPlugin(parser))

  modelLoader.load(
    DEFAULT_VRM_MODEL_URL,
    (gltf: any) => {
      if (destroyed || !scene) return

      const vrm = gltf.userData?.vrm
      if (!vrm) {
        loadError.value = 'VRM を読み込めませんでした。'
        loading.value = false
        return
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.removeUnnecessaryJoints(gltf.scene)
      vrm.scene.traverse((object: THREE.Object3D) => {
        object.frustumCulled = false
      })

      const box = new THREE.Box3().setFromObject(vrm.scene)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())

      vrm.scene.position.x -= center.x
      vrm.scene.position.y -= box.min.y
      vrm.scene.position.z -= center.z

      modelSize = size.clone()
      currentVrm = vrm
      gazeAssistSettings = 視線補助初期化(vrm)
      目線制御状態同期(true)
      container.add(vrm.scene)
      fitCamera()
      if (実効自立身体制御有効.value) {
        autoBodySettings = currentVrm ? 自立身体制御初期化(currentVrm, modelSize) : autoBodySettings
        標準VRMA再生開始()
      } else {
        サンプルVRMA再生開始()
      }
      loading.value = false
    },
    undefined,
    (error: unknown) => {
      loadError.value = error instanceof Error ? error.message : 'VRM の読み込みに失敗しました。'
      loading.value = false
    },
  )

  const animate = () => {
    if (!renderer || !scene || !camera || !clock || destroyed) return

    const delta = clock.getDelta()
    const elapsed = clock.elapsedTime

    if ((vrma再生中 || (!実効自立身体制御有効.value && !vrma再生準備中)) && !体姿勢補正状態) {
      mixer?.update(delta)
    }

    if (currentVrm) {
      const blink = Math.sin(elapsed * 2.4) > 0.985 ? 1 : 0
      const 補正姿勢 = 体姿勢補正更新(elapsed)
      const bodyState = 補正姿勢 ?? (
        実効自立身体制御有効.value && autoBodySettings
          ? 自立身体制御適用(elapsed, autoBodySettings)
          : { rotationY: 0, positionY: 0 }
      )

      currentVrm.expressionManager?.setValue('blink', blink)
      currentVrm.expressionManager?.setValue('aa', Math.min(1, props.speakerLevel))
      currentVrm.scene.rotation.y = bodyState.rotationY
      currentVrm.scene.position.y = bodyState.positionY
      const 追従入力 = 自動カメラ追従入力取得()
      カメラ高さ標準化更新(実効カメラモード.value, delta, 追従入力)
      カメラ位置反映(実効カメラモード.value, elapsed)
      if (currentVrm.lookAt && !カメラ目線一時解除中) {
        目線ターゲット更新()
        currentVrm.lookAt.lookAt(_lookAtPos)
        if (首顔カメラ目線有効()) {
          視線補助適用(delta)
        } else {
          視線補助リセット(gazeAssistSettings)
        }
      }
      currentVrm.update(delta)
    }

    renderer.render(scene, camera)
    frameHandle = window.requestAnimationFrame(animate)
  }

  resizeStage()
  stageResize監視開始()
  window.addEventListener('resize', resizeStage)
  animate()
}

function handlePointerDown(event: PointerEvent) {
  if (!mountRef.value) return
  カメラ手動基準更新(カメラ回転モード(実効カメラモード.value))
  dragging.value = true
  dragPointerId = event.pointerId
  dragStartX = event.clientX
  dragStartY = event.clientY
  dragStartCameraAngle = manualCameraAngle
  dragStartCameraHeight = manualCameraHeight
  mountRef.value.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value || dragPointerId !== event.pointerId) return
  const deltaX = event.clientX - dragStartX
  const deltaY = event.clientY - dragStartY
  manualCameraAngle = dragStartCameraAngle + deltaX * 0.0085
  manualCameraHeight = THREE.MathUtils.clamp(dragStartCameraHeight + deltaY * 0.006, -1.2, 1.2)
}

function stopPointerDrag(event?: PointerEvent) {
  if (mountRef.value && dragPointerId !== null && event?.pointerId === dragPointerId) {
    mountRef.value.releasePointerCapture(dragPointerId)
  }
  dragging.value = false
  dragPointerId = null
}

function handleWheel(event: WheelEvent) {
  if (!event.ctrlKey || !camera || !autoCameraSettings) return
  event.preventDefault()

  const cameraMode = 実効カメラモード.value
  const autoEnabled = カメラ自動有効(cameraMode)
  カメラ手動基準更新(カメラ回転モード(cameraMode))

  const currentRadius = autoCameraSettings.半径
  const nextRadius = THREE.MathUtils.clamp(
    currentRadius * (event.deltaY > 0 ? 1.08 : 0.92),
    autoCameraSettings.最小半径,
    autoCameraSettings.最大半径,
  )
  autoCameraSettings.半径 = nextRadius
  autoCameraSettings.最終更新時刻 = clock?.elapsedTime ?? 0
  if (autoEnabled) {
    autoCameraSettings.目標半径 = autoCameraSettings.基準半径
    cameraDistanceScale = 1
  } else {
    cameraDistanceScale = autoCameraSettings.基準半径 > 0
      ? nextRadius / autoCameraSettings.基準半径
      : cameraDistanceScale
    カメラ距離倍率即時適用(autoCameraSettings, cameraDistanceScale)
  }

  カメラ位置反映(cameraMode)
}

function 表示復帰() {
  resizeStage()
  clock?.getDelta()

  if (mixer) {
    mixer.timeScale = 1
  }
  if (currentAction) {
    currentAction.paused = false
    currentAction.enabled = true
    currentAction.play()
  }
  if (renderer && scene && camera) {
    renderer.render(scene, camera)
  }

  if (!currentVrm || vrma再生準備中 || vrma再生中 || currentAction) return

  if (実効自立身体制御有効.value) {
    標準VRMA再生開始()
    return
  }
  サンプルVRMA再生開始()
}

function 表示更新() {
  表示復帰()
}

function ページ表示復帰処理() {
  if (document.visibilityState === 'hidden') return
  window.requestAnimationFrame(() => {
    表示復帰()
  })
}

watch(() => 実効自立身体制御有効.value, (enabled) => {
  if (!currentVrm) return

  if (enabled) {
    vrma再生準備中 = false
    vrma再生中 = false
    vrma連続再生有効 = false
    体姿勢補正状態 = null
    autoBodySettings = modelSize ? 自立身体制御初期化(currentVrm, modelSize) : autoBodySettings
    標準VRMA再生開始()
    return
  }

  if (autoBodySettings) {
    自立身体制御リセット(autoBodySettings)
  }
  サンプルVRMA再生開始()
}, { immediate: false })

watch(() => 実効カメラモード.value, (mode, previousMode) => {
  if (!autoCameraSettings) return
  const oldEnabled = カメラ回転モード(previousMode ?? mode)
  const nextEnabled = カメラ回転モード(mode)
  const elapsed = clock?.elapsedTime ?? 0
  const previousState = 現在カメラ状態取得(autoCameraSettings, oldEnabled, elapsed)
  manualCameraAngle = 0
  manualCameraHeight = 0
  カメラ状態復元(autoCameraSettings, previousState, nextEnabled, elapsed)
  autoCameraSettings.最終更新時刻 = elapsed
  カメラ位置反映(mode, elapsed)
})

watch(() => props.uiVisible, (visible) => {
  if (!visible) return
  ページ表示復帰処理()
})

onMounted(() => {
  initScene()
  window.addEventListener('focus', ページ表示復帰処理)
  window.addEventListener('pageshow', ページ表示復帰処理)
  document.addEventListener('visibilitychange', ページ表示復帰処理)
})

onBeforeUnmount(() => {
  destroyed = true
  window.cancelAnimationFrame(frameHandle)
  window.removeEventListener('resize', resizeStage)
  window.removeEventListener('focus', ページ表示復帰処理)
  window.removeEventListener('pageshow', ページ表示復帰処理)
  document.removeEventListener('visibilitychange', ページ表示復帰処理)
  stageResizeObserver?.disconnect()
  stageResizeObserver = null
  mixer?.removeEventListener('finished', モーション終了時処理)
  mixer?.stopAllAction()
  currentAction = null
  最後に終了したアクション = null
  vrma再生準備中 = false
  vrma再生中 = false
  vrma連続再生有効 = false
  カメラ目線一時解除中 = false
  体姿勢補正状態 = null
  現在VRMA再生設定 = null
  最後に再生したVRMAファイル = null
  シャッフル済みVRMAキュー = []
  視線補助リセット(gazeAssistSettings)
  renderer?.dispose()
  if (currentVrm?.lookAt) {
    currentVrm.lookAt.target = null
  }
  currentVrm = null
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement)
  }
  renderer = null
  scene = null
  camera = null
  clock = null
  autoBodySettings = null
  autoCameraSettings = null
  gazeAssistSettings = null
  lookAtTarget = null
})

defineExpose({ VRMA再生開始, 表示更新, 表示復帰 })
</script>

<template>
  <section class="avatar-stage-shell" :class="{ transparent: transparentMode, 'controls-hidden': !controlsVisible }">
    <div
      ref="mountRef"
      class="canvas-host"
      data-interactive="true"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="stopPointerDrag"
      @pointercancel="stopPointerDrag"
      @pointerleave="stopPointerDrag"
      @wheel="handleWheel"
    ></div>
    <div v-if="controlsVisible" class="glow glow-a" :style="{ opacity: micLevel * 0.7 }"></div>
    <div v-if="controlsVisible" class="glow glow-b" :style="{ opacity: speakerLevel * 0.7 }"></div>

    <div v-if="controlsVisible && subtitleText" class="avatar-subtitle">
      {{ subtitleText }}
    </div>

    <div v-if="controlsVisible && !transparentMode" class="avatar-control-settings">
      <label class="setting-checkbox experimental-setting">
        <input v-model="自立身体制御有効" type="checkbox" />
        <span>不完全な自立身体制御</span>
      </label>
      <label class="setting-checkbox experimental-setting">
        <input v-model="自動カメラワーク有効" type="checkbox" />
        <span>不完全な自動カメラワーク</span>
      </label>
      <div class="setting-row camera-mode-row">
        <label class="setting-radio camera-mode-option" :class="{ disabled: !自動カメラワーク有効 }">
          <input v-model="カメラモード" type="radio" value="追従" :disabled="!自動カメラワーク有効" />
          <span>追従</span>
        </label>
        <label class="setting-radio camera-mode-option" :class="{ disabled: !自動カメラワーク有効 }">
          <input v-model="カメラモード" type="radio" value="回転" :disabled="!自動カメラワーク有効" />
          <span>回転</span>
        </label>
      </div>
    </div>

    <div v-if="!transparentMode && loading" class="stage-loading">
      <img src="/icons/loading.gif" alt="loading" />
    </div>

    <div v-else-if="!transparentMode && loadError" class="stage-status error">
      <img src="/icons/abort.png" alt="error" />
      <span>{{ loadError }}</span>
    </div>

  </section>
</template>

<style scoped>
.avatar-stage-shell {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 18%, rgba(255, 198, 86, 0.14), transparent 28%),
    radial-gradient(circle at 78% 78%, rgba(107, 149, 255, 0.12), transparent 24%),
    linear-gradient(180deg, rgba(7, 9, 15, 0.18), rgba(7, 9, 15, 0.04));
}

.avatar-stage-shell.transparent {
  background: transparent;
}

.avatar-stage-shell.controls-hidden .canvas-host {
  cursor: default;
}

.avatar-stage-shell.controls-hidden .canvas-host:active {
  cursor: default;
}

.canvas-host {
  position: absolute;
  inset: 0;
  cursor: grab;
  touch-action: none;
  z-index: 1;
}

.canvas-host:active {
  cursor: grabbing;
}

.glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(54px);
  pointer-events: none;
  z-index: 0;
}

.glow-a {
  width: 220px;
  height: 220px;
  top: 10%;
  left: 6%;
  background: rgba(220, 50, 50, 0.75);
}

.glow-b {
  width: 240px;
  height: 240px;
  top: 10%;
  right: 6%;
  background: rgba(0, 210, 220, 0.75);
}

.avatar-subtitle {
  position: absolute;
  left: 50%;
  bottom: 62px;
  transform: translateX(-50%);
  width: min(520px, calc(100% - 32px));
  padding: 10px 14px;
  border: 1px solid rgba(153, 141, 214, 0.34);
  background: rgba(3, 5, 10, 0.52);
  color: #00ff00;
  text-align: center;
  font-size: 1.425rem;
  line-height: 1.5;
  backdrop-filter: blur(12px);
  pointer-events: none;
  z-index: 6;
  white-space: pre-wrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.avatar-control-settings {
  position: absolute;
  right: 12px;
  bottom: 12px;
  min-height: 34px;
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  padding: 0;
}

.setting-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #f4f4ff;
  font-size: 10px;
  line-height: 1.2;
  user-select: none;
  cursor: pointer;
}

.experimental-setting {
  box-sizing: border-box;
  justify-content: flex-start;
  width: 140px;
}

.setting-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.camera-mode-row {
  box-sizing: border-box;
  justify-content: flex-start;
  width: 140px;
  padding-left: 16px;
}

.camera-mode-option {
  min-width: 34px;
}

.setting-checkbox input {
  width: 12px;
  height: 12px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(244, 244, 255, 0.82);
  border-radius: 2px;
  background: transparent;
  box-shadow: none;
  display: inline-grid;
  place-content: center;
  cursor: pointer;
}

.setting-checkbox input::before {
  content: '';
  width: 6px;
  height: 6px;
  transform: scale(0);
  transition: transform 0.12s ease;
  background: #44ff44;
}

.setting-checkbox input:checked::before {
  transform: scale(1);
}

.setting-radio {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #f4f4ff;
  font-size: 10px;
  line-height: 1.2;
  user-select: none;
  cursor: pointer;
}

.setting-radio.disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.setting-radio input[type="radio"] {
  width: 11px;
  height: 11px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid rgba(244, 244, 255, 0.82);
  border-radius: 50%;
  background: transparent;
  display: inline-grid;
  place-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.setting-radio input[type="radio"]::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: scale(0);
  transition: transform 0.12s ease;
  background: #44ff44;
}

.setting-radio input[type="radio"]:checked::before {
  transform: scale(1);
}

.setting-radio input[type="radio"]:disabled {
  cursor: not-allowed;
}

.stage-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.stage-loading img {
  width: 96px;
  height: 96px;
  object-fit: contain;
  opacity: 0.92;
}

.stage-status {
  position: absolute;
  left: 18px;
  bottom: 18px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(153, 141, 214, 0.38);
  background: rgba(3, 5, 10, 0.42);
  color: #f4f4ff;
  backdrop-filter: blur(12px);
  font-size: 0.8rem;
}

.stage-status img {
  width: 18px;
  height: 18px;
}

.stage-status.error {
  color: #ffd3d3;
  border-color: rgba(255, 131, 131, 0.26);
}

@media (max-width: 720px) {
  .avatar-subtitle {
    bottom: 56px;
    width: calc(100% - 24px);
    font-size: 1.32rem;
  }

  .stage-status {
    left: 12px;
    right: 12px;
    bottom: 12px;
  }
}
</style>
