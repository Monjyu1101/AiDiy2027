// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref, computed } from 'vue';
import { 外部連携か, 確認不要か } from './キー設定表示.mjs';

// 2つの設定画面で取得・試験・公開キャッシュの世代を共有する。認証 API は App から受け取る。
export function キー設定状態を作成({ api, connected, message, setTimer=setTimeout, clearTimer=clearTimeout }) {
const keyData=ref(null),keyBusy=ref(false),keyTestingIds=ref(new Set()),keyTesting=computed(()=>[...keyTestingIds.value][0]||''),keyResults=ref({}),latestBusy=ref(false),modelWriteBusy=ref(false),modelWritten=ref(false);
const integrationBusy=ref(false),integrationWriteBusy=ref(false),integrationWritten=ref(false);
const modelLastRun=ref(null),integrationLastRun=ref(null);
let keyGeneration=0, keyBatchGeneration=0, publicPoll=null, publicGeneration=0;
const keyRequests=new Map();let keyPoll=null,keyPollRequest=null;
function stopKeyPoll(){clearTimer(keyPoll);keyPoll=null;keyPollRequest?.abort();keyPollRequest=null;}
function scheduleKeyPoll(delay=100){if(keyPoll===null && !keyPollRequest && keyRequests.size)keyPoll=setTimer(pollKeys,delay);}
async function pollKeys(){
 keyPoll=null;if(!connected.value || !keyRequests.size)return;
 const generation=keyGeneration,requests=new Map(keyRequests),controller=new AbortController();keyPollRequest=controller;
 try{
  const data=await api('api/キーテスト/進捗','GET',controller.signal);
  if(generation!==keyGeneration || controller.signal.aborted)return;
  const next={...keyResults.value};
  for(const row of data?.項目 || [])if(requests.get(row.id)===keyRequests.get(row.id) && keyRequests.has(row.id) && ['待機中','確認中'].includes(row.状態))next[row.id]={id:row.id,状態:row.状態,説明:row.状態==='待機中'?'先の確認が終わるまで待機しています。':'確認しています。'};
  keyResults.value=next;
 }catch{/* 進捗取得失敗は POST の結果判定を置き換えない。 */}
 finally{if(keyPollRequest===controller){keyPollRequest=null;if(generation===keyGeneration)scheduleKeyPoll(500);}}
}
const publicModels=ref({状態:'未取得',件数:0,世代:-1}),publicBusy=ref(false);
function resetPublic(){publicGeneration++;clearTimeout(publicPoll);publicModels.value={状態:'未取得',件数:0,世代:-1};publicBusy.value=false;}
function updatePublic(data){if(data && Number(data.世代)>=Number(publicModels.value.世代))publicModels.value=data;}
async function pollPublic(){clearTimeout(publicPoll);if(!connected.value)return;const generation=publicGeneration;try{const data=await api('api/公開モデル');if(generation!==publicGeneration)return;updatePublic(data);}catch(error){if(generation===publicGeneration)message.value=error.message;return;}if(publicModels.value.状態==='取得中')publicPoll=setTimeout(pollPublic,1000);}
async function refreshPublic(){if(publicBusy.value || !connected.value)return;publicBusy.value=true;const generation=publicGeneration;try{const pending=api('api/公開モデル/再取得','POST');publicPoll=setTimeout(pollPublic,100);const data=await pending;if(generation===publicGeneration)updatePublic(data);}catch(error){if(generation===publicGeneration)message.value=error.message;}finally{if(generation===publicGeneration)publicBusy.value=false;}}
// 一方の再確認では、もう一方の結果・日時・書込済み表示を保持する。
async function loadKeys({対象='all'}={}){
 if(!connected.value || keyBusy.value || keyTesting.value || modelWriteBusy.value || integrationWriteBusy.value)return;
 const models=対象!=='integrations',integrations=対象!=='models',初回=!keyData.value;
 keyBusy.value=true;if(models)modelWritten.value=false;if(integrations)integrationWritten.value=false;
 const generation=++keyGeneration;
 const 保持=Object.fromEntries(Object.entries(keyResults.value).filter(([id])=>外部連携か({id})?!integrations:!models));
 if(対象==='all')keyData.value=null;keyResults.value=保持;
 try{
  const route=対象==='models'?'api/キー設定/モデル一覧':対象==='integrations'?'api/キー設定/外部連携':'api/キー設定';
  const data=await api(route);if(generation!==keyGeneration)return;
  keyData.value=data;const previous=data.前回結果||{};
  const 復元=[...(models||初回?previous.モデル一覧?.結果||[]:[]),...(integrations||初回?previous.外部連携?.結果||[]:[])];
  keyResults.value={...Object.fromEntries(復元.filter(item=>data.項目.some(row=>row.id===item.id)).map(item=>[item.id,{...item,前回結果:true}])),...保持};
  if(models||初回)modelLastRun.value=previous.モデル一覧?.前回実行日時||null;
  if(integrations||初回)integrationLastRun.value=previous.外部連携?.前回実行日時||null;
  updatePublic(data.公開モデル);if(publicModels.value.状態==='取得中')publicPoll=setTimeout(pollPublic,1000);
  return true;
 }catch(error){if(generation===keyGeneration)message.value=error.message;}
 finally{if(generation===keyGeneration)keyBusy.value=false;}
}
async function testKey(id,{batch=false}={}){
 if(!connected.value || (keyRequests.has(id) || (!batch && keyTestingIds.value.has(id))) || keyBusy.value || (!batch && (latestBusy.value || integrationBusy.value)) || modelWriteBusy.value || integrationWriteBusy.value)return;
 // 外部連携とモデル情報は別ファイルへ保存するため、対象側の書込済み表示だけを消す。
 if(外部連携か({id}))integrationWritten.value=false;else modelWritten.value=false;

 const generation=keyGeneration,controller=new AbortController();keyRequests.set(id,controller);
 keyTestingIds.value=new Set([...keyTestingIds.value,id]);keyResults.value={...keyResults.value,[id]:{id,状態:'待機中',説明:'確認の開始を待っています。'}};

 scheduleKeyPoll();
 try{const result=await api(`api/キーテスト/${encodeURIComponent(id)}`,'POST',controller.signal);if(generation===keyGeneration && !controller.signal.aborted){keyResults.value={...keyResults.value,[id]:result};(外部連携か({id})?integrationLastRun:modelLastRun).value=result.前回実行日時||result.確認日時||new Date().toISOString();}}
 catch(error){if(generation===keyGeneration && !controller.signal.aborted){message.value=error.message;const next={...keyResults.value};delete next[id];keyResults.value=next;}}
 finally{if(keyRequests.get(id)===controller){keyRequests.delete(id);const next=new Set(keyTestingIds.value);next.delete(id);keyTestingIds.value=next;if(!keyRequests.size)stopKeyPoll();}}
}

// 一括は2本のワーカーでFIFO送信し、ブラウザの接続枠を進捗取得に残す。
async function testBatch(items){
 const generation=keyGeneration,ids=[...new Set(items.map(item=>item.id))];let cursor=0;
 keyTestingIds.value=new Set([...keyTestingIds.value,...ids]);
 keyResults.value={...keyResults.value,...Object.fromEntries(ids.map(id=>[id,{id,状態:'待機中',説明:'確認の開始を待っています。'}]))};
 const worker=async()=>{while(generation===keyGeneration && connected.value && cursor<ids.length){const id=ids[cursor++];await testKey(id,{batch:true});}};
 try{await Promise.allSettled([worker(),worker()]);}
 finally{if(generation===keyGeneration){const next=new Set(keyTestingIds.value);for(const id of ids)if(!keyRequests.has(id))next.delete(id);keyTestingIds.value=next;}}
}

// 一覧再取得: 設定状況を読み直し、モデル一覧のテスト可能な行を FIFO に投入し、同時2件まで取得する。
async function 一覧再取得(){
 if(!connected.value || latestBusy.value || integrationBusy.value || keyBusy.value || keyTesting.value)return;
 latestBusy.value=true;const operation=keyBatchGeneration,generation=keyGeneration+1;
 try{if(!await loadKeys({対象:'models'}))return;if(generation!==keyGeneration || !keyData.value)return;
  await testBatch(keyData.value.項目.filter(item=>!外部連携か(item) && !確認不要か(item) && item.テスト可能)); }
 finally{if(operation===keyBatchGeneration)latestBusy.value=false;}
}
// 外部連携の状況確認: 設定状況を読み直し、外部連携のテストできる行を FIFO に投入し、同時2件まで認証確認する。
// 全テストでは直前に設定を読込済みなので重複読込を省く。通常の再読込でもモデル一覧の結果は保持する。
async function 外部連携確認({再読込=true}={}){
 if(!connected.value || integrationBusy.value || latestBusy.value || keyBusy.value || keyTesting.value)return;
 integrationBusy.value=true;integrationWritten.value=false;const operation=keyBatchGeneration,generation=再読込||!keyData.value?keyGeneration+1:keyGeneration;
 try{if((再読込||!keyData.value)&&!await loadKeys({対象:'integrations'}))return;if(generation!==keyGeneration || !keyData.value)return;
  await testBatch(keyData.value.項目.filter(item=>外部連携か(item) && item.テスト可能)); }
 finally{if(operation===keyBatchGeneration)integrationBusy.value=false;}
}
// 外部連携の書込: サーバーが直前に確認した結果を integration_info.json へ保存する（画面の値は送らない）。
async function 外部連携書込(){
 if(!connected.value || integrationWriteBusy.value || integrationBusy.value || keyBusy.value || keyTesting.value || !Object.keys(keyResults.value).some(id=>外部連携か({id}) && !keyResults.value[id].前回結果))return false;
 integrationWriteBusy.value=true;const generation=keyGeneration;
 try{await api('api/外部連携書込','POST');if(generation===keyGeneration)integrationWritten.value=true;return true;}
 catch(error){if(generation===keyGeneration)message.value=error.message;return false;}
 finally{integrationWriteBusy.value=false;}
}
// モデル情報の書込: サーバーが直前に取得した結果をプロバイダ別ファイルへ保存する（画面の値は送らない）。
async function モデル書込(){
 if(!connected.value || modelWriteBusy.value || latestBusy.value || keyBusy.value || keyTesting.value || !Object.keys(keyResults.value).some(id=>!外部連携か({id}) && !keyResults.value[id].前回結果))return false;
 modelWriteBusy.value=true;const generation=keyGeneration;
 try{await api('api/モデル書込','POST');if(generation===keyGeneration)modelWritten.value=true;return true;}
 catch(error){if(generation===keyGeneration)message.value=error.message;return false;}
 finally{modelWriteBusy.value=false;}
}
function 設定を破棄(){keyGeneration++;keyBatchGeneration++;stopKeyPoll();for(const controller of keyRequests.values())controller.abort();keyRequests.clear();latestBusy.value=false;integrationBusy.value=false;modelWritten.value=false;modelLastRun.value=null;integrationLastRun.value=null;resetPublic();keyData.value=null;keyResults.value={};keyBusy.value=false;keyTestingIds.value=new Set();integrationWritten.value=false;}
function 終了(){設定を破棄();}
return { modelLastRun,integrationLastRun,keyData,keyBusy,keyTesting,keyTestingIds,keyResults,latestBusy,modelWriteBusy,modelWritten,integrationBusy,integrationWriteBusy,integrationWritten,publicModels,publicBusy,loadKeys,testKey,一覧再取得,モデル書込,外部連携確認,外部連携書込,refreshPublic,resetPublic,設定を破棄,終了 };
}
