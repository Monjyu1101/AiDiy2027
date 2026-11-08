<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import ModalDialog from './共通ダイアログ.vue';
const props=defineProps({request:Object,loadTargets:Function,insertDraft:Function,launchTarget:Function,emptyHint:String});
const emit=defineEmits(['close']);
const snapshot=ref(null),selected=ref(''),busy=ref(false),error=ref('');
let generation=0,disposed=false;
const targets=computed(()=>snapshot.value?.targets||[]);
const target=computed(()=>targets.value.find(item=>item.id===selected.value));
async function refresh(reselect=false){
  if(busy.value)return;const run=++generation;busy.value=true;error.value='';
  try{const result=await props.loadTargets(props.request);if(disposed||run!==generation)return;if(!result?.ok)throw Error(result?.error||'連携先を確認できません。');
    snapshot.value=result;
    selected.value=reselect
      ?result.targets.find(item=>item.id===result.frontmostTargetId)?.id||(result.targets.length===1?result.targets[0].id:'')
      :result.targets.some(item=>item.id===selected.value)?selected.value:result.targets.length===1?result.targets[0].id:'';
    if(reselect&&result.targets.length&&!selected.value)error.value='最前面の連携先を確認できません。Code / Live を前面にして再選択するか、一覧から選んでください。';
  }catch(e){if(!disposed&&run===generation){snapshot.value=null;selected.value='';error.value=e.message;}}
  finally{if(!disposed&&run===generation)busy.value=false;}
}
async function insert(){
  if(busy.value||!target.value)return;const run=++generation;busy.value=true;error.value='';
  const request={targetId:target.value.id,contextId:target.value.contextId,sessionKey:snapshot.value.sessionKey,projectPath:props.request.projectPath,text:props.request.text};
  try{const result=await props.insertDraft(request);if(disposed||run!==generation)return;if(!result?.ok)throw Error(result?.error||'下書きに追加できません。');emit('close');}
  catch(e){if(!disposed&&run===generation)error.value=e.message;}
  finally{if(!disposed&&run===generation)busy.value=false;}
}
async function launch(kind){
  if(busy.value||!props.launchTarget)return;busy.value=true;error.value='';
  try{const result=await props.launchTarget(kind,props.request);if(result?.ok===false)throw Error(result.error||'起動できません。');}
  catch(e){error.value=e.message;}
  finally{busy.value=false;}
  if(!disposed&&!error.value)await refresh();
}
onMounted(()=>refresh(true));onBeforeUnmount(()=>{disposed=true;generation++;});
</script>
<template>
  <ModalDialog label="Code / Live の下書きへ追加" :locked="busy" @close="emit('close')">
    <h3>Code / Live の下書きへ追加</h3>
    <p class="draft-source">{{ request.path }}{{ request.selection?'（選択範囲）':'' }}</p>
    <p>起動中の連携先の入力欄へ追加します。既存の下書きを残し、送信はその画面で行います。</p>
    <details v-if="request.browserElementId" class="draft-element-preview" open><summary>選択した要素の連携内容</summary><p>表示文章に個人情報が残る場合があります。内容を確認してから追加してください。</p><pre>{{request.text}}</pre></details>
    <div class="draft-target-row">
      <label v-if="targets.length>1||(targets.length===1&&!selected)">連携先<select v-model="selected" :disabled="busy" aria-label="下書きの連携先" @change="error='' "><option disabled value="">連携先を選択してください</option><option v-for="item in targets" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <span v-else>連携先: {{ targets[0]?.label || '未選択' }}</span>
      <button :disabled="busy" @click="refresh(true)">最前面を再選択</button>
    </div>
    <p v-if="target&&targets.length===1&&snapshot.frontmostTargetId!==target.id" class="draft-target-note">連携先は1件です。最前面は未確認ですが、この連携先を選択しています。</p>
    <p v-if="!targets.length&&!busy&&!error">{{emptyHint||'起動中のCode / Liveがありません。IDEの起動メニューの「Code」または「Live」から起動してください。'}}</p>
    <p v-if="target&&request.text.length>target.maxLength" class="error">選択範囲が連携先の入力上限を超えています。範囲を短くしてください。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">確認中…</p>
    <div class="dialog-actions draft-actions">
      <template v-if="!targets.length&&snapshot&&launchTarget"><button :disabled="busy" @click="launch('code')">＋ Code を起動</button><button v-if="snapshot.mode==='online'" :disabled="busy" @click="launch('live')">＋ Live を起動</button></template>
      <button :disabled="busy||!target||request.text.length>target.maxLength" @click="insert">下書きへ追加</button>
      <button :disabled="busy" @click="emit('close')">キャンセル</button>
    </div>
  </ModalDialog>
</template>
<style scoped>
.draft-element-preview{margin:12px 0}.draft-element-preview pre{max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;padding:8px;border:1px solid #375067}.draft-element-preview p{font-size:12px}
.draft-target-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.draft-target-row label{display:flex;align-items:center;gap:8px;min-width:0;flex:1;flex-wrap:wrap}
.draft-target-row select{min-width:0;max-width:100%;flex:1}
.draft-target-row button{flex-shrink:0}
</style>
