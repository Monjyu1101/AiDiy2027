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
// AiDiy紹介・解説
const allUrl = `${baseUrl}Xビデオ/AiDiy紹介__all_ja/index.html`;
const 解説AllUrl = `${baseUrl}Xビデオ/AiDiy解説__all_ja/index.html`;

// 時事ニュース・解説
const ニュース_20260906_fable51_jaUrl = `${baseUrl}Xビデオ/ニュース_20260906_fable51_ja/index.html`;
const ニュース_20260906_gpt6astra_jaUrl = `${baseUrl}Xビデオ/ニュース_20260906_gpt6astra_ja/index.html`;
const ニュース_20260906_gemini38flash_jaUrl = `${baseUrl}Xビデオ/ニュース_20260906_gemini38flash_ja/index.html`;

// 小説
const 小説解説_AiDiy誕生_jaUrl = `${baseUrl}Xビデオ/小説解説_AiDiy誕生_ja/index.html`;
const 小説解説_本好きの下剋上_jaUrl = `${baseUrl}Xビデオ/小説解説_本好きの下剋上_ja/index.html`;

// 四コマ漫画
const 四コマ漫画_伝説のプログラマ_jaUrl = `${baseUrl}Xビデオ/四コマ漫画_伝説のプログラマ_ja/index.html`;

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
  <div class="menu-view">
    <h2 class="page-title">
      <span class="title-text">【 Xビデオ 】</span>
      <div class="header-actions">
        <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
        <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleReturn">戻る</button>
      </div>
    </h2>

    <div class="content">
      <p>AiDiy の紹介・解説、ニュース、小説、四コマ漫画のビデオです。下記から選択してください。</p>

      <div class="video-menu-sections">
        <div class="section-label">AiDiy紹介・解説</div>

        <div class="menu-row">
          <a class="menu-card menu-card-fixed" :href="allUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">X全</span>
              AiDiy紹介（総合）
            </div>
            <div class="menu-card-description">
              backend・frontend・AIコア・tools・hermes・avatar の全テーマを通しで再生する総合プレゼンビデオ
            </div>
          </a>

          <a class="menu-card menu-card-fixed" :href="解説AllUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">X全</span>
              AiDiy解説（総合）
            </div>
            <div class="menu-card-description">
              AiDiy の全体構成・日本語ファースト設計・AI コア・MCP・ビデオページ生成までを二人掛け合いで解説
            </div>
          </a>

        </div>

        <div class="section-label">時事ニュース・解説</div>

        <div class="menu-row">
          <a class="menu-card menu-card-fixed" :href="ニュース_20260906_fable51_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">寓話</span>
              Claude Fable 5.1 発表
            </div>
            <div class="menu-card-description">
              Claude Fable 5.1の科学・開発性能と料金、安全性を解説
            </div>
          </a>

          <a class="menu-card menu-card-fixed" :href="ニュース_20260906_gpt6astra_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">極星</span>
              GPT-6 Astra 発表
            </div>
            <div class="menu-card-description">
              GPT-6 Astraの性能とPC操作、料金、安全性を解説
            </div>
          </a>

          <a class="menu-card menu-card-fixed" :href="ニュース_20260906_gemini38flash_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">閃考</span>
              Gemini 3.8 Flash 発表
            </div>
            <div class="menu-card-description">
              Gemini 3.8 Flashの性能と料金、速度特性を解説
            </div>
          </a>

        </div>

        <div class="section-label">小説</div>

        <div class="menu-row">
          <a class="menu-card menu-card-fixed" :href="小説解説_AiDiy誕生_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">誕生</span>
              小説解説『AiDiy誕生』
            </div>
            <div class="menu-card-description">
              一枚の HTML から始まった AiDiy の誕生と歩みをひとり語りで紹介
            </div>
          </a>

          <a class="menu-card menu-card-fixed" :href="小説解説_本好きの下剋上_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">本好</span>
              小説解説『本好きの下剋上』全5部
            </div>
            <div class="menu-card-description">
              本を求める少女の転生から始まる全 5 部の物語をネタバレ込みで紹介
            </div>
          </a>

        </div>

        <div class="section-label">四コマ漫画</div>

        <div class="menu-row">
          <a class="menu-card menu-card-fixed" :href="四コマ漫画_伝説のプログラマ_jaUrl" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">伝説</span>
              四コマ漫画『小話　伝説のプログラマ』
            </div>
            <div class="menu-card-description">
              伝説のプログラマをめぐる小話を、日本語ナレーション付きの四コマ漫画で軽快に描く
            </div>
          </a>

        </div>

      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
.page-title {
  display: flex;
  align-items: center;
}

.title-text {
  flex: 1;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-menu {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 12px;
  background-color: #6c757d;
  color: #fff;
}

.btn-menu:hover {
  background-color: #5a6268;
}

.btn-return {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 12px;
  background-color: #dc3545;
  color: #fff;
}

.btn-return:hover {
  background-color: #c82333;
}

.video-menu-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
}

.menu-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #888;
  text-transform: none;
  border-bottom: 1px solid #333;
  padding-bottom: 4px;
  margin-top: 4px;
}

@media (max-width: 768px) {
  .menu-row {
    flex-direction: column;
  }

  .menu-card-fixed {
    width: 100%;
    min-width: 0;
    height: auto;
    min-height: 158px;
  }
}
</style>
