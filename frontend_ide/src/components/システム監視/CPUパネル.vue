<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import StatusBar from '../共通表示/状態バー.vue';
import {chartSeries,placeLabels} from './使用率グラフ.js';
defineProps({desktop:Boolean,floating:Boolean,standalone:Boolean});
const emit=defineEmits(['close']);
const samples=ref([]),error=ref(''),ready=ref(false);
const series=computed(()=>chartSeries(samples.value));
const labels=computed(()=>placeLabels(series.value));
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
 <section class="cpu-panel" :class="{'cpu-floating':floating}" aria-label="CPU GPU RAM 使用率">
  <StatusBar :title="standalone?'AiDiy CPU':'AiDiy IDE / CPU'" :desktop="desktop" :connected="ready" :status="ready?'計測中':'計測待ち'">
   <template v-if="floating" #connection-tools><button class="cpu-close" aria-label="使用率画面を閉じる" @click="emit('close')">×</button></template>
  </StatusBar>
  <div class="cpu-chart">
   <svg viewBox="0 0 460 176" preserveAspectRatio="none" role="img" aria-label="直近60回の使用率。CPUとGPUは面、RAMは折線。縦軸0から100パーセント">
    <g class="cpu-grid"><path v-for="y in [16,52,88,124,160]" :key="y" :d="`M28 ${y}H350`" /></g>
    <g class="cpu-axis"><text x="24" y="19">100</text><text x="24" y="91">50</text><text x="24" y="163">0</text></g>
    <g v-for="item in series" :key="item.key" :style="{color:item.color}">
     <path v-if="item.key!=='ram'" :d="item.area" fill="currentColor" fill-opacity=".22" />
     <path :d="item.line" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" />
    </g>
    <g v-for="item in labels" :key="item.key" :style="{color:item.color}" class="cpu-label">
     <path v-if="item.value!==null" :d="`M350 ${item.y}L362 ${item.labelY}`" stroke="currentColor" fill="none" stroke-opacity=".55" />
     <circle v-if="item.value!==null" cx="350" :cy="item.y" r="2.5" fill="currentColor" />
     <text x="365" :y="item.labelY+4" fill="currentColor">{{ item.key.toUpperCase() }} {{ item.value===null?'—':Math.round(item.value)+'%' }}</text>
    </g>
   </svg>
  </div>
  <footer class="cpu-caption"><span>{{ error||'実行ホスト全体 · 約1秒更新' }}</span><span v-if="series[1].value===null" title="NVIDIA nvidia-smi未対応・未導入、または取得に失敗しています">GPU 未取得</span><span v-else>GPU 最大負荷</span></footer>
 </section>
</template>
<style>
.cpu-panel{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#000;color:#d9e5ec;overflow:hidden}
.cpu-floating{position:absolute;right:18px;bottom:18px;width:min(460px,calc(100% - 36px));height:260px;z-index:50;border:1px solid #465460;box-shadow:0 12px 32px #0009;resize:both;min-width:300px;min-height:180px;max-width:calc(100% - 36px);max-height:calc(100% - 36px)}
.cpu-chart{flex:1;min-height:0;padding:12px 8px 0}.cpu-chart svg{width:100%;height:100%;overflow:visible}
.cpu-grid path{stroke:#1c2930;stroke-width:1;vector-effect:non-scaling-stroke}.cpu-axis{fill:#6d7e87;font:10px monospace;text-anchor:end}
.cpu-label{font:12px ui-monospace,monospace;font-weight:600}.cpu-caption{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;color:#7c929e;font-size:10px;white-space:nowrap}
.cpu-close{margin-left:8px;background:none;border:0;color:white;font-size:20px;cursor:pointer;-webkit-app-region:no-drag}
</style>
