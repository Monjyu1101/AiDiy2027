<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    query: string;
    zoom?: number;
    width?: string;
    height?: string;
    title?: string;
    language?: string;
  }>(),
  {
    zoom: 15,
    width: '100%',
    height: '400px',
    title: 'Google マップ',
    language: 'ja'
  }
);

const src = computed(() => {
  const q = encodeURIComponent((props.query || '').trim());
  if (!q) return '';
  return `https://www.google.com/maps?q=${q}&z=${props.zoom}&hl=${props.language}&output=embed`;
});
</script>

<template>
  <div class="gmap-wrap" :style="{ width, height }">
    <iframe
      v-if="src"
      :src="src"
      :title="title"
      class="gmap-frame"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
      allowfullscreen
    ></iframe>
    <div v-else class="gmap-empty">住所未入力</div>
  </div>
</template>

<style scoped>
.gmap-wrap {
  box-sizing: border-box;
  border: 1px solid #c7d0d8;
  background: #f2f4f6;
  overflow: hidden;
}

.gmap-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.gmap-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
  font-size: 11px;
}
</style>
