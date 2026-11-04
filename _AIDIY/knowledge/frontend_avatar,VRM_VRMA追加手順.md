# VRM・VRMA 追加手順

> 文書: `frontend_avatar,VRM_VRMA追加手順.md` | 実装: `frontend_avatar/public/vrm/`, `frontend_avatar/public/vrma/`, `frontend_avatar/src/components/AIコア_アバター.vue`

## このメモを使う場面
- アバターに新しい VRM モデルを追加する
- 新しい VRMA モーションを追加する
- Electron / Web 両方でモデルやモーション一覧を扱う

## 関連ファイル
- `frontend_avatar/public/vrm/` — VRM モデル格納フォルダ
- `frontend_avatar/public/vrma/` — VRMA モーション格納フォルダ
- `frontend_avatar/src/api/config.ts` — VRM / VRMA の既定値と Web フォールバック一覧
- `frontend_avatar/src/components/AIコア_アバター.vue` — Three.js + @pixiv/three-vrm 実装
- `frontend_avatar/electron/main.ts` — `desktop:list-vrma-files` IPC
- `_AIDIY/knowledge/frontend_avatar,frontend_web,アバター表示とVRMA.md` — 表示サイズ、向き、連続再生の調整知見

## 基本方針
- VRM は `frontend_avatar/public/vrm/` に置く。
- VRMA は `frontend_avatar/public/vrma/<フォルダ名>/` に置く。現行フォルダは `サンプル` / `標準`。
- Web モードでは `config.ts` の配列が一覧フォールバックになる。
- Electron モードでは `desktop:list-vrma-files` が実ファイル一覧を優先する。
- モーションは `THREE.LoopRepeat` 固定ではなく、`finished` イベントで次の VRMA を選び直す巡回再生方式に合わせる。

## config.ts の確認箇所

```typescript
export const DEFAULT_VRM_MODEL_URL = '/vrm/VRM_AiDiy.vrm'
export const SAMPLE_VRMA_FOLDER_NAME = 'サンプル'
export const STANDARD_VRMA_FOLDER_NAME = '標準'

export const SAMPLE_VRMA_FILES = [
  '/vrma/サンプル/VRMA_01.vrma',
]
export const STANDARD_VRMA_FILES = [
  '/vrma/標準/VRMA_01.vrma',
]
```

## VRM モデル追加手順
1. `frontend_avatar/public/vrm/` に `.vrm` ファイルを置く。
2. 既定モデルにする場合は `DEFAULT_VRM_MODEL_URL` を更新する。
3. 設定画面で切り替える場合は、モデル一覧を管理している箇所にも追加する。
4. `AIコア_アバター.vue` の `loadVrm()` が参照する URL と向き・サイズ調整を確認する。

## VRMA モーション追加手順
1. `frontend_avatar/public/vrma/<フォルダ名>/` に `.vrma` ファイルを置く。
2. Web モードのため、`config.ts` の `SAMPLE_VRMA_FILES` または `STANDARD_VRMA_FILES` へ追加する。
3. Electron モードでは `window.desktopApi?.listVrmaFiles?.(folderName)` が実ファイルを列挙するため、`config.ts` 未記載のファイルも取得できる。
4. 追加した VRMA が短すぎる / 姿勢差が大きい場合は、`AIコア_アバター.vue` の cross fade と終了イベント処理を確認する。

## Electron IPC の扱い

```typescript
const vrmaFiles = await window.desktopApi?.listVrmaFiles?.(SAMPLE_VRMA_FOLDER_NAME)
// string[] | undefined。フォルダが存在しない場合は空配列想定。
```

IPC を変更する場合は `_AIDIY/knowledge/frontend_avatar,ElectronIPC追加手順.md` の main.ts / preload.ts / env.d.ts 3 点セットに従う。

## 注意点
- ファイル名やフォルダ名は URL として参照される。日本語フォルダは Vite 経由で取得できるが、ブラウザでは URL エンコードも確認する。
- VRMA ファイルや設定 JSON は UTF-8 BOM なしを優先する。
- 既定モデルの変更時は、カメラ距離、初期回転、口パク BlendShape 名の差を確認する。
- Electron と Web で一覧取得経路が違うため、片方だけで確認して終わらせない。

## 確認方法
1. `cd frontend_avatar && npm run type-check`
2. `npm run dev` で Web モードまたは Electron を起動する。
3. アバターが正面を向き、画面内に収まることを確認する。
4. 追加 VRMA が選択・巡回再生され、終了後に停止しないことを確認する。
5. DevTools Console と Network で `.vrm` / `.vrma` の 404 や decode エラーがないことを確認する。
