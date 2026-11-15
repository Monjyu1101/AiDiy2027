<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { usePanelCollapse } from '../共通表示/パネル折り畳み.js';
import { createPanelToggleDrag } from './パネル切替ドラッグ.js';
// tone（online / disconnected / offline / success / failure）を渡した窓は、折畳中に隠れる接続バーの色をマーク背景で示す。
const props = defineProps({ collapsed: Boolean, disabled: Boolean, desktop: Boolean, windowApi: Object, windowContext: Object, tone: String, blackExpanded: Boolean });
const emit = defineEmits(['toggle', 'hidden', 'busy']);
const button = ref();
const { panelElement, panelCollapsed, panelHidden, panelBusy, togglePanel } = usePanelCollapse(props);
onMounted(() => { panelElement.value = button.value.closest('.ai-component'); });
watch(panelCollapsed, () => emit('toggle'));
watch(panelHidden, value => emit('hidden', value));
watch(panelBusy, value => emit('busy', value), { flush: 'sync' });
defineExpose({ async expand() { if (panelCollapsed.value) await togglePanel(); return !panelCollapsed.value && !panelBusy.value; } });
const drag = createPanelToggleDrag({ api: props.desktop ? (props.windowApi ?? window.aidiyWindow) : undefined, win: props.windowContext ?? window, toggle: () => { if (!props.disabled) return togglePanel(); } });
onBeforeUnmount(drag.dispose);
</script>
<template>
  <button ref="button" type="button" class="code-panel-toggle" data-aidiy-no-window-move
    :disabled="disabled" :aria-expanded="!collapsed" :aria-label="collapsed ? 'パネル内容を表示' : 'パネル内容を非表示'"
    :title="(collapsed ? 'パネル内容を表示' : 'パネル内容を非表示') + (desktop ? '（ドラッグで移動）' : '')"
    @pointerdown="drag.down" @pointermove="drag.move" @pointerup="drag.up" @pointercancel="drag.cancel" @lostpointercapture="drag.up" @click="drag.click" @dragstart.prevent>
    <span class="code-panel-mark" :class="collapsed && tone ? `tone-${tone}` : blackExpanded ? 'tone-offline' : undefined" aria-hidden="true">{{ collapsed ? '▶' : '▽' }}</span>
  </button>
</template>
<style scoped>
.code-panel-toggle{flex:none;display:grid;place-items:center;width:26px;min-width:26px;height:26px;padding:0;border:0;background:transparent;color:inherit;box-shadow:none;-webkit-app-region:no-drag;touch-action:none;user-select:none;cursor:pointer}
.code-panel-mark{box-sizing:border-box;display:grid;place-items:center;width:22px;height:22px;border:2px solid currentColor;border-radius:0;font-size:14px;line-height:1;pointer-events:none}
.code-panel-toggle:hover .code-panel-mark:not([class*="tone-"]){background:#ffffff1f}
/* 接続バーと同じ色・4.5秒の明滅（style.css の connection-breathe）。 */
.code-panel-mark.tone-online{--connection-color:#00ffff;animation:connection-breathe 4.5s linear infinite}
.code-panel-mark.tone-disconnected{--connection-color:#ff0000;animation:connection-breathe 4.5s linear infinite}
.code-panel-mark.tone-offline{background:#000}
/* Term のコマンド終了結果（終了コード 0 / 0以外）。 */
.code-panel-mark.tone-success{background:#00a83a}
.code-panel-mark.tone-failure{background:#d81f2a}
.code-panel-toggle:focus-visible{outline:2px solid var(--focus,#889aff);outline-offset:1px}
</style>
