<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { onBeforeUnmount } from 'vue';
import { createPanelToggleDrag } from '../コード/パネル切替ドラッグ.js';
const props=defineProps({transparent:Boolean,desktop:Boolean});
const emit=defineEmits(['toggle']);
// CPUは本文を折り畳まず、背景だけを切り替える。窓移動は共通操作を使う。
const drag=createPanelToggleDrag({api:props.desktop?window.aidiyWindow:undefined,win:window,toggle:()=>emit('toggle')});
onBeforeUnmount(drag.dispose);
</script>
<template>
 <button type="button" class="cpu-display-toggle" data-aidiy-no-window-move
  :aria-pressed="transparent" :aria-label="transparent?'背景を通常表示に戻す':'背景を透過表示にする'"
  :title="(transparent?'背景を通常表示に戻す':'背景を透過表示にする')+(desktop?'（ドラッグで移動）':'')"
  @pointerdown="drag.down" @pointermove="drag.move" @pointerup="drag.up" @pointercancel="drag.cancel" @lostpointercapture="drag.up" @click="drag.click" @dragstart.prevent>
  <span class="cpu-display-mark" aria-hidden="true">{{ transparent?'▷':'▽' }}</span>
 </button>
</template>
<style scoped>
.cpu-display-toggle{flex:none;display:grid;place-items:center;width:26px;min-width:26px;height:26px;padding:0;border:0;background:transparent;color:inherit;box-shadow:none;-webkit-app-region:no-drag;touch-action:none;user-select:none;cursor:pointer}
.cpu-display-mark{box-sizing:border-box;display:grid;place-items:center;width:22px;height:22px;border:2px solid currentColor;border-radius:0;font-size:14px;line-height:1;pointer-events:none}
.cpu-display-toggle:hover .cpu-display-mark{background:#ffffff1f}
.cpu-display-toggle:focus-visible{outline:2px solid var(--focus,#889aff);outline-offset:1px}
</style>
