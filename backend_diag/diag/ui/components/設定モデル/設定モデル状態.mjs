// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';
import { 設定モデル音声を作成 } from './設定モデル音声.mjs';

// 試行は明示操作だけで開始し、サーバー指定順に一件ずつ待つ。共有判定はサーバーだけが行う。
export function 設定モデル状態を作成({ api, 接続可能 }) {
 const 設定=ref(null),結果=ref({}),読込中=ref(false),実行中=ref(false),選択=ref(''),通知=ref('');
 let 世代=0,制御,実行ID='',破棄済み=false;
 const 有効=()=>!破棄済み&&接続可能();
 const 音声=設定モデル音声を作成({api,接続可能:有効});
 async function サーバー中止(id){if(id)try{await api(`api/モデル試行/${encodeURIComponent(id)}`,'DELETE');}catch{/* 切断時も表示は無効化し、サーバー側の期限・切断処理に委ねる。 */}}
 function 中止(理由='試行を中止しました。'){
  音声.破棄();++世代;制御?.abort();制御=undefined;const id=実行ID;実行ID='';
  if(実行中.value){結果.value=Object.fromEntries(Object.entries(結果.value).map(([key,value])=>[key,value.状態==='実行中'?{...value,状態:'中止',説明:理由}:value]));通知.value=理由;}
  実行中.value=false;読込中.value=false;void サーバー中止(id);
 }
 async function 読込(){
  if(!有効()||読込中.value||実行中.value)return;
  中止();const 現在=++世代;制御=new AbortController();読込中.value=true;設定.value=null;結果.value={};通知.value='';
  try{const data=await api('api/モデル試行','GET',制御.signal);if(現在!==世代||!有効())return;設定.value=data;選択.value=data.項目?.[0]?.id||'';}
  catch(error){if(現在===世代)通知.value=error.message||'設定を取得できませんでした。';}
  finally{if(現在===世代){読込中.value=false;制御=undefined;}}
 }
 async function 開始(rowId){
  if(!有効()||実行中.value||読込中.value||!設定.value?.項目?.length)return;
  if(rowId!==undefined&&!設定.value.項目.some(row=>row.id===rowId))return;
  if(rowId==='PREDICTION'&&!設定.value.予測条件?.テスト可能){通知.value=設定.value.予測条件?.説明||'先にChatテストを成功させてください。';return;}
  中止();const 現在=++世代;制御=new AbortController();実行中.value=true;const 前版=設定.value.版;
  // 次の開始で音声は失効する。個別テストでは他の行のテキスト結果だけを残す。
  結果.value=rowId===undefined?{}:Object.fromEntries(Object.entries(結果.value).map(([id,{音声ファイル,...value}])=>[id,value]));通知.value='設定を確認して試行します…';
  let id='';
  try{
   const data=await api(`api/モデル試行/開始${rowId===undefined?'':`/${encodeURIComponent(rowId)}`}`,'POST',制御.signal);id=data.実行ID;
   if(現在!==世代||!有効()){void サーバー中止(id);return;}
   if(data.版!==前版)結果.value={};
   実行ID=id;設定.value=data;
   // 個別再試行でも、現在未導入の行に古い成功・失敗を残さない。
   for(const item of data.項目)if(item.状態==='未実施')結果.value={...結果.value,[item.id]:{id:item.id,状態:'未実施',説明:item.説明}};
   const 完了=new Set();
   for(const row of data.実行順||data.項目.map(item=>item.id)){
    const item=data.項目.find(item=>item.id===row);if(!item)throw new Error('試行する設定項目が見つかりません。');
    if(現在!==世代||!有効())return;
    const 対象=item.共有対象||[item.id];
    選択.value=item.id;通知.value=`${item.id} を確認中…`;
    if(!完了.has(item.id))結果.value={...結果.value,...Object.fromEntries(対象.map(id=>[id,{id,状態:item.状態==='未実施'?'未実施':'実行中',説明:item.説明}]))};
    const result=await api(`api/モデル試行/${encodeURIComponent(id)}/${encodeURIComponent(item.id)}`,'POST',制御.signal);
    if(現在!==世代||!有効())return;
    設定.value={...設定.value,チャット成功:result.チャット成功||[],予測条件:result.予測条件||設定.value.予測条件};
    const 共有元=result.共有元||item.id;
    結果.value={...結果.value,...Object.fromEntries(対象.map(id=>[id,{...result,id,共有元:id===共有元?'':共有元,所要ms:id===共有元?(結果.value[id]?.所要ms??result.所要ms):0}]))};
    // Live の音声はサーバー側の保存期限（10分）があるため、受け取った時点で取得し、再生ボタンですぐ聴けるようにする。
    if(result.音声ファイル)void 音声.読込(結果.value[item.id]);
    for(const id of 対象)完了.add(id);
    if(result.状態==='中止'||result.実行終了===true){通知.value=result.説明||'試行を中止しました。';return;}
   }
   通知.value='試行が完了しました。';
  }catch(error){
   if(現在===世代){if(設定.value)設定.value={...設定.value,チャット成功:[],予測条件:{...設定.value.予測条件,テスト可能:false}};通知.value=error.message||'通信に失敗しました。設定を再読込してください。';結果.value=Object.fromEntries(Object.entries(結果.value).map(([id,value])=>[id,value.状態==='実行中'?{id,状態:'ERR',説明:通知.value}:value]));}
  }finally{
   // 全行の動作確認が終わったら、1項目目（先頭行）を表示する（個別テスト・中止では選択を維持）。
   if(現在===世代){if(rowId===undefined&&設定.value?.項目?.length)選択.value=設定.value.項目[0].id;実行中.value=false;制御=undefined;実行ID='';await サーバー中止(id);}
  }
 }
 function 表示を離れる(){if(実行中.value||読込中.value)中止();}
 function 切断(){中止('Tools または診断への接続が切れたため、試行を中止しました。');設定.value=null;結果.value={};選択.value='';}
 function 終了(){中止();破棄済み=true;}
 return {音声状態:音声.音声状態,音声読込:音声.読込,音声再生失敗:音声.再生失敗,設定,結果,読込中,実行中,選択,通知,読込,開始,個別開始:(id=選択.value)=>開始(id),中止,表示を離れる,切断,終了};
}
