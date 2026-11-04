<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  label?: string;
}>(), {
  title: '再読込',
  label: '',
});
</script>

<template>
  <button
    type="button"
    class="refresh-button"
    :class="{ 'with-label': label }"
    :title="title"
    :aria-label="label || title"
  >
    <span class="refresh-icon" aria-hidden="true">↺</span>
    <span v-if="label" class="refresh-label">{{ label }}</span>
  </button>
</template>

<style scoped>
/* frontend_web の AIファイル.vue の再読込ボタンと同じ表示・操作状態。 */
.refresh-button {
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid #16a34a;
  border-radius: 2px;
  background: #22c55e;
  color: #ffffff;
  cursor: pointer;
  font-size: 18px;
  line-height: 22px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  -webkit-app-region: no-drag;
}

.refresh-button:hover:not(:disabled) {
  background: #34d399;
  border-color: #22c55e;
  color: #ffffff;
  transform: scale(1.2);
}

.refresh-button:disabled {
  opacity: 0.4;
  background: #1f8a4b;
  border-color: #166a39;
  color: #ffffff;
  cursor: not-allowed;
}

.refresh-button.with-label {
  width: auto;
  height: var(--refresh-button-height, 26px);
  padding: var(--refresh-button-padding, 0 8px);
  gap: 5px;
}

.refresh-button.with-label:hover:not(:disabled) {
  transform: none;
}

.refresh-button.with-label:hover:not(:disabled) .refresh-icon {
  transform: scale(1.2);
}

.refresh-icon {
  font-size: 18px;
  line-height: 22px;
  transition: transform 0.15s ease;
}

.refresh-label {
  font-size: var(--refresh-button-label-size, 9px);
  line-height: 1.5;
  white-space: nowrap;
}
</style>
