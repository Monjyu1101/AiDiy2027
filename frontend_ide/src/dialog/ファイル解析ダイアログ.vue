<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,computed,inject,onMounted,onBeforeUnmount,nextTick} from 'vue';
import MarkdownIt from 'markdown-it';
import {normalizeDisplayUrls} from '../../viewer/表示URL.mjs';
import {openBrowser} from '../components/ブラウザ/起動.js';
const props=defineProps({file:Object,root:String});
const emit=defineEmits(['close']);
const dialog=ref(),input=ref(),loading=ref(true),saving=ref(false),error=ref(''),record=ref(null),job=ref(null),stale=ref(false);
const closeError=ref(''),keepEditingButton=ref();
const browserAvailable=inject('browserAvailable',false),openingUrl=ref(''),urlError=ref('');
const displayUrls=computed(()=>normalizeDisplayUrls(record.value?.displayUrls));
const screenFile=/\.(html?|vue)$/i.test(props.file.name);
const example=/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?|heic|heif)$/i.test(props.file.name)
  ?'この画像を確認し、描かれている内容、構図・配色、画像内の文字、想定される用途を日本語で説明してください。実際に読み取れる情報と推測を区別し、確認できない部分は明記してください。画像や関連ファイルの変更は不要です。'
  :'このファイルの機能概要を日本語で説明してください。主な役割、主要な関数・処理の流れ、入出力、依存先や呼び出し元、読む際の注意点を整理し、根拠となる関数名や行番号も示してください。ソースの変更は不要です。';
const instruction=ref(example),busy=computed(()=>job.value?.status==='waiting');
const markdown=new MarkdownIt({html:false,linkify:false,breaks:true});
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'画像');
const linkOpen=markdown.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return linkOpen(tokens,index,options,env,self);};
const rendered=computed(()=>markdown.render(record.value?.content||''));
const controller=new AbortController();let timer,closed=false;
async function request(method='GET',body) {
  const response=await fetch('/api/file-analysis'+(method==='GET'?'?'+new URLSearchParams({path:props.file.path}):''),{
    method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),cache:'no-store'});
  const value=await response.json();if(!response.ok)throw Error(value.error||'解析記録を取得できません。');return value;
}
async function load(initial=false) {
  clearTimeout(timer);
  try {
    const value=await request();if(closed)return;
    record.value=value.result;job.value=value.job;stale.value=value.stale;error.value='';
    if(initial)instruction.value=value.instruction||example;
    if(busy.value)timer=setTimeout(()=>load(),2000);
  }catch(e){if(!closed)error.value=e.message;}
  finally{loading.value=false;}
}
async function analyze() {
  if(busy.value||saving.value||!instruction.value.trim())return;
  saving.value=true;error.value='';
  try{job.value=await request('POST',{path:props.file.path,instruction:instruction.value});timer=setTimeout(()=>load(),500);}
  catch(e){error.value=e.message;}finally{saving.value=false;}
}
async function browse(url){
  if(openingUrl.value||!screenFile)return;
  openingUrl.value=url;urlError.value='';
  try{const result=await openBrowser(props.file.path,undefined,window,url);if(!result?.ok)throw Error(result?.error||'ブラウザを開けませんでした。');}
  catch(e){if(!closed)urlError.value=e.message;}
  finally{if(!closed)openingUrl.value='';}
}
async function close() {
  if(saving.value||closed)return;
  if(!loading.value){
    saving.value=true;error.value='';closeError.value='';
    try{await request('PUT',{path:props.file.path,instruction:instruction.value});}
    catch(e){closeError.value=e.message;return;}
    finally{
      saving.value=false;
      if(closeError.value){await nextTick();keepEditingButton.value?.focus();}
    }
  }
  finishClose();
}
function finishClose() {
  if(closed||saving.value)return;
  closed=true;clearTimeout(timer);controller.abort();
  dialog.value?.close();emit('close');
}
async function keepEditing() {
  closeError.value='';await nextTick();input.value?.focus();
}
const when=value=>new Date(value).toLocaleString('ja-JP');
onMounted(()=>{dialog.value.showModal();void load(true);});
onBeforeUnmount(()=>{closed=true;clearTimeout(timer);controller.abort();dialog.value?.close();});
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="file-analysis-dialog" aria-labelledby="file-analysis-title" @keydown.stop @cancel.prevent="close">
      <header><img :src="'/development/AiDiy.png'" alt=""><h2 id="file-analysis-title">AI解析</h2><button aria-label="AI解析を閉じる" :disabled="saving" @click="close"><span class="close-icon" aria-hidden="true"></span></button></header>
      <p class="analysis-path" :title="root">{{ file.path }}</p>
      <section class="analysis-instruction">
        <label for="file-analysis-instruction">AIへの解析指示</label>
        <textarea id="file-analysis-instruction" ref="input" v-model="instruction" :disabled="loading||saving" maxlength="4000" rows="5" autofocus />
        <div class="analysis-actions"><button :disabled="loading||saving||busy||!instruction.trim()" @click="analyze">{{ busy?'解析中…':saving?'保存中…':'解析を実行' }}</button><button :disabled="loading||saving" @click="instruction=example">指示例に戻す</button><span>指示と結果は、このプロジェクト・ファイルごとに保存します。</span></div>
        <p class="analysis-help">AIエージェントに依頼し、最大5分間、結果を確認します。内容と並行して画面の表示URLも調べ、一緒に保存します。閉じても解析結果は保存されます。</p>
        <p v-if="job" role="status">{{ job.message || (busy?'解析を依頼しました。結果を待っています…':'') }}</p>
        <p v-if="job&&!busy&&job.status!=='complete'">エージェントの実行状況をご確認ください。未実行の場合は下の依頼文で実行してください。<button @click="load()">結果を再確認</button></p>
        <details v-if="job&&!busy&&job.status!=='complete'"><summary>エージェントへの依頼文</summary><textarea readonly :value="job.prompt" rows="5" aria-label="解析エージェントへの依頼文" /></details>
        <p v-if="error" class="error" role="alert">{{ error }} <button @click="load()">再確認</button></p>
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
          <section v-if="screenFile||displayUrls.length" class="analysis-display-urls" aria-label="表示URL">
            <h4>表示URL</h4>
            <div v-for="item in displayUrls" :key="item.url" class="analysis-display-url"><span>{{ item.label || '画面' }}<small>{{ item.url }}</small></span><button v-if="screenFile" :disabled="!!openingUrl||!browserAvailable" :title="browserAvailable?'保存したURLをブラウザで開く':'tools接続中のみ起動できます'" @click="browse(item.url)">{{ openingUrl===item.url?'起動中…':'ブラウザで表示' }}</button></div>
            <p v-if="record.displayUrlReason">{{ record.displayUrlReason }}</p>
            <p v-else-if="!displayUrls.length">表示URLの記録がありません。再解析すると画面URLも調べます。</p>
            <p v-if="displayUrls.length">画面にはサーバーの起動やログインが必要な場合があります。</p>
            <p v-if="urlError" class="error" role="alert">{{ urlError }}</p>
          </section>
          <details><summary>この結果の解析指示</summary><p class="analysis-original-instruction">{{ record.instruction }}</p></details><article class="analysis-result" v-html="rendered" />
        </template>
        <p v-else>このファイルの解析記録はまだありません。上の指示で解析を実行できます。</p>
      </section>
    </dialog>
  </Teleport>
</template>
