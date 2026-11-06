// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ref,computed,watch,effectScope,reactive,nextTick} from 'vue';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navigation窓サイズ.js';
import {createNavigationMessage} from '../src/components/開発スペース/Navigationメッセージ.js';
import {createDraftReceiver,DRAFT_LIMITS} from '../src/components/下書き連携/下書き受け渡し.js';
const full=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
const source=full.split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
const text='今回の目標\n対処しようとしている内容\n今回の作業 <AI本文>  ';
const saved=()=>({schemaVersion:3,navigationId:'saved',goal:'保存済み目標',overall:{progress:20},items:[{id:'first',progress:20}],nextItemId:'first',nextPrompt:text});
async function fixture(t,{standalone=true,native=false,actions=true}={}){
 const scope=effectScope(),requests=[],insertions=[];
 const props=reactive({instance:'navi-1',standalone,project:{path:'/fixture'},startedAt:1});
 const receiverState=reactive({path:'/fixture',session:'conversation-1',ready:true,draft:'既存の下書き'});let focus=0,identity=0;
 const receiver=createDraftReceiver({kind:'code',project:()=>receiverState.path,scope:()=>receiverState.session,ready:()=>receiverState.ready,draft:()=>receiverState.draft,setDraft:value=>{receiverState.draft=value;},focus:()=>{focus++;},uuid:()=>`context-${++identity}`});receiver.mount();
 const api=scope.run(()=>vm.runInNewContext(source+`;codeSession=1;({setCodeSession:value=>{codeSession=value;},handoff,handoffLabel,handoffTitle,canHandoff,handoffBusy,handoffError,draftRequest,codeOpen,codeOpening,codePanel,codeBase,autopilot,result,goal,visible,detached,submitting,toolsState})`,{
  ref,computed,watch,nextTick,createNavigationPopupSizer,createNavigationMessage,
  inject:()=>actions?{}:null,onMounted(){},onBeforeUnmount(){},defineProps:()=>props,defineEmits:()=>()=>{},window:native?{aidiyWindow:{}}:{},DEFAULT_NAVIGATION_GOAL:'目標',AbortController,AbortSignal,setTimeout:()=>1,clearTimeout(){},pickNavigationScene:()=> 'ride',
  fetch:async(url,options={})=>{requests.push({url,...options});return {ok:true,json:async()=>({})};},
 }));
 t.after(()=>{scope.stop();receiver.dispose();});
 api.visible.value=true;api.codeBase.value='/panels/code/navi-1/test/';api.result.value=saved();api.goal.value='編集中の別目標';
 api.codePanel.value={draftTarget:receiver.target,insertDraft:data=>{insertions.push(data);return receiver.insert(data);},runNavigationPrompt:()=>assert.fail('下書き追加で自動航行を実行しない'),submit:()=>assert.fail('下書き追加で送信しない')};
 await nextTick();
 return {api,props,requests,receiver,receiverState,insertions,focus:()=>focus};
}
test('内蔵Code表示中は単独WebでもCODEへと表示し、本文をそのまま既存下書きに追記する',async t=>{
 const f=await fixture(t,{actions:false});f.api.codeOpen.value=true;await nextTick();
 assert.equal(f.api.handoffLabel.value,'CODEへ');assert.equal(f.api.canHandoff.value,true);
 await f.api.handoff();
 assert.equal(f.receiverState.draft,'既存の下書き\n\n'+text);assert.equal(f.insertions.length,1);
 assert.equal(f.insertions[0].projectPath,'/fixture');assert.equal(f.insertions[0].text,text);
 assert.equal(f.api.draftRequest.value,null);assert.equal(f.api.result.value.nextPrompt,text);assert.equal(f.api.goal.value,'編集中の別目標');
 assert.equal(f.focus(),1);assert.equal(f.requests.length,0);assert.equal(f.api.autopilot.value,false);
});
test('連続した明示クリックは既存の本文を置換せず追記する',async t=>{
 const f=await fixture(t);f.api.codeOpen.value=true;await nextTick();
 await f.api.handoff();await f.api.handoff();assert.equal(f.receiverState.draft,'既存の下書き\n\n'+text+'\n\n'+text);assert.equal(f.requests.length,0);
});
for(const boundary of ['preparing','autopilot','busy','not-ready','missing-panel','missing-base','other-project','old-session','hidden','wrong-kind'])test(`内蔵Codeの${boundary}では無効化し、外部ダイアログへ迂回しない`,async t=>{
 const f=await fixture(t,{native:true});f.api.codeOpen.value=true;
 if(boundary==='preparing')f.api.codeOpening.value=true;
 if(boundary==='autopilot')f.api.autopilot.value=true;
 if(boundary==='busy')f.api.submitting.value=true;
 if(boundary==='not-ready')f.receiverState.ready=false;
 if(boundary==='missing-panel')f.api.codePanel.value=null;
 if(boundary==='missing-base')f.api.codeBase.value='';
 if(boundary==='old-session'){f.api.setCodeSession(2);f.api.codeOpen.value=false;f.api.codeOpen.value=true;}
 if(boundary==='other-project')f.receiverState.path='/other';
 if(boundary==='hidden')f.api.visible.value=false;
 if(boundary==='wrong-kind')f.api.codePanel.value.draftTarget=()=>({...f.receiver.target(),kind:'live'});
 await nextTick();assert.equal(f.api.canHandoff.value,false);await f.api.handoff();
 assert.equal(f.api.draftRequest.value,null);assert.equal(f.insertions.length,0);assert.equal(f.receiverState.draft,'既存の下書き');assert.equal(f.requests.length,0);
});
test('ready復帰後は同じパネルへ追加できる',async t=>{
 const f=await fixture(t);f.api.codeOpen.value=true;f.receiverState.ready=false;await nextTick();assert.equal(f.api.canHandoff.value,false);
 f.receiverState.ready=true;assert.equal(f.api.canHandoff.value,true);await f.api.handoff();assert.equal(f.receiverState.draft,'既存の下書き\n\n'+text);
});
test('受信先会話が直前に変われば拒否し、元の下書きを残す',async t=>{
 const f=await fixture(t,{native:true});f.api.codeOpen.value=true;await nextTick();
 f.api.codePanel.value.insertDraft=data=>{f.receiverState.session='conversation-2';return f.receiver.insert(data);};
 await f.api.handoff();assert.equal(f.receiverState.draft,'既存の下書き');assert.ok(f.api.handoffError.value);assert.equal(f.api.draftRequest.value,null);
});
test('文字数上限による受信拒否は本文を切り詰めずエラーを表示する',async t=>{
 const f=await fixture(t);f.api.codeOpen.value=true;f.receiverState.draft='x'.repeat(DRAFT_LIMITS.code);await nextTick();
 await f.api.handoff();assert.equal(f.receiverState.draft,'x'.repeat(DRAFT_LIMITS.code));assert.ok(f.api.handoffError.value);assert.equal(f.api.handoffBusy.value,false);assert.equal(f.api.draftRequest.value,null);
});
for(const standalone of [true,false])test(`Code非表示は従来の共通ダイアログを使用する（standalone=${standalone}）`,async t=>{
 const f=await fixture(t,{standalone,native:standalone});assert.equal(f.api.handoffLabel.value,'CODE/LIVEへ');assert.equal(f.api.canHandoff.value,true);
 await f.api.handoff();assert.equal(f.api.draftRequest.value.text,text);assert.equal(f.api.draftRequest.value.projectPath,'/fixture');assert.equal(f.insertions.length,0);assert.equal(f.requests.length,0);
});
test('内蔵Code非表示の単独Webは従来どおり外部連携しない',async t=>{
 const f=await fixture(t);assert.equal(f.api.canHandoff.value,false);await f.api.handoff();assert.equal(f.api.draftRequest.value,null);
});
for(const boundary of ['project','session','code-display','hidden','detached','prompt'])test(`${boundary}の変更で古い外部連携ダイアログを閉じる`,async t=>{
 const f=await fixture(t,{native:true});await f.api.handoff();assert.ok(f.api.draftRequest.value);
 if(boundary==='project')f.props.project={path:'/other'};
 if(boundary==='session')f.props.startedAt=2;
 if(boundary==='code-display')f.api.codeOpen.value=true;
 if(boundary==='hidden')f.api.visible.value=false;
 if(boundary==='detached')f.api.detached.value=true;
 if(boundary==='prompt')f.api.result.value={...saved(),nextPrompt:'新しい提案'};
 await nextTick();assert.equal(f.api.draftRequest.value,null);assert.equal(f.insertions.length,0);
});
test('提案のない全件完了時は下書きを作らない',async t=>{
 const f=await fixture(t);f.api.codeOpen.value=true;f.api.result.value={...saved(),items:[{id:'first',progress:100}],overall:{progress:100},nextItemId:null,nextPrompt:''};await nextTick();
 await f.api.handoff();assert.equal(f.insertions.length,0);assert.equal(f.api.draftRequest.value,null);
});
test('ボタンは動的ラベル・無効化・説明に接続し、失敗を通知する',()=>{
 const button=full.match(/<button[^>]*class="navigation-handoff"[^>]*>[\s\S]*?<\/button>/)?.[0];assert.ok(button);
 assert.match(button,/:disabled="!canHandoff"/);assert.match(button,/:title="handoffTitle"/);assert.match(button,/\{\{handoffLabel\}\}/);
 assert.match(full,/v-if="handoffError"[^>]*role="alert"/);
});

test('受信処理待ちの二重クリックは一度だけ追加し、送信しない',async t=>{
 const f=await fixture(t);f.api.codeOpen.value=true;await nextTick();let finish,calls=0;
 f.api.codePanel.value.insertDraft=data=>{calls++;return new Promise(resolve=>{finish=()=>resolve(f.receiver.insert(data));});};
 const first=f.api.handoff();assert.equal(f.api.handoffBusy.value,true);await f.api.handoff();assert.equal(calls,1);
 finish();await first;assert.equal(f.api.handoffBusy.value,false);assert.equal(f.receiverState.draft,'既存の下書き\n\n'+text);assert.equal(f.requests.length,0);
});
test('受信処理の例外はエラー表示し、外部へ迂回しない',async t=>{
 const f=await fixture(t,{native:true});f.api.codeOpen.value=true;await nextTick();
 f.api.codePanel.value.insertDraft=()=>{throw Error('追加できません');};await f.api.handoff();
 assert.match(f.api.handoffError.value,/追加できません/);assert.equal(f.api.handoffBusy.value,false);assert.equal(f.api.draftRequest.value,null);assert.equal(f.receiverState.draft,'既存の下書き');
});
