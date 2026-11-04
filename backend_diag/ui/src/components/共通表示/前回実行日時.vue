<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { computed } from 'vue';
const props=defineProps(['value']);
const 表示=computed(()=>{
  const date=new Date(props.value);
  return props.value && Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '未実行';
});
</script>
<template><span class="previous-run" aria-live="polite">[前回実行日時: <time v-if="value" :datetime="value">{{表示}}</time><template v-else>{{表示}}</template>]</span></template>
