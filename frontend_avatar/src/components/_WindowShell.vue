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
import { computed, onBeforeUnmount, ref } from 'vue'
import WindowControls from './_WindowControls.vue'

type ResizeDirection =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

const props = withDefaults(defineProps<{
  title: string;
  theme?: 'purple' | 'light';
  closable?: boolean;
  resizable?: boolean;
  closeMode?: 'window' | 'event' | 'minimize';
  chromeVisible?: boolean;
}>(), {
  theme: 'light',
  closable: true,
  resizable: true,
  closeMode: 'window',
  chromeVisible: true,
})

const emit = defineEmits<{
  close: []
}>()

const isElectron = Boolean(window.desktopApi)
const actionButtonLabel = computed(() => (props.closeMode === 'minimize' ? '−' : '×'))
const actionButtonTitle = computed(() => (props.closeMode === 'minimize' ? '最小化' : '閉じる'))

const リサイズ中 = ref(false)

let 最小幅 = 0
let 最小高 = 0
let 現在方向: ResizeDirection | null = null
let 初期幅 = 0
let 初期高 = 0
let 初期X = 0
let 初期Y = 0
let 初期スクリーンX = 0
let 初期スクリーンY = 0
let 初期化済み = false

function closeWindow() {
  if (props.closeMode === 'event') {
    emit('close')
    return
  }
  if (props.closeMode === 'minimize') {
    void window.desktopApi?.minimizeCurrentWindow?.()
    return
  }
  void window.desktopApi?.closeCurrentWindow?.()
}

function 停止リサイズ() {
  リサイズ中.value = false
  現在方向 = null
  初期化済み = false
  window.removeEventListener('pointermove', リサイズ処理)
  window.removeEventListener('pointerup', 停止リサイズ)
}

function 開始リサイズ(event: PointerEvent, direction: ResizeDirection) {
  event.preventDefault()
  event.stopPropagation()

  // pointerdown 時点のスクリーン座標を記録（絶対デルタ方式）
  初期スクリーンX = event.screenX
  初期スクリーンY = event.screenY
  現在方向 = direction
  初期化済み = false
  リサイズ中.value = true

  // リスナーを即時登録（イベントを取り逃がさないため）
  window.addEventListener('pointermove', リサイズ処理)
  window.addEventListener('pointerup', 停止リサイズ)

  // ウィンドウ情報を非同期取得
  void (async () => {
    const metrics = await window.desktopApi?.getWindowBounds?.()
    if (!metrics || !現在方向) return
    初期幅 = metrics.width
    初期高 = metrics.height
    初期X = metrics.x
    初期Y = metrics.y
    最小幅 = metrics.minWidth
    最小高 = metrics.minHeight
    初期化済み = true
  })()
}

function リサイズ処理(event: PointerEvent) {
  if (!現在方向 || !初期化済み) return

  // screenX/Y の絶対デルタ（累積誤差なし・DPI無関係）
  const dx = event.screenX - 初期スクリーンX
  const dy = event.screenY - 初期スクリーンY

  let nextX = 初期X
  let nextY = 初期Y
  let nextWidth = 初期幅
  let nextHeight = 初期高

  if (現在方向.includes('e')) {
    nextWidth = Math.max(最小幅, 初期幅 + dx)
  }

  if (現在方向.includes('s')) {
    nextHeight = Math.max(最小高, 初期高 + dy)
  }

  if (現在方向.includes('w')) {
    nextWidth = Math.max(最小幅, 初期幅 - dx)
    nextX = 初期X + (初期幅 - nextWidth)
  }

  if (現在方向.includes('n')) {
    nextHeight = Math.max(最小高, 初期高 - dy)
    nextY = 初期Y + (初期高 - nextHeight)
  }

  void window.desktopApi?.setWindowBounds?.({
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  })
}

onBeforeUnmount(() => {
  停止リサイズ()
})
</script>

<template>
  <section
    class="window-shell"
    :class="[`theme-${theme}`, { resizing: リサイズ中, 'chrome-hidden': !chromeVisible }]"
  >
    <header class="window-titlebar">
      <div class="title-left">
        <slot name="title-left"></slot>
        <strong>{{ title }}</strong>
      </div>
      <div class="title-right">
        <slot name="title-right"></slot>
        <WindowControls v-if="isElectron" :closable="closable" @close="closeWindow" />
        <button
          v-else-if="closable"
          class="close-button"
          type="button"
          :title="actionButtonTitle"
          @click="closeWindow"
        >{{ actionButtonLabel }}</button>
      </div>
    </header>

    <div class="window-body">
      <slot></slot>
    </div>

    <template v-if="resizable">
      <button class="resize-handle edge north" type="button" aria-label="resize north" @pointerdown="開始リサイズ($event, 'n')"></button>
      <button class="resize-handle edge south" type="button" aria-label="resize south" @pointerdown="開始リサイズ($event, 's')"></button>
      <button class="resize-handle edge east" type="button" aria-label="resize east" @pointerdown="開始リサイズ($event, 'e')"></button>
      <button class="resize-handle edge west" type="button" aria-label="resize west" @pointerdown="開始リサイズ($event, 'w')"></button>
      <button class="resize-handle corner north-east" type="button" aria-label="resize north east" @pointerdown="開始リサイズ($event, 'ne')"></button>
      <button class="resize-handle corner north-west" type="button" aria-label="resize north west" @pointerdown="開始リサイズ($event, 'nw')"></button>
      <button class="resize-handle corner south-east" type="button" aria-label="resize south east" @pointerdown="開始リサイズ($event, 'se')"></button>
      <button class="resize-handle corner south-west" type="button" aria-label="resize south west" @pointerdown="開始リサイズ($event, 'sw')"></button>
    </template>
  </section>
</template>

<style scoped>
.window-shell {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 1px solid transparent;
  background: rgba(12, 12, 12, 0.72);
  box-shadow: 0 20px 42px rgba(0, 0, 0, 0.3);
  position: relative;
}

.window-shell.resizing {
  user-select: none;
}

/* 子パネルの不透明な描画より前面に、操作を遮らない1px枠を描く。 */
.window-shell::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid var(--avatar-light-title-background);
  pointer-events: none;
  z-index: 30;
}

.window-shell.theme-purple::after {
  border-color: var(--avatar-title-edge);
}

.window-shell.chrome-hidden::after {
  display: none;
}

.window-shell.chrome-hidden {
  border-color: transparent;
  border-image: none;
  background: transparent;
  box-shadow: none;
}

.window-titlebar {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 8px;
  cursor: move;
  -webkit-app-region: drag;
}

.window-shell.chrome-hidden .window-titlebar {
  opacity: 0;
  pointer-events: none;
  border-bottom-color: transparent;
  box-shadow: none;
}

.title-left,
.title-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-left strong {
  font-size: 0.74rem;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title-right {
  -webkit-app-region: no-drag;
}

.window-body {
  position: relative;
  height: calc(100% - 28px);
  user-select: text;
}

.close-button {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.resize-handle {
  position: absolute;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  opacity: 0;
  z-index: 20;
}

.window-shell.chrome-hidden .resize-handle {
  pointer-events: none;
}

.resize-handle:hover,
.window-shell.resizing .resize-handle {
  opacity: 1;
}

.edge.north,
.edge.south {
  left: 10px;
  right: 10px;
  height: 8px;
  cursor: ns-resize;
}

.edge.north {
  top: 0;
}

.edge.south {
  bottom: 0;
}

.edge.east,
.edge.west {
  top: 10px;
  bottom: 10px;
  width: 8px;
  cursor: ew-resize;
}

.edge.east {
  right: 0;
}

.edge.west {
  left: 0;
}

.corner {
  width: 14px;
  height: 14px;
}

.corner.north-east {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.corner.north-west {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.corner.south-east {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}

.corner.south-west {
  left: 0;
  bottom: 0;
  cursor: nesw-resize;
}

.theme-purple {
  border-color: transparent;
  border-image: none;
  background: rgba(6, 8, 14, 0.18);
}

.theme-purple .window-titlebar {
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  background: var(--avatar-title-background);
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
}

.theme-purple .resize-handle:hover {
  background: rgba(162, 143, 255, 0.18);
}

.theme-light .window-titlebar {
  border-bottom: 1px solid rgba(120, 120, 120, 0.9);
  background: var(--avatar-light-title-background);
  color: #222;
}

.theme-light .resize-handle:hover {
  background: rgba(110, 110, 110, 0.14);
}
</style>
