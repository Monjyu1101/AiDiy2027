<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,watch,onUnmounted} from 'vue';
import AI設定再起動 from '../../dialog/AI設定再起動.vue';
import {AI設定状態を作成} from './AI設定状態.mjs';
const props=defineProps({api:Function,connected:Boolean,coreOnline:Boolean});
const state=AI設定状態を作成({api:(...args)=>props.api(...args),利用可能:()=>props.connected&&props.coreOnline});
const userId=ref(''),password=ref('');
async function login(){const secret=password.value;password.value='';await state.ログイン(userId.value,secret);}
watch(()=>props.connected&&props.coreOnline,value=>{if(!value){password.value='';state.切断(props.connected?'Coreとの接続が切れたため、設定操作を中止しました。':'Diagへ接続してください。');}},{flush:'sync'});
onUnmounted(()=>{password.value='';state.終了();});
</script>
<template>
<section class="ai-settings-tab" aria-label="設定再起動">
 <header class="ai-settings-toolbar"><h2>設定再起動</h2><button v-if="state.認証済み.value" :disabled="state.変更中.value" @click="state.ログアウト()">Coreからログアウト</button></header>
 <p>Core（AIコア）を起動し、既存の利用者IDでログインしてください。認証はこの画面内だけで保持します。</p>
 <p v-if="!connected" role="status">先にDiagへ接続してください。</p>
 <p v-else-if="!coreOnline" role="status">Core 起動中のみ操作できます。システム起動で Core を起動してください。</p>
 <form v-else-if="!state.認証済み.value" class="ai-settings-login" @submit.prevent="login">
  <label>利用者ID<input v-model="userId" autocomplete="username" :disabled="state.処理中.value" required></label>
  <label>パスワード<input v-model="password" type="password" autocomplete="off" :disabled="state.処理中.value" required></label>
  <button :disabled="state.処理中.value">{{state.処理中.value?'接続中…':'Coreへログイン'}}</button>
 </form>
 <p v-if="state.通知.value" role="status" aria-live="polite">{{state.通知.value}}</p>
 <p v-if="state.待機秒.value" role="status">再接続まで {{state.待機秒.value}} 秒（再起動完了の保証ではありません）</p>
 <button v-if="state.認証済み.value" :disabled="state.処理中.value||state.変更中.value||state.待機秒.value>0" @click="state.再読込()">設定を再読込</button>
 <AI設定再起動 v-if="connected&&coreOnline&&state.認証済み.value&&!state.待機秒.value&&!state.処理中.value" :key="state.画面版.value" :is-open="true" :session-id="state.セッションID.value" :request="state.request" @close="state.ログアウト()" @saved="state.保存後"/>
</section>
</template>
