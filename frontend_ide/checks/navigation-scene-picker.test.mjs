// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ref,computed,watch,effectScope,reactive} from 'vue';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navi窓サイズ.js';
import {createNavigationMessage} from '../src/components/開発スペース/Naviメッセージ.js';
import {NAVIGATION_SCENES,NAVIGATION_SCENE_LABELS} from '../src/components/開発スペース/ナビ風景.js';
const source=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
const saved={schemaVersion:3,navigationId:'saved',goal:'保存済み目標',overall:{progress:20},items:[{id:'first',progress:20}],nextItemId:'first',nextPrompt:'次の作業'};
function fixture(t){
 const scope=effectScope(),requests=[],props=reactive({instance:'navi-1',project:{path:'/fixture'},startedAt:1});let randoms=0;
 const api=scope.run(()=>vm.runInNewContext(source+`;({navigate,chooseScene,runWithScene,sceneAction,cruiseKind,cruiseFailed,goal,result,availability,submitting,job,autopilot,visible,detached,sceneRequest})`,{
  ref,computed,watch,createNavigationPopupSizer,createNavigationMessage,NAVIGATION_SCENES,NAVIGATION_SCENE_LABELS,pickNavigationScene:()=>{randoms++;return 'ride';},
  inject:()=>null,onMounted(){},onBeforeUnmount(){},nextTick:async()=>{},defineExpose(){},defineProps:()=>props,defineEmits:()=>()=>{},window:{},DEFAULT_NAVIGATION_GOAL:'目標',AbortController,AbortSignal,setTimeout:()=>1,clearTimeout(){},
  fetch:(url,options)=>{requests.push({url,...options});return new Promise(()=>{});},
 }));
 t.after(()=>scope.stop());api.visible.value=true;api.availability.value={available:true};api.result.value=saved;api.goal.value='編集中の目標';
 return {api,requests,props,randoms:()=>randoms};
}
test('9候補に表示名が揃い、右クリックで開いただけでは目標・APIを変更しない',t=>{
 const f=fixture(t);assert.deepEqual(NAVIGATION_SCENES.map(id=>NAVIGATION_SCENE_LABELS[id]),['羽衣ライディング','花火','アクアリウム','万華鏡','水面','時計','迷路','依頼文','夜間飛行']);
 f.api.chooseScene('evaluate');assert.equal(f.api.sceneAction.value,'evaluate');assert.equal(f.api.goal.value,'編集中の目標');assert.equal(f.requests.length,0);
 f.api.sceneAction.value='';assert.equal(f.api.goal.value,'編集中の目標');assert.equal(f.requests.length,0);
});
for(const scene of NAVIGATION_SCENES)test(`選択した ${scene} は同期routing処理でも上書きせず、再評価は保存目標で一度実行する`,t=>{
 const f=fixture(t);f.api.chooseScene('evaluate');f.api.runWithScene(scene);assert.equal(f.api.sceneAction.value,'');assert.equal(f.api.cruiseKind.value,scene);assert.equal(f.randoms(),0);
 assert.deepEqual(JSON.parse(f.requests[0].body),{goal:'保存済み目標',action:'evaluate',clientRequestId:JSON.parse(f.requests[0].body).clientRequestId});assert.match(JSON.parse(f.requests[0].body).clientRequestId,/^navi-1-/);f.api.runWithScene(scene);assert.equal(f.requests.length,1);
});
test('選択演出は今回だけで、次の通常実行・自動航行待機は再びランダムになる',t=>{
 const f=fixture(t);f.api.chooseScene('navigate');f.api.runWithScene('water');assert.equal(f.api.cruiseKind.value,'water');assert.equal(JSON.parse(f.requests[0].body).goal,'編集中の目標');
 f.api.submitting.value=false;f.api.cruiseFailed.value=true;void f.api.navigate();assert.equal(f.api.cruiseKind.value,'ride');assert.equal(f.api.cruiseFailed.value,false);assert.equal(f.randoms(),1);
 f.api.submitting.value=false;f.api.autopilot.value=true;f.api.submitting.value=true;assert.equal(f.randoms(),2);
});
for(const field of ['busy','unavailable','autopilot','hidden','project','session','detached'])test(`${field} で選択を閉じ、古い候補クリックから実行しない`,t=>{
 const f=fixture(t);f.api.chooseScene('evaluate');assert.equal(f.api.sceneAction.value,'evaluate');
 if(field==='busy')f.api.submitting.value=true;
 if(field==='unavailable')f.api.availability.value={available:false};
 if(field==='autopilot')f.api.autopilot.value=true;
 if(field==='hidden')f.api.visible.value=false;
 if(field==='project')f.props.project={path:'/other'};
 if(field==='session')f.props.startedAt=2;
 if(field==='detached')f.api.detached.value=true;
 assert.equal(f.api.sceneAction.value,'');const before=f.requests.length;f.api.runWithScene('water');assert.equal(f.requests.length,before);
});
test('周期更新が同じ値を再代入しても、開いた選択を閉じず候補から実行できる',t=>{
 const f=fixture(t);f.api.chooseScene('evaluate');assert.equal(f.api.sceneAction.value,'evaluate');
 // refresh() は5秒ごと（実行中は2秒ごと）に、値が同じでも新しい availability オブジェクトを代入する。
 for(let i=0;i<3;i++)f.api.availability.value={available:true,reason:''};
 f.props.project={path:'/fixture'};f.props.startedAt=1;
 assert.equal(f.api.sceneAction.value,'evaluate');
 f.api.runWithScene('aquarium');assert.equal(f.requests.length,1);assert.equal(f.api.cruiseKind.value,'aquarium');
});
test('不正な候補や実行不可の再評価は送信しない',t=>{
 const f=fixture(t);f.api.chooseScene('evaluate');f.api.runWithScene('unknown');assert.equal(f.requests.length,0);f.api.result.value=null;f.api.chooseScene('evaluate');assert.equal(f.api.sceneAction.value,'');
});

test('右クリックメニュー: 夜間飛行（ランダム選択に含めない画面）は一番下で、1pxのヘアラインで区切る',async()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ画面メニュー.vue',import.meta.url),'utf8');
 assert.match(source,/<div v-if="!NAVIGATION_RANDOM_SCENES\.includes\(scene\)" class="navigation-scene-separator" role="separator"/);
 assert.match(source,/\.navigation-scene-separator\{height:1px;/);
 assert.equal(NAVIGATION_SCENES.at(-1),'nightflight');
 assert.deepEqual(NAVIGATION_SCENES.filter(scene=>scene==='nightflight'),['nightflight']);
});
