<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import WindowActions from '../共通表示/窓操作.vue';
import {chartSeries,placeLabels} from './使用率グラフ.js';
defineProps({desktop:Boolean,floating:Boolean,standalone:Boolean});
const emit=defineEmits(['close']);
const samples=ref([]),error=ref(''),ready=ref(false);
const series=computed(()=>chartSeries(samples.value));
// GPU未取得時はグラフ上の浮動ラベルを隠す。0%は正常値として表示する。
const labels=computed(()=>placeLabels(series.value.filter(item=>item.key!=='gpu'||item.value!==null)));
let timer,request,disposed=false;
async function poll(){
 clearTimeout(timer);if(disposed||document.hidden||request)return;
 const controller=new AbortController();request=controller;
 const timeout=setTimeout(()=>controller.abort(),4000);
 try{
  const response=await fetch('/api/system-metrics',{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw Error();const sample=await response.json();
  if(!sample||typeof sample!=='object'||!Number.isFinite(sample.timestamp))throw Error();
  if(disposed||document.hidden)return;
  samples.value=[...samples.value,sample].slice(-60);error.value='';ready.value=true;
 }catch{
  if(!disposed&&!document.hidden){samples.value=[...samples.value,{timestamp:Date.now(),cpu:null,gpu:null,ram:null}].slice(-60);error.value='計測できません。再試行中';ready.value=false;}
 }finally{clearTimeout(timeout);request=undefined;if(!disposed&&!document.hidden)timer=setTimeout(poll,1000);}
}
function visibility(){clearTimeout(timer);if(document.hidden)request?.abort();else{samples.value=[];void poll();}}
onMounted(()=>{document.addEventListener('visibilitychange',visibility);void poll();});
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility);});
</script>
<template>
 <section class="cpu-panel" :class="{'cpu-floating':floating}" aria-label="CPU GPU RAM 使用率" tabindex="0" data-aidiy-window-move-surface>
  <header class="cpu-title" :class="{desktop}">
   <strong>{{ standalone?'AiDiy CPU':'AiDiy IDE / CPU' }}</strong>
   <WindowActions v-if="desktop" />
   <button v-else-if="floating" class="cpu-close" aria-label="使用率画面を閉じる" @click="emit('close')">×</button>
  </header>
  <div class="cpu-chart">
   <svg viewBox="0 0 264 100" preserveAspectRatio="none" role="img" aria-label="直近60回の使用率。CPUとGPUは面、RAMは折線。縦軸0から100パーセント">
    <g class="cpu-grid"><path v-for="y in [10,31,52,73,94]" :key="y" :d="`M22 ${y}H192`" /></g>
    <g class="cpu-axis"><text x="19" y="13">100</text><text x="19" y="55">50</text><text x="19" y="97">0</text></g>
    <g v-for="item in series" :key="item.key" :style="{color:item.color}">
     <path v-if="item.key!=='ram'" :d="item.area" fill="currentColor" fill-opacity=".22" />
     <path :d="item.line" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" />
    </g>
    <g v-for="item in labels" :key="item.key" :style="{color:item.color}" class="cpu-label">
     <path v-if="item.value!==null" :d="`M192 ${item.y}L201 ${item.labelY}`" stroke="currentColor" fill="none" stroke-opacity=".55" />
     <circle v-if="item.value!==null" cx="192" :cy="item.y" r="2.5" fill="currentColor" />
     <text x="262" text-anchor="end" :y="item.labelY+4" fill="currentColor">{{ item.key.toUpperCase() }} {{ item.value===null?'—':Math.round(item.value)+'%' }}</text>
    </g>
   </svg>
  </div>
 </section>
</template>
<style>
.cpu-panel{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#000;color:#d9e5ec;overflow:hidden}
.cpu-floating{position:absolute;right:8px;bottom:min(376px,max(8px,calc(100% - 168px)));width:min(240px,calc(100% - 16px));height:160px;z-index:50;border:1px solid #465460;box-shadow:0 12px 32px #0009;resize:both;min-width:min(240px,calc(100% - 16px));min-height:150px;max-width:calc(100% - 16px);max-height:calc(100% - 16px)}
/* CPU専用の小さいタイトル。接続表示・接続バー・その監視処理は持たない。 */
.cpu-title{position:absolute;left:0;right:0;top:0;z-index:1;opacity:0;pointer-events:none;height:22px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 4px;background:#30343a;color:white}
.cpu-panel:hover>.cpu-title,.cpu-panel:focus-within>.cpu-title{opacity:1;pointer-events:auto}
.cpu-title.desktop{-webkit-app-region:drag}
.cpu-title strong{font-size:11px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cpu-title button{-webkit-app-region:no-drag}
.cpu-title .window-actions button{width:24px;height:22px;padding:0}
.cpu-chart{flex:1;min-height:0;padding:2px 2px 0}.cpu-chart svg{width:100%;height:100%;overflow:visible}
.cpu-grid path{stroke:#1c2930;stroke-width:1;vector-effect:non-scaling-stroke}.cpu-axis{fill:#6d7e87;font:10px monospace;text-anchor:end}
.cpu-label{font:11px ui-monospace,monospace;font-weight:600}
.cpu-close{margin-left:4px;line-height:20px;padding:0 4px;background:none;border:0;color:white;font-size:20px;cursor:pointer;-webkit-app-region:no-drag}
</style>
