// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {ref,reactive,computed,nextTick} from 'vue';
import {設定モデル音声を作成} from '../設定モデル/設定モデル音声.mjs';
import {TRIAL_PROMPT,decisionQuestions,TRIAL_FAMILIES} from '../../../../モデル試行/defaults.mjs';

export function AIモデル状態を作成({api,接続可能,createURL,revokeURL}){
 const 一覧=ref(null),区分=ref('CHAT'),結果一覧=ref({}),実行中=ref(false),読込中=ref(false),通知=ref('');
 const families=TRIAL_FAMILIES;
 const チャット成功=ref([]);
 const 経過=ref([]);
 const question=decisionQuestions()[0];
 const forms=Object.fromEntries(families.map(f=>[f,reactive({provider:'',model:'',voice:'',prompt:TRIAL_PROMPT,type:question.type,name:question.name,instructions:question.instructions,choices:question.choices.map(c=>c.value).join('\n')})]));
 let 入力=forms.CHAT;
 const 結果=computed(()=>結果一覧.value[区分.value]||null);
 const 音声=設定モデル音声を作成({api,接続可能,createURL,revokeURL});
 let 世代=0,controller,runId='',cancelled=Promise.resolve(),disposed=false;
 const プロバイダ=computed(()=>一覧.value?.区分?.[区分.value]?.プロバイダ||[]);
 const 選択肢=computed(()=>プロバイダ.value.find(p=>p.id===forms[区分.value].provider));
 const モデル=computed(()=>選択肢.value?.モデル||[]),音声候補=computed(()=>選択肢.value?.音声||[]);
 const 予測条件=computed(()=>{const form=forms.PREDICTION,provider=一覧.value?.区分?.PREDICTION?.プロバイダ?.find(p=>p.id===form.provider),model=provider?.モデル?.find(m=>m.id===form.model);return {プロバイダ:model?.解決プロバイダ,モデル:model?.解決モデル,テスト可能:model?.利用可能===true&&チャット成功.value.length>0,説明:model?.説明||'先にChatテストを成功させてください。'};});
 const remembered=new Map();
 function 中止(message='',preserveChat=false,preserveResults=false,preserveAudio=false){
  const invalidate=!preserveChat&&チャット成功.value.length>0;
  if(!preserveChat)チャット成功.value=[];
  世代++;controller?.abort();controller=null;if(!preserveAudio)音声.破棄();if(!preserveResults)結果一覧.value=preserveChat?Object.fromEntries(Object.entries(結果一覧.value).map(([key,{音声ファイル,...value}])=>[key,value])):{};実行中.value=false;読込中.value=false;通知.value=message;
  const id=runId;runId='';
  if(id||invalidate)cancelled=Promise.all([...(id?[api(`api/モデル試行/${id}`,'DELETE').catch(()=>{})]:[]),...(invalidate?[api('api/モデル試行/チャット成功','DELETE')]:[])]);
  cancelled.catch(()=>{});
 }
 function remember(){if(入力.provider)remembered.set(`${区分.value}/${入力.provider}`,{model:入力.model,voice:入力.voice});}
 function 連動(){
  const prior=remembered.get(`${区分.value}/${入力.provider}`);
  入力.model=モデル.value.some(m=>m.id===prior?.model)?prior.model:選択肢.value?.現在モデル||モデル.value[0]?.id||'';
  入力.voice=音声候補.value.some(v=>v.id===prior?.voice)?prior.voice:選択肢.value?.現在音声||音声候補.value[0]?.id||'';
 }
 // 表示結果とChat成功資格は別管理。入力変更は対象結果だけを消し、Chat変更時は予測の資格を無効化する。
 function 変更(key,value){remember();const chat=区分.value==='CHAT';中止('',!chat,true,区分.value!=='LIVE');const {[区分.value]:_,...rest}=結果一覧.value;結果一覧.value=rest;入力[key]=value;if(key==='provider')連動();remember();}
 function 表示を離れる(){if(実行中.value||読込中.value)中止();}
 function 区分変更(value){remember();表示を離れる();区分.value=value;入力=forms[value];if(!入力.provider){入力.provider=プロバイダ.value[0]?.id||'';連動();}}
 async function 読込(){
  if(!接続可能()||disposed)return;中止();const current=世代;controller=new AbortController();読込中.value=true;
  try{const data=await api('api/AIモデル','GET',controller.signal);if(current!==世代||disposed)return;一覧.value=data;チャット成功.value=data.チャット成功||[];remembered.clear();for(const family of families){const providers=data.区分?.[family]?.プロバイダ||[],initial=data.初期値?.[family],provider=providers.find(p=>p.id===initial?.provider)||providers[0];Object.assign(forms[family],{provider:provider?.id||'',model:initial?.provider===provider?.id?initial.model:provider?.現在モデル||provider?.モデル?.[0]?.id||'',voice:initial?.provider===provider?.id?initial.voice||'':provider?.現在音声||provider?.音声?.[0]?.id||''});}入力=forms[区分.value];}
  catch(error){if(current===世代)通知.value=error.message;}
  finally{if(current===世代){読込中.value=false;controller=null;}}
 }
 function payload(family=区分.value,form=入力){
  const 入力=form;
  const value={family,provider:入力.provider,model:入力.model,...(family==='PREDICTION'?{}:{voice:入力.voice,prompt:入力.prompt})};
  if(!value.provider||!value.model||(family!=='PREDICTION'&&!value.prompt.trim())||(value.family==='LIVE'&&!value.voice))throw Error('プロバイダ・モデル・入力・音声を確認してください。');
  if(value.family==='DECISION'){
   if(!入力.name.trim()||!入力.instructions.trim())throw Error('質問名と質問文を入力してください。');
   const q={type:入力.type,name:入力.name.trim(),instructions:入力.instructions.trim()};
   if(q.type!=='predicate'){
    const values=入力.choices.split('\n').map(s=>s.trim()).filter(Boolean);
    if(values.length<2||values.length>32||new Set(values).size!==values.length)throw Error('選択肢・段階は重複のない2〜32件を1行ずつ入力してください。');
    q[q.type==='choice'?'choices':'levels']=values.map(v=>({[q.type==='choice'?'value':'label']:v,description:''}));
   }
   value.questions=[q];
  }
  return value;
 }
 async function 開始(all=false){
  if(実行中.value||読込中.value||!接続可能()||disposed)return;
  if(all!==true&&区分.value==='PREDICTION'&&!予測条件.value.テスト可能){通知.value=予測条件.value.説明;return;}
  const queue=all===true?families:[区分.value];
  const snapshots=queue.map(family=>{try{return {family,body:payload(family,forms[family])};}catch(error){return {family,error:error.message};}});
  if(all!==true&&snapshots[0].error){通知.value=snapshots[0].error;return;}
  中止('',!queue.includes('CHAT'),all!==true,!queue.includes('LIVE'));
  // 単発再試行では対象だけ更新し、他区分の前回結果（音声を含む）を保持する。
  if(all!==true){const {[queue[0]]:_,...rest}=結果一覧.value;結果一覧.value=rest;}
  const current=世代;controller=new AbortController();const signal=controller.signal;実行中.value=true;通知.value='実行中…';
  try{
   await cancelled;if(current!==世代)return;
   const start=await api('api/AIモデル/開始','POST',signal,'json',all===true?{items:snapshots.map(e=>e.body||{family:e.family})}:snapshots[0].body);
   if(current!==世代||disposed){void api(`api/モデル試行/${start.実行ID}`,'DELETE').catch(()=>{});return;}
   runId=start.実行ID;チャット成功.value=start.チャット成功||[];
   for(const entry of snapshots){
   if(current!==世代||disposed||!接続可能())return;
   区分.value=entry.family;入力=forms[entry.family];通知.value=`${entry.family} 実行中…`;
   // 実行する区分を描画してから問い合わせる。手動切替による中止もここで反映する。
   await nextTick();if(current!==世代||disposed||!接続可能())return;
   const body=entry.body||{family:entry.family};
   const rowId=entry.family==='CODE'?'CODE1':entry.family;
   // 予測は1回の要求で2ターン＋予測まで進むため、実行中の経過を1秒ごとに取得して表示する。
   let timer;
   if(entry.family==='PREDICTION'){const id=runId;経過.value=[];timer=setInterval(()=>{api(`api/モデル試行/${id}/経過`,'GET',signal).then(p=>{if(current===世代&&実行中.value)経過.value=p.経過||[];}).catch(()=>{});},1000);}
   let result;
   try{result=await api(`api/モデル試行/${runId}/${rowId}`,'POST',signal);}finally{clearInterval(timer);}
   if(entry.family==='PREDICTION')経過.value=result.経過||経過.value;
   if(current!==世代||disposed||!接続可能())return;
   チャット成功.value=result.チャット成功||[];
   結果一覧.value={...結果一覧.value,[entry.family]:{...result,指定プロバイダ:body.provider,指定モデル:body.model}};通知.value=result.状態==='OK'?'完了':result.説明||'試行に失敗しました。';
   if(body.family==='LIVE')await 音声.読込(result);
   if(result.実行終了)break;
   }
   runId='';
   if(current===世代&&all===true){区分.value=families[0];入力=forms[families[0]];通知.value='一括試行が完了しました。';}
  }catch(error){if(current===世代){チャット成功.value=[];結果一覧.value={...結果一覧.value,[区分.value]:{状態:'NG',説明:error.message}};通知.value=error.message;}}
  finally{if(current===世代){if(runId){const id=runId;runId='';cancelled=api(`api/モデル試行/${id}`,'DELETE').catch(()=>{});}実行中.value=false;controller=null;}}
 }
 return {一覧,区分,予測条件,チャット成功,経過,get 入力(){return forms[区分.value];},プロバイダ,モデル,音声候補,結果,結果一覧,実行中,読込中,通知,音声状態:音声.音声状態,変更,区分変更,読込,開始,中止,表示を離れる,音声読込:音声.読込,音声再生失敗:音声.再生失敗,終了(){中止();disposed=true;}};
}
