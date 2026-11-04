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

<!-- createApp でマウントされるトーストUI。App.vue への登録不要。 -->

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  message: string;
  type?: string;
  durationMs?: number;
  onClose: () => void;
}>();

const visible = ref(false);
let closed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const close = () => {
  if (closed) return;
  closed = true;
  if (timer) { clearTimeout(timer); timer = null; }
  visible.value = false;
  setTimeout(() => props.onClose(), 300);
};

onMounted(() => {
  visible.value = true;
  const delay = typeof props.durationMs === 'number' ? props.durationMs : 3000;
  if (delay > 0) {
    timer = setTimeout(close, delay);
  }
});

onBeforeUnmount(() => {
  if (timer) { clearTimeout(timer); timer = null; }
});
</script>

<template>
  <Transition name="q-message-fade">
    <div
      v-if="visible"
      class="q-message-toast"
      :class="`q-message-${type ?? 'success'}`"
      @click="close"
    >
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
.q-message-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  min-width: 260px;
  max-width: min(720px, calc(100vw - 32px));
  padding: 12px 18px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1f2937;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
}

.q-message-success {
  border-color: #b7dfc2;
  background: #eaf8ef;
  color: #166534;
}

.q-message-error {
  border-color: #efb0b7;
  background: #fdecee;
  color: #991b1b;
}

.q-message-info {
  border-color: #b9d4f7;
  background: #eef5ff;
  color: #1d4ed8;
}

.q-message-fade-enter-active,
.q-message-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.q-message-fade-enter-from,
.q-message-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>
