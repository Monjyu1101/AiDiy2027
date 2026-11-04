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
defineProps({
  checked: {
    type: Boolean,
    default: false
  },
  ariaLabel: {
    type: String,
    default: 'チェック状態'
  }
});
</script>

<template>
  <span class="readonly-checkbox-wrap">
    <span
      class="readonly-checkbox"
      :class="{ 'is-checked': checked }"
      :aria-label="ariaLabel"
      aria-readonly="true"
      :aria-checked="checked ? 'true' : 'false'"
      role="checkbox"
    >
      <span v-if="checked" class="readonly-checkbox-mark">✓</span>
    </span>
  </span>
</template>

<style scoped>
.readonly-checkbox-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.readonly-checkbox {
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #9aa8b5;
  background: #ffffff;
  pointer-events: none;
}

.readonly-checkbox.is-checked {
  border-color: #00c853;
  background: #00c853;
}

.readonly-checkbox-mark {
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}
</style>
