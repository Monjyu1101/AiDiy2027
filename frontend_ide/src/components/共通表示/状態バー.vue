<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import WindowActions from './窓操作.vue';
const props = defineProps({ title: String, status: String, mode: String, connected: Boolean, busy: Boolean, active: Boolean, desktop: Boolean, clockPulse: Boolean, windowApi: Object, windowContext: Object, allowAll: Boolean, allDisplays: Boolean, allBusy: Boolean, hideClose: Boolean, pinTitle: String });
const emit = defineEmits(['toggle-all']);
const pulseLevel = ref(0);
let pulseTimer;
// Webのタイトル下線と同じ時刻・式・50ms更新。絶対値なので明滅は4.5秒周期。
function updatePulse(){pulseLevel.value=Math.round(255*Math.abs(Math.sin(((Date.now()/1000)%9)/9*Math.PI*2)));}
// 黒い未接続バー・非表示の画面では20回/秒のVue更新を止め、復帰時に現在時刻へ揃える。
function syncPulse(){clearInterval(pulseTimer);pulseTimer=undefined;if(props.clockPulse&&!document.hidden&&(props.mode==='offline'||props.connected)){updatePulse();pulseTimer=setInterval(updatePulse,50);}}
watch(()=>[props.clockPulse,props.mode,props.connected],syncPulse);
const pulseStyle = computed(()=>props.clockPulse?{
  backgroundColor:props.mode==='offline'?`rgb(${pulseLevel.value}, 0, 0)`:props.connected?`rgb(0, ${pulseLevel.value}, ${pulseLevel.value})`:'rgb(0, 0, 0)',
  animation:'none',opacity:1,
}:undefined);
onMounted(() => { document.addEventListener('visibilitychange',syncPulse);syncPulse(); });
onBeforeUnmount(() => {document.removeEventListener('visibilitychange',syncPulse);clearInterval(pulseTimer);});
</script>
<template>
  <header class="panel-brand" :class="{ desktop }">
    <span class="connection-label" role="status"><i :class="{ online: connected, active: active || busy }"></i>{{ status || (busy ? '接続中' : connected ? '接続済み' : '未接続') }}<slot name="connection-tools"></slot></span>
    <strong>{{ title }}</strong>
    <WindowActions v-if="desktop" :window-api="windowApi" :window-context="windowContext" :allow-all="allowAll" :all-displays="allDisplays" :all-busy="allBusy" :hide-close="hideClose" :pin-title="pinTitle" @toggle-all="emit('toggle-all')"><slot name="window-tools"></slot></WindowActions>
  </header>
  <div class="connection-bar" :class="{ online: connected && mode !== 'offline', offline: mode === 'offline' }" :style="pulseStyle"></div>
</template>
