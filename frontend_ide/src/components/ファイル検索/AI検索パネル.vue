<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import RefreshButton from '../共通表示/再読込ボタン.vue';
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
const props=defineProps({root:String});
const emit=defineEmits(['result','search']);
const query=ref(''),job=shallowRef(null),busy=ref(false),message=ref(''),copyMessage=ref('');
const history=ref([]),selectedId=ref(''),historyBusy=ref(false),historyError=ref(''),deleting=ref(null),showHistory=ref(false);
let historyRun=0,historyController;
const selectedKey=()=>`aidiy_ide:ai-history-selected:${props.root}`;
function remember(id){selectedId.value=id;try{localStorage.setItem(selectedKey(),id);}catch{}}
async function historyRequest(suffix='',options={}){
  const response=await fetch('/api/ai-search/history'+suffix,{...options,signal:AbortSignal.any([historyController.signal,AbortSignal.timeout(12000)])});
  const value=await response.json();if(!response.ok)throw Error(value.error||'検索履歴を読み取れませんでした。');return value;
}
async function loadHistory(restore=false){
  const run=++historyRun;historyController?.abort();historyController=new AbortController();historyBusy.value=true;historyError.value='';
  try{
    const value=await historyRequest();if(run!==historyRun)return;history.value=value.entries;
    if(restore&&!busy.value){
      let saved='';try{saved=localStorage.getItem(selectedKey())||'';}catch{}
      const entry=history.value.find(item=>item.id===saved)||history.value[0];
      if(entry){const result=await historyRequest('?'+new URLSearchParams({id:entry.id}));if(run!==historyRun||busy.value)return;remember(entry.id);emit('result',result,false);}
    }
  }catch(error){if(run===historyRun)historyError.value=error.message;}
  finally{if(run===historyRun)historyBusy.value=false;}
}
async function selectHistory(entry){
  if(busy.value||historyBusy.value)return;
  emit('search');
  const run=++historyRun;historyController?.abort();historyController=new AbortController();historyBusy.value=true;historyError.value='';
  try{
    const result=await historyRequest('?'+new URLSearchParams({id:entry.id}));if(run!==historyRun)return;
    stop();job.value=null;message.value='';query.value=entry.query;remember(entry.id);deleting.value=null;showHistory.value=false;emit('result',result);
  }catch(error){if(run===historyRun)historyError.value=error.message;}
  finally{if(run===historyRun)historyBusy.value=false;}
}
async function deleteHistory(){
  if(!deleting.value||busy.value||historyBusy.value)return;
  const id=deleting.value.id,run=++historyRun;historyController?.abort();historyController=new AbortController();historyBusy.value=true;historyError.value='';
  try{
    await historyRequest('?'+new URLSearchParams({id}),{method:'DELETE'});if(run!==historyRun)return;
    history.value=history.value.filter(entry=>entry.id!==id);deleting.value=null;
    if(selectedId.value===id){remember('');job.value=null;message.value='';emit('result',null);}
  }catch(error){if(run===historyRun)historyError.value=error.message;}
  finally{if(run===historyRun)historyBusy.value=false;}
}
const historyDate=value=>new Date(value).toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
let generation=0,timer,controller;
function stop(){++generation;clearTimeout(timer);controller?.abort();busy.value=false;}
async function request(url,options={}){
  controller=new AbortController();
  const response=await fetch(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12_000)])});
  const value=await response.json();if(!response.ok)throw Error(value.error||'結果を確認できませんでした。');return value;
}
function accept(value,run){
  if(run!==generation)return;
  job.value=value;
  if(value.status==='complete'){
    busy.value=false;message.value=`${value.result.files.length}件の関連ファイルを確認しました。`;
    remember(value.result.id);emit('result',value.result);void loadHistory();return;
  }
  if(value.status!=='waiting') {busy.value=false;message.value=value.message;return;}
  message.value='最大5分間、結果ファイルを確認しています。';
  timer=setTimeout(()=>check(run),Math.max(100,Math.min(2000,value.deadline-Date.now())));
}
async function check(run){
  try{accept(await request('/api/ai-search?'+new URLSearchParams({id:job.value.id})),run);}
  catch(error){if(run===generation){busy.value=false;message.value=error.message;}}
}
async function search(){
  if(!query.value.trim())return;
  emit('search');
  stop();const run=generation;job.value=null;busy.value=true;message.value='AIエージェントへ依頼しています。';copyMessage.value='';
  ++historyRun;historyController?.abort();historyBusy.value=false;deleting.value=null;showHistory.value=false;
  try{accept(await request('/api/ai-search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:query.value})}),run);}
  catch(error){if(run===generation){busy.value=false;message.value=error.message;}}
}
function recheck(){if(!job.value)return;emit('search');stop();busy.value=true;void check(generation);}
async function copy(){try{await navigator.clipboard.writeText(job.value.prompt);copyMessage.value='依頼文をコピーしました。';}catch{copyMessage.value='下の依頼文を選択してコピーしてください。';}}
onMounted(()=>loadHistory(true));
onBeforeUnmount(()=>{stop();++historyRun;historyController?.abort();});
</script>
<template>
  <section class="ai-search-panel" aria-label="AI検索">
    <div class="ai-history-header"><strong>AI検索</strong><button type="button" :aria-expanded="showHistory" @click="showHistory=!showHistory;deleting=null;if(showHistory)loadHistory()">{{ showHistory?'検索へ戻る':`履歴 (${history.length})` }}</button></div>
    <p v-if="historyError" role="alert">{{ historyError }} <RefreshButton :disabled="historyBusy" :busy="historyBusy" title="AI検索履歴を再読込" @click="loadHistory()">再読込</RefreshButton></p>
    <section v-if="showHistory" class="ai-search-history" aria-label="このプロジェクトのAI検索履歴">
      <p v-if="historyBusy" role="status">履歴を読み込んでいます…</p>
      <p v-else-if="!history.length">このプロジェクトに検索履歴はありません。</p>
      <div v-for="entry in history" :key="entry.id" class="ai-history-row" :class="{active:selectedId===entry.id}">
        <button class="ai-history-open" :title="entry.query" :disabled="busy||historyBusy" :aria-pressed="selectedId===entry.id" @click="selectHistory(entry)"><span>{{ entry.title || entry.query }}</span><small>{{ historyDate(entry.createdAt) }} · {{ entry.count }}件</small></button>
        <button class="ai-history-delete" :disabled="busy||historyBusy" :aria-label="`${entry.title || entry.query} の履歴を削除`" @click="deleting=entry">削除</button>
      </div>
      <div v-if="deleting" class="ai-history-confirm" role="alertdialog" aria-label="検索履歴の削除確認"><p>「{{ deleting.title || deleting.query }}」の検索履歴を削除しますか？</p><button :disabled="historyBusy" @click="deleteHistory">削除する</button><button :disabled="historyBusy" @click="deleting=null">取消</button></div>
    </section>
    <div v-show="!showHistory">
    <form @submit.prevent="search">
      <label>関連するファイルを探す<textarea v-model="query" maxlength="2000" rows="2" placeholder="例: 認証機能に関わるファイル" /></label>
      <button type="submit" :disabled="!query.trim()">{{ busy?'新しく検索':'AI検索を依頼' }}</button>
    </form>
    <p class="ai-search-help">AIエージェントに依頼し、最大5分間、結果ファイルを確認します。</p>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="job">
      <p class="ai-result-path">{{ job.path }}</p>
      <p v-if="!busy&&job.status!=='complete'">エージェントの実行状況をご確認ください。未実行の場合は、依頼文を使ってエージェントを実行してください。前回のAI検索軌跡は保持します。</p>
      <div class="ai-search-actions"><button type="button" @click="copy">依頼文をコピー</button><RefreshButton :disabled="busy" :busy="busy" title="AI検索の結果を再確認" @click="recheck">結果を再確認</RefreshButton></div>
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
      <details><summary>依頼文</summary><textarea readonly :value="job.prompt" rows="5" aria-label="AI検索の依頼文" /></details>
    </template>
    </div>
  </section>
</template>
