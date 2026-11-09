<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,inject,onMounted,onBeforeUnmount,nextTick} from 'vue';
import MarkdownIt from 'markdown-it';
import {normalizeDisplayUrls,isPageSource} from '../../viewer/表示URL.mjs';
import {openBrowser} from '../components/ブラウザ/起動.js';
const props=defineProps({file:Object,root:String});
const emit=defineEmits(['close']);
const dialog=ref(),input=ref(),loading=ref(true),saving=ref(false),error=ref(''),record=ref(null),job=ref(null),stale=ref(false);
const closeError=ref(''),keepEditingButton=ref();
const browserAvailable=inject('browserAvailable',false),openingUrl=ref(''),urlError=ref('');
const displayUrls=computed(()=>isPageSource(props.file.name)&&!['direct','none'].includes(record.value?.relatedSourceScope)?normalizeDisplayUrls(record.value?.displayUrls,{limit:60}).map(item=>({...item,evidence:record.value.displayUrls.find(value=>value.url===item.url)?.evidence||[]})):[]);
const scopeLabel=computed(()=>({page:'関連ソース: 利用画面まで（複数URL）',direct:'関連ソース: 1次レベル（直接の呼び出し元・呼び出し先）',none:'関連ソース探索なし（内容のみ）'}[record.value?.relatedSourceScope]||''));
const screenFile=computed(()=>isPageSource(props.file.name));
const example=/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?|heic|heif)$/i.test(props.file.name)
  ?'この画像を確認し、描かれている内容、構図・配色、画像内の文字、想定される用途を日本語で説明してください。実際に読み取れる情報と推測を区別し、確認できない部分は明記してください。画像や関連ファイルの変更は不要です。'
  :'このファイルの機能概要を日本語で説明してください。主な役割、主要な関数・処理の流れ、入出力、依存先や呼び出し元、読む際の注意点を整理し、根拠となる関数名や行番号も示してください。ソースの変更は不要です。';
const instruction=ref(example),busy=computed(()=>job.value?.status==='waiting'||!!job.value?.monitoring);
const markdown=new MarkdownIt({html:false,linkify:false,breaks:true});
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'画像');
const linkOpen=markdown.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return linkOpen(tokens,index,options,env,self);};
const rendered=computed(()=>markdown.render(record.value?.content||''));
const summaries=computed(()=>(record.value?.summaries||[]).map(item=>({...item,html:markdown.render(item.content||'')})));
const analyses=computed(()=>(record.value?.analyses||[]).map(item=>({...item,html:markdown.render(item.result?.content||'')})));
const relationLabel=value=>({caller:'呼び出し元',callee:'呼び出し先',page:'利用画面',related:'ページ関連の参照先'}[value]||'参照');
const controller=new AbortController();let timer,closed=false,loadRevision=0,instructionInitialized=false;
function monitor(delay=2000){clearTimeout(timer);if(!closed)timer=setTimeout(()=>load(),delay);}
function attemptLabel(attempt){
  if(attempt.status==='complete')return '結果保存済み'+(['preparing','configuring','requested'].includes(attempt.processState)?'（実行応答待ち）':attempt.processState==='cancel_requested'?'（停止要求済み・終了未確認）':attempt.processState==='failed'?'（実行要求は失敗）':'');
  if(attempt.processState==='cancel_requested')return '停止要求済み（終了未確認）';
  if(attempt.status==='invalid')return '結果JSONの確認待ち';
  if(attempt.status==='failed')return '有効な結果なし';
  return {preparing:'起動準備',configuring:'接続・設定確認',requested:'実行応答待ち',returned:'応答受信',failed:'実行要求失敗'}[attempt.processState]||'結果確認中';
}
async function request(method='GET',body) {
  const response=await fetch('/api/file-analysis'+(method==='GET'?'?'+new URLSearchParams({path:props.file.path}):''),{
    method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),cache:'no-store'});
  const value=await response.json();if(!response.ok)throw Error(value.error||'解析記録を取得できません。');return value;
}
async function load(initial=false) {
  if(closed||saving.value)return;
  clearTimeout(timer);const run=++loadRevision;
  try {
    const value=await request();if(closed||run!==loadRevision)return;
    record.value=value.result;job.value=value.job;stale.value=value.stale;error.value='';
    if(!instructionInitialized){if(initial||instruction.value===example)instruction.value=value.instruction||example;instructionInitialized=true;}
  }catch(e){if(!closed&&run===loadRevision)error.value=e.message;}
  finally{
    if(!closed&&run===loadRevision){loading.value=false;if(busy.value||error.value)monitor();}
  }
}
async function analyze() {
  if(closed||loading.value||busy.value||saving.value||!instruction.value.trim())return;
  clearTimeout(timer);const run=++loadRevision;
  saving.value=true;error.value='';
  try{const value=await request('POST',{path:props.file.path,instruction:instruction.value});if(closed||run!==loadRevision)return;job.value=value;monitor(500);}
  catch(e){if(!closed&&run===loadRevision){error.value=e.message;monitor();}}
  finally{if(!closed)saving.value=false;}
}
async function browse(url){
  if(closed||openingUrl.value||!screenFile.value||!displayUrls.value.some(item=>item.url===url))return;
  openingUrl.value=url;urlError.value='';
  try{const result=await openBrowser(props.file.path,undefined,window,url,true);if(!result?.ok)throw Error(result?.error||'ブラウザを開けませんでした。');}
  catch(e){if(!closed)urlError.value=e.message;}
  finally{if(!closed)openingUrl.value='';}
}
async function close() {
  if(saving.value||closed)return;
  // 初回取得に失敗したままの既定文では、未取得の保存済み指示を上書きしない。
  if(!loading.value&&(instructionInitialized||instruction.value!==example)){
    saving.value=true;error.value='';closeError.value='';
    try{await request('PUT',{path:props.file.path,instruction:instruction.value});}
    catch(e){closeError.value=e.message;return;}
    finally{
      saving.value=false;
      // 保存待ち中に発火したpollはload()で終了するため、失敗後は監視を再開する。
      if(closeError.value){monitor();await nextTick();keepEditingButton.value?.focus();}
    }
  }
  finishClose();
}
function finishClose() {
  if(closed||saving.value)return;
  closed=true;loadRevision++;clearTimeout(timer);controller.abort();
  dialog.value?.close();emit('close');
}
async function keepEditing() {
  closeError.value='';await nextTick();input.value?.focus();
}
const when=value=>new Date(value).toLocaleString('ja-JP');
onMounted(()=>{dialog.value.showModal();void load(true);});
onBeforeUnmount(()=>{closed=true;loadRevision++;clearTimeout(timer);controller.abort();dialog.value?.close();});
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="file-analysis-dialog" aria-labelledby="file-analysis-title" @keydown.stop @cancel.prevent="close">
      <header><h2 id="file-analysis-title">AI解析</h2><button aria-label="AI解析を閉じる" :disabled="saving" @click="close"><span class="close-icon" aria-hidden="true"></span></button></header>
      <p class="analysis-path" :title="root">{{ file.path }}</p>
      <section class="analysis-instruction">
        <label for="file-analysis-instruction">概要の分析指示（テキスト）</label>
        <p id="file-analysis-instruction-help" class="analysis-help">この入力は概要（summary・content内の内容説明）の分析指示です。表示URLや関連ソースの調査と探索範囲、指定JSON形式での回答・保存は、別の定型文で依頼します。</p>
        <textarea id="file-analysis-instruction" aria-describedby="file-analysis-instruction-help" ref="input" v-model="instruction" :disabled="loading||saving" maxlength="4000" rows="5" autofocus />
        <div class="analysis-actions"><button :disabled="loading||saving||busy||!instruction.trim()" @click="analyze">{{ busy?'解析中…':saving?'保存中…':'解析を実行' }}</button><button :disabled="loading||saving" @click="instruction=example">指示例に戻す</button><span>指示と結果は、このプロジェクト・ファイルごとに保存します。</span></div>
        <p class="analysis-help">ページ関連の候補は、関連ソース探索を含む解析を3並列で実行し、3件の結果を個別に保存します。完成した分からURL・概要・関連ソースの順に合成して表示し、残りの実行も続けます。最大5分間、実行要求と結果ファイルを監視します。ページ関連ソース（HTML・Vue・JS/TSなど）は、利用される複数画面のURLと根拠も調べ、一緒に保存します。画面に関係しない.py・CRUDなどは、直接の呼び出し元・呼び出し先だけを調べ、祖父・孫には広げません。この画面を閉じて別ソースへ移っても、IDEサーバーが動いている間は継続します。次に開くと進行状況または保存済み結果を表示します。</p>
        <p v-if="job" role="status">{{ job.message || (busy?'解析を依頼しました。結果を待っています…':'') }}</p>
        <ul v-if="job?.attempts?.length" class="analysis-processes" aria-label="解析の実行状況"><li v-for="attempt in job.attempts" :key="attempt.id">解析{{ attempt.index }}: {{ attemptLabel(attempt) }}<small v-if="attempt.status!=='complete'&&attempt.message"> · {{ attempt.message }}</small><span v-if="attempt.warning"> · {{ attempt.warning }}</span></li></ul>
        <p v-if="job&&!busy&&job.status!=='complete'">エージェントの実行状況をご確認ください。未実行の場合は下の依頼文で実行してください。<button :disabled="saving" @click="load()">結果を再確認</button></p>
        <details v-if="job&&!busy&&job.status!=='complete'&&job.prompt"><summary>エージェントへの依頼文</summary><textarea readonly :value="job.prompt" rows="5" aria-label="解析エージェントへの依頼文" /></details>
        <p v-if="error" class="error" role="alert">{{ error }} <button :disabled="saving" @click="load()">再確認</button></p>
        <div v-if="closeError" class="analysis-save-error" role="alert">
          <p class="error">解析指示を保存できませんでした: {{ closeError }}</p>
          <p>入力はこの画面に残っています。保存せずに閉じると、今回の指示の変更は失われます。</p>
          <div class="analysis-actions"><button ref="keepEditingButton" :disabled="saving" @click="keepEditing">編集を続ける</button><button :disabled="saving" @click="close">保存して閉じる</button><button :disabled="saving" @click="finishClose">保存せずに閉じる</button></div>
        </div>
      </section>
      <section class="analysis-history" aria-label="前回の解析内容">
        <div class="analysis-result-heading"><h3>解析内容</h3><time v-if="record">{{ when(record.createdAt) }}</time></div>
        <p v-if="loading">保存済みの解析を読み込んでいます…</p>
        <template v-else-if="record">
          <p v-if="stale" class="analysis-stale">解析後にファイルが更新されています。</p>
          <p v-if="record.warning" class="analysis-stale">{{ record.warning }}</p>
          <p v-if="scopeLabel" class="analysis-source-scope">{{ scopeLabel }}</p>
          <section v-if="(screenFile&&!['direct','none'].includes(record.relatedSourceScope))||displayUrls.length" class="analysis-display-urls" aria-label="表示URL">
            <h4>表示URL</h4>
            <div v-for="item in displayUrls" :key="item.url" class="analysis-display-url"><span>{{ item.label || '画面' }}<small>{{ item.url }}</small><small v-for="(evidence,index) in item.evidence" :key="index">解析{{ evidence.analysis }}{{ evidence.label?'（'+evidence.label+'）':'' }}: {{ evidence.reason || '根拠の補足なし' }}</small><small v-if="!item.evidence.length&&item.reason">{{ item.reason }}</small></span><button v-if="screenFile" :disabled="!!openingUrl||!browserAvailable" :title="browserAvailable?'この画面のURLをブラウザで開く':'tools接続中のみ起動できます'" @click="browse(item.url)">{{ openingUrl===item.url?'起動中…':'ブラウザで表示' }}</button></div>
            <p v-for="item in record.displayUrlReasons||[]" :key="item.analysis">解析{{ item.analysis }}: {{ item.reason }}</p>
            <p v-if="!record.displayUrlReasons?.length&&record.displayUrlReason">{{ record.displayUrlReason }}</p>
            <p v-if="!record.displayUrlReason&&!displayUrls.length">表示URLの記録がありません。再解析すると画面URLも調べます。</p>
            <p v-if="displayUrls.length">画面にはサーバーの起動やログインが必要な場合があります。</p>
            <p v-if="urlError" class="error" role="alert">{{ urlError }}</p>
          </section>
          <section class="analysis-summary" aria-label="概要"><h4>概要</h4>
            <template v-if="summaries.length"><div v-for="(item,index) in summaries" :key="index"><small>解析{{ item.analyses.join('・') }}</small><article class="analysis-result" v-html="item.html" /></div></template>
            <article v-else class="analysis-result" v-html="rendered" />
          </section>
          <section v-if="analyses.length||record.relatedSources?.length" class="analysis-related-sources" aria-label="関連ソース"><h4>関連ソース</h4>
            <ul><li v-for="item in record.relatedSources||[]" :key="item.path"><strong>{{ item.path }}</strong><ul><li v-for="(evidence,index) in item.evidence||[]" :key="index">解析{{ evidence.analysis }} · {{ relationLabel(evidence.relation) }}{{ evidence.line?' · '+evidence.line+'行':'' }}: {{ evidence.reason }}</li></ul></li></ul>
            <p v-if="!record.relatedSources?.length">確認できた関連ソースの記録はありません。個別の解析本文も確認してください。</p>
          </section>
          <details><summary>この結果の概要の分析指示</summary><p class="analysis-original-instruction">{{ record.instruction }}</p></details>
          <details v-for="item in analyses" :key="item.id" class="analysis-individual"><summary>解析{{ item.index }}の保存原本</summary><article class="analysis-result" v-html="item.html" /></details>
        </template>
        <p v-else>このファイルの解析記録はまだありません。上の指示で解析を実行できます。</p>
      </section>
    </dialog>
  </Teleport>
</template>
