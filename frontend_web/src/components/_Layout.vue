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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import TopBar from './_TopBar.vue';
import TopMenu from './_TopMenu.vue';

const route = useRoute();

const AIコアパス判定 = (path: string): boolean => {
  try {
    const decodedPath = decodeURIComponent(path);
    return decodedPath === '/AiDiy' || decodedPath.startsWith('/AiDiy/');
  } catch {
    return path.startsWith('/AI');
  }
};

const isAIコア = computed(() => {
  // ルーター初期化前の瞬間はroute.pathが未確定なことがあるため、現在URLも併用する
  return AIコアパス判定(route.path) || AIコアパス判定(window.location.pathname);
});

// HTML要素のdark-routeクラスをルート遷移に応じて動的に切り替え
watch(isAIコア, (暗いモード) => {
  if (暗いモード) {
    document.documentElement.classList.add('dark-route');
  } else {
    document.documentElement.classList.remove('dark-route');
  }
}, { immediate: true });

onBeforeUnmount(() => {
  document.documentElement.classList.remove('dark-route');
});

// メニュー状態: 1=全表示, 2=メニュー非表示, 3=最小化
const menuState = ref(1);

const toggleMenu = () => {
  // 3段階でトグル: 1 → 2 → 3 → 1
  menuState.value = menuState.value >= 3 ? 1 : menuState.value + 1;

  // 状態をlocalStorageに保存
  localStorage.setItem('menu_state', menuState.value.toString());

  console.log('Menu state:', menuState.value);
};

// 保存された状態を復元
onMounted(() => {
  const saved = localStorage.getItem('menu_state');
  if (saved !== null) {
    const state = parseInt(saved, 10);
    if (!isNaN(state) && state >= 1 && state <= 3) {
      menuState.value = state;
    }
  }
});
</script>

<template>
    <div class="app-layout" :class="{ 'dark-bg': isAIコア }">
    <TopBar @toggle-menu="toggleMenu" :menuState="menuState" />
    <TopMenu :isOpen="menuState === 1" />
    <main class="content" :class="{ 'full-height': menuState >= 2, 'dark-bg': isAIコア }">
      <slot></slot>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f0f0f0;
}

.app-layout.dark-bg {
  background-color: #1a1a1a;
}

.content {
  flex: 1;
  padding: 0;
  overflow-y: auto;
  transition: flex 0.3s ease, padding 0.3s ease;
}

.content.full-height {
  /* メニュー非表示時にコンテンツを広げる */
  flex: 1;
}

.content.dark-bg {
  background-color: #1a1a1a;
}
</style>

