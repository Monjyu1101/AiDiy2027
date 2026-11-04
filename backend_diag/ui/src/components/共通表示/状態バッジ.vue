<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { computed } from 'vue';
const props = defineProps({
  state: { type: String, default: '未確認' },
  label: { type: String, default: '' },
});
const tone = computed(() => ({ OK: 'success', 取得済: 'success', 未実施: 'warning', 未検出: 'warning', 注意: 'warning', NG: 'danger', ERR: 'danger', 失敗: 'danger', 実行中: 'pending', 取得中: 'pending', 確認中: 'pending', 待機中: 'pending', キャッシュ利用: 'cache', PASS: 'cache' })[props.state] || 'neutral');
const text = computed(() => props.label || props.state);
</script>

<template>
  <span class="badge" :data-state="state" :data-tone="tone" :aria-label="text">
    <span v-if="state==='確認中' || state==='取得中' || state==='実行中'" class="badge-spinner" aria-hidden="true"></span>
    <span class="badge-label">{{text}}</span>
  </span>
</template>
