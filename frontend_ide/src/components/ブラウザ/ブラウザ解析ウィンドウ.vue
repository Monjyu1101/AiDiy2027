<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import BrowserAnalysisDialog from '../../dialog/ブラウザ解析ダイアログ.vue';
const context=ref(null),error=ref('');let disposed=false;
const close=()=>window.aidiyWindow.browserAction('analysis-window-close');
onMounted(async()=>{
 try{const result=await window.aidiyWindow.browserAction('analysis-window-context');if(disposed)return;if(!result?.ok||!result.context)throw Error(result?.error||'解析対象を取得できません。');context.value=result.context;}
 catch(e){if(!disposed)error.value=e.message;}
});
onBeforeUnmount(()=>{disposed=true;});
</script>
<template>
 <BrowserAnalysisDialog v-if="context" :context="context" native-window @close="close" />
 <div v-else class="browser-analysis-window-loading"><p :role="error?'alert':'status'">{{ error||'解析対象を確認しています…' }}</p><button @click="close">閉じる</button></div>
</template>
<style scoped>
.browser-analysis-window-loading{padding:12px;color:#dce6f4}
</style>
