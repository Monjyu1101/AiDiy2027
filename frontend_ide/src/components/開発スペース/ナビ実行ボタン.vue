<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {bindNavigationButton} from './ナビボタン入力.js';
defineProps({disabled:Boolean});
const emit=defineEmits(['run','choose']);
const button=ref();let binding;
onMounted(()=>{binding=bindNavigationButton(button.value,{run:()=>emit('run'),choose:request=>emit('choose',request)});});
onBeforeUnmount(()=>binding?.dispose());
</script>
<template>
 <button ref="button" type="button" :disabled="disabled" aria-haspopup="menu" aria-keyshortcuts="Shift+F10 ContextMenu ArrowDown"><slot /></button>
</template>
<style>
.navigation-run{touch-action:manipulation;user-select:none;-webkit-touch-callout:none}
</style>
