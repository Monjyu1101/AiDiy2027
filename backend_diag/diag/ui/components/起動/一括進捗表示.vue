<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {computed} from 'vue';
import './一括進捗表示.css';
const props=defineProps({state:Object,compact:Boolean});
const 進捗=computed(()=>{const value=props.state.進捗表示.value;return ['running','error'].includes(value?.状態)?value:null;});
const 見出し=computed(()=>{
 const label=進捗.value?.種別==='stop'?'強制停止':'一括起動';
 return label+(進捗.value?.状態==='running'?'中…':'を確認してください');
});
</script>
<template>
<section v-if="進捗" class="batch-progress" :class="{compact}" :data-state="進捗.状態" :data-kind="進捗.種別" role="region" aria-label="システム起動の進行状況">
 <span v-if="進捗.状態==='running'" class="batch-progress-spinner" aria-hidden="true"></span>
 <div class="batch-progress-message" role="status" aria-live="polite" aria-atomic="true">
  <strong>{{見出し}}</strong>
  <span class="batch-progress-detail">{{進捗.通知}}</span>
  <small v-if="進捗.状態==='error'">システム起動タブで状態・コンソールを確認してください。</small>
  <small v-if="state.更新失敗.value">状態を再確認しています。処理の停止は確認されていません。</small>
 </div>
 <small v-if="!compact" class="batch-progress-hint">処理中もタブを切り替えて操作できます。</small>
 <button v-if="進捗.状態!=='running'" type="button" aria-label="進行状況を閉じる" @click="state.進捗を閉じる()">閉じる</button>
</section>
</template>
