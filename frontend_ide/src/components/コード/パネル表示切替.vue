<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { usePanelCollapse } from '../共通表示/パネル折り畳み.js';
import { createPanelToggleDrag } from './パネル切替ドラッグ.js';
const props = defineProps({ collapsed: Boolean, desktop: Boolean, windowApi: Object, windowContext: Object });
const emit = defineEmits(['toggle', 'hidden']);
const button = ref();
const { panelElement, panelCollapsed, panelHidden, togglePanel } = usePanelCollapse(props);
onMounted(() => { panelElement.value = button.value.closest('.ai-component'); });
watch(panelCollapsed, () => emit('toggle'));
watch(panelHidden, value => emit('hidden', value));
const drag = createPanelToggleDrag({ api: props.desktop ? (props.windowApi ?? window.aidiyWindow) : undefined, win: props.windowContext ?? window, toggle: togglePanel });
onBeforeUnmount(drag.dispose);
</script>
<template>
  <button ref="button" type="button" class="code-panel-toggle" data-aidiy-no-window-move
    :aria-expanded="!collapsed" :aria-label="collapsed ? 'パネル内容を表示' : 'パネル内容を非表示'"
    :title="(collapsed ? 'パネル内容を表示' : 'パネル内容を非表示') + (desktop ? '（ドラッグで移動）' : '')"
    @pointerdown="drag.down" @pointermove="drag.move" @pointerup="drag.up" @pointercancel="drag.cancel" @lostpointercapture="drag.up" @click="drag.click" @dragstart.prevent>
    <span class="code-panel-mark" aria-hidden="true">{{ collapsed ? '▶' : '▽' }}</span>
  </button>
</template>
<style scoped>
.code-panel-toggle{flex:none;display:grid;place-items:center;width:26px;min-width:26px;height:26px;padding:0;border:0;background:transparent;color:inherit;box-shadow:none;-webkit-app-region:no-drag;touch-action:none;user-select:none;cursor:pointer}
.code-panel-mark{box-sizing:border-box;display:grid;place-items:center;width:22px;height:22px;border:2px solid currentColor;border-radius:0;font-size:14px;line-height:1;pointer-events:none}
.code-panel-toggle:hover .code-panel-mark{background:#ffffff1f}
.code-panel-toggle:focus-visible{outline:2px solid var(--focus,#889aff);outline-offset:1px}
</style>
