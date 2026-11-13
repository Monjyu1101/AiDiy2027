<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {起動モーション} from './起動モーション.mjs';
import './起動モーション.css';
import {computed,watch,ref,onBeforeUnmount} from 'vue';
import {アプリアイコン,起動項目を整列} from './アプリアイコン.mjs';
import ミニアイコン列 from './ミニアイコン列.vue';
const props=defineProps({state:Object,cliState:Object,online:Boolean});
defineEmits(['open-apps']);
const 起動一覧=computed(()=>起動項目を整列([...props.state.項目.value.filter(item=>item.id!=='chrome'&&props.state.利用可能(item.id)),...(props.cliState?.項目.value||[]).filter(item=>item.id==='aidiy_hermes')]));
watch(()=>props.online,value=>{if(value)void props.state.読込();},{immediate:true});
// 未選択の案内は英語で右端から左端へ流す（通常画面の入力欄とボタンのtitleは日本語のまま）
const 未選択案内='SELECT YOUR PROJECT  ▸▸  READY FOR LAUNCH';
// 文字を格子1マス（1.6px）ずつ送るため、流す距離をマス数で渡す。固定の格子の下を文字が移って見える。
const マーキー=ref(null);let 監視;
watch(マーキー,el=>{監視?.disconnect();if(!el)return;const 設定=()=>el.style.setProperty('--marquee-cells',String(Math.max(1,Math.round(el.offsetWidth/1.6))));設定();監視=new ResizeObserver(設定);監視.observe(el);});
onBeforeUnmount(()=>監視?.disconnect());
</script>
<template>
<div class="mini-app-launch" aria-label="アプリ起動">
 <component :is="ミニアイコン列" class="mini-app-buttons">
 <template v-for="item in 起動一覧" :key="item.id">
  <button v-if="item.id!=='aidiy_hermes'" class="mini-app-button" :data-app="item.id" :aria-label="item.名前+' を起動'+(state.不可理由(item.id)?' — '+state.不可理由(item.id):'')" :title="state.不可理由(item.id)||item.名前+' を起動'+(state.フォルダ.value?' — '+state.フォルダ.value:' — プロジェクト選択してね')" :disabled="!online||!state.利用可能(item.id)||item.id!=='chrome'&&!state.フォルダ.value||!!state.処理中.value||state.選択中.value" @click="state.起動(item.id,{開始時:起動モーション($event)})"><span class="mini-icon-frame"><span class="launch-frame launch-frame-36" aria-hidden="true"><img :src="アプリアイコン[item.id]" alt="" width="36" height="36"><span class="launch-trace"></span></span></span></button>
  <button v-else class="mini-app-button mini-hermes-button" data-cli="aidiy_hermes" :aria-label="item.名前+' をConsoleで起動（'+item.モード+'）'" :title="item.名前+' / '+item.モード+' / モデル指定なし / 複数起動可'+(state.フォルダ.value?' — '+state.フォルダ.value:' — プロジェクト選択してね')" :disabled="!online||!state.フォルダ.value||!!state.処理中.value&&!state.処理中.value.startsWith('cli:')||state.選択中.value" @click="cliState.起動('aidiy_hermes',{確認省略:true,開始時:起動モーション($event)})"><span class="mini-icon-frame"><span class="launch-frame launch-frame-36" aria-hidden="true"><img src="CLI_aidiy_hermes.png" alt="" width="36" height="36"><span class="launch-trace"></span></span></span></button>
 </template>
 </component>
 <button v-if="!state.フォルダ.value" type="button" class="mini-app-message required mini-project-link" title="プロジェクト選択してね" aria-label="アプリ起動パネルでプロジェクトを選択" @click="$emit('open-apps')"><span ref="マーキー" class="mini-app-marquee">{{未選択案内}}</span></button>
 <p v-else class="mini-app-message" :title="state.フォルダ.value">{{state.フォルダ.value}}</p>
</div>
</template>
