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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{ controlsVisible?: boolean; 前景色?: string }>(),
  { controlsVisible: true, 前景色: '#ffffff' }
)

function fg(alpha = 1): string {
  if (alpha >= 1) return props.前景色
  const h = props.前景色.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const 現在時刻 = ref(new Date())
let タイマーID: number | null = null

function rad(deg: number) { return (deg * Math.PI) / 180 }

const 秒角度 = computed(() => {
  const 秒 = 現在時刻.value.getSeconds() + 現在時刻.value.getMilliseconds() / 1000
  return 秒 * 6
})
const 分角度 = computed(() => {
  const 分 = 現在時刻.value.getMinutes()
  const 秒 = 現在時刻.value.getSeconds()
  return (分 + 秒 / 60) * 6
})
const 時角度 = computed(() => {
  const 時 = 現在時刻.value.getHours() % 12
  const 分 = 現在時刻.value.getMinutes()
  return (時 + 分 / 60) * 30
})

// 針の先端・後端を角度から計算（中心ズレなし）
function 先端(角度: number, 長さ: number) {
  return { x: Math.sin(rad(角度)) * 長さ, y: -Math.cos(rad(角度)) * 長さ }
}
function 後端(角度: number, 長さ: number) {
  return { x: -Math.sin(rad(角度)) * 長さ, y: Math.cos(rad(角度)) * 長さ }
}

onMounted(() => {
  現在時刻.value = new Date()
  タイマーID = window.setInterval(() => { 現在時刻.value = new Date() }, 50)
})

onBeforeUnmount(() => {
  if (タイマーID !== null) {
    window.clearInterval(タイマーID)
    タイマーID = null
  }
})
</script>

<template>
  <main class="時計画面" aria-label="アナログ時計">
    <div :class="['時計背景', { '暗背景あり': props.controlsVisible }]">
    <svg class="時計SVG" viewBox="-50 -50 100 100" xmlns="http://www.w3.org/2000/svg">
      <!-- 外周リング -->
      <circle cx="0" cy="0" r="44" fill="none" :stroke="fg()" stroke-width="2" />
      <!-- 目盛（60本：時間位置は太長、分は細短） -->
      <line
        v-for="i in 60"
        :key="i"
        :x1="Math.sin((i / 60) * Math.PI * 2) * (i % 5 === 0 ? 38 : 41)"
        :y1="-Math.cos((i / 60) * Math.PI * 2) * (i % 5 === 0 ? 38 : 41)"
        :x2="Math.sin((i / 60) * Math.PI * 2) * 43"
        :y2="-Math.cos((i / 60) * Math.PI * 2) * 43"
        :stroke="i % 5 === 0 ? fg() : fg(0.6)"
        :stroke-width="i % 5 === 0 ? 2.5 : 1"
        stroke-linecap="round"
      />
      <!-- 時針 -->
      <line
        x1="0" y1="0"
        :x2="先端(時角度, 25).x" :y2="先端(時角度, 25).y"
        :stroke="fg()"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      <!-- 分針 -->
      <line
        x1="0" y1="0"
        :x2="先端(分角度, 35).x" :y2="先端(分角度, 35).y"
        :stroke="fg()"
        stroke-width="2"
        stroke-linecap="round"
      />
      <!-- 秒針 -->
      <line
        x1="0" y1="0"
        :x2="先端(秒角度, 38).x" :y2="先端(秒角度, 38).y"
        stroke="#ff4040"
        stroke-width="1.2"
        stroke-linecap="round"
      />
      <!-- 中心点 -->
      <circle cx="0" cy="0" r="2.5" :fill="fg()" />
    </svg>
    </div>
  </main>
</template>

<style scoped>
.時計画面 {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: transparent;
}

.時計背景 {
  border-radius: 12px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.時計背景.暗背景あり {
  background: rgba(0, 0, 0, 0.45);
}

.時計SVG {
  width: min(90vmin, 400px);
  height: min(90vmin, 400px);
  overflow: visible;
}
</style>
