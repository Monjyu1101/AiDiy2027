<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount,watch} from 'vue';
import {bindNavigationButton} from './ナビボタン入力.js';
const props=defineProps({disabled:Boolean,context:Array});
const emit=defineEmits(['run','choose']);
const button=ref();let binding;
onMounted(()=>{binding=bindNavigationButton(button.value,{run:()=>emit('run'),choose:()=>emit('choose')});});
watch(()=>props.disabled,value=>{if(value)binding?.cancel();},{flush:'sync'});
watch(()=>props.context,()=>binding?.cancel(),{flush:'sync'});
onBeforeUnmount(()=>binding?.dispose());
</script>
<template>
 <button ref="button" type="button" :disabled="disabled" aria-haspopup="dialog" aria-keyshortcuts="ArrowDown"><slot /></button>
</template>
<style>
.navigation-run{touch-action:manipulation;user-select:none;-webkit-touch-callout:none}
</style>
