# 3D アバター制御 (Three.js VRM)

> 文書: `frontend_avatar,3Dアバター制御(Three.js VRM).md` | 実装: `frontend_avatar/src/components/AIコア_アバター.vue`, `frontend_avatar/src/components/AIコア_自立身体制御.ts`, `frontend_avatar/src/components/AIコア_自動カメラワーク.ts`

## このメモを使う場面

- 3D アバターの描画・読み込みロジックを変更するとき
- VRMA モーションの再生・連続再生・シャッフルを変更するとき
- 視線補助（首・頭ボーン操作）を調整するとき
- リップシンクの表情制御を変更するとき
- カメラモード（追従/回転/停止）を追加・変更するとき
- 自立身体制御（アイドル揺れ・腕の動き）を調整するとき

## アーキテクチャ

```text
AIコア_アバター.vue（アバター描画 + VRMA再生 + 視線 + リップシンク + カメラ）
  ├─ AIコア_自立身体制御.ts（アイドル時の体揺れ・腕重力）
  └─ AIコア_自動カメラワーク.ts（3 カメラモード + 距離制御）
```

## VRM モデル読み込み

```typescript
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'

// モデル読み込み
modelLoader = new GLTFLoader()
modelLoader.register((parser) => new VRMLoaderPlugin(parser))
modelLoader.load(DEFAULT_VRM_MODEL_URL, (gltf) => { ... })

// モーション読み込み（別ローダー）
motionLoader = new GLTFLoader()
motionLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))
```

| 項目 | 値 |
|------|-----|
| モデルURL | `/vrm/VRM_AiDiy.vrm`（`DEFAULT_VRM_MODEL_URL`） |
| レンダラー | `WebGLRenderer`（`antialias: true`, `alpha: true`） |
| 背景色 | 透明（`setClearColor(0x000000, 0)`） |
| FOV | 28° |
| カメラ距離 | モデルサイズに応じて自動計算（`fitCamera()`） |

### 読み込み後処理

1. `VRMUtils.removeUnnecessaryVertices()` / `removeUnnecessaryJoints()` で不要データ削除
2. `object.frustumCulled = false` で全オブジェクトのカリング無効化
3. BoundingBox でモデルサイズ計測 → 中心補正（`position -= center`）
4. `視線補助初期化()` で首/頭ボーン取得
5. `fitCamera()` でカメラ位置自動調整
6. 自動モーション再生開始

## VRMA モーション再生

### 再生パイプライン

```text
VRMA再生開始()
  → カメラ目線一時解除 + 目線制御OFF
  → 体姿勢補正開始() → 姿勢ゼロへ lerp（0.42s）
  → VRMA再生実行()
    → VRMAファイル選択() → シャッフルキューから選択
    → motionLoader.load() → createVRMAAnimationClip() → mixer.clipAction()
    → crossFadeFrom(前のアクション, 0.3s)
    → play() + LoopOnce + clampWhenFinished
  → モーション終了時処理()
    → 連続再生ON → 次のVRMA再生開始
    → 連続再生OFF → 自立身体制御へ復帰
```

### 連続再生・シャッフル

- `VRMA再生設定`: `{ フォルダ名, 連続再生, 選択モード: 'サンプル巡回' | '標準巡回' }`
- キューは Fisher-Yates シャッフル＋直前ファイル重複防止
- Electron では `window.desktopApi.listVrmaFiles()` で実ファイル一覧取得、なければ定数フォールバック

| フォルダ | 定数 | ファイル数 |
|---------|------|-----------|
| サンプル | `SAMPLE_VRMA_FILES` | 7 |
| 標準 | `STANDARD_VRMA_FILES` | 5 |

### キュー世代管理

`vrma再生要求番号` で世代管理。連続した再生要求のうち古いものを破棄。

## 視線補助（Gaze Assistance）

首（neck）と頭（head）のボーンを操作し、カメラ方向への視線を補強します。

| ボーン | ヨー倍率 | ピッチ倍率 |
|-------|---------|-----------|
| 首 (neck) | 0.48 | 0.3 |
| 頭 (head) | 0.68 | 0.4 |

```typescript
// 視線補助適用（毎フレーム）
_gazeEuler.set(pitch * ピッチ倍率, yaw * ヨー倍率, 0, 'YXZ')
_gazeQuat.setFromEuler(_gazeEuler)
骨.node.quaternion.slerp(初期姿勢 × _gazeQuat, blend)
// blend = 1 - exp(-delta * 視線補間速度(10))
```

- `視線補助最大ヨー角 = 48°` / `視線補助最大ピッチ角 = 26°` でクランプ
- `首顔カメラ目線有効()` が false の間は視線補助リセット
  - false 条件: `カメラ目線一時解除中` || `vrma再生中`
- `目線ターゲット(lookAtTarget)` はカメラ位置から 0.18m 手前に配置

## リップシンク・表情

毎フレームのアニメーションループで適用:

```typescript
// まばたき（約 2.4Hz の正弦波、ピーク時のみ閉じる）
const blink = Math.sin(elapsed * 2.4) > 0.985 ? 1 : 0
currentVrm.expressionManager?.setValue('blink', blink)

// リップシンク（スピーカーレベル → aa 表情）
currentVrm.expressionManager?.setValue('aa', Math.min(1, props.speakerLevel))
```

## 体姿勢補正（Body Pose Correction）

VRMA モーション再生前に、現在の体の回転・位置をゼロへ戻します。

```typescript
体姿勢補正秒数 = 0.42
体姿勢誤差許容 = 0.0001

// lerp(現在Y, 0, progress) で 0.42s かけて補正
// 補正完了後 → VRMA再生実行 or コールバック呼び出し
```

## 自立身体制御（AIコア_自立身体制御.ts）

VRMA 非再生時のアイドル動作を生成します。

```typescript
export type 自立身体制御設定 = {
  回転振幅: number     // 0.08（体の左右揺れ最大値）
  回転速度: number     // 0.28
  上下振幅: number     // 0.01（上下動最大値）
  上下速度: number     // 0.9
  腕補間率: number     // 0.035（腕の目標姿勢への補間速度）
  左上腕 / 右上腕 / 左前腕 / 右前腕: 腕制御設定 | null
}
```

| ボーン | 回転差分 (Euler) |
|-------|----------------|
| leftUpperArm | `(0.04, 0, -0.16)` |
| rightUpperArm | `(0.04, 0, 0.16)` |
| leftLowerArm | `(0.02, 0, -0.06)` |
| rightLowerArm | `(0.02, 0, 0.06)` |

```typescript
// 毎フレーム適用
rotationY = sin(elapsed * 回転速度) * 回転振幅  // ゆっくり左右に揺れる
positionY = sin(elapsed * 上下速度) * 上下振幅   // 小さく上下動
// 腕は slerp(目標姿勢, 腕補間率) で徐々に目標へ
```

## カメラワーク（AIコア_自動カメラワーク.ts）

### 3 つのカメラモード

| モード | 動作 | 有効条件 |
|-------|------|---------|
| `回転` | 自動で約 9 秒周回。高さは正弦波 | 自動カメラワーク有効 + モード='回転' |
| `追従` | アバターの向きに追従。角度差 30° 以上で距離拡大 | 自動カメラワーク有効 + モード='追従' |
| `停止` | 初期位置固定、手動操作のみ | 自動カメラワーク無効 |

### パラメータ

```typescript
export type 自動カメラワーク設定 = {
  基準半径: number
  半径: number           // 現在の半径（補間中）
  目標半径: number       // lerp 目標
  最小半径: 基準半径 * 0.12
  最大半径: 基準半径 * 3.2
  注視Y: number
  角速度: (Math.PI * 2) / 9  // 約 9 秒/周
  高さ振幅: modelSize.y * 0.018
  半径補間速度: -ln(0.05) / 9s  // 1周で95%収束
  角度補間速度: 1.6
  注視補間速度: 2.2
}
```

### 手動操作

| 操作 | 効果 |
|------|------|
| ドラッグ | 角度オフセット (`0.0085 rad/px`) + 高さオフセット (`0.006/px`, clamp ±1.2) |
| Ctrl + ホイール | 距離スケール変更（`×1.08` / `×0.92`、最小〜最大半径でクランプ） |
| 手動操作後もカメラモード有効なら自動動作出続行 |

### カメラ距離倍率

`カメラ距離倍率適用(設定, 倍率)` で基準半径に対する倍率を設定。ホイール操作は `cameraDistanceScale` に記憶され、`fitCamera()` 呼び出しで復元されます。

## 灯光

```typescript
const ambient = new THREE.AmbientLight(0xffffff, 1.25)
const keyLight = new THREE.DirectionalLight(0xfff5e6, Math.PI * 0.74)
keyLight.position.set(1.2, 1.5, 1.1)  // 右上前方
const rimLight = new THREE.DirectionalLight(0xdde8ff, 1.05)
rimLight.position.set(-1.3, 0.7, 1.3) // 左上前方
```

## 破棄処理（onBeforeUnmount）

主要なクリーンアップ項目:
1. `cancelAnimationFrame` でアニメーションループ停止
2. `resize` / `focus` / `pageshow` / `visibilitychange` リスナー解除
3. `ResizeObserver` 切断
4. `AnimationMixer` の全アクション停止＋リスナー解除
5. 視線補助リセット（ボーン姿勢復元）
6. `renderer.dispose()` で WebGL リソース解放
7. 全参照を `null` に設定

## ライフサイクル

| イベント | 処理 |
|---------|------|
| onMounted | `initScene()` → VRM 読み込み → アニメーション開始 |
| focus / pageshow / visibilitychange | `表示復帰()` → resize + mixer 再開 + モーション復帰 |
| uiVisible watch | 表示復帰 |
| 破棄 | onBeforeUnmount で全リソース解放 |

## 注意点

- **transparentMode**: `true` のとき背景完全透明＋コントロール非表示。サブウィンドウ表示用
- **controlsVisible**: `false` でドラッグ制御も無効化（cursor: default）
- **VRMA ファイル不在**: `listVrmaFiles()` が空の場合、定数リストにフォールバック。それも空なら `motion error`
- **カメラ目線と VRMA の競合**: VRMA 再生中は `カメラ目線一時解除中 = true` として目線制御を OFF に。VRMA 側が目線を動かすため
- **フェードアウト競合**: 連続キャンセルや高速モーション切り替えは `vrma再生要求番号` で世代管理
- **fitCamera 呼び出し**: resize 時と VRM 読み込み完了時に自動実行。前のカメラ状態を維持したまま再計算
