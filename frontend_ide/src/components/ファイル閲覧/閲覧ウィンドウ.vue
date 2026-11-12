<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ピン留めしたファイルの独立ウィンドウ。宇宙パネルの外で、同じIDEのファイルAPIを使って1ファイルを表示する。
import { ref, computed, provide, onMounted, onBeforeUnmount } from 'vue';
import { validConnectionState } from '../共通表示/接続状態.js';
import PanelToggle from '../コード/パネル表示切替.vue';
import StatusBar from '../共通表示/状態バー.vue';
import FileViewer from '../ファイル閲覧/ファイルビューア.vue';
const props=defineProps({path:String,desktop:Boolean});
const state=ref({}),error=ref('');
const panelCollapsed=ref(false),panelHidden=ref(false);
provide('browserAvailable',computed(()=>state.value.active&&state.value.mode==='online'&&state.value.connected===true));
const name=props.path.split('/').at(-1);
const file={name,path:props.path,mtime:0};
let timer,disposed=false,polling=false,boundSession='',ended=false;
const controller=new AbortController();
// IDEの利用が終わったらファイルAPIは使えないので、状態を見て案内に切り替える（Electron版は子ウィンドウごと閉じる）
async function status(){
  if(disposed||polling||ended)return;polling=true;
  try{
    const response=await fetch('/api/connection',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(5000)])});
    if(!response.ok)throw Error();const next=await response.json();if(disposed)return;
    if(!validConnectionState(next))throw Error();
    const key=next.active?`${next.mode}:${next.startedAt}:${next.project?.path||''}`:'';
    if(!next.active||boundSession&&boundSession!==key){ended=true;state.value={...next,active:false};error.value='ピン留め元のIDEの利用が終了しました。IDEから開き直してください。';return;}
    boundSession=key;state.value=next;error.value='';
  }
  catch{if(!disposed)error.value='IDEに接続できません。';}
  finally{polling=false;}
}
onMounted(()=>{document.title=`AiDiy IDE / Viewer - ${name}`;void status();timer=setInterval(status,10000);});
onBeforeUnmount(()=>{disposed=true;clearInterval(timer);controller.abort();});
</script>
<template>
  <div class="development-app viewer-window ai-component" :class="{'desktop-window':desktop,'panel-opening':!desktop,'panel-collapsed':panelHidden}" data-app="viewer">
    <StatusBar :hide-connection-bar="panelHidden" :title="`AiDiy IDE / Viewer - ${name}`" :connected="state.connected" :mode="state.mode" :desktop="desktop"><template #leading><PanelToggle :collapsed="panelCollapsed" :desktop="desktop" @toggle="panelCollapsed=!panelCollapsed" @hidden="panelHidden=$event" /></template></StatusBar>
    <p v-if="state.active&&error" class="input-hint" role="status">{{ error }} 作業を保持して再試行します。</p>
    <FileViewer v-if="state.active" :file="file" :root="state.project?.path||''" pinned />
    <p v-else class="panel-loading">{{ error||'読み込み中…' }}</p>
  </div>
</template>
