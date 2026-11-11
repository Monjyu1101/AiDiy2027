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

const props = withDefaults(defineProps<{ controlsVisible?: boolean }>(), { controlsVisible: true })

const stageRef = ref<HTMLDivElement | null>(null)
const leftEyeRef = ref<HTMLDivElement | null>(null)
const rightEyeRef = ref<HTMLDivElement | null>(null)
const leftPupilStyle = ref<Record<string, string>>({ transform: 'translate3d(0, 0, 0)' })
const rightPupilStyle = ref<Record<string, string>>({ transform: 'translate3d(0, 0, 0)' })
const cpuSamples = ref<Array<number | null>>([])
const cpuAverage = ref<number | null>(null)
const cpuColorLevel = ref(0)
const bloodshotLineLevel = ref(0)
const designMode = ref<'normal' | 'simple'>('normal')
const cpuColorEnabled = ref(true)

const effectiveCpuColorLevel = computed(() => cpuColorEnabled.value ? cpuColorLevel.value : 0)
const effectiveBloodshotLineLevel = computed(() => cpuColorEnabled.value ? bloodshotLineLevel.value : 0)

let animationId = 0
let lastSnapshotTimestamp = 0
let snapshotLoading = false
let windowRole: AvatarWindowRole = 'core'
let targetX = 0
let targetY = 0
let cpuTimerId: number | null = null
let cpuLoading = false
let disposed = false

const SNAPSHOT_INTERVAL_MS = 33
const CPU_SAMPLE_INTERVAL_MS = 500
const CPU_SAMPLE_LIMIT = 12
const CPU_COLOR_START = 50
const CPU_COLOR_FULL = 90
const CPU_BAR_COLOR_START = 50
const CPU_BAR_COLOR_FULL = 95
const bloodshotTicks = Array.from({ length: 30 }, (_, index) => {
  const angleDeg = index * 12
  const angleRad = angleDeg * Math.PI / 180
  return {
    index,
    major: index % 5 === 0,
    style: {
      left: `${50 + (Math.cos(angleRad) * 42)}%`,
      top: `${50 + (Math.sin(angleRad) * 45)}%`,
      transform: `translate(-50%, 0) rotate(${angleDeg + 90}deg)`,
    },
  }
})

function updateBloodshotLevel() {
  const samples = cpuSamples.value.filter((value): value is number => value !== null)
  // 最新の未取得を過去の平均や0%で埋めない。色だけは直前の状態を保つ。
  if (cpuSamples.value[cpuSamples.value.length - 1] === null || !samples.length) {
    cpuAverage.value = null
    return
  }
  cpuAverage.value = samples.reduce((sum, value) => sum + value, 0) / samples.length
  // サンプル平均が50%以下なら白、90%以上なら淡いピンクにする。
  const level = Math.min(1, Math.max(0, (cpuAverage.value - CPU_COLOR_START) / (CPU_COLOR_FULL - CPU_COLOR_START)))
  cpuColorLevel.value = level
  bloodshotLineLevel.value = level
}

function cpuBarColor(usage: number) {
  const level = Math.min(1, Math.max(0, (usage - CPU_BAR_COLOR_START) / (CPU_BAR_COLOR_FULL - CPU_BAR_COLOR_START)))
  const channel = Math.round(255 * (1 - level))
  return `rgb(255, ${channel}, ${channel})`
}

async function collectCpuUsage() {
  if (cpuLoading || disposed) return
  cpuLoading = true
  let usage: number | null | undefined
  try {
    usage = await window.desktopApi?.getSystemCpuUsage?.()
  } catch {
    usage = null
  } finally {
    cpuLoading = false
  }
  if (disposed) return
  const sample = typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 && usage <= 100 ? usage : null
  // 500msごとの12枠（約6秒）。欠損も枠として進め、数値の平均には含めない。
  cpuSamples.value = [...cpuSamples.value, sample].slice(-CPU_SAMPLE_LIMIT)
  updateBloodshotLevel()
}

function eyePupilTransform(eye: HTMLDivElement, stageRect: DOMRect) {
  const eyeRect = eye.getBoundingClientRect()
  const centerX = eyeRect.left - stageRect.left + (eyeRect.width / 2)
  const centerY = eyeRect.top - stageRect.top + (eyeRect.height / 2)
  const diffX = targetX - centerX
  const diffY = targetY - centerY
  const distance = Math.hypot(diffX, diffY) || 1
  const maxOffsetX = Math.max(6, eyeRect.width * 0.20)
  const maxOffsetY = Math.max(10, eyeRect.height * 0.28)
  const offsetX = (diffX / distance) * maxOffsetX
  const offsetY = (diffY / distance) * maxOffsetY
  return {
    transform: `translate3d(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px, 0)`,
  }
}

function applyPupilPosition() {
  const stageRect = stageRef.value?.getBoundingClientRect()
  if (!stageRect || !leftEyeRef.value || !rightEyeRef.value) return
  leftPupilStyle.value = eyePupilTransform(leftEyeRef.value, stageRect)
  rightPupilStyle.value = eyePupilTransform(rightEyeRef.value, stageRect)
}

function setFallbackTarget() {
  const stageRect = stageRef.value?.getBoundingClientRect()
  if (!stageRect) return
  targetX = stageRect.width * 0.5
  targetY = stageRect.height * 0.42
}

async function updateElectronPointerTarget() {
  if (snapshotLoading || !window.desktopApi?.getWindowPointerSnapshot) return
  const stageRect = stageRef.value?.getBoundingClientRect()
  if (!stageRect) return

  snapshotLoading = true
  try {
    const snapshot = await window.desktopApi.getWindowPointerSnapshot(windowRole)
    targetX = snapshot.mouse.x - (snapshot.bounds.x + stageRect.left)
    targetY = snapshot.mouse.y - (snapshot.bounds.y + stageRect.top)
  } catch {
    setFallbackTarget()
  } finally {
    snapshotLoading = false
  }
}

function handlePointerMove(event: PointerEvent) {
  const stageRect = stageRef.value?.getBoundingClientRect()
  if (!stageRect) return
  targetX = event.clientX - stageRect.left
  targetY = event.clientY - stageRect.top
  applyPupilPosition()
}

function onAnimationFrame(timestamp: number) {
  if (!stageRef.value) return

  if (window.desktopApi?.getWindowPointerSnapshot) {
    if (timestamp - lastSnapshotTimestamp >= SNAPSHOT_INTERVAL_MS) {
      lastSnapshotTimestamp = timestamp
      void updateElectronPointerTarget()
    }
  }

  applyPupilPosition()
  animationId = window.requestAnimationFrame(onAnimationFrame)
}

onMounted(async () => {
  windowRole = await window.desktopApi?.getWindowRole?.() ?? 'core'
  if (disposed) return
  setFallbackTarget()
  stageRef.value?.addEventListener('pointermove', handlePointerMove)
  stageRef.value?.addEventListener('pointerdown', handlePointerMove)
  void collectCpuUsage()
  cpuTimerId = window.setInterval(() => {
    void collectCpuUsage()
  }, CPU_SAMPLE_INTERVAL_MS)
  animationId = window.requestAnimationFrame(onAnimationFrame)
})

onBeforeUnmount(() => {
  disposed = true
  stageRef.value?.removeEventListener('pointermove', handlePointerMove)
  stageRef.value?.removeEventListener('pointerdown', handlePointerMove)
  if (cpuTimerId !== null) {
    window.clearInterval(cpuTimerId)
    cpuTimerId = null
  }
  if (animationId) window.cancelAnimationFrame(animationId)
})
</script>

<template>
  <div ref="stageRef" class="xeyes-stage">
    <div
      class="xeyes-wrap"
      aria-hidden="true"
      :style="{
        '--cpu-color-level': effectiveCpuColorLevel.toFixed(3),
        '--bloodshot-line-level': effectiveBloodshotLineLevel.toFixed(3),
      }"
    >
      <div ref="leftEyeRef" class="xeyes-eye" :class="{ simple: designMode === 'simple' }">
        <template v-if="designMode === 'normal'">
          <span
            v-for="tick in bloodshotTicks"
            :key="`left-ray-${tick.index}`"
            class="bloodshot-ray"
            :class="{ major: tick.major }"
            :style="tick.style"
          ></span>
        </template>
        <div class="xeyes-pupil" :class="{ simple: designMode === 'simple' }" :style="leftPupilStyle">
          <span v-if="designMode === 'normal'"></span>
        </div>
      </div>
      <div ref="rightEyeRef" class="xeyes-eye" :class="{ simple: designMode === 'simple' }">
        <template v-if="designMode === 'normal'">
          <span
            v-for="tick in bloodshotTicks"
            :key="`right-ray-${tick.index}`"
            class="bloodshot-ray"
            :class="{ major: tick.major }"
            :style="tick.style"
          ></span>
        </template>
        <div class="xeyes-pupil" :class="{ simple: designMode === 'simple' }" :style="rightPupilStyle">
          <span v-if="designMode === 'normal'"></span>
        </div>
      </div>
    </div>
    <div v-if="props.controlsVisible" class="cpu-meter">
      <div class="cpu-meter-header">
        <span>CPU</span>
        <strong
          :style="{ color: cpuAverage === null ? undefined : cpuBarColor(cpuAverage) }"
          :title="cpuAverage === null ? 'CPU使用率は未取得です' : '直近約6秒の有効な標本の平均'"
        >{{ cpuAverage === null ? '—' : `${Math.round(cpuAverage)}%` }}</strong>
      </div>
      <div class="cpu-bars">
        <i
          v-for="(sample, index) in cpuSamples"
          :key="index"
          :style="{
            height: sample === null ? '0%' : `${sample}%`,
            backgroundColor: sample === null ? 'transparent' : cpuBarColor(sample),
          }"
        ></i>
      </div>
    </div>
    <div v-if="props.controlsVisible" class="xeyes-shadow"></div>
    <div v-if="props.controlsVisible" class="xeyes-options">
      <div class="options-row">
        <span class="options-label">デザイン</span>
        <label class="options-radio"><input type="radio" v-model="designMode" value="normal"> 通常</label>
        <label class="options-radio"><input type="radio" v-model="designMode" value="simple"> シンプル</label>
      </div>
      <div class="options-row">
        <label class="options-check">
          <input type="checkbox" v-model="cpuColorEnabled">
          <span>目のCPU色変化</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xeyes-stage {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  cursor: crosshair;
  background: transparent;
}

.xeyes-wrap {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(16px, 7%, 40px);
  padding: clamp(34px, 9%, 64px) clamp(24px, 8%, 56px) clamp(60px, 15%, 98px);
  pointer-events: none;
}

.xeyes-eye {
  position: relative;
  width: clamp(104px, 31%, 168px);
  aspect-ratio: 0.55 / 1;
  border: 2px solid rgba(18, 20, 25, 0.9);
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(ellipse at 34% 26%, #fff 0 22%, #f7fbff 48%, #d6e0ea 100%);
  box-shadow:
    inset -9px -14px 18px rgba(72, 90, 112, 0.22),
    inset 7px 10px 16px rgba(255, 255, 255, 0.55),
    0 5px 14px rgba(0, 0, 0, 0.18);
}

.xeyes-eye::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(ellipse at 34% 26%, #fff2f4 0 22%, #ffdce5 48%, #f2b9ca 100%);
  opacity: var(--cpu-color-level);
  transition: opacity 1s ease-out;
  pointer-events: none;
}

.bloodshot-ray {
  position: absolute;
  width: 1px;
  height: 8%;
  transform-origin: 50% 0;
  border-radius: 999px;
  background: rgba(186, 74, 95, 0.48);
  opacity: var(--bloodshot-line-level);
  transition: opacity 1s ease-out;
  z-index: 1;
}

.bloodshot-ray::after {
  content: '';
  position: absolute;
  left: 0;
  top: 70%;
  width: 1px;
  height: 65%;
  border-radius: 999px;
  background: inherit;
  transform-origin: 50% 0;
  transform: rotate(35deg);
}

.bloodshot-ray.major {
  width: 2px;
  height: 14%;
  background: rgba(173, 51, 78, 0.62);
}

.xeyes-pupil {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28%;
  aspect-ratio: 0.62 / 1;
  margin-left: -14%;
  margin-top: -22.5%;
  border-radius: 50%;
  background:
    radial-gradient(ellipse at 38% 28%, #2a3038 0 10%, #050505 48%, #000000 100%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45);
  transition: transform 0.06s linear;
  z-index: 2;
}

.xeyes-pupil span {
  position: absolute;
  left: 28%;
  top: 17%;
  width: 18%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
}

.xeyes-shadow {
  position: absolute;
  left: 28%;
  right: 28%;
  bottom: 16%;
  height: 8px;
  border-radius: 50%;
  background: rgba(5, 8, 14, 0.14);
  filter: blur(7px);
  pointer-events: none;
}

.cpu-meter {
  position: absolute;
  left: 50%;
  bottom: 58px;
  width: min(220px, 56%);
  height: 72px;
  box-sizing: border-box;
  overflow: hidden;
  transform: translateX(-50%);
  z-index: 3;
  display: grid;
  grid-template-rows: 15px 1fr;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(4, 8, 14, 0.42);
  backdrop-filter: blur(6px);
  color: #ffffff;
  pointer-events: none;
}

.cpu-meter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  line-height: 1;
}

.cpu-meter-header strong {
  font-size: 11px;
}

.cpu-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.cpu-bars i {
  display: block;
  flex: 1 1 0;
  min-width: 0;
  border-radius: 1px 1px 0 0;
  transition: background-color 0.5s linear;
}

/* シンプルモード */
.xeyes-eye.simple {
  background: transparent;
  border: 20px solid rgb(
    255,
    calc(255 - (36 * var(--cpu-color-level))),
    calc(255 - (28 * var(--cpu-color-level)))
  );
  box-shadow: none;
  transition: border-color 1s ease-out;
}

.xeyes-eye.simple::before {
  display: none;
}

.xeyes-pupil.simple {
  background: rgb(
    255,
    calc(255 - (36 * var(--cpu-color-level))),
    calc(255 - (28 * var(--cpu-color-level)))
  );
  box-shadow: none;
  transition: transform 0.06s linear, background-color 1s ease-out;
}

/* オプションパネル */
.xeyes-options {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(4, 8, 14, 0.50);
  backdrop-filter: blur(6px);
  color: #ffffff;
  font-size: 10px;
  line-height: 1.4;
  pointer-events: all;
  user-select: none;
}

.options-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.options-label {
  white-space: nowrap;
  opacity: 0.8;
}

.options-radio {
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  white-space: nowrap;
}

.options-radio input[type="radio"] {
  accent-color: #7fcfff;
  cursor: pointer;
}

.options-check {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.options-check input[type="checkbox"] {
  accent-color: #7fcfff;
  cursor: pointer;
}
</style>
