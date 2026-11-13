<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms. -->
<script setup>
import './メモ画面.css';
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue';
import {メモAPIを作成} from './表示対象.mjs';
import {自動保存を作成} from './自動保存.mjs';
import {長押し移動を作成} from './長押し移動.mjs';
import {貼付ファイル,画像読込} from './画像貼付.mjs';
import {メモ色} from './メモ編集.mjs';
const props=defineProps({api:{type:Function,required:true},initialNew:Boolean,initialSource:String,initialId:String,initialScope:String,onSaved:Function,onNew:Function});
const native=globalThis.window?.aidiyMemo;
const state=ref({draft:{タイトル:'',本文:'',色:'yellow'},saving:false,error:'',conflict:false,dirty:false,blankNew:true});
const movingInput=ref(false);let composing=false;
const inputMove=長押し移動を作成({native,changed:value=>{movingInput.value=value;},enabled:()=>ready.value&&!closing.value&&!composing});
const imageError=ref(''),imageBusy=ref(false);
let imageFlight=null;
const adding=ref(false),addError=ref('');
const ready=ref(false),closing=ref(false),textFormat=ref(false),bootError=ref(''),source=ref(''),editor=ref(),copied=ref(false);
const color=computed(()=>メモ色.includes(state.value.draft.色)?state.value.draft.色:'yellow');
const 色名={yellow:'黄',blue:'青',green:'緑',pink:'桃',purple:'紫'};
let resolveBoot;const boot=new Promise(resolve=>{resolveBoot=resolve;});
let model,alive=true,closeBusy=false,pendingBlur=false,dragEnd=()=>{},unsubscribers=[];
function bounds(value){if(!model||!value)return;const {x,y,width,height}=value;if([x,y,width,height].every(Number.isFinite))model.edit({位置:{x,y},サイズ:{width,height}});}
function edit(patch){if(closing.value)return;model?.edit(patch);copied.value=false;}
async function flushClose(request){
 if(closeBusy)return;inputMove.cancel();closeBusy=true;closing.value=true;
 try{await boot;await imageFlight;if(!request.waitOnly&&request.bounds)bounds(request.bounds);const ok=ready.value&&!!model&&await (request.waitOnly?model.settled():model.flush());await native?.completeClose({requestId:request.requestId,ok,error:ok?'':state.value.error||bootError.value||'メモを読み込んでいます。'});}
 finally{closeBusy=false;closing.value=false;}
}
async function blur(event){await imageFlight;if(event?.bounds)bounds(event.bounds);if(!model){pendingBlur=true;return;}if(model.snapshot().blankNew){if(native)await native.close();else window.close();return;}await model.flush();}
function beforeUnload(event){if(state.value.dirty||state.value.saving||imageBusy.value){event.preventDefault();event.returnValue='';}}
function move(event){
 if(!native||event.button!==0||event.target.closest('input,textarea,button,select,a'))return;
 event.preventDefault();inputMove.cancel();dragEnd();let token,interval,ended=false;
 const end=()=>{ended=true;clearInterval(interval);if(token)void native.endWindowMove(token);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);dragEnd=()=>{};};
 window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);dragEnd=end;
 void (async()=>{try{token=await native.beginWindowMove();if(ended){if(token)void native.endWindowMove(token);return;}if(token)interval=setInterval(()=>{void native.moveWindow(token);},16);}catch{end();}})();
}
function paste(event){const files=貼付ファイル(event.clipboardData);if(!files.length)return;event.preventDefault();void attach(files);}
function drop(event){event.preventDefault();void attach(貼付ファイル(event.dataTransfer));}
async function attach(files){
 if(!ready.value||closing.value||imageBusy.value)return;
 imageError.value='';
 if(files.length!==1){imageError.value='画像を1枚指定してください。';return;}
 imageBusy.value=true;
 imageFlight=(async()=>{
  try{
   const data=await 画像読込(files[0]);if(!alive)return;
   // Apply content before any geometry event; image-only notes must survive blur/close.
   model.edit({画像:data});
  }catch(error){imageError.value=error.message||'画像を貼り付けできませんでした。';}
  finally{imageBusy.value=false;}
 })();
 await imageFlight;imageFlight=null;
}
function removeImage(){if(imageBusy.value||closing.value)return;edit({画像:''});imageError.value='';}
async function copyText(){try{await navigator.clipboard.writeText(state.value.draft.本文);copied.value=true;}catch{editor.value?.focus();editor.value?.select();}}
async function retry(){await model?.retry();}
async function add(){
 if(adding.value||closing.value||!ready.value)return;adding.value=true;addError.value='';
 try{if(!await (native?native.newMemo():props.onNew?.()))throw Error('付箋を追加できませんでした。プロジェクト設定とポップアップ許可を確認してください。');}
 catch(error){addError.value=error.message;}
 finally{adding.value=false;}
}
async function trash(){
 if(closing.value||!ready.value||imageBusy.value)return;closing.value=true;
 try{if(await model.trash()){if(native)await native.close();else window.close();}}
 finally{closing.value=false;}
}
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
  // 復元時の画面内クランプは書込理由にしない。次の実操作で現在位置も保存する。
  const {x,y,width,height}=initial.bounds||{};
  const geometry=[x,y,width,height].every(Number.isFinite)?{位置:{x,y},サイズ:{width,height}}:{};
  const initialNote=initial.note?{...initial.note,...geometry}:null;
  model=自動保存を作成({api:メモAPIを作成(props.api,initial.scope),note:initialNote,sourceId,changed:value=>{state.value=value;},identity:async note=>{if(native?.updateSavedNote)await native.updateSavedNote(note);else if(native?.setNoteIdentity)await native.setNoteIdentity({id:note.id,sourceId:note.保存先});props.onSaved?.(note);}});
  if(initialBounds)bounds(initialBounds);else if(!initial.note&&initial.bounds)bounds(initial.bounds);
  ready.value=true;
  await nextTick();if(!initial.note)editor.value?.focus();
 }catch(error){bootError.value=error.message||'メモを開けませんでした。';}
 finally{resolveBoot();if(pendingBlur)void blur();}
});
onUnmounted(()=>{alive=false;inputMove.cancel();dragEnd();model?.dispose();for(const off of unsubscribers)off?.();window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('blur',blur);});
</script>
<template>
 <main class="sticky-note" :class="[`sticky-${color}`,{'sticky-moving':movingInput}]" @paste="paste" @dragover.prevent @drop="drop">
  <div v-if="movingInput" class="sticky-move-marker" role="status">✥ 移動中</div>
  <div v-if="bootError" class="sticky-error" role="alert">{{bootError}}</div>
  <template v-else>
   <header class="sticky-header" title="ドラッグして移動" @pointerdown="move"><input class="sticky-title" @pointerdown="inputMove.start" @compositionstart="composing=true;inputMove.cancel()" @compositionend="composing=false" :value="state.draft.タイトル" :readonly="textFormat" :disabled="!ready||closing" aria-label="付箋のタイトル" placeholder="タイトル" maxlength="200" @input="edit({タイトル:$event.target.value})"><button class="sticky-add" aria-label="新しい付箋を追加" title="新しい付箋を追加" :disabled="!ready||closing||adding" @pointerdown.stop @click.stop="add">＋</button></header>
   <div class="sticky-content">
   <textarea ref="editor" class="sticky-text" @pointerdown="inputMove.start" @compositionstart="composing=true;inputMove.cancel()" @compositionend="composing=false" :value="state.draft.本文" :disabled="!ready||closing" aria-label="付箋の本文" placeholder="メモを書く…" spellcheck="false" @input="edit({本文:$event.target.value})"></textarea>
   <div v-if="state.draft.画像" class="sticky-image-frame"><img :src="state.draft.画像" alt="付箋に貼り付けた画像" draggable="false"><button class="sticky-image-remove" aria-label="画像を取り除く" title="画像を取り除く" :disabled="closing||imageBusy" @click="removeImage">×</button></div>
   </div>
   <div v-if="imageError" class="sticky-error" role="alert">{{imageError}}</div>
   <div v-if="imageBusy" class="sticky-save-state" role="status">画像を読み込み中…</div>
   <div v-if="state.error" class="sticky-error" role="alert"><span>{{state.error}} 入力内容は保持しています。</span><div><button type="button" @click="retry">再試行</button><button type="button" @click="copyText">{{copied?'コピー済':'本文をコピー'}}</button></div></div>
   <div v-if="addError" class="sticky-error" role="alert">{{addError}}</div>
   <div class="sticky-bottom" :title="source" aria-label="付箋の色と保存先">
    <div class="sticky-palette"><button v-for="value in メモ色" :key="value" type="button" :class="`sticky-${value}`" :aria-label="`${色名[value]}色の付箋`" :aria-pressed="color===value" :disabled="!ready||closing" @click="edit({色:value})"></button></div>
    <span class="sticky-save-state" role="status">{{state.error?'未保存':state.saving?'保存中…':state.dirty?'未保存':''}}</span><button type="button" class="sticky-trash" aria-label="付箋をゴミ箱へ移動" title="ゴミ箱へ移動" :disabled="!ready||closing" @click="trash">🗑</button>
   </div>
  </template>
 </main>
</template>
