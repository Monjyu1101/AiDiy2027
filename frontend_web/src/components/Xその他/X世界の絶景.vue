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
import { useRoute, useRouter } from 'vue-router';

const baseUrl = import.meta.env.BASE_URL || '/';
const frameSrc = `${baseUrl}X世界の絶景/index.html`;
const route = useRoute();
const router = useRouter();
const normalizeQueryValue = (value: string | string[] | null | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;
const toHalfwidthUrl = (value: string): string => value.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=');
const URLメニュー = computed(() => {
  const value = normalizeQueryValue(route.query.URLメニュー as string | string[] | undefined);
  return value ? String(value) : '';
});
const URL戻り先 = computed(() => {
  const value = normalizeQueryValue(route.query.URL戻り先 as string | string[] | undefined);
  return value ? String(value) : '';
});
const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleReturn = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};
</script>

<template>
  <div class="page-container">
    <div class="header-actions">
      <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
      <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleReturn">戻る</button>
    </div>
    <iframe
      class="world-frame"
      :src="frameSrc"
      title="X世界の絶景"
      frameborder="0"
      allow="fullscreen"
      loading="lazy"
    ></iframe>
  </div>
</template>

<style scoped>
.page-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #071016;
}

.world-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.header-actions {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-menu,
.btn-return {
  height: 30px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.40);
  background: rgba(5, 14, 20, 0.72);
  color: #e8faff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  backdrop-filter: blur(8px);
}

.btn-menu:hover,
.btn-return:hover {
  background: rgba(6, 36, 48, 0.86);
}
</style>
