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
| CPU 使用率 | `window.desktopApi?.getSystemCpuUsage?.()` | 0 扱い、または UI 非表示 |
| ファイル一覧 | IPC で実ファイル列挙 | `config.ts` などの固定配列 |

IPC を呼ぶ箇所は optional chaining にし、戻り値がない場合の Web フォールバックを同じ関数内で処理する。

## xeyes 実装の要点
- Electron では renderer だけでウィンドウ外カーソルを追えないため、main process 側で `screen.getCursorScreenPoint()` と対象 `BrowserWindow.getBounds()` を返す。
- `window:get-pointer-snapshot` の `role` / `bounds` / `mouse` / `insideWindow` とステージの矩形からローカル座標へ変換する。CPU使用率は `system:get-cpu-usage` で取得する。
- Web ではステージ内の `pointermove` を使う。画面外は追えない前提にする。
- CPU 使用率は `os.cpus()` の直前サンプルとの差分から計算するため、初回値は 0 になり得る。
- 色変化やグラフは `controlsVisible` が true のときだけ出す。表示本体の目線追従とは分離する。
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
