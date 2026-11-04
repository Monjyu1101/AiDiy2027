<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { createWindowPinController } from './窓操作.js';
const props = defineProps({ windowApi: Object, windowContext: Object, allowAll: Boolean, allDisplays: Boolean, allBusy: Boolean, hideClose: Boolean, pinOnly: Boolean, maximizeDisabled: Boolean, maximizeTitle: String, pinTitle: String });
const emit = defineEmits(['toggle-all']);
const currentWindow = props.windowContext || window;
const api = props.windowApi || currentWindow.aidiyWindow;
const maximized = ref(false), pin = ref({ pinned: false, locked: false, ready: false, busy: false, error: '' });
let disposed = false;
const controller = createWindowPinController({ api, changed: value => { pin.value = value; } });
const pinTitle = computed(() => pin.value.error || props.pinTitle || (pin.value.locked ? 'ピン留め中（VRモード中は解除できません）' : pin.value.pinned ? 'ピン留めを解除（最前面の維持を終了）' : 'ピン留め（最前面を維持）'));
async function updateWindow() {
  try { const value = await api?.isMaximized?.(); if (!disposed) maximized.value = !!value; } catch { /* 終了中の窓から届く失敗は無視する。 */ }
}
async function action(value) { try { await api?.[value]?.(); await updateWindow(); } catch { /* mainで拒否された操作は状態を変えない。 */ } }
function focusWindow() { void updateWindow(); void controller.refresh(); }
onMounted(() => { void controller.start(); void updateWindow(); currentWindow.addEventListener('resize', updateWindow); currentWindow.addEventListener('focus', focusWindow); });
onBeforeUnmount(() => { disposed = true; controller.dispose(); currentWindow.removeEventListener('resize', updateWindow); currentWindow.removeEventListener('focus', focusWindow); });
</script>
<template>
  <span class="window-actions" :class="{ 'window-maximized': maximized }">
    <slot></slot>
    <button v-if="allowAll" class="window-all" :aria-pressed="allDisplays" :disabled="allBusy" :title="allDisplays ? 'VRモードを終了' : 'VRモード：全ディスプレイに宇宙空間を広げる'" aria-label="VRモード" @click="emit('toggle-all')">VR</button>
    <button v-if="!pinOnly" type="button" @click="action('minimize')" title="最小化" aria-label="最小化"><span class="window-minimize" aria-hidden="true"></span></button>
    <button v-if="!pinOnly" type="button" @click="action('maximize')" :disabled="maximizeDisabled" :title="maximizeDisabled ? maximizeTitle || 'このウィンドウは最大化できません' : maximized ? '元のサイズに戻す' : '最大化'" :aria-label="maximized ? '元のサイズに戻す' : '最大化'" :aria-description="maximizeDisabled ? maximizeTitle : undefined"><span class="window-maximize" aria-hidden="true"></span></button>
    <button type="button" class="window-pin" :class="{ 'pin-active': pin.pinned, 'pin-locked': pin.locked }" :aria-pressed="pin.pinned" :disabled="!pin.ready || pin.busy || pin.locked" :title="pinTitle" :aria-label="pinTitle" @click="controller.toggle()"><span aria-hidden="true">📌</span></button>
    <button v-if="!pinOnly" type="button" class="window-close" :disabled="hideClose" :aria-description="hideClose ? 'VRモード中は閉じられません' : undefined" @click="action('close')" :title="hideClose ? 'VRモード中は閉じられません' : '閉じる'" aria-label="終了"><span class="close-icon" aria-hidden="true"></span></button>
  </span>
</template>
