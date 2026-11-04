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
  isOpen: Boolean,
  title: String
});
defineEmits(['close']);
</script>

<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <header class="modal-header">
        <h3>{{ title }}</h3>
        <button class="close-btn" @click="$emit('close')">×</button>
      </header>
      <div class="modal-body">
        <slot></slot>
      </div>
      <footer class="modal-footer" v-if="$slots.footer">
        <slot name="footer"></slot>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal-content {
  background: white; width: 500px; max-width: 90%;
  border-radius: 0.5rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  display: flex; flex-direction: column;
  animation: modal-in 0.2s ease-out;
}
@keyframes modal-in {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
}
.modal-header {
  padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color);
  display: flex; justify-content: space-between; align-items: center;
}
.modal-header h3 { margin: 0; font-size: 1.125rem; font-weight: 600; }
.modal-body { padding: 1.5rem; }
.modal-footer {
  padding: 1rem 1.5rem; border-top: 1px solid var(--border-color);
  display: flex; justify-content: flex-end; gap: 0.5rem;
  background-color: #f9fafb;
  border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem;
}
.close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--secondary-color); }
.close-btn:hover { color: var(--text-color); }
</style>

