<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, onMounted } from 'vue';
defineProps({ label: String, locked: Boolean });
const emit = defineEmits(['close']);
const dialog = ref();
onMounted(() => dialog.value.showModal());
</script>
<template>
  <dialog ref="dialog" class="model-dialog" :aria-label="label" @cancel="event => { if (locked) event.preventDefault(); }" @close="emit('close')"><slot /></dialog>
</template>
