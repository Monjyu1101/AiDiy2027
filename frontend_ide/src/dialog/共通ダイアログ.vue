<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import {openFloatingDialog} from '../components/共通表示/浮動ダイアログ.js';
const props=defineProps({ label: String, locked: Boolean, modeless: Boolean, sourceElement: Object });
defineOptions({inheritAttrs:false});
const emit = defineEmits(['close']);
const dialog = ref();
let stopFloating=()=>{};
function showFloating(){stopFloating();stopFloating=openFloatingDialog(dialog.value,{sourceElement:props.sourceElement,onCancel:()=>{if(!props.locked)emit('close');}});}
watch(()=>props.sourceElement,()=>{if(props.modeless)showFloating();},{flush:'post'});
onMounted(() => {
  if(props.modeless)showFloating();
  else dialog.value.showModal();
});
onBeforeUnmount(()=>stopFloating());
</script>
<template>
  <Teleport :to="sourceElement?.ownerDocument?.body || 'body'" :disabled="!modeless">
  <dialog ref="dialog" v-bind="$attrs" class="model-dialog" :class="{'floating-dialog':modeless}" :data-aidiy-no-window-move="modeless?'':undefined" :aria-label="label" @cancel="event => { if (locked) event.preventDefault(); }" @close="emit('close')"><slot /></dialog>
  </Teleport>
</template>
