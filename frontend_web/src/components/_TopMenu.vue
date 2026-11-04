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
import { RouterLink } from 'vue-router';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: true
  }
});
</script>

<template>
  <nav class="top-menu" :class="{ 'hidden': !isOpen }">
    <div class="tabs">
      <div class="tab-container">
        <!-- カテゴリーメニュー -->
        <a href="/AiDiy" target="_blank" class="tab">
          AiDiy
        </a>
        <RouterLink to="/メニュー" active-class="active" class="tab">
          メニュー
        </RouterLink>
        <RouterLink to="/C管理" active-class="active" class="tab">
          C管理
        </RouterLink>
        <RouterLink to="/Mマスタ" active-class="active" class="tab">
          Mマスタ
        </RouterLink>
        <RouterLink to="/Tトラン" active-class="active" class="tab">
          Tトラン
        </RouterLink>
        <RouterLink to="/Sスケジュール" active-class="active" class="tab">
          Sスケジュール
        </RouterLink>
        <RouterLink to="/Vビュー" active-class="active" class="tab">
          Vビュー
        </RouterLink>
        <RouterLink to="/リンク" active-class="active" class="tab">
          リンク
        </RouterLink>
        <RouterLink to="/Xビデオ" active-class="active" class="tab">
          Xビデオ
        </RouterLink>
        <RouterLink to="/Xその他" active-class="active" class="tab">
          Xその他
        </RouterLink>

        <!-- ログアウト -->
        <RouterLink to="/ログアウト" class="tab tab-logout">
          ログアウト
        </RouterLink>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.top-menu {
  width: 100%;
  background-color: #fff;
  transition: all 0.3s ease;
}

.top-menu.hidden {
  display: none;
}

/* タブのスタイル */
.tabs {
  display: flex;
  overflow-x: auto;
  background-color: #fff;
  padding: 6px 8px;
  z-index: 10;
  position: relative;
  justify-content: center;
  /* スムーズなスクロール */
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}

/* スクロールバーを非表示（オプション） */
.tabs::-webkit-scrollbar {
  display: none;
}

.tab-container {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  min-width: min-content;
}

/* 個々のタブのスタイル */
.tab {
  display: inline-block;
  padding: 4px 12px;
  background-color: #ddd;
  text-decoration: none;
  color: #000;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  transition: all 0.2s;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.tab:hover {
  background-color: #ccc;
}

.tab:active {
  transform: scale(0.95);
}

/* アクティブなタブのスタイル */
.tab.active {
  background-color: #000;
  color: #fff;
  font-weight: bold;
}

/* 無効化されたタブ（準備中）のスタイル */
.tab.tab-disabled {
  background-color: #f0f0f0;
  color: #999;
  cursor: not-allowed;
  opacity: 0.6;
}

.tab.tab-disabled:hover {
  background-color: #f0f0f0;
}

/* ログアウトタブのスタイル */
.tab.tab-logout {
  background-color: #ddd;
  color: #000;
  border: 1px solid #dc3545;
  margin-left: auto;
}

.tab.tab-logout:hover {
  background-color: #ccc;
  border-color: #c82333;
}

/* スマホ向けスタイル */
@media (max-width: 768px) {
  .tabs {
    padding: 6px 6px;
    justify-content: flex-start;
  }

  .tab-container {
    gap: 10px;
    padding: 0 20px;
    justify-content: center;
    width: auto;
  }

  .tab {
    padding: 6px 14px;
    font-size: 13px;
    min-height: 34px;
    border-radius: 6px;
    min-width: 72px;
  }

  /* ログアウトボタンもスマホで中央配置 */
  .tab.tab-logout {
    margin-left: 0;
  }
}

/* 極小スマホ向け */
@media (max-width: 480px) {
  .tab-container {
    padding: 0 10px;
    gap: 8px;
  }

  .tab {
    padding: 6px 12px;
    font-size: 12px;
    min-width: 64px;
  }
}
</style>
