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
import { ref, computed } from 'vue';

const isVisible = ref(false);
const title = ref('色選択');
const selectedColor = ref('#000000');
const resolvePromise = ref<((value: string | null) => void) | null>(null);
const colorError = ref('');

// サンプル色
const sampleColors = [
  // 基本色
  { name: '黒', value: '#000000' },
  { name: '白', value: '#ffffff' },
  { name: '灰色', value: '#808080' },
  { name: '薄灰色', value: '#d3d3d3' },

  // 赤系
  { name: '赤', value: '#ff0000' },
  { name: '濃赤', value: '#8b0000' },
  { name: '薄赤', value: '#ffcccc' },
  { name: 'ピンク', value: '#ffc0cb' },

  // 青系
  { name: '青', value: '#0000ff' },
  { name: '濃青', value: '#00008b' },
  { name: '薄青', value: '#ccccff' },
  { name: '水色', value: '#87ceeb' },

  // 緑系
  { name: '緑', value: '#00ff00' },
  { name: '濃緑', value: '#006400' },
  { name: '薄緑', value: '#ccffcc' },
  { name: '黄緑', value: '#9acd32' },

  // 黄系
  { name: '黄色', value: '#ffff00' },
  { name: '金色', value: '#ffd700' },
  { name: '薄黄', value: '#ffffcc' },
  { name: 'オレンジ', value: '#ffa500' },

  // その他
  { name: '紫', value: '#800080' },
  { name: '薄紫', value: '#e6ccff' },
  { name: '茶色', value: '#a52a2a' },
  { name: 'ベージュ', value: '#f5f5dc' }
];

// バリデーション
const isValidColorCode = (value: string): boolean => {
  const colorPattern = /^#[0-9a-fA-F]{6}$/;
  return colorPattern.test(value);
};

const isColorValid = computed(() => {
  return isValidColorCode(selectedColor.value);
});

const validateColor = (): boolean => {
  if (!selectedColor.value) {
    colorError.value = '色コードを入力してください。';
    return false;
  }
  if (!isValidColorCode(selectedColor.value)) {
    colorError.value = '#000000形式で入力してください。（# + 16進6桁）';
    return false;
  }
  colorError.value = '';
  return true;
};

const show = (initialColor = '#000000', dialogTitle = '色選択'): Promise<string | null> => {
  title.value = dialogTitle;
  selectedColor.value = initialColor || '#000000';
  colorError.value = '';
  isVisible.value = true;

  return new Promise((resolve) => {
    resolvePromise.value = resolve;
  });
};

const handleOk = () => {
  if (!validateColor()) {
    return;
  }
  isVisible.value = false;
  if (resolvePromise.value) {
    resolvePromise.value(selectedColor.value);
    resolvePromise.value = null;
  }
};

const handleCancel = () => {
  isVisible.value = false;
  if (resolvePromise.value) {
    resolvePromise.value(null);
    resolvePromise.value = null;
  }
};

const selectSampleColor = (color: string) => {
  selectedColor.value = color;
  colorError.value = '';
};

defineExpose({ show });
</script>

<template>
  <teleport to="body">
    <div v-if="isVisible" class="dialog-overlay" @click.self="handleCancel">
      <div class="dialog-container">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ title }}</h3>
        </div>
        <div class="dialog-content">
          <!-- サンプル色 -->
          <div class="sample-colors-section">
            <label class="sample-label">サンプル色:</label>
            <div class="sample-colors-grid">
              <button
                v-for="sample in sampleColors"
                :key="sample.value"
                type="button"
                class="sample-color-btn"
                :class="{ selected: selectedColor.toLowerCase() === sample.value.toLowerCase() }"
                :style="{ backgroundColor: sample.value }"
                :title="sample.name"
                @click="selectSampleColor(sample.value)"
              >
                <span class="sample-color-name">{{ sample.name }}</span>
              </button>
            </div>
          </div>

          <!-- 色入力 -->
          <div class="color-input-section">
            <label class="input-label">色コード:</label>
            <div class="color-input-wrapper">
              <input
                type="text"
                v-model="selectedColor"
                class="color-text-input"
                :class="{ 'input-error': !isColorValid }"
                placeholder="#000000"
                maxlength="7"
                @input="validateColor"
              />
              <div class="color-preview" :style="{ backgroundColor: isColorValid ? selectedColor : '#ffffff' }"></div>
            </div>
            <div v-if="colorError" class="error-message">{{ colorError }}</div>
          </div>
        </div>
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="handleCancel">
            キャンセル
          </button>
          <button class="dialog-btn dialog-btn-ok" @click="handleOk">
            選択
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog-container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 480px;
  max-width: 550px;
  margin: 20px;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid #e0e0e0;
}

.dialog-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.dialog-content {
  padding: 24px;
  flex: 1;
}

.color-input-section {
  margin-top: 24px;
}

.input-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #555;
}

.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
}

.color-text-input {
  width: 140px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  font-family: monospace;
}

.color-text-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.1);
}

.color-text-input.input-error {
  border-color: #dc2626;
  background-color: #fff8f8;
}

.color-text-input.input-error:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.1);
}

.error-message {
  margin-top: 6px;
  font-size: 12px;
  color: #dc2626;
  font-weight: 500;
}

.color-preview {
  width: 60px;
  height: 36px;
  border: 2px solid #333;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

.sample-label {
  display: block;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 500;
  color: #555;
}

.sample-colors-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.sample-color-btn {
  position: relative;
  height: 40px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.sample-color-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
  z-index: 1;
}

.sample-color-btn.selected {
  transform: scale(1.12);
  box-shadow: 0 0 0 3px #007bff, 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 2;
}

.sample-color-name {
  font-size: 11px;
  font-weight: 600;
  text-shadow:
    -1px -1px 0 rgba(255, 255, 255, 0.8),
    1px -1px 0 rgba(255, 255, 255, 0.8),
    -1px 1px 0 rgba(255, 255, 255, 0.8),
    1px 1px 0 rgba(255, 255, 255, 0.8),
    0 0 3px rgba(0, 0, 0, 0.5);
  color: #000;
}

.dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid #e0e0e0;
}

.dialog-btn {
  padding: 8px 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
  min-width: 100px;
}

.dialog-btn-ok {
  background-color: #007bff;
  color: white;
}

.dialog-btn-ok:hover {
  background-color: #0056b3;
}

.dialog-btn-cancel {
  background-color: #6c757d;
  color: white;
}

.dialog-btn-cancel:hover {
  background-color: #545b62;
}

@media (max-width: 550px) {
  .dialog-container {
    min-width: auto;
    width: 90%;
  }

  .sample-colors-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}

@media (max-width: 400px) {
  .sample-colors-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .color-text-input {
    width: 120px;
  }
}
</style>

