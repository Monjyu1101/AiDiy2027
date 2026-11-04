<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import RefreshButton from '../共通表示/再読込ボタン.vue';
import { ref, computed, inject, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { loadMonaco, monacoLanguage } from '../ファイル閲覧/コード表示.js';
import { searchReference, fileDraftReference } from '../ファイル閲覧/ファイル参照.js';
import { copyBrowserText, fullFilePath } from '../ファイル閲覧/ファイル操作.js';
import {createViewerActivity} from '../ファイル閲覧/閲覧待機.js';
import {openBrowser} from '../ブラウザ/起動.js';
import {MEDIA_PATTERN} from '../../../viewer/media-types.mjs';
const browserAvailable=inject('browserAvailable',false);
// pinned: 右側のプレビューではなく、ピン留めした独立ウィンドウの中身として全面に表示する
const props=defineProps({file:Object,root:String,pinned:Boolean,pinBusy:Boolean});const emit=defineEmits(['close','pin','activity']);
const openAnalysis=inject('openFileAnalysis',null),openDraft=inject('openFileDraft',null);
const openHistory=inject('openFileHistory',null),hasHistory=ref(false),historyError=ref('');
const data=ref(),error=ref(''),host=ref(),fallback=ref(false),copied=ref(false),stamp=ref(Date.now()),reloading=ref(false);
const actionError=ref(''),actionBusy=ref(''),canOpenFile=typeof window.aidiyWindow?.openFile==='function';
let actionRevision=0,copyTimer;
let controller,editor,scrollSubscription,revision=0,frameCleanup;
const viewer=ref(),fallbackHost=ref(),fallbackMatch=ref(),jump=ref(null),jumpNote=ref('');
const fallbackParts=computed(()=>{const text=data.value?.text||'',at=jump.value;return at&&!at.stale?{before:text.slice(0,at.start),match:text.slice(at.start,at.start+at.length),after:text.slice(at.start+at.length)}:null;});
const userActivity=createViewerActivity(()=>emit('activity'));
const activity=event=>userActivity.handle(event);
const pointerActivity=activity;
// Officeなど同一オリジンの文書内イベントも拾う。別オリジンのプレビューは通知を受け取る。
function bindFrame(event){if(event.target.tagName!=='IFRAME')return;frameCleanup?.();frameCleanup=null;try{const doc=event.target.contentDocument;if(!doc)return;const types=['pointerdown','click','keydown','wheel','touchstart','touchmove','scroll','change'];for(const type of types)doc.addEventListener(type,activity,{capture:true,passive:true});doc.addEventListener('pointermove',pointerActivity,true);frameCleanup=()=>{for(const type of types)doc.removeEventListener(type,activity,true);doc.removeEventListener('pointermove',pointerActivity,true);};}catch{}}
function frameActivity(event){const frame=viewer.value?.querySelector('iframe');if(frame&&event.source===frame.contentWindow&&event.data?.type==='aidiy-ide-viewer-activity'&&event.data.userInput===true)emit('activity');}
let activityWindow;
function bindActivityWindow(){activityWindow?.removeEventListener('message',frameActivity);activityWindow=viewer.value?.ownerDocument?.defaultView||window;activityWindow.addEventListener('message',frameActivity);}
onMounted(bindActivityWindow);
watch(()=>props.pinned,()=>nextTick(bindActivityWindow));
// HTML / SVG / Vue / Markdown はコードとプレビューを切り替える。文書は別オリジンで表示する。
// 最後に選んだ方を種類ごとに覚える（SVG / Markdownは表示が既定）。
// 音声・動画はビューア内で再生せず、「ブラウザ」で開いて再生する。
const mediaFile=computed(()=>MEDIA_PATTERN.test(props.file?.name||''));
const previewKind=computed(()=>/\.(md|markdown)$/i.test(props.file?.name||'')?'markdown':/\.html?$/i.test(props.file?.name||'')?'html':/\.svg$/i.test(props.file?.name||'')?'svg':/\.vue$/i.test(props.file?.name||'')?'vue':'');
const modeKey=kind=>`aidiy-ide-preview-mode:${kind}`;
const readMode=kind=>{try{const saved=localStorage.getItem(modeKey(kind));if(saved==='view'||saved==='code')return saved;}catch{}return ['svg','markdown'].includes(kind)?'view':'code';};
const mode=ref(previewKind.value?readMode(previewKind.value):'code'),preview=ref(),routeIndex=ref(0);
let previewRun=0;
async function loadPreview(){
  const run=++previewRun;preview.value=null;
  try{const response=await fetch('/api/preview?'+new URLSearchParams({path:props.file.path}),{cache:'no-store'});if(!response.ok)throw Error(await response.text());const value=await response.json();if(run===previewRun)preview.value=value;}
  catch(e){if(run===previewRun)preview.value={error:e.message};}
}
function setMode(next){mode.value=next;try{localStorage.setItem(modeKey(previewKind.value),next);}catch{}if(next==='view')void loadPreview();}
const previewUrl=computed(()=>preview.value?.url||preview.value?.routes?.[routeIndex.value]?.url||'');
const params=value=>new URLSearchParams(value).toString();
function disposeEditor(){scrollSubscription?.dispose();scrollSubscription=null;const previous=editor;editor=undefined;const model=previous?.getModel();previous?.dispose();model?.dispose();}
async function checkHistory(file,run,signal){
  try{const response=await fetch('/api/file-history?'+new URLSearchParams({path:file.path}),{signal,cache:'no-store'});const value=await response.json();if(!response.ok)throw Error(value.error);if(run===revision)hasHistory.value=value.versions.length>0;}
  catch(e){if(run===revision&&e.name!=='AbortError')historyError.value='更新履歴を確認できませんでした。↺で再確認できます。';}
}
// ファイルを読み込む。リフレッシュでも同じ処理を使い、キャッシュを使わず最新の内容を取り直す。
async function revealMatch(file,run){
  jump.value=searchReference(data.value?.text||'',file);
  if(!jump.value)return;
  if(jump.value.stale){jumpNote.value='検索後に内容が変わった可能性があります。検索し直して位置を確認してください。';return;}
  const at=jump.value;
  jumpNote.value=`検索結果: ${at.line}行 ${at.column}列`;
  if(editor){editor.setSelection({startLineNumber:at.line,startColumn:at.column,endLineNumber:at.line,endColumn:at.endColumn});editor.revealLineInCenter(at.line);}
  else{await nextTick();if(run===revision)fallbackMatch.value?.scrollIntoView({block:'center'});}
}
async function load(file){
  const run=++revision;controller?.abort();controller=new AbortController();disposeEditor();data.value=null;error.value='';fallback.value=false;hasHistory.value=false;historyError.value='';jump.value=null;jumpNote.value='';
  if(!file)return;
  try{
    const response=await fetch('/api/file?'+new URLSearchParams({path:file.path}),{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw Error(response.status===404?'ファイルが移動・削除されたため開けません。最新の一覧や検索を確認してください。':await response.text());const value=await response.json();if(run!==revision)return;
    data.value=value;
    if(value.tooLarge){error.value='表示できるサイズの上限を超えています。';return;}
    if(value.kind==='text'){
      if(openHistory)void checkHistory(file,run,controller.signal);
      await nextTick();const monaco=await loadMonaco().catch(()=>null);if(run!==revision)return;
      if(!monaco){fallback.value=true;await revealMatch(file,run);return;}
      const fontSize=parseFloat(getComputedStyle(host.value).getPropertyValue('--file-font-size'))||10;
      editor=monaco.editor.create(host.value,{value:value.text,language:monacoLanguage(file.name),theme:'aidiy-space',readOnly:true,domReadOnly:true,automaticLayout:true,fontSize,wordWrap:'on',minimap:{enabled:!props.pinned},scrollBeyondLastLine:false,contextmenu:false});
      scrollSubscription=editor.onDidScrollChange(event=>{if(event.scrollTopChanged||event.scrollLeftChanged)userActivity.scroll();});
      await revealMatch(file,run);
    }
  }catch(e){if(run===revision)error.value=e.message;}
}
watch(()=>props.file,file=>{previewRun++;stamp.value=Date.now();routeIndex.value=0;preview.value=null;mode.value=file?.line?'code':previewKind.value?readMode(previewKind.value):'code';void load(file);if(mode.value==='view')void loadPreview();},{immediate:true});
// 画像・Office文書は URL の v を変えて読み直させる。テキストは Monaco を作り直す。表示中のページは iframe を作り直す。
async function refresh(){if(reloading.value)return;reloading.value=true;stamp.value=Date.now();try{await Promise.all([load(props.file),mode.value==='view'?loadPreview():null]);}finally{reloading.value=false;}}
const fullPath=computed(()=>fullFilePath(props.root||'',props.file?.path||''));
function resetActions(){actionRevision++;clearTimeout(copyTimer);copied.value=false;actionBusy.value='';actionError.value='';}
watch(()=>[props.file,props.root],resetActions,{flush:'sync'});
async function copy(){
  if(actionBusy.value||!props.file?.path)return;
  const run=++actionRevision,path=props.file.path,text=fullPath.value;
  clearTimeout(copyTimer);copied.value=false;actionBusy.value='copy';actionError.value='';
  try{
    if(typeof window.aidiyWindow?.copyFilePath==='function'){
      const result=await window.aidiyWindow.copyFilePath(path);
      if(!result?.ok)throw Error(result?.error||'パスをコピーできませんでした。');
    }else await copyBrowserText(text,{isCurrent:()=>run===actionRevision});
    if(run!==actionRevision)return;
    copied.value=true;copyTimer=setTimeout(()=>{if(run===actionRevision)copied.value=false;},1500);
  }catch(e){if(run===actionRevision)actionError.value='パスをコピーできませんでした。表示されたパスを選択してコピーしてください。';}
  finally{if(run===actionRevision)actionBusy.value='';}
}
async function openFile(){
  if(!canOpenFile||actionBusy.value||!props.file?.path)return;
  const run=++actionRevision,path=props.file.path;clearTimeout(copyTimer);copied.value=false;actionBusy.value='open';actionError.value='';
  try{const result=await window.aidiyWindow.openFile(path);if(!result?.ok&&!result?.cancelled)throw Error(result?.error||'関連付けられたアプリで開けませんでした。');}
  catch(e){if(run===actionRevision)actionError.value=e.message||'関連付けられたアプリで開けませんでした。';}
  finally{if(run===actionRevision)actionBusy.value='';}
}
async function browse(){
  if(actionBusy.value||(previewKind.value!=='html'&&!mediaFile.value))return;
  const run=++actionRevision;actionBusy.value='browser';actionError.value='';
  try{const result=await openBrowser(props.file.path);if(!result?.ok)throw Error(result?.error||'ブラウザを開けませんでした。');}
  catch(e){if(run===actionRevision)actionError.value=e.message;}
  finally{if(run===actionRevision)actionBusy.value='';}
}
function selectedReference(){
  if(mode.value==='view'||data.value?.kind!=='text')return null;
  const selection=editor?.getSelection();
  if(selection&&!selection.isEmpty())return{text:editor.getModel().getValueInRange(selection),startLine:selection.startLineNumber,endLine:selection.endLineNumber};
  const dom=(viewer.value?.ownerDocument?.defaultView||window).getSelection?.();
  if(!fallbackHost.value||!dom?.rangeCount||dom.isCollapsed)return null;
  const range=dom.getRangeAt(0);
  if(!fallbackHost.value.contains(range.startContainer)||!fallbackHost.value.contains(range.endContainer))return null;
  const prefix=range.cloneRange();prefix.selectNodeContents(fallbackHost.value);prefix.setEnd(range.startContainer,range.startOffset);
  const startLine=prefix.toString().split(/\r\n|\r|\n/).length,text=range.toString();
  return{text,startLine,endLine:startLine+text.split(/\r\n|\r|\n/).length-1};
}
function handoff(){
  if(!openDraft||!props.root)return;
  try{const selection=selectedReference();openDraft({projectPath:props.root,path:props.file.path,name:props.file.name,text:fileDraftReference(props.file,selection),selection:!!selection});}
  catch(e){error.value=e.message;}
}
onBeforeUnmount(()=>{userActivity.dispose();resetActions();revision++;previewRun++;controller?.abort();disposeEditor();frameCleanup?.();activityWindow?.removeEventListener('message',frameActivity);activityWindow=null;});
defineExpose({moved:bindActivityWindow});
</script>
<template>
  <aside ref="viewer" :class="pinned?'viewer-pinned':'viewer-popup'" data-component="FileViewer" @pointerdown.capture="activity" @pointermove.capture="pointerActivity" @click.capture="activity" @keydown.capture="activity" @wheel.capture.passive="activity" @touchstart.capture.passive="activity" @touchmove.capture.passive="activity" @scroll.capture.passive="activity" @change.capture="activity" @load.capture="bindFrame"><header><span :title="file.path">{{ file.name }}</span>
      <span v-if="previewKind" class="viewer-mode" role="group" aria-label="表示の切り替え"><button :aria-pressed="mode==='code'" @click="setMode('code')">コード</button><button :aria-pressed="mode==='view'" @click="setMode('view')">{{ previewKind==='markdown'?'プレビュー':'表示' }}</button></span>
      <button v-if="previewKind==='html'||mediaFile" class="viewer-browser" :disabled="!!actionBusy||!browserAvailable" :title="browserAvailable?'ブラウザで開く':'tools接続中のみ起動できます'" @click="browse">{{ actionBusy==='browser'?'起動中…':'ブラウザ' }}</button>
      <button v-if="hasHistory&&openHistory" class="viewer-history" @click="openHistory(file,root)">更新履歴</button>
      <button v-if="openAnalysis" class="viewer-analysis" title="AiDiy分析" aria-label="AiDiy分析" @click="openAnalysis(file,root)"><img :src="'/development/AiDiy.png'" alt="">AiDiy分析</button>
      <button v-if="openDraft" class="viewer-handoff" :disabled="!root" title="このファイルまたは選択範囲を起動中のCode / Liveの下書きへ追加" @pointerdown.prevent @click="handoff">Code / Liveへ</button>
      <!-- 右端は ↺ 📌 × の順。ページ内の📌で別ウィンドウを開く。 -->
      <RefreshButton class="viewer-refresh" title="最新の内容に更新" aria-label="最新の内容に更新" :disabled="reloading" :busy="reloading" @click="refresh" /><button v-if="!pinned" class="viewer-pin panel-detach-pin" :aria-pressed="false" :disabled="pinBusy" title="別ウィンドウで開く" aria-label="ファイルを別ウィンドウで開く" @click="emit('pin',file)"><span aria-hidden="true">📌</span></button><button v-if="!pinned" class="viewer-close" aria-label="プレビューを閉じる" @click="emit('close')"><span class="close-icon" aria-hidden="true"></span></button></header>
    <div class="viewer-path-row"><p class="viewer-path" :title="fullPath">{{ fullPath }}</p><div class="viewer-path-actions"><button class="viewer-copy" :disabled="!!actionBusy" aria-live="polite" @click="copy">{{ copied?'コピーしました':'パスをコピー' }}</button><button v-if="canOpenFile" class="viewer-open-app" :disabled="!!actionBusy" @click="openFile">{{ actionBusy==='open'?'開いています…':'アプリで開く' }}</button></div></div><div class="viewer-meta">{{ data?.kind }} · {{ data?.size?.toLocaleString() }} B · {{ new Date(stamp).toLocaleTimeString('ja-JP') }} 読込</div>
    <p v-if="actionError" class="error viewer-action-error" role="status">{{ actionError }}</p>
    <p v-if="file.unlisted" class="input-hint">現在の一覧に含まれない検索結果を直接表示しています。</p>
    <p v-if="jumpNote" class="input-hint" role="status">{{ jumpNote }}</p>
    <p v-if="historyError" class="input-hint">{{ historyError }}</p>
    <p v-if="error" class="error">{{ error }}</p><p v-else-if="!data">読み込み中…</p>
    <div v-else class="viewer-content"><iframe v-if="data.kind==='office'&&!data.tooLarge" :key="file.path+stamp" :src="'/office.html?'+params({path:file.path,format:data.format,v:`${file.mtime}-${stamp}`})" sandbox="allow-scripts allow-same-origin" :title="file.name+' ビューア'"></iframe>
      <img v-else-if="data.kind==='image'&&!data.tooLarge" :src="'/api/raw?'+params({path:file.path,v:stamp})" :alt="file.name">
      <template v-else-if="data.kind==='text'">
        <!-- HTML/SVGはフォルダ構造を保った別サーバーで表示し、相対画像・CSS・SVG参照を解決する。IDEとは別オリジン。 -->
        <template v-if="mode==='view'">
          <p v-if="!preview" class="viewer-preview-note">表示を準備しています…</p>
          <p v-else-if="preview.error" class="viewer-preview-note">{{ preview.error }}</p>
          <template v-else>
            <label v-if="preview.routes?.length>1" class="viewer-route">画面 <select v-model.number="routeIndex"><option v-for="(route,i) in preview.routes" :key="route.path" :value="i">{{ route.path }}</option></select></label>
            <p v-if="previewKind==='vue'" class="viewer-preview-note">frontend_web の開発サーバーで、この部品を使う画面 {{ preview.routes[routeIndex]?.path }} を表示しています（ログイン画面が出たらログインしてください）。</p>
            <iframe :key="previewUrl+stamp" class="viewer-preview" :src="previewUrl" :sandbox="previewKind==='markdown'?'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox':previewKind==='vue'?'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads':'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock'" allow="autoplay; fullscreen" :title="file.name+' の表示'"></iframe>
          </template>
        </template>
        <div v-show="mode!=='view'" class="viewer-code"><p v-if="data.truncated" class="input-hint">先頭の一部を表示しています。</p><pre v-if="fallback" ref="fallbackHost"><template v-if="fallbackParts">{{ fallbackParts.before }}<mark ref="fallbackMatch">{{ fallbackParts.match }}</mark>{{ fallbackParts.after }}</template><template v-else>{{ data.text }}</template></pre><div v-else ref="host" class="monaco-host"></div></div>
      </template>
      <p v-else-if="mediaFile">音声・動画は「ブラウザ」で開いて再生できます。</p>
      <p v-else>この形式はプレビューできません。</p>
    </div>
  </aside>
</template>
