<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import RefreshButton from '../共通表示/再読込ボタン.vue';
import {ref,onMounted,onBeforeUnmount} from 'vue';
import StatusBar from '../共通表示/状態バー.vue';
import {displayBrowserURL,browserAddressTarget} from './URL表示.js';
import {browserAnalysisPageKey,createBrowserAnalysisStatus} from './ブラウザ解析状態.js';
const props=defineProps({standalone:Boolean,headerOnly:Boolean});
const page=ref({url:'',title:'',loading:false,back:false,forward:false,error:''}),address=ref(''),surface=ref(),chrome=ref(),chromeHeight=ref(100),error=ref(''),capturing=ref(false),captureMessage=ref('');
let stop=()=>{},stopFrame=()=>{},stopAnalysis=()=>{},stopElement=()=>{},observer,disposed=false,editing=false,frame,stateRevision=-1,analysisNavigation=0;
const headerOffset=ref(0),windowTitle=ref('');
const headerWindowApi=props.headerOnly?{
 ...window.aidiyWindow,
 pinState:()=>window.aidiyWindow.browserAction('header-pin-state'),
 togglePin:()=>window.aidiyWindow.browserAction('header-toggle-pin'),
 onPinChanged:callback=>window.aidiyWindow.onBrowserChanged(value=>callback({pinned:!!value.headerPinned,locked:false})),
}:undefined;
const handing=ref(false),openingAnalysis=ref(false),analysisStatus=ref({status:'idle'});
const analysisMonitor=createBrowserAnalysisStatus({
 read:async(url,signal)=>{const response=await fetch('/api/browser-analysis?'+new URLSearchParams({url,status:'1'}),{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});const value=await response.json();if(!response.ok)throw Error(value.error||'解析状況を確認できません。');return value;},
 changed:value=>{if(!disposed)analysisStatus.value=value;},
});
function monitorAnalysis(){const visible=props.headerOnly?page.value.headerVisible!==false:!page.value.fullscreen;analysisMonitor.setPage(page.value.url,page.value.available===true&&visible,page.value.session||'');}
async function openAnalysis(){
 if(openingAnalysis.value||handing.value)return;
 openingAnalysis.value=true;const navigation=analysisNavigation;
 try{
  const result=await window.aidiyWindow.browserAction('open-analysis');
  if(disposed||navigation!==analysisNavigation)return;if(!result?.ok)throw Error(result?.error||'解析画面を開けません。');error.value='';
 }catch(e){if(!disposed&&navigation===analysisNavigation)error.value=e.message;}finally{if(!disposed)openingAnalysis.value=false;}
}

async function handoff(element=false){
 if(handing.value||openingAnalysis.value)return;handing.value=true;const navigation=analysisNavigation;
 try{const result=await window.aidiyWindow.browserAction('open-draft',element===true);if(!disposed&&navigation===analysisNavigation){if(!result?.ok)throw Error(result?.error||'連携先を開けません。');error.value='';}}
 catch(e){if(!disposed&&navigation===analysisNavigation)error.value=e.message;}finally{if(!disposed)handing.value=false;}
}
function update(value){
 if(disposed||!value)return;
 // F11の通知より遅く届いた操作応答で、通常表示を古い全画面状態へ戻さない。
 if(Number.isFinite(value.stateRevision)){if(value.stateRevision<stateRevision)return;stateRevision=value.stateRevision;}
 if(browserAnalysisPageKey(value.url)!==browserAnalysisPageKey(page.value.url)||value.session!==page.value.session)analysisNavigation++;
 const showHeader=props.headerOnly&&value.headerVisible&&!page.value.headerVisible&&browserAnalysisPageKey(value.url)===browserAnalysisPageKey(page.value.url);
 // 再撮影中・失敗後に、同じ保存パスの状態通知で古い成功表示を戻さない。
 const captureChanged=value.capturePath!==page.value.capturePath;
 page.value=value;if(!capturing.value&&captureChanged)captureMessage.value=value.capturePath||'';if(!editing)address.value=displayBrowserURL(value.url);
 monitorAnalysis();if(showHeader)void analysisMonitor.refresh();
}
async function action(name,value){
 const result=await window.aidiyWindow.browserAction(name,value).catch(e=>({ok:false,error:e.message}));
 if(disposed)return;if(!result?.ok){error.value=result?.error||'ブラウザを操作できません。';return;}
 error.value='';update(result);
}
function navigate(){editing=false;void action('navigate',browserAddressTarget(address.value,page.value.url));}
async function capture(){
 if(disposed||capturing.value)return;capturing.value=true;captureMessage.value='';
 try{
  const result=await window.aidiyWindow.browserAction('capture');
  if(disposed)return;
  if(!result?.ok)throw Error(result?.error||'撮影できませんでした。');
  if(typeof result.path!=='string'||!result.path.trim())throw Error('撮影画像の保存を確認できませんでした。');
  captureMessage.value=result.message||result.path;error.value='';
 }catch(e){if(!disposed){captureMessage.value='';error.value=e.message;}}finally{if(!disposed)capturing.value=false;}
}
function resize(){const rect=surface.value?.getBoundingClientRect(),viewport=rect?document.documentElement.getBoundingClientRect():null;chromeHeight.value=chrome.value?.getBoundingClientRect().height||100;if(props.headerOnly)void window.aidiyWindow.browserAction('header-size',chromeHeight.value).catch(()=>{});else if(rect)void window.aidiyWindow.browserAction('bounds',{left:rect.left,top:rect.top,width:rect.width,height:rect.height,chromeHeight:chromeHeight.value,viewportWidth:viewport.width,viewportHeight:viewport.height,fullscreen:!!page.value.fullscreen,measuredAt:performance.timeOrigin+performance.now()}).catch(()=>{});}
function transition(){cancelAnimationFrame(frame);const end=performance.now()+260;function step(){resize();if(!disposed&&performance.now()<end)frame=requestAnimationFrame(step);}step();}
onMounted(()=>{
 // Codeと同じ限定IPCを使う。全画面ヘッダーもmainが解決した元Browser窓のタイトルを表示する。
 void Promise.resolve().then(()=>window.aidiyWindow?.title?.()).then(title=>{if(!disposed&&typeof title==='string'&&title.trim())windowTitle.value=title;}).catch(()=>{});
 stop=window.aidiyWindow.onBrowserChanged(update);void action('state');
 if(props.headerOnly){document.documentElement.classList.add('browser-header-document');stopFrame=window.aidiyWindow.onBrowserHeaderFrame?.(value=>{headerOffset.value=value;})||(()=>{});}
 else {stopElement=window.aidiyWindow.onBrowserElementSelected?.(()=>{void handoff(true);})||(()=>{});stopAnalysis=window.aidiyWindow.onBrowserOpenAnalysis?.(()=>{void openAnalysis();})||(()=>{});}
 observer=new ResizeObserver(resize);if(surface.value)observer.observe(surface.value);if(chrome.value)observer.observe(chrome.value);resize();
});
onBeforeUnmount(()=>{disposed=true;analysisMonitor.dispose();stop();stopFrame();stopAnalysis();stopElement();if(!props.headerOnly)void window.aidiyWindow.browserAction('element-stop').catch(()=>{});if(props.headerOnly)document.documentElement.classList.remove('browser-header-document');observer?.disconnect();cancelAnimationFrame(frame);});
</script>
<template>
 <main class="development-app browser-panel desktop-window" :class="{'browser-fullscreen':page.fullscreen,'browser-header-only':headerOnly}" :style="{'--header-offset':headerOffset+'px'}" data-app="browser" @transitionrun.self="transition">
  <div ref="chrome" class="browser-chrome panel-window-title" data-aidiy-window-move-handle @transitionrun="transition">
  <StatusBar :title="windowTitle||(standalone?'AiDiy Browser':'AiDiy IDE / Browser')" :connected="page.available===true" :status="page.available===false?'tools未接続':page.loading?'読み込み中':'ブラウザ'" desktop :clock-pulse="false" :window-api="headerWindowApi" :pin-title="headerOnly?(page.headerPinned?'ヘッダーの常時表示を解除':'ヘッダーを常時表示'):undefined">
   <template #connection-tools><button type="button" class="browser-analysis" :disabled="openingAnalysis||handing||capturing||!page.available" :title="analysisStatus.message||(analysisStatus.status==='waiting'?'このページをバックグラウンド解析中。クリックで進行状況を確認':analysisStatus.status==='complete'?'このページの解析結果を表示':'表示中URLに対応する関連ソースをAIで解析')" @click="openAnalysis">{{analysisStatus.status==='waiting'?'解析中…':openingAnalysis?'準備中…':analysisStatus.status==='complete'?'AI解析済':analysisStatus.status==='failed'?'AI解析 要確認':'AI解析'}}</button><span class="browser-capture-tools"><button type="button" class="browser-capture" :disabled="capturing||!page.available" :title="captureMessage||'表示中のWeb画面をtemp/inputに保存'" aria-label="Web画面を撮影" @click="capture">{{capturing?'撮影中…':'📷 撮影'}}</button><span v-if="captureMessage&&!capturing" class="browser-capture-status" :title="captureMessage" role="status">保存済み</span></span><button type="button" class="browser-handoff" :disabled="handing||capturing||!page.available" title="session・tab_id・URLと1分以内の撮影画像パスを下書きへ追加" @click="handoff">Code / Liveへ</button><button type="button" class="browser-element-link" :disabled="openingAnalysis||handing||capturing||!page.available" :aria-pressed="!!page.elementPicking" title="ホバーで要素のHTML/CSSを表示し、クリックでCode / Liveの下書きへ。Escで解除" @click="action('element-toggle')">{{page.elementPicking?'要素連携中（Esc）':'要素連携'}}</button></template>
   <template #window-tools>
    <span class="browser-window-sizes">
     <button type="button" title="Web表示領域を1920×945にしてパネルを拡大（画面外へはみ出しても縮小しません）" @click="action('size','fhd')">FHD</button>
     <button type="button" title="Web表示領域を1080×1785にしてパネルを拡大（画面外へはみ出しても縮小しません）" @click="action('size','portrait')">縦表示</button>
     <button type="button" :title="page.fullscreen?'全画面表示を終了':'現在の画面全体に表示'" :aria-pressed="!!page.fullscreen" @click="action('fullscreen')">F11</button>
    </span>
   </template>
  </StatusBar>
  <form class="browser-toolbar" @submit.prevent="navigate">
   <button type="button" aria-label="戻る" title="戻る" :disabled="!page.available||!page.back" @click="action('back')">←</button>
   <button type="button" aria-label="進む" title="進む" :disabled="!page.available||!page.forward" @click="action('forward')">→</button>
   <RefreshButton :disabled="!page.available" :stop="page.loading" :aria-label="page.loading?'読み込みを停止':'再読み込み'" :title="page.loading?'読み込みを停止':'再読み込み'" @click="action(page.loading?'stop':'reload')" />
   <button type="button" :disabled="!page.available" title="Google検索" aria-label="Google検索" @click="action('home')">⌂</button>
   <input v-model="address" :disabled="!page.available" aria-label="URLまたは検索語" placeholder="URLまたはGoogleで検索" spellcheck="false" @focus="editing=true" @blur="editing=false">
   <button type="submit" :disabled="!page.available">開く</button>
  </form>
  <p class="browser-page-title" :class="{'browser-loading':page.loading&&!page.error}" :title="page.title" role="status" :aria-busy="page.loading&&!page.error">{{ page.loading&&!page.error?'Loading…':page.title||'Browser' }}<span v-if="page.session"> · session={{ page.session }}</span></p>
  <p v-if="error||page.error" class="error browser-error" role="status">{{ error||page.error }}</p>
  </div>
  <div v-if="!headerOnly" ref="surface" class="browser-surface"></div>
 </main>
</template>
<style scoped>
.browser-panel{container:browser-panel / inline-size;height:100vh;display:flex;flex-direction:column;background:#000;color:#dce6f4}
.browser-chrome{flex:none;background:#000;z-index:1}
.browser-element-link,.browser-analysis,.browser-capture,.browser-handoff{margin-left:7px;padding:0 6px;height:24px;font-size:11px;white-space:nowrap;-webkit-app-region:no-drag}
.browser-element-link[aria-pressed="true"]{color:#80eaff;border-color:#5ed9ff;background:#123f52}
.browser-capture-tools{display:inline-flex;align-items:center;flex:none;white-space:nowrap}
.browser-capture-status{margin-left:5px;white-space:nowrap;font-size:10px;color:#9edfff}
.development-app.browser-panel.browser-fullscreen{border:0;position:relative}
.browser-fullscreen:not(.browser-header-only) .browser-chrome{display:none}
.development-app.browser-header-only{--aidiy-titlebar-background:transparent;--aidiy-titlebar-foreground:#4b8eaa;--aidiy-titlebar-secondary:#4b8eaa;container:browser-header / inline-size;width:100%;max-width:none;height:auto;min-height:0;background:transparent;border:0;overflow:visible}
.browser-header-only .browser-chrome{position:relative;isolation:isolate;transform:translateY(var(--header-offset));border:1px solid rgba(35,147,179,.42);border-radius:0;overflow:hidden;background:rgba(64,210,245,.10);color:#4b8eaa;text-shadow:0 1px 2px rgba(255,255,255,.25)}
/* 4辺のガラスの縁。入力を遮らず、窓や本文の寸法も変えない。 */
.browser-header-only .browser-chrome::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;border:2px solid rgba(56,171,202,.38);border-top-color:rgba(255,255,255,.58);border-left-color:rgba(170,240,255,.48);box-shadow:inset 0 0 0 1px rgba(255,255,255,.24)}
.browser-header-only :deep(.connection-bar){background:rgba(132,205,214,.16);border-top-color:rgba(118,174,184,.18);animation:none}
.browser-header-only :deep(.panel-brand.desktop){-webkit-app-region:no-drag;background:transparent}
.browser-header-only :deep(.panel-brand strong),.browser-header-only :deep(.connection-label),.browser-header-only .browser-page-title,.browser-header-only .browser-capture-status{color:#4b8eaa}
.browser-header-only :deep(button),.browser-header-only :deep(.reload-control.refresh-button[type=button]){color:#4b8eaa;background:rgba(229,252,255,.10);border-color:rgba(59,122,133,.28);border-radius:0;text-shadow:0 1px 2px rgba(255,255,255,.25)}
.browser-header-only :deep(button:hover:not(:disabled)),.browser-header-only :deep(.reload-control.refresh-button[type=button]:hover:not(:disabled)){background:rgba(195,242,246,.24);color:#377f9e}
.browser-header-only :deep(button:focus-visible),.browser-header-only .browser-toolbar input:focus-visible{outline:2px solid #087c8c;outline-offset:1px}
.browser-header-only .browser-toolbar{border-bottom-color:#3b7a8533}
.browser-header-only .browser-toolbar input{background:rgba(239,255,255,.10);color:#4b8eaa;border-color:rgba(76,137,148,.32);border-radius:0;text-shadow:0 1px 2px rgba(255,255,255,.25);color-scheme:light}
.browser-header-only .browser-toolbar input::placeholder{color:#6aa0b5}
.browser-header-only .browser-error{color:#631d28;background:#ffe9efcf;text-shadow:none}
.browser-window-sizes{display:flex;gap:4px;flex:none;-webkit-app-region:no-drag}
.browser-window-sizes button{width:auto;min-width:42px;height:24px;padding:0 7px;font-size:11px;white-space:nowrap}
.browser-toolbar{display:flex;align-items:center;gap:5px;padding:7px 9px;border-bottom:1px solid #2c4055;flex:none}
.browser-toolbar button{padding:5px 9px;flex:none}.browser-toolbar input{flex:1;min-width:60px;background:#080f1b;color:#e2ecf8;border:1px solid #375067;border-radius:3px;padding:6px 9px;font:inherit}
.browser-page-title{margin:0;padding:3px 10px;font-size:11px;color:#9eb4c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
.browser-page-title.browser-loading{color:#fff;background:#17334b;font-weight:600}
.browser-error{margin:0;padding:6px 10px;flex:none}.browser-surface{flex:1;min-height:0}
/* AI解析を追加した操作欄も、狭い窓では折り返してnative本文へ高さを返す。 */
@container browser-panel (max-width:900px){
 .browser-panel:not(.browser-header-only) :deep(.panel-brand){height:auto;min-height:31px;grid-template-columns:minmax(0,1fr);padding:4px;gap:4px}
 .browser-panel:not(.browser-header-only) :deep(.panel-brand>strong){grid-column:1;grid-row:1}
 .browser-panel:not(.browser-header-only) :deep(.panel-brand>.connection-label){grid-column:1;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;gap:4px;white-space:normal}
 .browser-panel:not(.browser-header-only) :deep(.panel-brand>.window-actions){grid-column:1;grid-row:3;justify-self:start;max-width:100%;flex-wrap:wrap}
}
/* 幅800 DIPを高倍率で使う時も、操作列を切らず高さの測定でnative窓へ返す。 */
@container browser-header (max-width:640px){
 .browser-header-only :deep(.panel-brand){grid-template-columns:minmax(0,1fr);gap:4px}
 .browser-header-only :deep(.panel-brand>strong){grid-column:1;grid-row:1}
 .browser-header-only :deep(.panel-brand>.connection-label){grid-column:1;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;gap:4px;white-space:normal}
 .browser-header-only :deep(.panel-brand>.window-actions){grid-column:1;grid-row:3;max-width:100%;flex-wrap:wrap}
 .browser-header-only .browser-window-sizes,.browser-header-only .browser-toolbar{flex-wrap:wrap}
}
</style>
<style>
html.browser-header-document,html.browser-header-document body,html.browser-header-document #app{background:transparent!important;overflow:hidden}
</style>
