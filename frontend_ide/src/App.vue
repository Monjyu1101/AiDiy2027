<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, reactive, computed, provide, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { installWindowMove } from './components/共通表示/長押し窓移動.js';
import CodePanel from './components/コード/コードパネル.vue';
import ConsolePanel from './components/ターミナル/ターミナルパネル.vue';
import LivePanel from './components/ライブ/ライブパネル.vue';
import NavigationPanel from './components/開発スペース/Navigationパネル.vue';
import SpaceView from './components/開発スペース/開発スペース.vue';
import StatusBar from './components/共通表示/状態バー.vue';
import TerminalWelcome from './components/ターミナル/開始表示.vue';
import ViewerWindow from './components/ファイル閲覧/閲覧ウィンドウ.vue';
import BrowserPanel from './components/ブラウザ/ブラウザパネル.vue';
import {openBrowser} from './components/ブラウザ/起動.js';
import FileAnalysisDialog from './dialog/ファイル解析ダイアログ.vue';
import FileHistoryDialog from './dialog/ファイル履歴ダイアログ.vue';
import DraftHandoffDialog from './dialog/下書き連携ダイアログ.vue';
import { validConnectionState } from './components/共通表示/接続状態.js';
import { createDraftTargetRegistry } from './components/下書き連携/連携先登録.js';
const analysis=ref(null);
const history=ref(null),draftRequest=ref(null),codePanel=ref(),livePanel=ref();
const draftRegistry=createDraftTargetRegistry(),pinnedViewers=new Map();
let lastDraftKind='';
provide('openFileDraft',request=>{draftRequest.value=request;});
// Explorerの別窓にも、同じ連携先確認・下書き追加処理を提供する。
provide('fileDraftActions',{loadTargets:loadDraftTargets,insertDraft:insertFileDraft,launchTarget:launchDraftTarget});
provide('registerPinnedViewer',opened=>{if(opened&&state.value.active)pinnedViewers.set(opened,{sessionKey:session,projectPath:state.value.project?.path});});
provide('openFileHistory',(file,root)=>{history.value={file:{path:file.path,name:file.name},root};});
// ビューアの3分消去やファイル切替から独立して、解析対象を保持する。
provide('openFileAnalysis',(file,root)=>{analysis.value={file:{path:file.path,name:file.name},root};});
const { config }=defineProps({config:Object});
// IDEのピン留めで開いた独立ウィンドウ（URLの #viewer=ファイル）。IDE本体の画面・接続監視は動かさない。
const viewerPath=config.kind==='ide'&&location.hash.startsWith('#viewer=')?decodeURIComponent(location.hash.slice('#viewer='.length)):'';
const browserHeader=location.hash==='#browser-header';
const browserPanel=(config.kind==='browser'||config.kind==='ide'&&(location.hash==='#browser'||browserHeader))&&!!window.aidiyWindow;
const state=ref({active:false}),base=reactive({console:'',code:config.kind==='code'?(config.host?'host':config.base||''):'',live:config.kind==='live'?(config.host?'host':config.base||''):''});
const statusError=ref('');
const error=ref(''),pending=ref(false),panelOpen=ref(false),tab=ref('code'),liveOpen=ref(false),viewMode=ref('3d');
let stopWindowMove=()=>{};
const desktop=!!window.aidiyWindow;let timer,disposed=false,revision=0,polling=false,session='';
const allDisplayState=ref({active:false}),allBusy=ref(false),allMessage=ref(''),spaceView=ref();
const canEnterAll=computed(()=>desktop&&state.value.active&&viewMode.value==='3d');
const browserAvailable=computed(()=>state.value.active&&state.value.mode==='online'&&state.value.connected===true);
provide('browserAvailable',browserAvailable);
let stopAllDisplays=()=>{},allUpdate=0;
const allToolbars=computed(()=>allDisplayState.value.toolbars||[]);
const allRestoreStyle=toolbar=>({right:(100-toolbar.left-toolbar.width)+'%',top:toolbar.top+'%'});
function updateAllDisplays(value){
  if(disposed||!value)return;allUpdate++;
  if(value.ok)allDisplayState.value=value;
  if(value.error)error.value=value.error;
}
async function toggleAllDisplays(){
  if(allBusy.value||!desktop)return;
  const entering=!allDisplayState.value.active,space=spaceView.value,own=session;
  if(entering&&!canEnterAll.value)return;
  allBusy.value=true;allMessage.value=entering?'VR空間へ移行中…':'VRモードを終了しています…';error.value='';
  try{
    await nextTick();
    if(entering&&space)await space.prepareAll();
    if(disposed||space!==spaceView.value||own!==session||(entering&&!canEnterAll.value))throw Error('利用状態が変わったためVR空間への移行を中止しました。');
    updateAllDisplays(await window.aidiyWindow.allDisplays('toggle'));
  }
  catch(e){if(!disposed)error.value=e.message||'VRモードを切り替えられませんでした。';}
  finally{allBusy.value=false;}
}
const lifetime=new AbortController();
async function status(){
  if(polling||pending.value||disposed)return;polling=true;const run=revision,own=session;
  try{
    const r=await fetch('/api/connection',{cache:'no-store',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)])});
    if(!r.ok)throw Error();const data=await r.json();
    // 一時的なHTTP失敗・壊れた応答は利用終了の証拠ではない。子パネルやPTYを破棄しない。
    if(!validConnectionState(data))throw Error();
    if(disposed||run!==revision||own!==session)return;statusError.value='';update(data);const confirmed=session;
    if(desktop){
      try{const children=await window.aidiyWindow.childWindows();if(!disposed&&run===revision&&session===confirmed)liveOpen.value=!!children?.live;}
      catch{if(!disposed&&run===revision&&session===confirmed)statusError.value='子ウィンドウの状態を確認できません。次の確認で再試行します。';}
    }
  }catch{if(!disposed&&run===revision&&session===own)statusError.value='サーバーの状態を確認できません。作業を保持して再試行します。';}
  finally{polling=false;}
}
function update(data){
  if(disposed)return;
  const next=data.active?`${data.mode}:${data.startedAt}:${data.project?.path||''}`:'';
  if(next!==session){navigationWindows.value=[];nextNavigation=0;lastDraftKind='';analysis.value=null;history.value=null;draftRequest.value=null;pinnedViewers.clear();for(const key of Object.keys(opening))delete opening[key];session=next;base.code='';base.live='';base.console='';panelOpen.value=false;tab.value='code';liveOpen.value=false;viewMode.value='3d';}
  state.value=data;error.value=data.message||'';
}
async function start(action){
  if(pending.value)return;pending.value=true;revision++;error.value='';statusError.value='';
  if(action==='disconnect')update({active:false});
  try{if(action==='disconnect'&&desktop)await window.aidiyWindow.endSession();const response=await fetch('/api/connection/'+action,{method:'POST',signal:AbortSignal.timeout(7000)});if(!response.ok)throw Error(await response.text());update(await response.json());}
  catch(e){error.value=e.message;}finally{pending.value=false;}
}
const navigationWindows=ref([]);let nextNavigation=0;
function openNavigation(){if(!state.value.active)return;navigationWindows.value.push('navi-'+(++nextNavigation));}
function closeNavigation(id){navigationWindows.value=navigationWindows.value.filter(value=>value!==id);}
const launching=ref('');
async function openWindow(kind,displayId){
  if(kind==='browser'&&!browserAvailable.value){error.value='tools接続中のみBrowserを起動できます。';return{ok:false,error:error.value};}
  if(launching.value)return;launching.value=kind;error.value='';
  try{const result=kind==='browser'?await openBrowser(undefined,displayId):await window.aidiyWindow.openApp(kind,displayId);if(!result?.ok)throw Error(result?.error||'画面を開けません。');if(kind==='live')liveOpen.value=true;return result;}
  catch(e){error.value=e.message;return{ok:false,error:e.message};}finally{launching.value='';}
}
const opening={};
async function openPanel(kind){
  if(config.kind==='ide'&&!state.value.active)return;
  if(kind==='live'&&config.kind==='ide'&&state.value.mode!=='online')return;
  tab.value=kind;panelOpen.value=true;
  if(kind==='code'||kind==='live')lastDraftKind=kind;
  if(base[kind])return;
  const own=session;
  try{
    const request=opening[kind]??=fetch('/api/panels/'+kind,{method:'POST'}).then(async response=>{if(!response.ok)throw Error(await response.text());return response.json();});
    const result=await request;if(!disposed&&own===session)base[kind]=result.url;
  }catch(e){if(!disposed&&own===session)error.value=e.message;}finally{if(own===session)delete opening[kind];}
}
const panels=()=>[codePanel.value,livePanel.value].filter(Boolean);
async function confirmDraftSession(request,expected){
  const run=revision,own=session;
  const response=await fetch('/api/connection',{cache:'no-store',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)])});
  if(!response.ok)throw Error('IDEの利用状態を確認できません。接続を確認して再試行してください。');
  const current=await response.json();
  if(!validConnectionState(current))throw Error('IDEの利用状態を確認できません。');
  if(disposed||run!==revision||own!==session)throw Error('IDEの利用状態が変わりました。連携先を選び直してください。');
  update(current);
  if(!current.active||current.project?.path!==request.projectPath||expected&&expected!==session)throw Error('IDEの利用状態が変わりました。連携先を選び直してください。');
  return{sessionKey:session,projectPath:current.project.path,mode:current.mode};
}
function parentDraftAPI(){
  try{const parent=window.opener;if(parent&&!parent.closed&&parent.location.origin===location.origin&&parent.aidiyDraftLink)return parent.aidiyDraftLink;}catch{}
  throw Error('起動元のIDEへ接続できません。IDEからこのファイルを開き直してください。');
}
function verifyPinned(sender,request){
  const linked=pinnedViewers.get(sender);
  if(!linked||sender.closed||linked.sessionKey!==session||linked.projectPath!==request.projectPath)throw Error('ピン留め元のIDEの利用が終了しました。IDEから開き直してください。');
  return linked;
}
async function loadDraftTargets(request){
  if(desktop){const result=await window.aidiyWindow.draftTargets();if(result?.projectPath!==request.projectPath)throw Error('連携先のプロジェクトが一致しません。');return result;}
  if(viewerPath)return parentDraftAPI().list(window,request);
  const current=await confirmDraftSession(request);await nextTick();
  return{ok:true,...current,...draftRegistry.snapshot(panels(),current.projectPath,lastDraftKind)};
}
async function insertFileDraft(request,sourceGuard=()=>{}){
  if(desktop)return window.aidiyWindow.insertDraft(request);
  if(viewerPath)return parentDraftAPI().insert(window,request);
  const current=await confirmDraftSession(request,request.sessionKey);
  sourceGuard();
  const result=draftRegistry.insert(panels(),current,request);
  if(result.ok){const chosen=draftRegistry.targets(panels(),current.projectPath).find(item=>item.id===request.targetId);tab.value=chosen.kind;lastDraftKind=chosen.kind;panelOpen.value=true;}
  return result;
}
async function launchDraftTarget(kind,request){
  if(desktop)return openWindow(kind);
  if(viewerPath)return parentDraftAPI().launch(window,kind,request);
  await confirmDraftSession(request,request.sessionKey);
  if(kind==='live'&&state.value.mode!=='online')throw Error('LiveはAiDiy接続利用で起動してください。');
  await openPanel(kind);await nextTick();
  return base[kind]?{ok:true}:{ok:false,error:error.value||'画面を開けません。'};
}
const draftLink={
  async list(sender,request){const linked=verifyPinned(sender,request);const current=await confirmDraftSession(request,linked.sessionKey);verifyPinned(sender,request);return{ok:true,...current,...draftRegistry.snapshot(panels(),current.projectPath,lastDraftKind)};},
  async insert(sender,request){verifyPinned(sender,request);return insertFileDraft(request,()=>verifyPinned(sender,request));},
  async launch(sender,kind,request){const linked=verifyPinned(sender,request);await confirmDraftSession(request,linked.sessionKey);verifyPinned(sender,request);return launchDraftTarget(kind,{...request,sessionKey:linked.sessionKey});},
};
onMounted(async()=>{
  stopWindowMove=installWindowMove({kind:browserPanel?'browser':viewerPath?'viewer':config.kind,host:config.host});
  if(config.kind==='ide'&&desktop&&!viewerPath&&!browserPanel){
    stopAllDisplays=window.aidiyWindow.onAllDisplaysChanged?.(updateAllDisplays)||(()=>{});
    const version=allUpdate;
    void window.aidiyWindow.allDisplays?.('state').then(value=>{if(version===allUpdate)updateAllDisplays(value);}).catch(()=>{});
  }
  if(config.kind==='ide'&&!desktop&&!viewerPath)window.aidiyDraftLink=draftLink;
  if(config.host||viewerPath||browserPanel)return;
  if(config.kind==='ide'){await status();if(!disposed)timer=setInterval(status,10000);}
  else if(config.kind!=='navi'&&!base[config.kind])await openPanel(config.kind);
});
onBeforeUnmount(()=>{stopWindowMove();stopAllDisplays();disposed=true;revision++;lifetime.abort();clearInterval(timer);pinnedViewers.clear();if(window.aidiyDraftLink===draftLink)delete window.aidiyDraftLink;});
</script>
<template>
  <DraftHandoffDialog v-if="draftRequest" :request="draftRequest" :load-targets="loadDraftTargets" :insert-draft="insertFileDraft" :launch-target="launchDraftTarget" @close="draftRequest=null" />
  <FileAnalysisDialog v-if="analysis" :key="analysis.root+'|'+analysis.file.path" :file="analysis.file" :root="analysis.root" @close="analysis=null" />
  <FileHistoryDialog v-if="history" :key="history.root+'|'+history.file.path" :file="history.file" :root="history.root" @close="history=null" />
  <BrowserPanel v-if="browserPanel" :standalone="config.kind==='browser'" :header-only="browserHeader" />
  <ViewerWindow v-else-if="viewerPath" :path="viewerPath" :desktop="desktop" />
  <div v-else class="development-app" :class="[config.kind,{'vscode-host':config.host,'desktop-window':desktop,'all-displays':allDisplayState.active}]" :data-app="config.kind">
    <template v-if="config.kind==='ide'">
      <div v-show="!allDisplayState.active" class="ide-heading"><StatusBar title="AiDiy IDE" :connected="state.connected" :mode="state.mode" :busy="state.connecting||pending" :desktop="desktop" :allow-all="canEnterAll" :all-displays="allDisplayState.active" :all-busy="allBusy" @toggle-all="toggleAllDisplays" :clock-pulse="!allDisplayState.active" />
        <div class="component-toolbar">
          <div class="ide-project-actions">
            <span class="ide-project-name" :title="state.project?.path">プロジェクト: {{ state.project?.name }}</span>
            <nav v-if="state.active" class="ide-view-modes" aria-label="ファイルの表示モード"><button :aria-pressed="viewMode==='3d'" @click="viewMode='3d'">3D</button><button :aria-pressed="viewMode==='2d'" @click="viewMode='2d'">2D</button></nav>
          </div>
          <div class="ide-toolbar-right">
            <nav v-if="state.active&&desktop" class="ai-launchers" aria-label="別ウィンドウを開く"><button class="navigation-launch" @click="openNavigation">＋ Navigator</button><button :disabled="!!launching" title="ターミナルを別ウィンドウで開く" @click="openWindow('console')">{{ launching==='console'?'起動中…':'＋ Console' }}</button><button :disabled="!!launching" title="コード支援を別ウィンドウで開く" @click="openWindow('code')">{{ launching==='code'?'起動中…':'＋ Code' }}</button><button v-if="state.mode==='online'&&!liveOpen" :disabled="!!launching" title="音声会話を別ウィンドウで開く" @click="openWindow('live')">{{ launching==='live'?'起動中…':'＋ Live' }}</button><button :disabled="!!launching||!browserAvailable" :title="browserAvailable?'ブラウザを別ウィンドウで開く':'tools接続中のみ起動できます'" @click="openWindow('browser')">{{ launching==='browser'?'起動中…':'＋ Browser' }}</button><button v-for="type in ['task','team']" :key="type" v-show="state.mode==='online'" :disabled="!!launching" :title="'現在のプロジェクトに固定して '+type.toUpperCase()+' を開く'" @click="openWindow(type)">{{ launching===type?'起動中…':'＋ '+type.toUpperCase() }}</button></nav>
            <nav v-else-if="state.active" class="ai-launchers" aria-label="パネルを開く"><button class="navigation-launch" @click="openNavigation">＋ Navigator</button><button :aria-pressed="panelOpen&&tab==='console'" @click="openPanel('console')">Console</button><button :aria-pressed="panelOpen&&tab==='code'" @click="openPanel('code')">Code</button><button v-if="state.mode==='online'" :aria-pressed="panelOpen&&tab==='live'" @click="openPanel('live')">Live</button><button :disabled="!browserAvailable||!!launching" @click="openWindow('browser')" :title="browserAvailable?'新しいブラウザタブでGoogle検索を開く':'tools接続中のみ起動できます'">＋ Browser</button></nav>
            <nav><template v-if="!state.active"><button :disabled="pending" @click="start('connect')">AiDiy接続利用</button><button :disabled="pending" @click="start('offline')">オフライン利用</button></template><button v-else :disabled="pending" @click="start('disconnect')">{{ desktop?'終了':'利用終了' }}</button></nav>
          </div>
        </div>
      </div>
      <template v-if="allDisplayState.active"><nav v-for="toolbar in allToolbars" :key="toolbar.displayId" class="all-restore-zone" :data-display-id="toolbar.displayId" :style="allRestoreStyle(toolbar)" aria-label="この画面のVR操作" @mouseenter="status" @focusin="status">
        <button class="all-restore-button" :disabled="allBusy" aria-label="VRモードを終了して元の表示に戻す" title="VRモードを終了" @click="toggleAllDisplays"><span class="all-restore-icon" aria-hidden="true"></span></button>
        <div class="all-launchers">
          <button class="navigation-launch" :disabled="allBusy" @click="openNavigation">＋ Navigator</button>
          <button :disabled="!!launching||allBusy" title="この画面の下部にターミナルを開く" @click="openWindow('console',toolbar.displayId)">{{ launching==='console'?'起動中…':'＋ Console' }}</button>
          <button :disabled="!!launching||allBusy" title="この画面の右上にコード支援を開く" @click="openWindow('code',toolbar.displayId)">{{ launching==='code'?'起動中…':'＋ Code' }}</button>
          <button v-if="state.mode==='online'&&!liveOpen" :disabled="!!launching||allBusy" title="この画面の左上に音声会話を開く" @click="openWindow('live',toolbar.displayId)">{{ launching==='live'?'起動中…':'＋ Live' }}</button>
          <button v-for="type in ['task','team']" :key="type" v-show="state.mode==='online'" :disabled="!!launching||allBusy" @click="openWindow(type,toolbar.displayId)">{{ launching===type?'起動中…':'＋ '+type.toUpperCase() }}</button>
          <button :disabled="!!launching||allBusy||!browserAvailable" :title="browserAvailable?'この画面にブラウザを開く':'tools接続中のみ起動できます'" @click="openWindow('browser',toolbar.displayId)">{{ launching==='browser'?'起動中…':'＋ Browser' }}</button>
        </div>
      </nav></template>
      <div v-if="allBusy" class="all-transition" role="status" aria-live="polite"><p>{{ allMessage }}</p></div>
      <TerminalWelcome v-if="!state.active" kind="ide" :icon="config.icon" />
      <template v-else>
        <NavigationPanel v-for="id in navigationWindows" :key="id" :instance="id" :project="state.project" :started-at="state.startedAt" :all-displays="allDisplayState.active" @closed="closeNavigation(id)" />
        <SpaceView ref="spaceView" :key="`${state.mode}:${state.startedAt}:${state.project?.path||''}`" :started-at="state.startedAt" :view-mode="viewMode" :all-displays="allDisplayState.active" />
        <aside v-if="!desktop" v-show="panelOpen" class="ai-popup"><nav class="ai-tabs" role="tablist"><button role="tab" :aria-selected="tab==='console'" @click="openPanel('console')">Console</button><button role="tab" :aria-selected="tab==='code'" @click="openPanel('code')">Code</button><button v-if="state.mode==='online'" role="tab" :aria-selected="tab==='live'" @click="openPanel('live')">Live</button><button class="close" aria-label="パネルを閉じる" @click="panelOpen=false"><span class="close-icon" aria-hidden="true"></span></button></nav>
          <CodePanel ref="codePanel" v-if="base.code" v-show="tab==='code'" :key="base.code" :base="base.code" :icon="config.icon" embedded page-notifications />
          <LivePanel ref="livePanel" v-if="base.live&&state.mode==='online'" v-show="panelOpen&&tab==='live'" :visible="panelOpen&&tab==='live'" :key="base.live" :base="base.live" :icon="config.icon" />
          <ConsolePanel v-if="base.console" v-show="tab==='console'" :key="base.console" :base="base.console" :icon="config.icon" :visible="panelOpen&&tab==='console'" linked />
          <p v-if="!base[tab]" class="panel-loading">読み込み中…</p>
        </aside>
      </template>
    </template>
    <NavigationPanel v-else-if="config.kind==='navi'" standalone :instance="config.navigationInstance" :project="config.project" />
    <CodePanel v-else-if="config.kind==='code'&&base.code" :base="config.host?'':base.code" :host="config.host" :embedded="config.linked" :linked="config.linked" :icon="config.icon" :desktop="desktop" />
    <LivePanel v-else-if="config.kind==='live'&&base.live" :base="config.host?'':base.live" :config="config.live||{}" :linked="config.linked" :icon="config.icon" :desktop="desktop" />
    <ConsolePanel v-else-if="config.kind==='console'&&base.console" :base="base.console" :icon="config.icon" :desktop="desktop" :linked="config.linked" />
    <p v-else class="panel-loading">読み込み中…</p>
    <p v-if="error||statusError" class="app-error" role="alert">{{ error||statusError }}</p>
  </div>
</template>
