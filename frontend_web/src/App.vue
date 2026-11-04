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
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Layout from './components/_Layout.vue';
import qColorPickerDialog from './components/_share/qColorPickerDialog.vue';
import { setColorPickerInstance } from './utils/qAlert';

const route = useRoute();

const AIコアパス判定 = (path: string): boolean => {
  try {
    const decodedPath = decodeURIComponent(path);
    return decodedPath === '/AiDiy' || decodedPath.startsWith('/AiDiy/');
  } catch {
    return path.startsWith('/AI');
  }
};

const colorPickerRef = ref(null);

// ログイン画面以外はレイアウトを適用
const isLogin = computed(() => route.path === '/ログイン');
const isAIコア = computed(() => {
  return AIコアパス判定(route.path) || AIコアパス判定(window.location.pathname);
});

onMounted(() => {
  if (colorPickerRef.value) {
    setColorPickerInstance(colorPickerRef.value);
  }
});
</script>

<template>
  <div v-if="isLogin">
    <RouterView />
  </div>
  <Layout v-else>
    <RouterView v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
        <template #fallback>
          <div v-if="isAIコア" class="ai-core-loading"></div>
        </template>
      </Suspense>
    </RouterView>
  </Layout>
  <qColorPickerDialog ref="colorPickerRef" />
</template>

<style scoped>
.ai-core-loading {
  width: 100%;
  min-height: calc(100vh - 100px);
  background: #1a1a1a;
}

</style>
