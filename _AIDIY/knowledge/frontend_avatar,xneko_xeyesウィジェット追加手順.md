# xneko・xeyes ウィジェット追加手順

> 文書: `frontend_avatar,xneko_xeyesウィジェット追加手順.md` | 実装: `frontend_avatar/src/components/AIコア.vue`, `frontend_avatar/src/components/AIコア_xneko.vue`

## このメモを使う場面
- `AIコア.vue` の `表示選択` に新しいウィジェットを追加する
- xneko / xeyes のような Electron / Web 両対応ウィジェットを作る
- OS カーソル位置、CPU 使用率、スプライトアニメーションを扱う

## 関連ファイル
- `frontend_avatar/src/components/AIコア.vue` — `表示選択` の型、option、表示切替
- `frontend_avatar/src/components/AIコア_xneko.vue` — スプライトアニメーションの参考
- `frontend_avatar/src/components/AIコア_xeyes.vue` — CPU 連動、目線追従、オプションパネルの参考
- `frontend_avatar/public/oneko.gif` / `xneko_chatora.gif` / `xneko_mike.gif` — スプライトシート
- `_AIDIY/knowledge/frontend_avatar,ElectronIPC追加手順.md` — OS カーソル位置や CPU 使用率 IPC の追加手順

## 表示選択への追加手順

```typescript
// 1. 型に追加
type 表示選択型 =
  | 'アバター'
  | 'カレンダーα'
  | 'xneko(猫)'
  | 'xeyes(目)'
  | 'アナログ時計'
  | 'デジタル時計'
  | 'カレンダー'
  | '無し'
  | '新ウィジェット名'

// 2. import 追加
import NewWidget from './AIコア_新ウィジェット.vue'
```

```vue
<!-- 3. select option 追加 -->
<option value="新ウィジェット名">新ウィジェット名</option>

<!-- 4. 表示切替へ追加 -->
<component
  :is="NewWidget"
  v-if="表示選択 === '新ウィジェット名'"
  :controls-visible="controlsVisible"
/>
```

## ウィジェットコンポーネントの基本形

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(defineProps<{ controlsVisible?: boolean }>(), {
  controlsVisible: true,
})
</script>

<template>
  <div class="widget-stage">
    <div class="widget-main">...</div>
    <div v-if="props.controlsVisible" class="widget-options">...</div>
  </div>
</template>

<style scoped>
.widget-stage {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  background: transparent;
}

.widget-options {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 4;
  pointer-events: all;
  user-select: none;
}
</style>
```

- `controlsVisible=false` のときはオプションパネル、補助UI、デバッグ表示を隠す。
- 表示本体は絶対配置のステージに収め、親の avatar/core レイアウトを押し広げない。

## Electron / Web 両対応の判断

| 機能 | Electron | Web |
|------|----------|-----|
| OS カーソル位置 | `window.desktopApi?.getWindowPointerSnapshot?.(role)` | `stageRef.value?.addEventListener('pointermove', ...)` |
| CPU 使用率 | `window.desktopApi?.getSystemCpuUsage?.()`（`number \| null`） | 未取得として「—」表示。0%に置き換えない |
| ファイル一覧 | IPC で実ファイル列挙 | `config.ts` などの固定配列 |

IPC を呼ぶ箇所は optional chaining にし、戻り値がない場合の Web フォールバックを同じ関数内で処理する。

## xeyes 実装の要点
- Electron では renderer だけでウィンドウ外カーソルを追えないため、main process 側で `screen.getCursorScreenPoint()` と対象 `BrowserWindow.getBounds()` を返す。
- `window:get-pointer-snapshot` の `role` / `bounds` / `mouse` / `insideWindow` とステージの矩形からローカル座標へ変換する。CPU使用率は `system:get-cpu-usage` で取得する。
- Web ではステージ内の `pointermove` を使う。画面外は追えない前提にする。
- ElectronのCPUは全OSで `systeminformation@5.33.19` の `currentLoad()` を使う。Avatar自身のpackage依存から読み、`getLoad: () => si.currentLoad()` をCPU画面と共有する `frontend_ide/aidiy_cpu/systeminformation-cpu.cjs` へ渡す。IDEのnode_modulesへは依存しない。main processは最初のIPCでmonitorを遅延作成し、`read()?.cpu` をそのまま返す。
- 採取は約1秒周期、500ms IPCは最新値の読込だけ。SIの初回呼出しは内部で約500msの基準更新・差分採取を行うため、返された `currentLoad` を有効値として使う。採取済み百分率を500ms/1秒などの周期比やコア数で割り直さない。暖機・失敗・未取得は `null`、実測0%は有効な数値。Avatar終了時は `close()` で解放する。
- 独自のWindows Time/Utility選択や非Windows `os.cpus()` 差分処理へは切り替えない。SI自身は内部でOSカウンターを読むので、この方式への変更だけでTask Managerとの一致や実機の精度を確定しない。通常WebにはOS計測IPCを追加しない。
- xeyesは500ms間隔、12枠（約6秒）の平均と色変化を維持する。1秒標本を2回読む場合も縮小せず同じ率として扱う。欠損は `null` の枠として進めて平均から除外し、最新枠が未取得なら数値を「—」、棒を空白にする。目の色は直前の状態を保ち、復帰時は直近12枠の有効値平均へ戻る。6秒以上前の値を欠損期間の後まで平均に残さない。
- IPC要求は重複させず、画面破棄後に届いた結果を反映しない。破棄中の初期化完了からintervalを再開しない。
- CPUグラフとオプションは `controlsVisible` が true のときだけ出す。目の色変化・充血表現は `cpuColorEnabled` で制御し、`controlsVisible=false` でも有効になり得る。目線追従とは分離する。
- `v-if` と `v-for` を同一要素に書かず、必要なら `<template v-if>` でラップする。

## xneko スプライト追加の要点
- スプライトシートは `256x128px`、32px タイル 8列 x 4行、透過 GIF を前提にする。
- 既存 `AIコア_xneko.vue` の `background-position` と合うよう、輪郭・透明部分を保つ。
- 白背景画像から作る場合は、白い毛を消さないため単純な閾値除去ではなく四隅フラッドフィルで背景を除去する。
- `.neko-sprite` の `background-image` は画像URLのcomputedへバインドし、固定CSSと二重管理しない。
- 新しい画像を追加したら、選択 state、画像 URL computed、オプションパネルのラジオを合わせて追加する。
- Electron のカーソル IPC は定期取得の成功を操作扱いにせず、前回の画面座標から実際に変化した時だけ未操作時間をリセットする。
- マウス停止中は壁かき完了後に追跡目標を猫位置へ戻し、たたずみから睡眠へ遷移させる。睡眠後の自動起床では画面内だけを移動し、停止中のマウスを追って壁かきを再開させない。

## 注意点
- `requestAnimationFrame` は `onBeforeUnmount` で `cancelAnimationFrame` する。
- `setInterval` / `setTimeout` は `onBeforeUnmount` で解除する。
- オプションパネルに `pointer-events: all` を付けないとクリックが透過する。
- アバター以外の表示選択中にアバター固有 UI が見えないよう、設定 UI は各コンポーネント内へ閉じ込める。

## 確認方法
1. `cd frontend_avatar && npm run type-check`
2. `表示選択` で追加ウィジェットを選び、表示が切り替わることを確認する。
3. `controlsVisible=false` でオプションパネルが消えることを確認する。
4. Electron と Web の両方で、IPC 不在時に Console エラーが出ないことを確認する。
5. アニメーションや interval が画面切替後に残らないことを DevTools で確認する。

CPUの隔離試験はリポジトリ直下で `node --test frontend_avatar/checks/xeyes-cpu.test.cjs`。実際のmain/preload/Vueを使い、Windows/非Windowsの分岐、nullと0%、欠損・復帰、12枠平均、500ms予定、終了・破棄をmockで確認する。Avatarの依存物が未配置でも、導入済みのfrontend_ideのVue/TypeScriptがあればコンパイル試験に利用する。これは本番実行時の依存解決を変更せず、通常の `npm run type-check` やWindows実機の数値・色の確認を代替しない。
