<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import BrowserAnalysisDialog from '../../dialog/ブラウザ解析ダイアログ.vue';
const context=ref(null),error=ref(''),connected=ref(false);let disposed=false,timer,connectionRevision=0,stop=()=>{};
const lifetime=new AbortController();
const close=()=>window.aidiyWindow.browserAction('analysis-window-close');
function updateConnection(value){
 if(disposed)return;
 ++connectionRevision;connected.value=value?.available===true&&value?.connected===true;
 if(context.value)context.value={...context.value,connected:connected.value};
}
async function readConnection(){
 const revision=connectionRevision;
 try{
  const response=await fetch('/api/connection',{cache:'no-store',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)])});
  const value=await response.json();if(disposed||revision!==connectionRevision)return;
  updateConnection({available:response.ok&&value.active,connected:value.mode==='online'&&value.connected===true});
 }catch{if(!disposed&&revision===connectionRevision)updateConnection({connected:false});}
 finally{if(!disposed)timer=setTimeout(readConnection,2000);}
}
onMounted(async()=>{
 stop=window.aidiyWindow.onBrowserChanged?.(updateConnection)||(()=>{});
 void readConnection();
 try{const result=await window.aidiyWindow.browserAction('analysis-window-context');if(disposed)return;if(!result?.ok||!result.context)throw Error(result?.error||'解析対象を取得できません。');context.value={...result.context,connected:connected.value};}
 catch(e){if(!disposed)error.value=e.message;}
});
onBeforeUnmount(()=>{disposed=true;++connectionRevision;stop();clearTimeout(timer);lifetime.abort();});
</script>
<template>
 <BrowserAnalysisDialog v-if="context" :context="context" native-window @close="close" />
 <div v-else class="browser-analysis-window-loading"><p :role="error?'alert':'status'">{{ error||'解析対象を確認しています…' }}</p><button @click="close">閉じる</button></div>
</template>
<style scoped>
.browser-analysis-window-loading{padding:12px;color:#dce6f4}
</style>
