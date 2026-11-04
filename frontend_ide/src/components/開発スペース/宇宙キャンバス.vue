<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { createSpace } from '../開発スペース/宇宙描画.js';
const props = defineProps({ mode: { type: String, default: '3d' }, layout: Function });
const emit = defineEmits(['ready', 'change', 'toggle-explorer']);
const canvas = ref(), tooltip = ref();
let engine;
watch(() => props.mode, mode => engine?.setViewMode(mode), { flush: 'sync' });
onMounted(() => {
  engine = createSpace(canvas.value, { tooltip: tooltip.value }, {
    change: value => emit('change', value), layout: options => props.layout?.(options) || {},
    toggleExplorer: () => emit('toggle-explorer'),
  });
  engine.setViewMode(props.mode);
  emit('ready', engine);
});
onBeforeUnmount(() => { engine?.dispose(); engine = null; });
</script>
<template>
  <div v-show="mode==='3d'" class="space-renderer" aria-label="3D ファイル表示">
    <canvas ref="canvas" class="space-canvas"></canvas><div ref="tooltip" id="tooltip" hidden></div>
  </div>
</template>
