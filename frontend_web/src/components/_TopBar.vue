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
import { useAuthStore } from '../stores/auth';
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  menuState: {
    type: Number,
    default: 1
  }
});

const authStore = useAuthStore();
const emit = defineEmits(['toggle-menu']);

const toggleMenu = () => {
  emit('toggle-menu');
};

// ユーザー表示テキストを生成
const userDisplayText = computed(() => {
  if (!authStore.user) return '';

  const userName = authStore.user.利用者名 || authStore.user.利用者ID;
  // 注: 権限名はV利用者ビューから取得する必要があります
  // 現在のC利用者型には権限名フィールドが含まれていません

  return userName;
});

// サーバー状態管理
const isReady = ref(-1);  // -1: 未接続, 0以上: 処理可能数
const isBusy = ref(-1);   // -1: 未接続, 0以上: 処理中数
const titleUnderlineColor = ref('rgb(0, 0, 0)');

let readyCountInterval: ReturnType<typeof setInterval> | null = null;
let animationInterval: ReturnType<typeof setInterval> | null = null;
let updateTitleUnderlineLogged = false;

// サーバー状態を取得
const getReadyCount = async () => {
  try {
    const response = await fetch('/core/サーバー状態');
    const data = await response.json();
    isReady.value = data.ready_count;
    isBusy.value = data.busy_count;
    console.log('getReadyCount:', { ready: isReady.value, busy: isBusy.value });
  } catch (error) {
    console.error('サーバー状態取得エラー:', error);
    isReady.value = -1;
    isBusy.value = -1;
  }
};

// タイトル下線のアニメーション更新
const updateTitleUnderline = () => {
  const now = Date.now() / 1000;
  const tm = now % 9;
  const intensity = Math.abs(Math.sin((tm / 9) * Math.PI * 2));
  const c255 = Math.round(255 * intensity);

  // サーバー状態に応じて色を変更
  if (isReady.value === -1) {
    // 未接続: 黒
    titleUnderlineColor.value = 'rgb(0, 0, 0)';
  } else if (isBusy.value > 0) {
    // 処理中: 赤の点滅
    titleUnderlineColor.value = `rgb(${c255}, 0, 0)`;
  } else if (isReady.value > 0) {
    // 処理可能: シアンの点滅
    titleUnderlineColor.value = `rgb(0, ${c255}, ${c255})`;
  } else {
    // 待機中: グレーの点滅
    const c127 = Math.round(127 * intensity);
    titleUnderlineColor.value = `rgb(${c127}, ${c127}, ${c127})`;
  }

  // 初回のみログ出力
  if (!updateTitleUnderlineLogged) {
    console.log('updateTitleUnderline:', {
      ready: isReady.value,
      busy: isBusy.value,
      color: titleUnderlineColor.value
    });
    updateTitleUnderlineLogged = true;
  }
};

// コンポーネントマウント時
onMounted(() => {
  console.log('TopBar mounted - starting animations');

  // 初回取得
  getReadyCount();

  // 3秒ごとにサーバー状態を取得
  readyCountInterval = setInterval(getReadyCount, 3000);

  // 50msごとにアニメーション更新
  animationInterval = setInterval(updateTitleUnderline, 50);

  // 初回アニメーションも実行
  updateTitleUnderline();
});

// コンポーネントアンマウント時
onUnmounted(() => {
  if (readyCountInterval) clearInterval(readyCountInterval);
  if (animationInterval) clearInterval(animationInterval);
});
</script>

<template>
  <!-- ハンバーガーメニューは常に表示 -->
  <button class="hamburger-menu" @click="toggleMenu"></button>

  <!-- ユーザー情報も常に表示 -->
  <div class="user-info" v-if="authStore.isAuthenticated">
    <span class="user-display">{{ userDisplayText }}</span>
  </div>

  <header class="top-bar" v-show="menuState !== 3">
    <div class="brand">
      <h1>AiDiy ( Do it yourself with AI )</h1>
    </div>
  </header>
  <div class="title-underline" :style="{ backgroundColor: titleUnderlineColor, height: menuState === 3 ? '6px' : '12px' }"></div>
</template>

<style scoped>
/* トップバーのスタイル */
.top-bar {
  background-color: #000;
  color: #fff;
  padding: 10px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
  transition: all 0.3s ease;
}

.brand h1 {
  margin: 0;
  padding: 0;
  line-height: 0.75;
  text-align: center;
  font-size: 1.5rem;
  font-weight: normal;
  color: #fff;
}

/* ハンバーガーメニューボタン */
.hamburger-menu {
  position: fixed !important;
  left: 10px !important;
  top: 10px !important;
  background: #000000 !important;
  border: 2px solid #fff !important;
  color: #fff !important;
  font-size: 12px !important;
  font-weight: bold !important;
  cursor: pointer !important;
  padding: 5px !important;
  width: 27px !important;
  height: 27px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 5px !important;
  z-index: 99999 !important;
}

/* 2本線のアイコン作成 */
.hamburger-menu::before {
  content: '' !important;
  position: absolute !important;
  width: 12px !important;
  height: 2px !important;
  background: #fff !important;
  top: 8px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  box-shadow: 0 6px 0 #fff !important;
}

.hamburger-menu:hover {
  background-color: #333333 !important;
  border-color: #fff !important;
}

/* ユーザー情報表示エリア */
.user-info {
  position: fixed;
  top: 10px;
  right: 20px;
  background-color: rgba(0, 0, 0, 0.9);
  color: #fff;
  border: 2px solid #fff;
  padding: 2px 18px 8px 18px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: bold;
  height: 27px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  box-sizing: border-box;
}

.user-display {
  position: relative;
  top: 2px;
}

/* タイトルの下線 */
.title-underline {
  height: 12px;
  /* background-color は動的に設定されるため削除 */
  /* transition は50msアニメーションの邪魔になるため削除 */
}
</style>

