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
const props = defineProps<{
  show: boolean;
  files: string[];
}>();

const emit = defineEmits<{
  close: [];
  'select-file': [fileName: string];
}>();

function 閉じる() {
  emit('close');
}

function ファイル選択(fileName: string) {
  emit('select-file', fileName);
}
</script>

<template>
  <div v-if="show" class="update-files-dialog-overlay" @click.self="閉じる">
    <div class="update-files-dialog">
      <div class="update-files-dialog-title">CodeAI がファイルを更新しました</div>
      <div class="update-files-count">更新ファイル数: {{ props.files.length }}件</div>

      <div class="update-files-list-container">
        <div class="update-files-list">
          <button
            v-for="(file, index) in props.files"
            :key="`${index}-${file}`"
            type="button"
            class="update-file-item"
            @click="ファイル選択(file)"
          >
            {{ index + 1 }}. {{ file }}
          </button>
        </div>
      </div>

      <div class="update-files-message">クリックで内容を表示できます。</div>

      <div class="update-files-dialog-actions">
        <button type="button" class="close-button" @click="閉じる">閉じる</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.update-files-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.update-files-dialog {
  width: min(720px, calc(100vw - 40px));
  max-height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  background: #111827;
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  box-shadow: 0 22px 50px rgba(0, 0, 0, 0.5);
}

.update-files-dialog-title {
  font-size: 18px;
  font-weight: 700;
}

.update-files-count,
.update-files-message {
  font-size: 13px;
  color: #cbd5e1;
}

.update-files-list-container {
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.88);
}

.update-files-list {
  display: flex;
  flex-direction: column;
}

.update-file-item {
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: transparent;
  color: #e2e8f0;
  text-align: left;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  cursor: pointer;
}

.update-file-item:last-child {
  border-bottom: none;
}

.update-file-item:hover {
  background: rgba(99, 102, 241, 0.14);
  color: #ffffff;
}

.update-files-dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.close-button {
  min-width: 110px;
  padding: 10px 16px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #f8fafc;
  font-weight: 700;
  cursor: pointer;
}
</style>
