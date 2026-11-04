<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { computed, inject } from 'vue';
import { fileIcon } from '../ファイル閲覧/ファイルアイコン.js';
const props = defineProps({ name: String, directory: Boolean, open: Boolean });
const base = inject('catppuccinIconBase', '/development/assets/catppuccin_icons/');
const icon = computed(() => fileIcon(props.name, props));
</script>
<template>
  <img class="file-type-icon" :src="`${base}mocha/${icon}.svg`" width="16" height="16" alt="" aria-hidden="true" draggable="false">
</template>
<style scoped>
.file-type-icon{display:block;width:var(--file-type-icon-size,16px);height:var(--file-type-icon-size,16px);flex:0 0 var(--file-type-icon-size,16px);object-fit:contain;pointer-events:none}
</style>
