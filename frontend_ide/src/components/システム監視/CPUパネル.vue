<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import CpuDisplayToggle from './CPU表示切替.vue';
import WindowActions from '../共通表示/窓操作.vue';
import {chartSeries,placeLabels,chartRight,labelRight,labelMaxWidth} from './使用率グラフ.js';
const props=defineProps({desktop:Boolean,floating:Boolean,standalone:Boolean});
const transparent=ref(false);
function toggleBackground(){
 transparent.value=!transparent.value;
 if(!props.floating)document.documentElement.classList.toggle('cpu-transparent-window',transparent.value);
}
const emit=defineEmits(['close']);
const samples=ref([]),error=ref(''),ready=ref(false);
const series=computed(()=>chartSeries(samples.value));
// 初回のCPU準備中とGPU未取得時はラベルを隠す。取得済み0%は表示する。
const labels=computed(()=>placeLabels(series.value.filter(item=>
 (item.key!=='gpu'||item.value!==null)&&(item.key!=='cpu'||samples.value.at(-1)?.cpuSource!=='warming-up'))));
let timer,request,nextPollAt,generation=0,disposed=false;
async function poll(){
 clearTimeout(timer);if(disposed||document.hidden||request)return;
 if(nextPollAt===undefined)nextPollAt=performance.now();
 const version=generation,controller=new AbortController();request=controller;
 const timeout=setTimeout(()=>controller.abort(),4000);
 try{
  const response=await fetch('/api/system-metrics',{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw Error();const sample=await response.json();
  if(!sample||typeof sample!=='object'||!Number.isFinite(sample.timestamp))throw Error();
  if(disposed||document.hidden||version!==generation||controller.signal.aborted)return;
  samples.value=[...samples.value,sample].slice(-60);error.value='';ready.value=true;
 }catch{
  if(!disposed&&!document.hidden&&version===generation){samples.value=[...samples.value,{timestamp:Date.now(),cpu:null,gpu:null,ram:null}].slice(-60);error.value='計測できません。再試行中';ready.value=false;}
 }finally{
  clearTimeout(timeout);request=undefined;
  if(!disposed&&!document.hidden&&version!==generation){nextPollAt=undefined;timer=setTimeout(poll,0);}
  else if(!disposed&&!document.hidden){
   const finished=performance.now();nextPollAt=(nextPollAt??finished)+1000;
   if(nextPollAt<finished)nextPollAt+=Math.ceil((finished-nextPollAt)/1000)*1000;
   timer=setTimeout(poll,Math.max(0,Math.ceil(nextPollAt-finished)));
  }
 }
}
function visibility(){generation++;clearTimeout(timer);nextPollAt=undefined;if(document.hidden)request?.abort();else{samples.value=[];void poll();}}
onMounted(()=>{document.addEventListener('visibilitychange',visibility);void poll();});
onBeforeUnmount(()=>{if(!props.floating)document.documentElement.classList.remove('cpu-transparent-window');disposed=true;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility);});
</script>
<template>
 <section class="cpu-panel" :class="{'cpu-floating':floating,'cpu-transparent':transparent}" aria-label="CPU GPU RAM 使用率" tabindex="0" data-aidiy-window-move-surface>
  <header class="cpu-title" :class="{desktop}">
   <CpuDisplayToggle :transparent="transparent" :desktop="desktop" @toggle="toggleBackground" />
   <strong>{{ standalone?'AiDiy CPU':'AiDiy IDE / CPU' }}</strong>
   <WindowActions v-if="desktop" />
   <button v-else-if="floating" class="cpu-close" aria-label="使用率画面を閉じる" @click="emit('close')">×</button>
  </header>
  <div class="cpu-chart">
   <svg viewBox="0 0 264 100" preserveAspectRatio="none" role="img" aria-label="直近60回の使用率。CPUとGPUは面、RAMは折線。縦軸0から100パーセント">
    <g class="cpu-grid"><path v-for="y in [10,31,52,73,94]" :key="y" :d="`M22 ${y}H${chartRight}`" /></g>
    <g class="cpu-axis"><text x="19" y="13">100</text><text x="19" y="55">50</text><text x="19" y="97">0</text></g>
    <g v-for="item in series" :key="item.key" :style="{color:item.color}">
     <path v-if="item.key!=='ram'" :d="item.area" fill="currentColor" fill-opacity=".22" />
     <path :d="item.line" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" />
    </g>
    <g v-for="item in labels" :key="item.key" :style="{color:item.color}" class="cpu-label">
     <path v-if="item.value!==null" :d="`M${chartRight} ${item.y}L${chartRight+4} ${item.labelY}`" stroke="currentColor" fill="none" stroke-opacity=".55" />
     <circle v-if="item.value!==null" :cx="chartRight" :cy="item.y" r="2.5" fill="currentColor" />
     <rect :x="labelRight-labelMaxWidth-2" :y="item.labelY-6" :width="labelMaxWidth+4" height="13" fill="currentColor" />
     <text :x="labelRight-labelMaxWidth/2" :y="item.labelY+.5" text-anchor="middle" dominant-baseline="central" :textLength="(item.value===null?5:5+String(Math.round(item.value)).length)*6.6" lengthAdjust="spacingAndGlyphs" fill="#000">{{ item.key.toUpperCase() }} {{ item.value===null?'—':Math.round(item.value)+'%' }}</text>
    </g>
   </svg>
  </div>
 </section>
</template>
<style>
.cpu-panel{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:#000;color:#d9e5ec;overflow:hidden}
.cpu-panel.cpu-transparent{background:transparent;box-shadow:none;border-color:transparent}
html.cpu-transparent-window,html.cpu-transparent-window body,html.cpu-transparent-window #app,html.cpu-transparent-window .development-app{background:transparent}
.cpu-floating{position:absolute;right:8px;bottom:min(376px,max(8px,calc(100% - 133px)));width:min(400px,calc(100% - 16px));height:125px;z-index:50;border:1px solid #465460;box-shadow:0 12px 32px #0009;resize:both;min-width:min(240px,calc(100% - 16px));min-height:125px;max-width:calc(100% - 16px);max-height:calc(100% - 16px)}
/* CPU専用の小さいタイトル。接続表示・接続バー・その監視処理は持たない。 */
.cpu-title{position:absolute;left:0;right:0;top:0;z-index:1;opacity:0;pointer-events:none;height:31px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 4px;background:#30343a;color:white}
.cpu-panel:hover>.cpu-title,.cpu-panel:focus-within>.cpu-title{opacity:1;pointer-events:auto}
.cpu-title.desktop{-webkit-app-region:drag}
.cpu-title strong{flex:1;font-size:11px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cpu-title button{-webkit-app-region:no-drag}
.cpu-title .window-actions button{width:24px;height:26px;padding:0}
.cpu-chart{flex:1;min-height:0;padding:2px 2px 0}.cpu-chart svg{width:100%;height:100%;overflow:visible}
.cpu-grid path{stroke:#1c2930;stroke-width:1;vector-effect:non-scaling-stroke}.cpu-axis{fill:#6d7e87;font:10px monospace;text-anchor:end}
.cpu-label{font:11px ui-monospace,monospace;font-weight:600}
.cpu-close{margin-left:4px;line-height:20px;padding:0 4px;background:none;border:0;color:white;font-size:20px;cursor:pointer;-webkit-app-region:no-drag}
</style>
