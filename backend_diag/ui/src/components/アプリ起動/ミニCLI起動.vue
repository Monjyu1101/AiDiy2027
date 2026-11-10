<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {起動モーション} from './起動モーション.mjs';
import './起動モーション.css';
import {computed,watch} from 'vue';
import {アプリアイコン} from './アプリアイコン.mjs';
import ミニアイコン列 from './ミニアイコン列.vue';
const props=defineProps({state:Object,appState:Object,online:Boolean});
watch(()=>props.online,value=>{if(value)void props.state.読込();else props.state.切断();},{immediate:true});
const Chrome=computed(()=>props.appState.項目?.value?.find(item=>item.id==='chrome'&&props.appState.利用可能('chrome')));
const 外部CLI=computed(()=>props.state.項目.value.filter(item=>item.id!=='aidiy_hermes'));
</script>
<template>
<section v-if="外部CLI.length||Chrome" class="mini-cli-launch" aria-label="外部アプリ・CLI起動">
 <component :is="ミニアイコン列" class="mini-cli-buttons">
  <button v-for="item in 外部CLI" :key="item.id" class="mini-cli-button" :data-cli="item.id" :aria-label="item.種類==='editor'?item.名前+' でフォルダを開く':item.名前+' をConsoleで起動（'+item.モード+'）'" :title="item.名前+' / '+item.モード+(item.種類==='editor'?'':' / モデル指定なし')+' / 複数起動可'+(appState.フォルダ.value?' — '+appState.フォルダ.value:' — プロジェクト選択してね')" :disabled="!online||!appState.フォルダ.value||!!appState.処理中.value&&!appState.処理中.value.startsWith('cli:')||appState.選択中.value" @click="state.起動(item.id,{確認省略:true,開始時:起動モーション($event)})"><span class="mini-icon-frame"><span class="launch-frame launch-frame-36" aria-hidden="true"><img :src="'CLI_'+item.id+'.svg'" alt="" width="36" height="36"><span class="launch-trace"></span></span></span></button>
  <button v-if="Chrome" class="mini-cli-button" data-app="chrome" :aria-label="Chrome.名前+' を起動'+(appState.不可理由('chrome')?' — '+appState.不可理由('chrome'):'')" :title="appState.不可理由('chrome')||'Chrome を起動'" :disabled="!online||!appState.利用可能('chrome')||!!appState.処理中.value||appState.選択中.value" @click="appState.起動('chrome',{開始時:起動モーション($event)})"><span class="mini-icon-frame"><span class="launch-frame launch-frame-36" aria-hidden="true"><img :src="アプリアイコン.chrome" alt="" width="36" height="36"><span class="launch-trace"></span></span></span></button>
 </component>
</section>
</template>
