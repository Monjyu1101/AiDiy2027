<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import パネル表示切替 from '../../../../../frontend_ide/src/components/コード/パネル表示切替.vue';
const props=defineProps({serverState:String,connected:Boolean,compact:Boolean,switching:Boolean,microAvailable:Boolean,collapsed:Boolean,hidden:Boolean});
defineEmits(['restore','mini','micro','toggle','hidden']);
const customNormalTitle=ref(false);
const desktop=ref(!!window.aidiyWindow),maximized=ref(false),pin=ref({pinned:false,locked:false}),pinBusy=ref(false);
const pinTitle=computed(()=>pin.value.locked?'VRモード中はピン止めを解除できません':pin.value.pinned?'ピン止めを解除（最前面 OFF）':'ピン止め（最前面 ON）');
let unsubscribePin,disposed=false,pinVersion=0;
function applyPin(value){if(!disposed&&typeof value?.pinned==='boolean'&&typeof value?.locked==='boolean')pin.value=value;}
async function togglePin(){if(pinBusy.value||pin.value.locked)return;pinBusy.value=true;try{applyPin(await window.aidiyWindow?.togglePin?.());}catch{}finally{pinBusy.value=false;}}
async function update(){try{maximized.value=!!(await window.aidiyWindow?.isMaximized?.());}catch{}}
async function action(value){try{await window.aidiyWindow?.[value]?.();await update();}catch{}}
onMounted(()=>{
 customNormalTitle.value=window.aidiyWindow?.customNormalTitle===true;
 desktop.value=!!window.aidiyWindow;void update();window.addEventListener('resize',update);
 unsubscribePin=window.aidiyWindow?.onPinState?.(value=>{pinVersion++;applyPin(value);});
 const version=pinVersion;
 Promise.resolve(window.aidiyWindow?.getPinState?.()).then(value=>{if(version===pinVersion)applyPin(value);}).catch(()=>{});
});
onBeforeUnmount(()=>{disposed=true;unsubscribePin?.();window.removeEventListener('resize',update);});
</script>
<template>
<header class="panel-brand" :class="{desktop,compact}" :data-aidiy-standard-title="desktop&&customNormalTitle&&!compact?'':undefined" :data-aidiy-no-window-move="desktop&&customNormalTitle&&!compact?'':undefined">
 <div v-if="!compact" class="launcher-selector"><component :is="パネル表示切替" :collapsed="collapsed" :desktop="desktop" @toggle="$emit('toggle')" @hidden="$emit('hidden',$event)"/><button class="title-mini-switch" :disabled="!connected||switching" @click="$emit('mini')" title="ランチャー表示" aria-label="ランチャー表示">ランチャー表示</button><button class="title-micro-switch" aria-label="アイコン化" :disabled="!connected||switching||!microAvailable" @click="$emit('micro')" :title="microAvailable?'透明な円形ランチャー（常に最前面）':'プロジェクトフォルダを選択すると使えます'">アイコン化</button></div>
 <div v-else class="launcher-selector"><component :is="パネル表示切替" :collapsed="collapsed" :desktop="desktop" @toggle="$emit('toggle')" @hidden="$emit('hidden',$event)"/><button class="title-micro-switch" aria-label="アイコン化" :disabled="!connected||switching||!microAvailable" @click="$emit('micro')" :title="microAvailable?'アイコン化へ切り替え':'プロジェクトフォルダを選択すると使えます'">アイコン化</button></div>
 <strong>{{compact?'AiDiy ランチャー':'AiDiy Diag'}}</strong>
 <span class="window-actions" :class="{'window-maximized':maximized}">
  <button v-if="desktop" @click="action('minimize')" title="最小化" aria-label="最小化"><span class="window-minimize"></span></button>
  <button v-if="desktop||compact" :class="{'mini-restore':compact}" :disabled="switching" @click="compact?$emit('restore'):action('maximize')" :title="compact||maximized?'元のサイズに戻す':'最大化'" :aria-label="compact||maximized?'元のサイズに戻す':'最大化'"><span class="window-maximize"></span></button>
  <template v-if="desktop"><button class="window-pin" :class="{pinned:pin.pinned}" :aria-pressed="pin.pinned" :disabled="pin.locked||pinBusy" :title="pinTitle" :aria-label="pinTitle" @click="togglePin"><span aria-hidden="true">📌</span></button><button @click="action('close')" title="閉じる" aria-label="終了">×</button></template>
 </span>
</header>
<div v-show="!hidden" class="connection-bar" :class="{online:connected&&serverState==='online',offline:connected&&serverState==='offline',disconnected:!connected||!['online','offline'].includes(serverState)}" aria-hidden="true"></div>
</template>
