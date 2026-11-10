<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,provide,onBeforeUnmount,watch} from 'vue';
import FileViewer from '../ファイル閲覧/ファイルビューア.vue';
import FileHistoryDialog from '../../dialog/ファイル履歴ダイアログ.vue';
import {createPanelWindow} from '../ファイル閲覧/パネル別窓.js';
import {createViewerIdle} from '../ファイル閲覧/閲覧待機.js';
const props=defineProps({file:Object,root:String,autoSpin:Boolean});
const emit=defineEmits(['close','detached','recover','activity','pinning']);
const panel=ref(),viewer=ref(),history=ref(null),detached=ref(false),pinBusy=ref(false),error=ref('');
let windowPanel,pinRequest,disposed=false;
const idle=createViewerIdle({close});
watch(pinBusy,value=>emit('pinning',value),{flush:'sync'});
watch([detached,pinBusy,()=>props.autoSpin],()=>idle.configure({inline:!detached.value,autoSpin:props.autoSpin,pinning:pinBusy.value}),{immediate:true,flush:'sync'});
watch(()=>JSON.stringify([props.file?.path,props.file?.navigationId]),()=>idle.activity());
provide('openFileHistory',(file,root)=>{history.value={file:{path:file.path,name:file.name},root};});
function pin(){
  if(pinRequest)return pinRequest;
  if(disposed)return Promise.resolve(false);pinBusy.value=true;
  windowPanel??=createPanelWindow({element:()=>panel.value,
    rectangle:()=>panel.value?.querySelector('.history-embedded')||panel.value?.querySelector('.viewer-popup, .viewer-pinned'),
    title:`Viewer - ${props.file.name}`,kind:'panel-viewer',className:'viewer-window',
    changed:value=>{detached.value=value;},closed:()=>emit('close'),moved:()=>viewer.value?.moved(),
    recovered:()=>emit('recover'),report:message=>{error.value=message;}});
  pinRequest=windowPanel.pin().then(ok=>{if(ok)emit('detached');return !!ok;}).finally(()=>{pinBusy.value=false;pinRequest=undefined;});
  return pinRequest;
}
function close(){windowPanel?.close();emit('close');}
onBeforeUnmount(()=>{disposed=true;idle.dispose();windowPanel?.close();history.value=null;});
defineExpose({focus:()=>windowPanel?.focus()||false,pin,captureLayout:()=>({name:detached.value?panel.value?.ownerDocument.defaultView?.name:''})});
</script>
<template>
  <div ref="panel" class="viewer-session" :class="{detached}" :data-viewer-path="file.path">
    <FileViewer ref="viewer" v-show="!history" :file="file" :root="root" :pinned="detached" :pin-busy="pinBusy" @pin="pin" @close="close" @activity="idle.activity" />
    <FileHistoryDialog v-if="history" :key="history.root+'|'+history.file.path" :file="history.file" :root="history.root" embedded :pinned="detached" :pin-busy="pinBusy" @pin="pin" @close="history=null" @activity="idle.activity" />
    <p v-if="error" class="viewer-pin-error error" role="alert">{{ error }}</p>
  </div>
</template>
