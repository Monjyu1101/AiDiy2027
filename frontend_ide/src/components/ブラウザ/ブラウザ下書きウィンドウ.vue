<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import DraftHandoffDialog from '../../dialog/下書き連携ダイアログ.vue';
const request=ref(null),error=ref('');let disposed=false;
const close=()=>window.aidiyWindow.browserAction('draft-window-close');
const loadTargets=()=>window.aidiyWindow.draftTargets();
// mainがこの子窓に結び付けたページ・選択IDを再確認する。ページやrendererの本文は信頼しない。
const insertDraft=value=>window.aidiyWindow.insertDraft(value);
onMounted(async()=>{
 try{const result=await window.aidiyWindow.browserAction('draft-window-context');if(disposed)return;if(!result?.ok||!result.request)throw Error(result?.error||'連携内容を取得できません。');request.value=result.request;}
 catch(e){if(!disposed)error.value=e.message;}
});
onBeforeUnmount(()=>{disposed=true;});
</script>
<template>
 <DraftHandoffDialog v-if="request" :request="request" :load-targets="loadTargets" :insert-draft="insertDraft" native-window empty-hint="同じプロジェクトで aidiy_code または aidiy_live を起動してください。" @close="close" />
 <div v-else class="browser-draft-loading" @keydown.esc="close"><p :role="error?'alert':'status'">{{ error||'連携内容を確認しています…' }}</p><button @click="close">閉じる</button></div>
</template>
<style scoped>
.browser-draft-loading{padding:12px;color:#dce6f4}
</style>
