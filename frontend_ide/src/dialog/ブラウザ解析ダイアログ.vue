<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {notifyBrowserAnalysisChanged} from '../components/ブラウザ/ブラウザ解析状態.js';
const props=defineProps({context:{type:Object,required:true},nativeWindow:Boolean});
const emit=defineEmits(['close']);
const dialog=ref(),loading=ref(true),starting=ref(false),error=ref(''),sourceError=ref(''),opening=ref(''),result=ref(null),job=ref(null);
const sourceName=path=>path.split('/').at(-1);
const sourceFolder=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
const busy=computed(()=>job.value?.status==='waiting');
const controller=new AbortController();let timer,closed=false,revision=0;
async function request(method='GET'){
 const response=await fetch('/api/browser-analysis'+(method==='GET'?'?'+new URLSearchParams({url:props.context.url}):''),{method,cache:'no-store',headers:method==='POST'?{'content-type':'application/json'}:undefined,body:method==='POST'?JSON.stringify({url:props.context.url,title:props.context.title}):undefined,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
 const value=await response.json();if(!response.ok)throw Error(value.error||'ブラウザの解析結果を取得できません。');return value;
}
async function load(){
 if(closed||starting.value)return;
 clearTimeout(timer);const current=++revision;
 try{
  const value=await request();if(closed||current!==revision)return;
  result.value=value.result;job.value=value.job;error.value='';
  if(busy.value)timer=setTimeout(()=>load(),2000);
 }catch(e){if(!closed&&current===revision)error.value=e.message;}
 finally{if(!closed&&current===revision)loading.value=false;}
}
async function analyze(){
 if(closed||loading.value||starting.value||busy.value)return;
 clearTimeout(timer);++revision;starting.value=true;error.value='';
 try{
  const value=await request('POST');if(closed)return;
  job.value=value;timer=setTimeout(()=>load(),500);
 }catch(e){if(!closed)error.value=e.message;}
 finally{notifyBrowserAnalysisChanged(props.context.url);if(!closed)starting.value=false;}
}
async function selectSource(file){
 if(closed||opening.value||!props.context.canSelectSource||!result.value)return;
 opening.value=file.path;sourceError.value='';
 try{
  const value=await window.aidiyWindow.browserAction('analysis-select-source',{url:props.context.url,id:result.value.id,path:file.path});
  if(!value?.ok)throw Error(value?.error||'IDEでソースを選択できません。');
 }catch(e){if(!closed)sourceError.value=e.message;}
 finally{if(!closed)opening.value='';}
}
function close(){if(starting.value||closed)return;closed=true;++revision;clearTimeout(timer);controller.abort();dialog.value?.close();emit('close');}
onMounted(()=>{dialog.value.showModal();void load();});
onBeforeUnmount(()=>{closed=true;++revision;clearTimeout(timer);controller.abort();dialog.value?.close();});
</script>
<template>
 <Teleport to="body">
  <dialog ref="dialog" class="browser-analysis-dialog" :class="{'browser-analysis-native':nativeWindow}" aria-labelledby="browser-analysis-title" @keydown.stop @cancel.prevent="close">
   <header><h2 id="browser-analysis-title">Browser AI解析</h2><button aria-label="Browser AI解析を閉じる" :disabled="starting" @click="close"><span class="close-icon" aria-hidden="true"></span></button></header>
   <section class="browser-analysis-target" aria-label="解析対象">
    <h3>表示中のURL</h3><strong>{{ context.title||'表示中のページ' }}</strong><p class="browser-analysis-url">{{ context.url }}</p>
    <p :title="context.projectPath">プロジェクト: {{ context.baseName }}<small>{{ context.projectPath }}</small></p>
    <p>このURLに対応するプロジェクト内の関連ソースを解析します。ソースは変更しません。</p>
    <p v-if="context.canSelectSource" class="browser-analysis-hint">IDE連携中です。ソース欄をクリックすると、起動元のIDEのファイルビューアに表示します。</p>
    <template v-else>
     <p class="browser-analysis-hint">IDE未連携です。関連ソースは表示のみで、IDEのファイルは開きません。</p>
     <p v-if="context.ideRunning" class="browser-analysis-hint browser-analysis-viewer-available" role="status">同じプロジェクトのIDEが起動中です。{{ context.viewerAvailable?'IDEの「Browser」からこのURLを開くと、ビューアー連携できます。':'IDEでオンライン利用を開始し、tools接続後に「Browser」からこのURLを開くと、ビューアー連携できます。' }}</p>
     <p v-else class="browser-analysis-hint">ビューアー連携するには、同じプロジェクトのIDEでオンライン利用を開始し、IDEの「Browser」から開いてください。</p>
    </template>
    <div class="browser-analysis-actions"><button :disabled="loading||starting||busy" @click="analyze">{{ starting?'依頼中…':busy?'解析中…':result?'再解析':'解析を実行' }}</button><span>最大5分間、結果を確認します。別ページへ移動しても解析を続け、結果はこのURLに保存します。</span></div>
    <p v-if="busy" class="browser-analysis-hint">閉じて別のページを閲覧できます。元のURLに戻り「AI解析」を開くと、進行状況・結果を確認できます。</p>
    <p v-if="job" role="status">{{ job.message||(busy?'解析結果を待っています…':'') }}</p>
    <div v-if="job&&!busy&&job.status!=='complete'"><button @click="load">結果を再確認</button><details><summary>エージェントへの依頼文</summary><textarea readonly :value="job.prompt" rows="5" aria-label="Browser解析エージェントへの依頼文" /></details></div>
    <p v-if="error" class="error" role="alert">{{ error }} <button :disabled="starting" @click="load">再確認</button></p>
   </section>
   <p v-if="loading">保存済みの解析を読み込んでいます…</p>
   <template v-else-if="result">
    <div class="browser-analysis-result-title"><h3>関連ソース</h3><time>{{ new Date(result.createdAt).toLocaleString('ja-JP') }}</time></div>
    <p v-if="busy">前回の解析結果を表示しています。</p>
    <div v-if="result.files?.length" class="browser-analysis-sources" role="region" aria-label="関連ソースの表（縦横にスクロールできます）" tabindex="0">
     <table><thead><tr><th scope="col">役割</th><th scope="col">関連ソース</th><th scope="col">概要</th></tr></thead>
      <tbody><tr v-for="file in result.files" :key="file.path">
       <td class="browser-analysis-role">{{ file.role }}</td>
       <td><button v-if="context.canSelectSource" class="browser-analysis-source" :disabled="!!opening" :title="file.path+' をIDEで表示'" :aria-label="file.path+' をIDEで表示'" @click="selectSource(file)"><strong>{{ sourceName(file.path) }}</strong><small v-if="sourceFolder(file.path)">{{ sourceFolder(file.path) }}</small><span v-if="opening===file.path">選択中…</span></button><span v-else class="browser-analysis-source-path" :title="file.path"><strong>{{ sourceName(file.path) }}</strong><small v-if="sourceFolder(file.path)">{{ sourceFolder(file.path) }}</small></span></td>
       <td class="browser-analysis-source-summary">{{ file.summary }}</td>
      </tr></tbody>
     </table>
    </div>
    <p v-else>このプロジェクト内の関連ソースは確認できませんでした。</p>
    <p v-if="sourceError" class="error" role="alert">{{ sourceError }}</p>
   </template>
   <p v-else>このURLの解析記録はまだありません。</p>
  </dialog>
 </Teleport>
</template>
<style scoped>
.browser-analysis-dialog{width:min(1000px,92vw);max-height:86vh;box-sizing:border-box;overflow:auto;padding:12px;background:#101824;color:#dce6f4;border:1px solid #49627d;border-radius:0;font-size:13px;box-shadow:0 16px 60px #0009}
.browser-analysis-dialog::backdrop{background:#0009}.browser-analysis-dialog header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:26px;margin:0;padding:0;flex:none}.browser-analysis-dialog h2{margin:0;font-size:14px;line-height:20px}.browser-analysis-dialog header button{width:24px;height:24px;padding:0;flex:none;display:grid;place-items:center}
.browser-analysis-target{margin-top:8px;padding:12px;background:#0b121d;border:1px solid #2a3a50;border-radius:0}.browser-analysis-target p{margin:8px 0}.browser-analysis-target small{display:block;color:#9cafc5;overflow-wrap:anywhere}.browser-analysis-url{overflow-wrap:anywhere;color:#a8d8fb}
.browser-analysis-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:12px}.browser-analysis-actions span,.browser-analysis-hint{font-size:12px;color:#aabbd0}.browser-analysis-result-title{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;margin:16px 0 10px}.browser-analysis-result-title h3{margin:0}.browser-analysis-result-title time{font-size:11px;color:#aabbd0}
.browser-analysis-sources{overflow:auto;max-width:100%;max-height:min(65vh,720px);border:1px solid #49627d;scrollbar-color:#61758e #101824;scrollbar-width:auto;overscroll-behavior-x:contain}
.browser-analysis-sources:focus-visible{outline:2px solid #9edfff;outline-offset:2px}
.browser-analysis-sources table{border-collapse:separate;border-spacing:0;width:100%;min-width:680px;table-layout:fixed;font-size:13px;line-height:1.7}
.browser-analysis-sources th,.browser-analysis-sources td{text-align:left;vertical-align:top;padding:12px;border-right:1px solid #35465c;border-bottom:1px solid #35465c;overflow-wrap:anywhere;word-break:normal;white-space:pre-wrap}
.browser-analysis-sources th{position:sticky;top:0;z-index:1;background:#21334a;color:#f0f6ff;font-weight:700;box-shadow:0 1px 0 #61758e}
.browser-analysis-sources th:first-child{width:7em}.browser-analysis-sources th:nth-child(2){width:32%}
.browser-analysis-sources td{background:#0b121d}.browser-analysis-sources tbody tr:nth-child(even) td{background:#142033}.browser-analysis-sources tbody tr:hover td,.browser-analysis-sources tbody tr:focus-within td{background:#1d3047}
.browser-analysis-sources tr>:last-child{border-right:0}.browser-analysis-sources tr:last-child td{border-bottom:0}.browser-analysis-role{color:#bed5f0}
.browser-analysis-source{display:block;width:100%;border:0;background:none;color:#9edfff;padding:0;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer;font:inherit}
.browser-analysis-source strong{text-decoration:underline;text-underline-offset:3px}.browser-analysis-source strong,.browser-analysis-source-path strong{display:block;font-weight:600}
.browser-analysis-source small,.browser-analysis-source-path small{display:block;margin-top:4px;font-size:12px;line-height:1.6;color:#adbed3;overflow-wrap:anywhere}
.browser-analysis-source:hover{color:#fff}.browser-analysis-source:focus-visible{outline:2px solid #9edfff;outline-offset:4px}.browser-analysis-source:disabled{opacity:.65;cursor:wait}
.browser-analysis-dialog textarea{box-sizing:border-box;width:100%;background:#080f1b;color:#dce6f4;margin-top:8px}.browser-analysis-dialog details{margin-top:10px}
.browser-analysis-dialog.browser-analysis-native{width:100%;max-width:none;height:100dvh;max-height:none;margin:0;border-radius:0}
.browser-analysis-native>header{-webkit-app-region:drag}.browser-analysis-native>header button{-webkit-app-region:no-drag}
</style>
