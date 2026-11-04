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
import { ref, onMounted, watch, nextTick } from 'vue';
import QRCode from 'qrcode';

const props = withDefaults(
  defineProps<{
    value: string;
    size?: number;
    margin?: number;
    bgColor?: string;
    fgColor?: string;
    errorLevel?: 'L' | 'M' | 'Q' | 'H';
  }>(),
  {
    size: 200,
    margin: 2,
    bgColor: '#ffffff',
    fgColor: '#000000',
    errorLevel: 'M'
  }
);

const canvas = ref<HTMLCanvasElement | null>(null);
const エラー = ref<string>('');

async function 描画() {
  エラー.value = '';
  try {
    await nextTick();
    if (!canvas.value) return;
    await QRCode.toCanvas(canvas.value, props.value ?? '', {
      width: props.size,
      margin: props.margin,
      errorCorrectionLevel: props.errorLevel,
      color: { dark: props.fgColor, light: props.bgColor }
    });
  } catch (e: any) {
    エラー.value = e?.message ?? 'QRコード描画エラー';
  }
}

onMounted(描画);
watch(
  () => [props.value, props.size, props.margin, props.bgColor, props.fgColor, props.errorLevel],
  描画
);
</script>

<template>
  <span class="qrcode-wrap" :style="{ width: size + 'px', height: size + 'px' }">
    <canvas
      ref="canvas"
      class="qrcode-canvas"
      role="img"
      :aria-label="`QRコード: ${value}`"
    ></canvas>
    <span v-if="エラー" class="qrcode-error">{{ エラー }}</span>
  </span>
</template>

<style scoped>
.qrcode-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-sizing: border-box;
}

.qrcode-canvas {
  display: block;
  max-width: 100%;
  height: auto;
}

.qrcode-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d32f2f;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.9);
  padding: 4px 8px;
  text-align: center;
}
</style>
