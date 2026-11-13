<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms. -->
<script setup>
import './メモ画面.css';
import {ref, computed, watch, nextTick, onMounted, onUnmounted} from 'vue';
import {メモ色, メモキー, 編集開始, 変更あり, 保存要求} from './メモ編集.mjs';
const native=globalThis.window?.aidiyMemo;
const board=ref();
const 折畳み=ref(false), 切替中=ref(false);
let タイトル終了=()=>{},タイトルクリック抑止=false;
function タイトル移動(event){
 if(!native||event.button!==0||event.target.closest('.memo-window-actions'))return;
 タイトル終了();タイトルクリック抑止=false;let done=false,token,timer,interval;
 const end=()=>{done=true;clearTimeout(timer);clearInterval(interval);if(token)void native.endWindowMove(token);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);タイトル終了=()=>{};};
 timer=setTimeout(async()=>{token=await native.beginWindowMove();if(done){if(token)void native.endWindowMove(token);return;}if(token){タイトルクリック抑止=true;interval=setInterval(()=>{void native.moveWindow(token);},16);}},500);
 window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);タイトル終了=end;
}
function タイトルクリック(event){if(タイトルクリック抑止){タイトルクリック抑止=false;event.preventDefault();event.stopImmediatePropagation();}}
async function 開閉(){
 if(切替中.value)return;切替中.value=true;
 try{const next=!折畳み.value; const result=await native?.collapsePanel(next);if(!native||result?.ok===true)折畳み.value=next;}catch(error){エラー.value=error.message||'表示を切り替えられませんでした。';}finally{切替中.value=false;}
}
const props=defineProps({api:{type:Function,required:true},initialNew:Boolean});
const 保存先=ref([]), メモ=ref([]), 警告=ref([]), 読込中=ref(false), エラー=ref(''), 通知=ref(''), 再読込確認=ref(false), 選択先=ref('');
const 未保存=computed(()=>メモ.value.some(変更あり));
const 保存中=computed(()=>メモ.value.some(item=>item.保存中));
watch([未保存,保存中],([dirty,saving])=>native?.setDirty(dirty||saving),{immediate:true});
const 移動中=ref('');
const ボード高さ=computed(()=>Math.max(400,...メモ.value.map(item=>(item.位置?.y||0)+(item.サイズ?.height||280)+30)));
const 色名={yellow:'黄',blue:'青',green:'緑',pink:'桃',purple:'紫'};
let 生存=true, 作成番号=0,新規待ち=props.initialNew?1:0,新規処理中=false;
async function 新規を要求(){新規待ち++;await 新規を処理();}
async function 新規を処理(){
 if(!生存||読込中.value||新規処理中||!保存先.value.length||!新規待ち)return;
 新規処理中=true;
 try{
  const data=await props.api('api/メモ');if(!生存)return;
  // 保存先だけ更新する。未保存の本文や位置は置き換えない。
  保存先.value=data.保存先;警告.value=data.警告||[];
  選択先.value=既定保存先();
  if(!選択先.value)return;
  if(折畳み.value)await 開閉();
  while(新規待ち>0){新規待ち--;追加();}
 }catch(error){エラー.value=error.message||'新しいメモを開けませんでした。';}
 finally{新規処理中=false;}
}
function 既定保存先(){return 保存先.value.find(item=>item.id.startsWith('project:'))?.id||保存先.value[0]?.id||'';}
const 新規購読解除=native?.onNewMemo?.(()=>{void 新規を要求();});
function 新規メッセージ(event){if(event.origin===location.origin&&event.source===window.opener&&event.data?.type==='aidiy-memo-new')void 新規を要求();}

async function 読込(破棄=false){
 if(読込中.value||保存中.value)return;
 if(未保存.value&&!破棄){再読込確認.value=true;return;}
 再読込確認.value=false;読込中.value=true;エラー.value='';通知.value='';
 try{
  const data=await props.api('api/メモ');
  if(!生存)return;
  保存先.value=data.保存先;メモ.value=data.メモ.map((item,index)=>配置準備(編集開始(item),index));警告.value=data.警告||[];
  if(!保存先.value.some(item=>item.id===選択先.value))選択先.value=既定保存先();
 }catch(error){if(生存)エラー.value=error.message||'メモを読み込めませんでした。';}
 finally{if(生存){読込中.value=false;void 新規を処理();}}
}
function 追加(){
 if(!選択先.value||読込中.value)return;
 メモ.value.unshift(配置準備({...編集開始({id:`draft-${++作成番号}`,保存先:選択先.value,タイトル:'',本文:'',色:'yellow'}),新規:true},メモ.value.length));
 通知.value='';
 void nextTick(()=>{const input=board.value?.querySelector('.memo-note-title');input?.scrollIntoView?.({block:'nearest'});input?.focus();});
}
async function 保存(item){
 if(item.保存中||読込中.value)return;
 item.保存中=true;item.エラー='';通知.value='';
 try{
  const saved=await props.api(item.新規?'api/メモ/作成':'api/メモ/保存',{method:'POST',body:保存要求(item)});
  if(!生存)return;
  Object.assign(item,編集開始(saved),{新規:false});通知.value='保存しました。';
 }catch(error){if(生存)item.エラー=error.message||'保存できませんでした。入力内容は保持しています。';}
 finally{if(生存)item.保存中=false;}
}
function 配置準備(item,index){
 const columns=Math.max(1,Math.floor(((board.value?.clientWidth||760)+14)/274));
 item.位置 ||= {x:(index%columns)*274,y:Math.floor(index/columns)*294};
 item.サイズ ||= {width:260,height:280};
 if(!item.新規)item.元=JSON.stringify(編集値付き(item));
 return item;
}
function 編集値付き(item){return {タイトル:item.タイトル||'',本文:item.本文||'',色:item.色||'yellow',位置:item.位置,サイズ:item.サイズ};}
let 操作終了=()=>{};
function 操作開始(event,item,resize=false){
 if(event.button!==0||item.保存中||読込中.value)return;
 操作終了();const element=event.currentTarget;const start={x:event.clientX,y:event.clientY,位置:{...item.位置},サイズ:{...item.サイズ}};
 let active=resize,timer;
 const begin=()=>{active=true;移動中.value=メモキー(item);element.setPointerCapture?.(event.pointerId);};
 const move=e=>{if(!active){if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)end();return;}e.preventDefault();const dx=e.clientX-start.x,dy=e.clientY-start.y;if(resize)item.サイズ={width:Math.min(1200,Math.max(200,start.サイズ.width+dx)),height:Math.min(1600,Math.max(180,start.サイズ.height+dy))};else item.位置={x:Math.max(0,start.位置.x+dx),y:Math.max(0,start.位置.y+dy)};};
 const end=()=>{clearTimeout(timer);移動中.value='';window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);try{element.releasePointerCapture?.(event.pointerId);}catch{}操作終了=()=>{};};
 if(resize)begin();else timer=setTimeout(begin,500);
 window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);操作終了=end;
}
function 保存先名(id){return 保存先.value.find(item=>item.id===id)?.名前||id;}
function 終了前(event){if(未保存.value||保存中.value){event.preventDefault();event.returnValue='';}}
function 再表示(){if(!未保存.value&&!保存中.value&&document.visibilityState!=='hidden')void 読込();}
onMounted(()=>{window.addEventListener('message',新規メッセージ);window.addEventListener('beforeunload',終了前);window.addEventListener('focus',再表示);document.addEventListener('visibilitychange',再表示);void 読込();});
onUnmounted(()=>{新規購読解除?.();window.removeEventListener('message',新規メッセージ);タイトル終了();操作終了();生存=false;window.removeEventListener('beforeunload',終了前);window.removeEventListener('focus',再表示);document.removeEventListener('visibilitychange',再表示);});
defineExpose({hasUnsaved:未保存, saving:保存中});
</script>
<template>
 <main class="memo-app" :class="{'memo-collapsed':折畳み}">
  <header class="memo-title" data-aidiy-window-move-handle @pointerdown="タイトル移動" @click.capture="タイトルクリック"><button class="memo-toggle" type="button" :disabled="切替中" :aria-expanded="!折畳み" :aria-label="折畳み?'メモを展開':'メモを折りたたむ'" @click="開閉">{{折畳み?'▶':'▽'}}</button><h1>AiDiy Memo</h1><span v-if="未保存" class="memo-unsaved">未保存</span><div v-if="native" class="memo-window-actions"><button type="button" aria-label="最小化" @click="native.minimize()">－</button><button type="button" aria-label="最大化・元に戻す" @click="native.maximize()">□</button><span class="memo-fixed-pin" title="常に最前面">📌</span><button type="button" aria-label="閉じる" @click="native.close()">×</button></div></header>
  <div v-show="!折畳み" class="memo-body" data-aidiy-no-window-move>
  <div class="memo-toolbar">
   <label>保存先 <select v-model="選択先" :disabled="読込中 || !保存先.length"><option v-for="source in 保存先" :key="source.id" :value="source.id">{{source.名前}}</option></select></label>
   <button type="button" @click="追加" :disabled="読込中 || !選択先">＋ メモ</button>
   <button type="button" @click="読込()" :disabled="読込中 || 保存中">{{読込中?'読込中…':'再読込'}}</button>
  </div>
  <div v-if="再読込確認" class="memo-confirm" role="alert"><span>未保存の変更を破棄して再読込しますか？</span><button type="button" @click="読込(true)">破棄して再読込</button><button type="button" @click="再読込確認=false">戻る</button></div>
  <p v-if="エラー" class="memo-error" role="alert">{{エラー}}</p>
  <p v-if="通知" class="memo-notice" role="status">{{通知}}</p>
  <div v-if="警告.length" class="memo-warnings" role="status"><p v-for="(warning,index) in 警告" :key="index">{{typeof warning==='string'?warning:warning.メッセージ||warning.エラー||JSON.stringify(warning)}}</p></div>
  <div class="memo-sources"><div v-for="source in 保存先" :key="source.id"><strong>{{source.名前}}</strong><span>{{source.パス}}</span></div></div>
  <p v-if="!読込中 && !メモ.length && !エラー" class="memo-empty">メモはありません。保存先を選び「＋ メモ」で作成できます。</p>
  <section ref="board" class="memo-board" aria-label="ポストイットメモ" :style="{height:ボード高さ+'px'}">
   <article v-for="item in メモ" :key="メモキー(item)" class="memo-note" :class="[`memo-color-${メモ色.includes(item.色)?item.色:'yellow'}`,{'memo-moving':移動中===メモキー(item)}]" :style="{left:item.位置.x+'px',top:item.位置.y+'px',width:item.サイズ.width+'px',height:item.サイズ.height+'px'}">
    <div class="memo-note-meta" title="0.5秒長押しして移動" @pointerdown="操作開始($event,item)"><span>{{保存先名(item.保存先)}}</span><span v-if="変更あり(item)">未保存</span></div>
    <input v-model="item.タイトル" class="memo-note-title" aria-label="メモのタイトル" placeholder="タイトル" :readonly="item.形式==='text'" :disabled="item.保存中 || 読込中" maxlength="200">
    <textarea v-model="item.本文" aria-label="メモの本文" placeholder="メモを書く…" :disabled="item.保存中 || 読込中" @keydown.ctrl.s.prevent="保存(item)" @keydown.meta.s.prevent="保存(item)"></textarea>
    <div class="memo-note-actions"><div class="memo-palette" aria-label="メモの色"><button v-for="color in メモ色" :key="color" type="button" :class="`memo-color-${color}`" :aria-label="色名[color]" :aria-pressed="item.色===color" :disabled="item.保存中 || 読込中" @click="item.色=color"></button></div><button type="button" @click="保存(item)" :disabled="item.保存中 || 読込中 || !変更あり(item)">{{item.保存中?'保存中…':'保存'}}</button></div>
    <p v-if="item.エラー" class="memo-note-error" role="alert">{{item.エラー}} 入力内容は残っています。</p>
    <button type="button" class="memo-resize" aria-label="メモのサイズ調整" title="ドラッグでサイズ調整" @pointerdown.prevent="操作開始($event,item,true)">◢</button>
   </article>
  </section>
  </div>
 </main>
</template>
