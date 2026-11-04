<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import 一括進捗表示 from './一括進捗表示.vue';
import {computed,ref,onMounted,onBeforeUnmount} from 'vue';
import './起動ミニ.css';
import ミニアプリ起動 from '../アプリ起動/ミニアプリ起動.vue';
import ミニCLI起動 from '../アプリ起動/ミニCLI起動.vue';
import {明滅値} from './明滅.mjs';
import {ミニ高さを合わせる} from '../ウィンドウ/ミニ高さ.mjs';
const props=defineProps({state:Object,online:Boolean,appState:Object,cliState:Object,appOnline:Boolean});
defineEmits(['select','open-apps']);
const content=ref(null);let stopFit=()=>{};
onMounted(()=>{stopFit=ミニ高さを合わせる(content.value);});
onBeforeUnmount(()=>stopFit());
const ポート=computed(()=>props.state.ポート項目.value.length?props.state.ポート項目.value:props.state.項目.value);
// ポート確認のタイムアウト（未確認）では直前の表示を保ち、灰色への一瞬の切替と明滅のやり直しを避ける
const 前回=new Map();
function 色(item){const tone=!props.online?'idle':item.開放===true?'running':item.開放===false?(props.state.停止警告対象.value.has(item.id)?'stopped':'idle'):前回.get(item.id)||'idle';前回.set(item.id,tone);return tone;}
function 状態(item){return !props.online?'未接続':`ポート ${item.ポート} ${item.開放===true?'開放':item.開放===false?'未開放':'未確認'}`;}
</script>
<template>
<section class="panel start-mini" aria-label="起動ミニ表示">
 <div ref="content" class="mini-content">
 <component v-if="appOnline" :is="一括進捗表示" :state="state" compact/>
 <component v-if="appState" :is="ミニアプリ起動" :state="appState" :cli-state="cliState" :online="appOnline" @open-apps="$emit('open-apps')"/>
 <component v-if="cliState&&appState" :is="ミニCLI起動" :state="cliState" :app-state="appState" :online="appOnline"/>
 <div class="mini-services">
  <button v-for="(item,index) in ポート" :key="item.id" class="mini-service" :style="明滅値(index)" :data-tone="色(item)" :title="item.名前+' '+状態(item)+' — コンソールを表示'" :aria-label="item.名前+' '+状態(item)+'。コンソールを表示'" @click="$emit('select',item.id)"><span class="mini-name">{{item.id==='tools'?'Tools':item.id==='taskteam'?'Task/Team':item.名前}}</span></button>
 </div>
 </div>
</section>
</template>
