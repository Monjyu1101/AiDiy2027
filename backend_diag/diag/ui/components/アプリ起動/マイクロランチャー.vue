<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {起動モーション} from './起動モーション.mjs';
import './起動モーション.css';
import {computed,ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue';
import {アプリアイコン,起動項目を整列} from './アプリアイコン.mjs';
import {アイコン移動} from './アイコン移動.mjs';
import 配置 from './円周配置.cjs';
import './マイクロランチャー.css';
const props=defineProps({appState:Object,cliState:Object,state:Object,online:Boolean,switching:Boolean});
const emit=defineEmits(['restore','mini','select']);
const expanded=ref(false),busy=ref(false),stage=ref(null),projectLabel=ref(null),unfolded=ref(false),moving=ref(false);
let removeMenu,foldTimer,clickTimer,labelObserver,disposed=false;
function resizeLabel(){if(disposed||expanded.value||busy.value)return;const height=projectLabel.value?.getBoundingClientRect?.().height;if(height>0)void window.aidiyWindow?.resizeMicroLabel?.(Math.ceil(height));}
watch([()=>props.switching,()=>props.appState.フォルダ.value,busy],async()=>{await nextTick();resizeLabel();});
function activity(){clearTimeout(foldTimer);if(expanded.value&&!moving.value)foldTimer=setTimeout(()=>{void toggle();},60*60*1000);}
const move=アイコン移動(window.aidiyWindow,{開始(){moving.value=true;clearTimeout(clickTimer);clearTimeout(foldTimer);},終了(){moving.value=false;activity();}});
function coreClick(event){if(move.click())return;clearTimeout(clickTimer);if(event.detail===0){void toggle();return;}clickTimer=setTimeout(()=>{void toggle();},400);}
function coreDouble(){if(move.double())return;clearTimeout(clickTimer);emit('mini');}
function startMove(event){if(!props.switching&&!busy.value)move.down(event);}
const apps=computed(()=>起動項目を整列([...props.appState.項目.value.filter(item=>props.appState.利用可能(item.id)).map(item=>({...item,kind:'app',icon:アプリアイコン[item.id]})),...props.cliState.項目.value.map(item=>({...item,kind:'cli',icon:item.id==='aidiy_hermes'?'CLI_aidiy_hermes.png':`CLI_${item.id}.svg`}))]));
// OSに依存せず、末尾の区切りを除いたフォルダ名だけを表示する。
const projectName=computed(()=>{const folder=String(props.appState.フォルダ.value||'');return folder.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||folder;});
const batchProgress=computed(()=>{const value=props.state?.進捗表示?.value;return props.online&&['running','error'].includes(value?.状態)?value:null;});
const orbit=computed(()=>配置.円周配置(apps.value.length));
const 展開間隔=45,収納時間=420;
const 内側開始=computed(()=>orbit.value.外側数?(orbit.value.外側数-1)*展開間隔+収納時間:0);
const 最終開始=computed(()=>内側開始.value+Math.max(0,orbit.value.内側数-1)*展開間隔);
function 順序スタイル(ring,index){const start=(ring.outer?0:内側開始.value)+index*展開間隔;return {'--angle':`${index*360/ring.items.length-90}deg`,'--open-delay':`${start}ms`,'--close-delay':`${最終開始.value-start}ms`};}
const rings=computed(()=>[{items:apps.value.slice(0,orbit.value.内側数),radius:orbit.value.内半径,outer:false},...(orbit.value.外側数?[{items:apps.value.slice(orbit.value.内側数),radius:orbit.value.半径,outer:true}]:[])]);
watch(()=>apps.value.length,async count=>{if(expanded.value)await window.aidiyWindow?.expandMicro(true,count);});
watch(()=>props.online,value=>{if(value){void props.appState.読込();void props.cliState.読込();}},{immediate:true});
function disabled(item){return !props.online||(item.kind==='app'&&!props.appState.利用可能(item.id))||(item.kind!=='app'||item.id!=='chrome')&&!props.appState.フォルダ.value||props.appState.選択中.value||Boolean(props.appState.処理中.value)&&!(item.kind==='cli'&&props.appState.処理中.value.startsWith('cli:'));}
function contextMenu(){if(busy.value||props.switching)return;activity();void window.aidiyWindow?.showMicroMenu?.(apps.value.map(item=>({key:item.kind+':'+item.id,label:item.名前,...(item.id==='slack'?{enabled:!disabled(item),reason:props.appState.不可理由(item.id)}:{})})));}
function launch(item,event){if(disabled(item))return;const 開始時=起動モーション(event);if(item.kind==='cli')void props.cliState.起動(item.id,{確認省略:true,開始時});else void props.appState.起動(item.id,{開始時});}
async function toggle(){
 if(busy.value||props.switching)return;busy.value=true;
 try{
  if(!expanded.value){if(window.aidiyWindow&&await window.aidiyWindow.expandMicro(true,apps.value.length)!==true)return;unfolded.value=true;expanded.value=true;await nextTick();activity();}
  else {clearTimeout(foldTimer);expanded.value=false;await nextTick();await new Promise(resolve=>setTimeout(resolve,最終開始.value+収納時間+40));if(!disposed){await window.aidiyWindow?.expandMicro(false);unfolded.value=false;}}
 }finally{busy.value=false;}
}
function key(event){if(event.key==='Escape'){event.preventDefault();if(moving.value){move.finish();return;}if(expanded.value)void toggle();else emit('restore');}}
onMounted(()=>{removeMenu=window.aidiyWindow?.onMicroMenu?.(action=>{clearTimeout(clickTimer);if(action==='mini')emit('mini');else if(action==='normal')emit('restore');else if(action?.type==='launch'){const item=apps.value.find(item=>item.kind+':'+item.id===action.key);if(item){const button=[...stage.value.querySelectorAll('.micro-app')].find(button=>(button.dataset.app||button.dataset.cli)===item.id);launch(item,{currentTarget:button});}}});document.documentElement.classList.add('micro-mode');window.addEventListener('keydown',key);stage.value?.querySelector('.micro-core')?.focus();if(typeof ResizeObserver!=='undefined'&&projectLabel.value){labelObserver=new ResizeObserver(resizeLabel);labelObserver.observe(projectLabel.value);}resizeLabel();});
onBeforeUnmount(()=>{removeMenu?.();disposed=true;labelObserver?.disconnect();move.finish();clearTimeout(foldTimer);clearTimeout(clickTimer);document.documentElement.classList.remove('micro-mode');window.removeEventListener('keydown',key);});
</script>
<template>
<section ref="stage" class="micro-launcher" :class="{expanded,moving,unfolded}" :style="{'--radius':`${orbit.半径}px`,'--menu-size':`${orbit.幅}px`}" aria-label="アイコン化ランチャー" @contextmenu.prevent="contextMenu" @pointermove="activity" @pointerdown="activity" @keydown="activity" @focusin="activity">
 <div class="micro-deploy" :inert="!expanded">
  <div v-for="ring in rings" :key="String(ring.outer)" class="micro-orbit micro-app-orbit" :class="{'micro-outer-orbit':ring.outer}" :style="{'--radius':`${ring.radius}px`}" :aria-label="ring.outer?'外側の起動アイコン':'内側の起動アイコン'">
   <div v-for="(item,index) in ring.items" :key="item.kind+item.id" class="micro-position" :style="順序スタイル(ring,index)">
    <div class="micro-upright"><button data-micro-hit class="micro-app" :data-app="item.kind==='app'?item.id:undefined" :data-cli="item.kind==='cli'?item.id:undefined" :disabled="disabled(item)" :title="(item.kind==='app'&&appState.不可理由(item.id))||item.名前+' を起動 — '+appState.フォルダ.value" :aria-label="item.名前+' を起動'+(item.kind==='app'&&appState.不可理由(item.id)?' — '+appState.不可理由(item.id):'')" @click="launch(item,$event)"><span class="launch-frame launch-frame-40" aria-hidden="true"><img :src="item.icon" alt="" width="40" height="40"><span class="launch-trace"></span></span></button></div>
   </div>
  </div>
 </div>
 <div data-micro-hit class="micro-move" title="ドラッグして移動" @pointerdown="startMove" @pointermove="move.move" @pointerup="move.finish" @pointercancel="move.finish" @lostpointercapture="move.finish"></div>
 <button data-micro-hit class="micro-core" @pointerdown="startMove" @pointermove="move.move" @pointerup="move.finish" @pointercancel="move.finish" @lostpointercapture="move.finish" @dragstart.prevent :aria-expanded="expanded" :aria-busy="busy" :title="(expanded?'メニューを閉じる':'ランチャーを開く')+' — '+appState.フォルダ.value+'（ドラッグで移動・ダブルクリックでランチャー表示・Escで戻る）'" aria-label="円形ランチャーを開閉" @click="coreClick" @dblclick.prevent="coreDouble"><span class="micro-mark"><img :src="expanded?'AiDiy_diag.png':'AiDiy.png'" alt="AiDiy" width="40" height="40"></span></button>
 <span ref="projectLabel" data-micro-hit class="micro-project" :title="projectName" @pointerdown="startMove" @pointermove="move.move" @pointerup="move.finish" @pointercancel="move.finish" @lostpointercapture="move.finish"><span class="micro-project-name">{{projectName}}</span><span v-if="batchProgress" class="micro-batch-status" :data-state="batchProgress.状態" :data-kind="batchProgress.種別" role="status" aria-live="polite" :title="batchProgress.通知"><span v-if="batchProgress.状態==='running'" class="micro-batch-spinner" aria-hidden="true"></span>{{batchProgress.種別==='stop'?'強制停止':'一括起動'}}{{batchProgress.状態==='running'?'中…':'要確認'}}<button v-if="batchProgress.状態==='error'" type="button" @pointerdown.stop @click.stop="emit('restore')" title="通常表示に戻ってエラー内容を確認">詳細を確認</button></span></span>
</section>
</template>
