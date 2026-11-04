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
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ controlsVisible?: boolean }>(), { controlsVisible: true })

const 今日 = new Date()
const 表示年 = ref(今日.getFullYear())
const 表示月 = ref(今日.getMonth())

const 曜日ラベル = ['日', '月', '火', '水', '木', '金', '土']

function 月移動(差: number) {
  let 月 = 表示月.value + 差
  let 年 = 表示年.value
  if (月 < 0)  { 年--; 月 = 11 }
  if (月 > 11) { 年++; 月 = 0  }
  表示年.value = 年
  表示月.value = 月
}

function 月データ作成(年: number, 月: number) {
  const 月初曜日 = new Date(年, 月, 1).getDay()
  const 月末日   = new Date(年, 月 + 1, 0).getDate()
  const セル数   = Math.ceil((月初曜日 + 月末日) / 7) * 7
  const セル一覧 = Array.from({ length: セル数 }, (_, i) => {
    const 日番号 = i - 月初曜日 + 1
    const 有効   = 日番号 >= 1 && 日番号 <= 月末日
    return {
      日: 有効 ? 日番号 : null,
      今日: 有効 && 今日.getFullYear() === 年 && 今日.getMonth() === 月 && 今日.getDate() === 日番号,
      曜日: i % 7,
    }
  })
  return { タイトル: `${年}年 ${月 + 1}月`, セル一覧 }
}

function 隣月(差: number) {
  let 月 = 表示月.value + 差
  let 年 = 表示年.value
  if (月 < 0)  { 年--; 月 = 11 }
  if (月 > 11) { 年++; 月 = 0  }
  return 月データ作成(年, 月)
}

const 前月 = computed(() => 隣月(-1))
const 当月 = computed(() => 月データ作成(表示年.value, 表示月.value))
const 次月 = computed(() => 隣月(1))
</script>

<template>
  <main class="カレンダー画面" aria-label="カレンダー">
    <div :class="['カレンダーグループ', { '暗背景あり': props.controlsVisible }]">

      <!-- 前月（下揃え）＋▲ボタンをかぶせて配置 -->
      <div class="前次月枠 前月枠">
        <div class="月内容 薄">
          <div class="月タイトル">{{ 前月.タイトル }}</div>
          <div class="グリッド">
            <span v-for="(w, i) in 曜日ラベル" :key="i" class="曜日" :class="{ 日曜: i===0, 土曜: i===6 }">{{ w }}</span>
            <span v-for="(c, i) in 前月.セル一覧" :key="i" class="日"
              :class="{ 日曜: c.曜日===0, 土曜: c.曜日===6, 空: !c.日 }">{{ c.日 ?? '' }}</span>
          </div>
        </div>
        <button v-if="props.controlsVisible" class="月ボタン 上ボタン" aria-label="前月" @click="月移動(-1)">▲</button>
      </div>

      <!-- 当月（メイン） -->
      <div class="当月内容">
        <div class="月タイトル 当月タイトル">{{ 当月.タイトル }}</div>
        <div class="グリッド">
          <span v-for="(w, i) in 曜日ラベル" :key="i" class="曜日 当月曜日" :class="{ 日曜: i===0, 土曜: i===6 }">{{ w }}</span>
          <span v-for="(c, i) in 当月.セル一覧" :key="i" class="日 当月日"
            :class="{ 日曜: c.曜日===0, 土曜: c.曜日===6, 今日: c.今日, 空: !c.日 }">{{ c.日 ?? '' }}</span>
        </div>
      </div>

      <!-- 次月（上揃え）＋▼ボタンをかぶせて配置 -->
      <div class="前次月枠 次月枠">
        <button v-if="props.controlsVisible" class="月ボタン 下ボタン" aria-label="次月" @click="月移動(1)">▼</button>
        <div class="月内容 薄">
          <div class="月タイトル">{{ 次月.タイトル }}</div>
          <div class="グリッド">
            <span v-for="(w, i) in 曜日ラベル" :key="i" class="曜日" :class="{ 日曜: i===0, 土曜: i===6 }">{{ w }}</span>
            <span v-for="(c, i) in 次月.セル一覧" :key="i" class="日"
              :class="{ 日曜: c.曜日===0, 土曜: c.曜日===6, 空: !c.日 }">{{ c.日 ?? '' }}</span>
          </div>
        </div>
      </div>

    </div>
  </main>
</template>

<style scoped>
.カレンダー画面 {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: white;
  user-select: none;
  font-family: "Yu Gothic UI", "Meiryo", sans-serif;
  overflow: hidden;
}

/* 全体グループ：縦に積んで中央配置 */
.カレンダーグループ {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(340px, 94vw);
  border-radius: 12px;
  padding: 4px 8px;
}
.カレンダーグループ.暗背景あり {
  background: rgba(0, 0, 0, 0.45);
}

/* ナビボタン：グループに密着 */
.月ボタン {
  background: none;
  border: none;
  color: white;
  font-size: 2.2rem;
  cursor: pointer;
  padding: 1px 0;
  line-height: 1;
  opacity: 0.8;
  transition: opacity 0.15s;
  width: 100%;
  text-align: center;
}
.月ボタン:hover { opacity: 1; }

/* 前月・次月ペーク枠 */
.前次月枠 {
  position: relative;
  width: 100%;
  height: 100px;
  overflow: hidden;
}
.前月枠 {
  display: flex;
  flex-direction: column;
  justify-content: flex-end; /* 下半分を見せる */
}
.次月枠 {
  display: flex;
  flex-direction: column;
  justify-content: flex-start; /* 上半分を見せる */
}

/* 前次月コンテンツ：薄く */
.薄 {
  width: 100%;
  opacity: 0.5;
}

/* ボタンをペーク枠にかぶせて絶対配置 */
.月ボタン {
  position: absolute;
  left: 0;
  width: 100%;
  background: none;
  border: none;
  color: white;
  font-size: 2.2rem;
  cursor: pointer;
  padding: 4px 0;
  line-height: 1;
  opacity: 0.85;
  transition: opacity 0.15s;
  text-align: center;
  z-index: 1;
}
.月ボタン:hover { opacity: 1; }
.上ボタン { bottom: 26px; }
.下ボタン { top: 26px; }

/* 当月コンテンツ：6行分固定高さで月ごとのサイズ変動を防ぐ */
.当月内容 {
  width: 100%;
  padding: 2px 0;
  height: 264px;
  overflow: hidden;
}

/* 月タイトル */
.月タイトル {
  text-align: center;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 2px;
  color: white;
  font-size: 0.78rem;
}
.当月タイトル {
  font-size: 0.95rem;
  margin-bottom: 5px;
}

/* グリッド */
.グリッド {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.曜日 {
  text-align: center;
  font-weight: 700;
  font-size: 0.68rem;
  color: white;
  padding-bottom: 2px;
}
.当月曜日 {
  font-size: 0.82rem;
  padding-bottom: 3px;
}

.日 {
  text-align: center;
  line-height: 1.55;
  font-weight: 600;
  font-size: 0.88rem;
  color: white;
}
.当月日 {
  font-size: 1.15rem;
  font-weight: 700;
}

.日.空 { visibility: hidden; }

/* 日曜・土曜の色（鮮やか） */
.日.日曜, .曜日.日曜 { color: #ff4444; }
.日.土曜, .曜日.土曜 { color: #4499ff; }

/* 今日 */
.当月日.今日 {
  background: white;
  color: #111;
  font-weight: 900;
  border-radius: 50%;
}
</style>
