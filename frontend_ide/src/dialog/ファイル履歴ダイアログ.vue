<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import RefreshButton from '../components/共通表示/再読込ボタン.vue';
import {ref,computed,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {loadMonaco,monacoLanguage} from '../components/ファイル閲覧/コード表示.js';
import {createViewerActivity} from '../components/ファイル閲覧/閲覧待機.js';
const props=defineProps({file:Object,root:String,embedded:Boolean,pinned:Boolean,pinBusy:Boolean});
const emit=defineEmits(['close','pin','activity']);
const dialog=ref(),host=ref(),versions=ref([]),selected=ref(''),loading=ref(true),error=ref(''),comparison=ref(),truncated=ref(false),changes=ref(null);
const chosen=computed(()=>versions.value.find(v=>v.id===selected.value));
let editor,models=[],subscription,scrollSubscriptions=[],controller,revision=0,closed=false;
const userActivity=createViewerActivity(()=>emit('activity'));
const activity=event=>userActivity.handle(event);
const onPointerMove=activity;
function disposeEditor(){subscription?.dispose();subscription=null;for(const item of scrollSubscriptions)item.dispose();scrollSubscriptions=[];editor?.dispose();editor=null;for(const model of models)model.dispose();models=[];}
function close(){if(closed)return;closed=true;controller?.abort();dialog.value?.close?.();emit('close');}
async function request(params,signal){
  const response=await fetch('/api/file-history?'+new URLSearchParams({path:props.file.path,...params}),{cache:'no-store',signal});
  const value=await response.json();if(!response.ok)throw Error(value.error||'更新履歴を読み込めません。');return value;
}
async function loadComparison(){
  const run=++revision;controller?.abort();controller=new AbortController();loading.value=true;error.value='';comparison.value=null;changes.value=null;disposeEditor();
  try{
    const [value,monaco]=await Promise.all([request({version:selected.value},controller.signal),loadMonaco()]);
    if(closed||run!==revision)return;
    comparison.value=value;await nextTick();if(closed||run!==revision)return;
    const language=monacoLanguage(props.file.name);
    models=[monaco.editor.createModel(value.original.text,language),monaco.editor.createModel(value.modified.text,language)];
    editor=monaco.editor.createDiffEditor(host.value,{
      theme:'aidiy-space',readOnly:true,domReadOnly:true,originalEditable:false,automaticLayout:true,
      renderSideBySide:true,useInlineViewWhenSpaceIsLimited:false,enableSplitViewResizing:false,
      ignoreTrimWhitespace:false,diffAlgorithm:'advanced',hideUnchangedRegions:{enabled:false},
      fontSize:parseFloat(getComputedStyle(host.value).getPropertyValue('--file-font-size'))||10,
      minimap:{enabled:false},scrollBeyondLastLine:false,wordWrap:'off',contextmenu:false,
      originalAriaLabel:'旧版のソース',modifiedAriaLabel:'現在のソース',
    });
    subscription=editor.onDidUpdateDiff(()=>{changes.value=editor.getLineChanges()?.length??null;});
    editor.setModel({original:models[0],modified:models[1]});
    // Monaco は独自スクロールのため、左右エディターの位置変更も操作として受け取る。
    scrollSubscriptions=[editor.getOriginalEditor(),editor.getModifiedEditor()].map(view=>view.onDidScrollChange(event=>{if(event.scrollTopChanged||event.scrollLeftChanged)userActivity.scroll();}));
  }catch(e){if(!closed&&run===revision&&e.name!=='AbortError')error.value=e.message;}
  finally{if(!closed&&run===revision)loading.value=false;}
}
async function refresh(){
  const run=++revision;controller?.abort();controller=new AbortController();loading.value=true;error.value='';disposeEditor();comparison.value=null;
  try{
    const value=await request({},controller.signal);if(closed||run!==revision)return;
    versions.value=value.versions;truncated.value=value.truncated;
    if(!versions.value.some(v=>v.id===selected.value))selected.value=versions.value[0]?.id||'';
    if(selected.value)await loadComparison();
  }catch(e){if(!closed&&run===revision&&e.name!=='AbortError')error.value=e.message;}
  finally{if(!closed&&run===revision)loading.value=false;}
}
const when=value=>new Date(value).toLocaleString('ja-JP');
onMounted(()=>{if(props.embedded)dialog.value.focus({preventScroll:true});else dialog.value.showModal();void refresh();});
onBeforeUnmount(()=>{userActivity.dispose();closed=true;revision++;controller?.abort();disposeEditor();dialog.value?.close?.();});
</script>
<template>
  <Teleport to="body" :disabled="embedded">
    <component :is="embedded?'section':'dialog'" ref="dialog" class="file-history-dialog" :class="{'history-embedded':embedded}" :data-aidiy-window-move-surface="embedded ? '' : undefined" role="dialog" tabindex="-1" @keydown.esc.prevent="close" aria-labelledby="file-history-title" @keydown.stop @keydown.capture="activity" @pointerdown.capture="activity" @pointermove.capture="onPointerMove" @click.capture="activity" @wheel.capture.passive="activity" @touchstart.capture.passive="activity" @touchmove.capture.passive="activity" @scroll.capture.passive="activity" @change.capture="activity" @cancel.prevent="close">
      <header><h2 id="file-history-title">更新履歴</h2><span :title="root">{{ file.path }}</span><button v-if="embedded&&!pinned" class="viewer-pin" :disabled="pinBusy" title="別ウィンドウで開く" aria-label="ソース比較を別ウィンドウで開く" @click="emit('pin')">📌</button><button aria-label="更新履歴を閉じる" @click="close"><span class="close-icon" aria-hidden="true"></span></button></header>
      <div class="file-history-toolbar">
        <label>旧版 <select v-model="selected" :disabled="!versions.length" aria-label="比較するバックアップ" @change="loadComparison"><option v-for="version in versions" :key="version.id" :value="version.id">{{ version.label }}{{ version.fullBackup?'（全件）':'' }} · {{ version.backupPath.split('/.aidiy_backup/')[0]===version.backupPath?'ルート':version.backupPath.split('/.aidiy_backup/')[0] }}</option></select></label>
        <RefreshButton :disabled="loading" :busy="loading" title="更新履歴を再読み込み" @click="refresh">再読み込み</RefreshButton>
        <span v-if="comparison&&!loading&&!error" class="file-history-changes" :class="{'has-changes':changes>0,'no-changes':changes===0}" role="status">{{ changes===0?'差分はありません':changes===null?'差分を計算中…':`${changes}か所の変更` }}</span>
      </div>
      <p v-if="chosen" class="file-history-path">{{ chosen.backupPath }}</p>
      <p v-if="truncated" class="input-hint">履歴の確認上限に達したため、一部のバックアップを表示しています。</p>
      <div class="file-history-headings"><div>旧版 <small v-if="comparison">{{ comparison.original.encoding }} · {{ chosen?.label }}</small></div><div>現在のファイル <small v-if="comparison">{{ comparison.modified.encoding }} · {{ when(comparison.modified.mtime) }}</small></div></div>
      <div class="file-history-content">
        <div ref="host" class="file-history-editor" :aria-busy="loading" />
        <p v-if="loading" class="file-history-message" role="status">比較を準備しています…</p>
        <p v-else-if="error" class="file-history-message error" role="alert">{{ error }} <RefreshButton :disabled="loading" :busy="loading" title="更新履歴の取得を再試行" @click="refresh">再試行</RefreshButton></p>
        <p v-else-if="!versions.length" class="file-history-message">このファイルのバックアップはありません。</p>
      </div>
    </component>
  </Teleport>
</template>
