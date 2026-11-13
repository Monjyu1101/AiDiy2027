<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms. -->
<script setup>
import './メモ画面.css';
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue';
import {メモAPIを作成} from './表示対象.mjs';
import {自動保存を作成} from './自動保存.mjs';
import {メモ色} from './メモ編集.mjs';
const props=defineProps({api:{type:Function,required:true},initialNew:Boolean,initialSource:String,initialId:String,initialScope:String,onSaved:Function});
const native=globalThis.window?.aidiyMemo;
const state=ref({draft:{タイトル:'',本文:'',色:'yellow'},saving:false,error:'',conflict:false,dirty:false,blankNew:true});
const ready=ref(false),closing=ref(false),textFormat=ref(false),bootError=ref(''),source=ref(''),editor=ref(),copied=ref(false);
const color=computed(()=>メモ色.includes(state.value.draft.色)?state.value.draft.色:'yellow');
const 色名={yellow:'黄',blue:'青',green:'緑',pink:'桃',purple:'紫'};
let resolveBoot;const boot=new Promise(resolve=>{resolveBoot=resolve;});
let model,alive=true,closeBusy=false,pendingBlur=false,dragEnd=()=>{},unsubscribers=[];
function bounds(value){if(!model||!value)return;const {x,y,width,height}=value;if([x,y,width,height].every(Number.isFinite))model.edit({位置:{x,y},サイズ:{width,height}});}
function edit(patch){if(closing.value)return;model?.edit(patch);copied.value=false;}
async function flushClose(request){
 if(closeBusy)return;closeBusy=true;closing.value=true;
 try{await boot;if(request.bounds)bounds(request.bounds);const ok=ready.value&&!!model&&await model.flush();await native?.completeClose({requestId:request.requestId,ok,error:ok?'':state.value.error||bootError.value||'メモを読み込んでいます。'});}
 finally{closeBusy=false;closing.value=false;}
}
async function blur(event){if(event?.bounds)bounds(event.bounds);if(!model){pendingBlur=true;return;}if(model.snapshot().blankNew){if(native)await native.close();else window.close();return;}await model.flush();}
function beforeUnload(event){if(state.value.dirty||state.value.saving){event.preventDefault();event.returnValue='';}}
function move(event){
 if(!native||event.button!==0||event.target.closest('button,select,a'))return;
 // 入力欄では短いドラッグを文字選択に使い、静止した500ms長押しだけ窓移動にする。
 dragEnd();let token,timer,interval,ended=false,started=false;
 const x=event.clientX,y=event.clientY;
 const end=()=>{ended=true;clearTimeout(timer);clearInterval(interval);if(token)void native.endWindowMove(token);window.removeEventListener('pointermove',motion);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);dragEnd=()=>{};};
 const motion=e=>{if(!started&&Math.hypot(e.clientX-x,e.clientY-y)>5){end();return;}if(started)e.preventDefault();};
 timer=setTimeout(async()=>{try{token=await native.beginWindowMove();if(ended){if(token)void native.endWindowMove(token);return;}if(token){started=true;editor.value?.blur();interval=setInterval(()=>{void native.moveWindow(token);},16);}}catch{end();}},500);
 window.addEventListener('pointermove',motion,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);dragEnd=end;
}
async function copyText(){try{await navigator.clipboard.writeText(state.value.draft.本文);copied.value=true;}catch{editor.value?.focus();editor.value?.select();}}
async function retry(){await model?.retry();}
async function close(){if(native){await native.close();return;}closing.value=true;try{if(await model?.flush())window.close();}finally{closing.value=false;}}
onMounted(async()=>{
 window.addEventListener('beforeunload',beforeUnload);if(!native)window.addEventListener('blur',blur);
 // close/bounds購読を初期状態取得より先に登録し、起動直後の操作を取りこぼさない。
 let initialBounds;
 if(native){
  unsubscribers=[native.onBounds?.(value=>{if(model)bounds(value);else initialBounds=value;}),native.onBlur?.(event=>{void blur(event);}),native.onCloseRequested?.(request=>{void flushClose(request);})];
 }
 try{
  let initial;
  if(native)initial=await native.getInitialState();
  else{
   const scopedApi=メモAPIを作成(props.api,props.initialScope);
   const data=await scopedApi('api/メモ');
   const target=data.保存先.find(item=>item.id===props.initialSource)||data.保存先.find(item=>item.id.startsWith('project:'))||data.保存先[0];
   let note=props.initialNew?null:data.メモ.find(item=>item.id===props.initialId&&item.保存先===props.initialSource);
   if(!props.initialNew&&!note&&props.initialSource&&props.initialId)note=await scopedApi('api/メモ/読込',{method:'POST',body:{保存先:props.initialSource,id:props.initialId}});
   if(!props.initialNew&&!note)throw Error('表示対象のメモがありません。Diagの「+メモ」から新規作成できます。');
   initial={note,sources:data.保存先,sourceId:target?.id,scope:props.initialScope};
  }
  if(!alive)return;
  const sourceId=initial.note?.保存先||initial.sourceId;
  if(!sourceId)throw Error('メモの保存先を確認できません。Diagでプロジェクトを選択してください。');
  const selected=initial.sources?.find(item=>item.id===sourceId);source.value=selected?`${selected.名前} · ${selected.パス}`:sourceId;
  textFormat.value=initial.note?.形式==='text';
  model=自動保存を作成({api:メモAPIを作成(props.api,initial.scope),note:initial.note,sourceId,changed:value=>{state.value=value;},identity:async note=>{if(native?.updateSavedNote)await native.updateSavedNote(note);else if(native?.setNoteIdentity)await native.setNoteIdentity({id:note.id,sourceId:note.保存先});props.onSaved?.(note);}});
  if(initialBounds||initial.bounds)bounds(initialBounds||initial.bounds);
  ready.value=true;
  await nextTick();if(!initial.note)editor.value?.focus();
 }catch(error){bootError.value=error.message||'メモを開けませんでした。';}
 finally{resolveBoot();if(pendingBlur)void blur();}
});
onUnmounted(()=>{alive=false;dragEnd();model?.dispose();for(const off of unsubscribers)off?.();window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('blur',blur);});
</script>
<template>
 <main class="sticky-note" :class="`sticky-${color}`" @pointerdown="move">
  <div v-if="bootError" class="sticky-error" role="alert">{{bootError}}</div>
  <template v-else>
   <input class="sticky-title" :value="state.draft.タイトル" :readonly="textFormat" :disabled="!ready||closing" aria-label="付箋のタイトル" placeholder="タイトル" maxlength="200" @input="edit({タイトル:$event.target.value})">
   <textarea ref="editor" class="sticky-text" :value="state.draft.本文" :disabled="!ready||closing" aria-label="付箋の本文" placeholder="メモを書く…" spellcheck="false" @input="edit({本文:$event.target.value})"></textarea>
   <div v-if="state.error" class="sticky-error" role="alert"><span>{{state.error}} 入力内容は保持しています。</span><div><button type="button" @click="retry">再試行</button><button type="button" @click="copyText">{{copied?'コピー済':'本文をコピー'}}</button></div></div>
   <div class="sticky-bottom" :title="source" aria-label="付箋の色と保存先">
    <div class="sticky-palette"><button v-for="value in メモ色" :key="value" type="button" :class="`sticky-${value}`" :aria-label="`${色名[value]}色の付箋`" :aria-pressed="color===value" :disabled="!ready||closing" @click="edit({色:value})"></button></div>
    <span class="sticky-save-state" role="status">{{state.error?'未保存':state.saving?'保存中…':state.dirty?'未保存':''}}</span><button type="button" class="sticky-close" aria-label="付箋を閉じる" :disabled="closing" @click="close">×</button>
   </div>
  </template>
 </main>
</template>
