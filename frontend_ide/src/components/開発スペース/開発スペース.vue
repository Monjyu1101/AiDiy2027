<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick, inject } from 'vue';
import { createFolderMonitor } from '../ファイル閲覧/フォルダ監視.js';
import { scanWarning } from '../ファイル閲覧/走査警告.js';
import SpaceCanvas from '../開発スペース/宇宙キャンバス.vue';
import FolderPages from '../ファイル閲覧/フォルダページ.vue';
import FileExplorer from '../ファイル閲覧/ファイル一覧.vue';
import ViewerSession from '../ファイル閲覧/閲覧セッション.vue';
import { containsPath, renamedPath } from '../ファイル閲覧/エクスプローラー操作.js';
const props=defineProps({startedAt:Number,viewMode:{type:String,default:'3d'},allDisplays:Boolean});
const pagesReady=ref(props.viewMode==='2d');
watch(()=>props.viewMode,mode=>{if(mode==='2d')pagesReady.value=true;});
const updateMarks=shallowRef({levels:{},flashes:{}});
const scan=shallowRef(),selected=shallowRef(),trail=ref([]),focus=shallowRef();
const unlistedParent=computed(()=>{const file=selected.value,parent=file?.path.split('/').slice(0,-1).join('/');return file?.unlisted&&parent!==trail.value.join('/')?parent:undefined;});
const explorer=ref(),explorerDetached=ref(false);
async function toggleExplorer(){
  if(explorer.value?.focusDetached())return;
  if(props.allDisplays){try{await explorer.value?.pinForAll();}catch(e){error.value=e.message;}}
  else open.value=!open.value;
}
const open=ref(false),loading=ref(true),error=ref(''),root=ref(),marks=shallowRef({mode:'since',since:props.startedAt,paths:[]});
const autoSpin=ref(true),driving=ref(false),orbitPhase=ref('idle');
const refreshPaused=ref(false);
function pauseRefresh(value){refreshPaused.value=value;engine?.setRefreshPaused(value);if(!value)void engine?.refresh(undefined,{fresh:false});}
const explorationStatus=ref('出航準備中');
const fastWarp=ref(false);
watch(fastWarp,value=>engine?.setFastWarp(value));
const route=shallowRef({mode:'view',paths:[]});
const viewHistory=shallowRef([]);
const viewVoyages=shallowRef({});
watch(route,value=>engine?.route(value));
// 同じ閲覧セッションを別Documentへ移す。比較・表示モード・スクロールを再生成しない。
const viewerSessions=ref([]),viewerRefs=new Map();
let preparingAll=false,disposed=false;
async function prepareAll(){
  if(preparingAll||disposed)throw Error('VR空間への移行準備中です。');
  preparingAll=true;const resume=autoSpin.value;
  engine?.setAutoSpin(false);engine?.interact();
  try{
    // 閲覧・比較はIDE内に保ち、Explorerと軌跡だけを別窓へ移す。
    if(!explorer.value)throw Error('エクスプローラーの準備が完了していません。');
    await explorer.value.pinForAll();
    if(disposed)throw Error('開発スペースが閉じられました。');
  }finally{preparingAll=false;if(!disposed)engine?.setAutoSpin(resume);}
}
defineExpose({prepareAll});
watch(selected,file=>{
  viewerSessions.value=viewerSessions.value.filter(entry=>entry.detached||entry.pinning||entry.file.path===file?.path);
  if(!file)return;
  let entry=viewerSessions.value.find(entry=>entry.file.path===file.path);
  if(entry?.detached){viewerRefs.get(file.path)?.focus();engine?.clear();return;}
  if(entry){if(entry.keepView)entry.keepView=false;else entry.file=file;}else viewerSessions.value.push({file,detached:false});
});
function detachedViewer(entry){entry.detached=true;if(selected.value?.path===entry.file.path)engine?.clear();}
function pinningViewer(entry,value){entry.pinning=value;if(!value&&!entry.detached&&selected.value?.path!==entry.file.path)closeViewer(entry);}
function closeViewer(entry){viewerSessions.value=viewerSessions.value.filter(item=>item!==entry);viewerRefs.delete(entry.file.path);if(selected.value?.path===entry.file.path)engine?.clear();}
function recoverViewer(entry){if(!entry.detached)return;entry.detached=false;entry.keepView=true;void engine?.goTo(entry.file);}
async function reloadExplorer(){
  // 変更直前から進行していた走査を取り込んだ後、必ず新しい走査を1回行う。
  await engine?.refresh();
  if(!await engine?.refresh())throw Error('一覧を再読み込みできません。');
}
let navigationVersion=0;
function navigationActivity(){navigationVersion++;}
async function applyFileChange(result){
  const navigation=navigationVersion,session=props.startedAt,project=scan.value?.root;
  const results=result.results||[result];
  const oldSelection=selected.value?.path,current=trail.value.join('/');
  let next;
  for(const result of results){
  const previous=result.previousPath||result.path,affected=result.action==='rename'||result.action==='trash';
  if(affected){
    if(result.action==='rename'){
      if(oldSelection&&containsPath(previous,oldSelection))next={type:'file',path:renamedPath(oldSelection,previous,result.path)};
      else if(containsPath(previous,current))next={type:'dir',path:renamedPath(current,previous,result.path)};
    }
    // 別窓・比較も古いパスを参照し続けない。名前変更後は選択中のファイルを新しいパスで開き直す。
    viewerSessions.value=viewerSessions.value.filter(entry=>!containsPath(previous,entry.file.path));
    for(const path of viewerRefs.keys())if(containsPath(previous,path))viewerRefs.delete(path);
    if((oldSelection&&containsPath(previous,oldSelection))||containsPath(previous,current))engine?.clear();
  }
  }
  explorerNavigation.value=null;
  if(!refreshPaused.value)await reloadExplorer();
  if(!disposed&&navigation===navigationVersion&&session===props.startedAt&&project===scan.value?.root&&next)await selectExplorer(next);
}
// 最終更新ファイルの表示: 起動直後の最終更新と、その後の新しい最終更新を宇宙へ予約する。
// 宇宙は自動探索 ON・オープニング後・追いかけてよい状態になってから、そのファイルまでワープして開く。
function onLatest(file){engine?.requestFollow(file.files.map(item=>item.path));}
function onFreshness(){void engine?.refresh(undefined,{fresh:false});}
// フィルター（左下、既定 ON）: 宇宙とエクスプローラーを AiDiy のバックアップ対象だけにする。
const filter=ref(true);
watch(filter,on=>engine?.setFilter(on));
let engine, folderMonitor;
const monitorMessage = ref('');
function syncFolderMonitor() {
  folderMonitor?.configure({ enabled: !refreshPaused.value && props.viewMode === '2d' && autoSpin.value && !!scan.value && !document.hidden,
    path: trail.value.join('/'), filter: filter.value ? 'backup' : '', session: props.startedAt });
}
watch([()=>props.viewMode, autoSpin, filter, refreshPaused, ()=>trail.value.join('/'), ()=>props.startedAt, ()=>!!scan.value], syncFolderMonitor,{flush:'sync'});

watch(()=>props.startedAt,value=>{explorerNavigation.value=null;void engine?.refresh(value);});
// 一覧からの移動中は選んだ行を保持し、中間階層を一覧へ送り返さない。
const explorerNavigation=shallowRef(null);
async function selectExplorer(entry){
  if(preparingAll)return;
  navigationVersion++;
  explorerNavigation.value=entry;
  try{await engine?.goTo(entry);}
  finally{if(explorerNavigation.value===entry)explorerNavigation.value=null;}
}
function change(value){if('scan'in value){scan.value=value.scan;selected.value=value.selected;trail.value=value.trail;focus.value=value.focus;updateMarks.value=value.updateMarks||{levels:{},flashes:{}};viewHistory.value=value.journal||[];viewVoyages.value=value.voyages||{};}if('autoSpin'in value)autoSpin.value=value.autoSpin;if('driving'in value)driving.value=value.driving;if('orbitPhase'in value)orbitPhase.value=value.orbitPhase;if('explorationStatus'in value)explorationStatus.value=value.explorationStatus;loading.value=value.loading;if('error'in value)error.value=value.error||'';}
// VRの手動補正は閲覧・階層移動で戻さず、通常画面の自動配置とは分けて保持する。
const centerOffset={x:0,y:0};let centerGesture=null,unsubscribeCenter,unsubscribeBrowserSource;
function moveCenter({id,phase,x,y}){
  if(!props.allDisplays)return;
  if(phase==='start'){centerGesture={id,...centerOffset};engine?.interact();}
  else if(centerGesture?.id===id){
    if(phase==='end'){centerGesture=null;engine?.interact();}
    else if(phase==='move'&&Number.isFinite(x)&&Number.isFinite(y)){
      centerOffset.x=centerGesture.x+x;centerOffset.y=centerGesture.y+y;engine?.interact();
    }
  }
}
watch(()=>props.allDisplays,()=>{centerGesture=null;});
function layout({preview:plannedPreview}={}){
  const element=root.value;
  // VR中は手動補正した中心を固定し、開閉・選択による自動補正を停止する。
  if(props.allDisplays){
    const centerX=innerWidth/2+centerOffset.x,centerY=innerHeight/2+centerOffset.y;
    element?.style.setProperty('--focus-x',`${centerX}px`);
    element?.style.setProperty('--focus-y',`${centerY}px`);
    return{centerX,centerY,preview:false,fixedCenter:true};
  }
  const preview=plannedPreview??!!element?.querySelector('.viewer-popup');
  const explorer=open.value?element?.querySelector('.explorer-panel')?.getBoundingClientRect():null;
  const list=element?.querySelector('.route-file-list')?.getBoundingClientRect();
  const top=parseFloat(getComputedStyle(element).getPropertyValue('--workspace-top'))||78;
  const bottom=innerHeight-60;
  let left=16,right=innerWidth-16,upper=top,lower=bottom;
  if(innerHeight>=innerWidth){
    if(preview){
      lower=innerHeight/2-8;
      if(explorer)left=explorer.right+8;
      // Explorer外部表示中は軌跡も左端へ寄せるため、左側の占有領域として扱う。
      if(list){if(element?.querySelector('.explorer-routes.explorer-detached'))left=Math.max(left,list.right+8);else right=list.left-8;}
    }else{
      // ビューア非表示では一覧の開閉によらず画面そのものの中央を使う。
      upper=0;lower=innerHeight;
    }
  }else{
    if(explorer)left=Math.max(left,explorer.right+8);
    if(list)left=Math.max(left,list.right+8);
    if(preview)right=innerWidth*0.67-24;
  }
  const centerX=(left+right)/2,centerY=(upper+lower)/2;
  root.value?.style.setProperty('--focus-x',`${centerX}px`);
  return{centerX,centerY,preview:!!preview};
}
watch(marks,value=>engine?.marks(value));
function documentKey(event){const frame=root.value?.querySelector('.viewer-popup iframe');if(!frame||event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='aidiy-ide-document-key')return;if(event.data.key==='explorer')toggleExplorer();else if(event.data.key==='close')engine.clear();}
function ready(value){engine=value;engine.marks(marks.value);engine.route(route.value);window.aidiyIDE=engine;void engine.refresh(props.startedAt);}
// 共通ビューアでのEscも2Dのまま使える。本文入力やダイアログのキー操作は奪わない。
function pageKey(event){
  if(props.viewMode!=='2d'||event.defaultPrevented||event.isComposing)return;
  if(event.target?.closest?.('input, textarea, select, [contenteditable="true"], .ai-component, dialog, [role="dialog"]'))return;
  if(event.key==='Escape'){event.preventDefault();if(selected.value)engine?.clear();else if(trail.value.length)void engine?.ascend(trail.value.length-1);}
  else if(event.key==='Backspace'||event.altKey&&event.key==='ArrowLeft'){event.preventDefault();if(trail.value.length)void engine?.ascend(trail.value.length-1);}
}
// 軌跡バーは狭い画面で折り返す。固定高さでページの見出しを隠さないよう、変更時だけ計測する。
let pageLayoutObserver;
function pageLayout(){
  const element=root.value;if(!element)return;
  const top=parseFloat(getComputedStyle(element).getPropertyValue('--workspace-top'))||78;
  const bottom=element.querySelector('.route-controls')?.getBoundingClientRect().bottom||top;
  element.style.setProperty('--folder-page-top',`${Math.max(top+48,bottom+8)}px`);
}
onMounted(async()=>{
  unsubscribeCenter=window.aidiyWindow?.onSpaceCenterMove?.(moveCenter);
  unsubscribeBrowserSource=window.aidiyWindow?.onBrowserSelectSource?.(value=>{
    if(disposed||value?.startedAt!==props.startedAt||value.projectPath!==scan.value?.root||typeof value.path!=='string')return;
    void selectExplorer({path:value.path,type:'file',source:'browser-analysis'}).catch(e=>{if(!disposed)error.value=e.message;});
  });
  folderMonitor = createFolderMonitor({ apply: (context,result) => engine?.applyFolderSnapshot(context,result) ?? false, report: message => { monitorMessage.value=message; } });
  document.addEventListener('visibilitychange',syncFolderMonitor);syncFolderMonitor();
  window.addEventListener('message',documentKey);window.addEventListener('keydown',pageKey);window.addEventListener('resize',pageLayout);
  await nextTick();pageLayout();
  const routes=root.value?.querySelector('.explorer-routes');
  if(routes&&typeof ResizeObserver!=='undefined'){pageLayoutObserver=new ResizeObserver(pageLayout);pageLayoutObserver.observe(routes);}
});
onBeforeUnmount(()=>{disposed=true;unsubscribeCenter?.();unsubscribeBrowserSource?.();viewerRefs.clear();folderMonitor?.close();document.removeEventListener('visibilitychange',syncFolderMonitor);pageLayoutObserver?.disconnect();if(window.aidiyIDE===engine)delete window.aidiyIDE;window.removeEventListener('message',documentKey);window.removeEventListener('keydown',pageKey);window.removeEventListener('resize',pageLayout);});
</script>
<template>
  <section ref="root" class="space-view" :class="{'explorer-open':open&&!explorerDetached,viewing:!!selected,'mode-2d':viewMode==='2d'}" data-component="SpaceView" @pointerdown.capture="navigationActivity" @keydown.capture="navigationActivity">
    <SpaceCanvas :mode="viewMode" :layout="layout" @ready="ready" @change="change" @toggle-explorer="toggleExplorer" />
    <FolderPages v-if="scan&&pagesReady" :active="viewMode==='2d'" :tree="scan.tree" :current="trail.join('/')" :selected="selected?.path" :unlisted-parent="unlistedParent" :monitor-message="monitorMessage" :reload="()=>engine?.refresh()" :marks="marks" :update-marks="updateMarks" :color="name=>engine?.color(name)||'#bac7da'" @select="selectExplorer" @activity="engine?.interact()" @clear="engine?.clear()" @refresh="engine?.refresh()" @toggle-explorer="toggleExplorer" />
    <div class="space-flight-controls">
      <button v-show="viewMode==='3d'" class="space-motion-toggle space-fast-warp-toggle" role="switch" aria-label="高速ワープ" :aria-checked="fastWarp" title="別フォルダのファイルを選ぶと、1回のワープで目的フォルダへ移動" @click="fastWarp=!fastWarp"><span>高速ワープ</span><span class="motion-switch" aria-hidden="true"></span><span aria-hidden="true">{{ fastWarp?'ON':'OFF' }}</span></button>
      <div class="space-auto-explore">
        <div v-if="autoSpin&&explorationStatus" class="space-orbit-status" role="status" aria-live="polite" aria-atomic="true">{{ explorationStatus }}</div>
        <button class="space-motion-toggle" :class="{driving:autoSpin&&driving}" role="switch" aria-label="自動探索" :aria-checked="autoSpin" :title="viewMode==='2d'?'最終更新のファイルを自動で開く（手動操作中は待機）':autoSpin&&driving?'自動探索中':''" @click="engine?.setAutoSpin(!autoSpin)"><span>自動探索</span><span class="motion-switch" aria-hidden="true"></span><span aria-hidden="true">{{ autoSpin?'ON':'OFF' }}</span></button>
      </div>
    </div>
    <FileExplorer @pause-refresh="pauseRefresh" :apply-file-change="applyFileChange" :reload="reloadExplorer" @activity="navigationActivity();engine?.interact()" ref="explorer" :all-displays="allDisplays" @detached="value=>explorerDetached=value" v-model:open="open" :view-history="viewHistory" :view-voyages="viewVoyages" :tree="scan?.tree" :scan="scan" :root="scan?.root" :selected="explorerNavigation ? (explorerNavigation.type==='file' ? explorerNavigation.path : undefined) : selected?.path" :current="explorerNavigation ? (explorerNavigation.type==='dir' ? explorerNavigation.path : explorerNavigation.path.split('/').slice(0,-1).join('/')) : trail.join('/')" :navigating="!!explorerNavigation" :started-at="startedAt" :color="name=>engine?.color(name)||'#bac7da'" @select="selectExplorer" @clear="engine?.clear()" @marks="value=>marks=value" @latest="onLatest" @freshness="onFreshness" @route="value=>route=value" @clear-view-history="engine?.clearViewHistory()" :filter="filter" />
    <p v-if="scan?.truncated&&!open" class="space-scan-warning" role="status">{{ scanWarning(scan) }}</p>
    <button class="space-filter-toggle" role="switch" aria-label="フィルター" :aria-checked="filter" title="AiDiy のバックアップ対象のファイルだけを表示" @click="filter=!filter"><span>フィルター</span><span class="motion-switch" aria-hidden="true"></span><span aria-hidden="true">{{ filter?'ON':'OFF' }}</span></button>
    <ViewerSession v-for="entry in viewerSessions" :key="entry.file.path" :ref="value=>value?viewerRefs.set(entry.file.path,value):viewerRefs.delete(entry.file.path)" :file="entry.file" :root="scan?.root" :auto-spin="autoSpin" @close="closeViewer(entry)" @pinning="value=>pinningViewer(entry,value)" @detached="detachedViewer(entry)" @recover="recoverViewer(entry)" />
    <nav v-if="scan" v-show="viewMode==='3d'" class="space-breadcrumb"><button @click="engine.ascend(0)">{{ scan.tree.n }}</button><template v-for="(name,i) in trail" :key="i"><span>›</span><button @click="engine.ascend(i+1)">{{ name }}</button></template></nav>
    <div v-if="!scan&&(loading||error)" class="space-loading">{{ error||'読み込み中…' }}</div>
    <div v-else-if="error" class="space-notice" role="status"><span>{{ error }}</span><button aria-label="案内を閉じる" @click="error=''"><span class="close-icon" aria-hidden="true"></span></button></div>
  </section>
</template>

<style scoped>
.space-scan-warning{position:absolute;left:16px;bottom:52px;z-index:35;max-width:min(340px,calc(100vw - 32px));margin:0;padding:6px 8px;color:#ffe28a;background:#080c1af2;font-size:var(--file-font-size,10px)}
.space-notice{position:fixed;left:50%;bottom:66px;transform:translateX(-50%);z-index:45;display:flex;align-items:start;gap:8px;max-width:min(680px,calc(100vw - 32px));padding:8px 10px;background:#251e10f2;color:#ffe5a2;border:1px solid #7c6740;font-size:var(--file-font-size,11px);pointer-events:none}.space-notice button{flex:none;pointer-events:auto;padding:0 5px}.mode-2d .space-notice{background:#f5e8c9;color:#74521f;border-color:#d8c398}
</style>
