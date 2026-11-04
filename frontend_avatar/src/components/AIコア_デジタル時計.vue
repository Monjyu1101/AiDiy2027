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

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const 点灯色 = computed(() => props.前景色)
const 消灯色 = computed(() => hexToRgba(props.前景色, 0.08))

const 現在時刻 = ref(new Date())
const コロン点灯 = ref(true)
let タイマーID: number | null = null

// 7セグメント定義 [a上, b右上, c右下, d下, e左下, f左上, g中]
const セグメント表: boolean[][] = [
  [true,  true,  true,  true,  true,  true,  false], // 0
  [false, true,  true,  false, false, false, false], // 1
  [true,  true,  false, true,  true,  false, true ], // 2
  [true,  true,  true,  true,  false, false, true ], // 3
  [false, true,  true,  false, false, true,  true ], // 4
  [true,  false, true,  true,  false, true,  true ], // 5
  [true,  false, true,  true,  true,  true,  true ], // 6
  [true,  true,  true,  false, false, false, false], // 7
  [true,  true,  true,  true,  true,  true,  true ], // 8
  [true,  true,  true,  true,  false, true,  true ], // 9
]

// 各セグメントの矩形 (x, y, w, h) — DigitBox: 22×46
const セグメント矩形 = [
  { x: 3,  y: 0,  w: 16, h: 4  }, // a 上
  { x: 19, y: 3,  w: 4,  h: 17 }, // b 右上
  { x: 19, y: 26, w: 4,  h: 17 }, // c 右下
  { x: 3,  y: 42, w: 16, h: 4  }, // d 下
  { x: 0,  y: 26, w: 4,  h: 17 }, // e 左下
  { x: 0,  y: 3,  w: 4,  h: 17 }, // f 左上
  { x: 3,  y: 21, w: 16, h: 4  }, // g 中
]

const 表示桁 = computed(() => {
  const h = 現在時刻.value.getHours()
  const m = 現在時刻.value.getMinutes()
  return [Math.floor(h / 10), h % 10, Math.floor(m / 10), m % 10]
})

// 桁インデックス → SVG x座標（コロン分14px追加）
function 桁X(i: number) {
  return i * 28 + (i >= 2 ? 14 : 0)
}

onMounted(() => {
  現在時刻.value = new Date()
  タイマーID = window.setInterval(() => {
    現在時刻.value = new Date()
    コロン点灯.value = !コロン点灯.value
  }, 1000)
})

onBeforeUnmount(() => {
  if (タイマーID !== null) {
    window.clearInterval(タイマーID)
    タイマーID = null
  }
})
</script>

<template>
  <main class="デジタル時計画面" aria-label="デジタル時計">
    <div :class="['時計背景', { '暗背景あり': props.controlsVisible }]">
    <!-- viewBox: 4桁×(22+6)=112 + コロン14 = 126 wide, 46 tall -->
    <svg class="時計SVG" viewBox="-3 -3 132 52" xmlns="http://www.w3.org/2000/svg">
      <!-- 4桁 -->
      <g v-for="(桁値, i) in 表示桁" :key="i" :transform="`translate(${桁X(i)}, 0)`">
        <rect
          v-for="(矩形, s) in セグメント矩形"
          :key="s"
          :x="矩形.x" :y="矩形.y" :width="矩形.w" :height="矩形.h"
          rx="2"
          :fill="(セグメント表[桁値]?.[s] ?? false) ? 点灯色 : 消灯色"
        />
      </g>
      <!-- コロン -->
      <circle cx="59" cy="14" r="3.5" :fill="コロン点灯 ? 点灯色 : 消灯色" />
      <circle cx="59" cy="32" r="3.5" :fill="コロン点灯 ? 点灯色 : 消灯色" />
    </svg>
    </div>
  </main>
</template>

<style scoped>
.デジタル時計画面 {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: transparent;
  user-select: none;
}

.時計背景 {
  border-radius: 10px;
  padding: 7px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.時計背景.暗背景あり {
  background: rgba(0, 0, 0, 0.45);
}

.時計SVG {
  width: min(72vw, 360px);
  overflow: visible;
}
</style>
