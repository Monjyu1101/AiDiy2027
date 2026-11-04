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

<!-- createApp でマウントされるダイアログ UI。App.vue への登録不要。 -->

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  message: string;
  showCancel?: boolean;
  onOk: () => void;
  onCancel?: () => void;
}>();

const messageLines = computed(() => String(props.message ?? '').split('\n'));
const okBtn = ref<HTMLButtonElement | null>(null);
let closed = false;

const handleOk = () => {
  if (closed) return;
  closed = true;
  props.onOk();
};

const handleCancel = () => {
  if (closed) return;
  closed = true;
  (props.onCancel ?? props.onOk)();
};

const handleOverlayClick = () => {
  if (props.showCancel) {
    handleCancel();
  } else {
    handleOk();
  }
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') { e.preventDefault(); handleOk(); }
  if (e.key === 'Escape') { e.preventDefault(); props.showCancel ? handleCancel() : handleOk(); }
};

onMounted(() => {
  try {
    okBtn.value?.focus({ preventScroll: true });
  } catch {
    okBtn.value?.focus();
  }
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="q-alert-overlay" @click.self="handleOverlayClick">
    <div class="q-alert-dialog" role="alertdialog" aria-modal="true">
      <div class="q-alert-body">
        <span v-for="(line, i) in messageLines" :key="i">
          {{ line }}<br v-if="i < messageLines.length - 1" />
        </span>
      </div>
      <div class="q-alert-footer">
        <button
          ref="okBtn"
          type="button"
          class="q-alert-btn q-alert-btn-ok"
          @click="handleOk"
        >
          OK
        </button>
        <button
          v-if="showCancel"
          type="button"
          class="q-alert-btn q-alert-btn-cancel"
          @click="handleCancel"
        >
          キャンセル
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.q-alert-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.q-alert-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 320px;
  max-width: 500px;
  margin: 20px;
  overflow: hidden;
}

.q-alert-body {
  padding: 24px 24px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  word-break: break-word;
  white-space: pre-wrap;
}

.q-alert-footer {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 8px 16px 16px;
}

.q-alert-btn {
  padding: 8px 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  min-width: 80px;
  transition: background-color 0.2s;
}

.q-alert-btn-ok {
  background-color: #007bff;
  color: white;
}

.q-alert-btn-ok:hover {
  background-color: #0056b3;
}

.q-alert-btn-cancel {
  background-color: #6c757d;
  color: white;
}

.q-alert-btn-cancel:hover {
  background-color: #545b62;
}
</style>

