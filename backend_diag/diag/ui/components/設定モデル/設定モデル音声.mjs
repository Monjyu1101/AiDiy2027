// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';

// 音声URLに認証情報を含めず、認証済みAPIから取得した一時Blobだけを再生する。
export function 再生可能な音声(result){
 const audio=result?.音声ファイル;
 return audio && /^[a-f0-9]{32}$/.test(audio.id) && audio.MIME==='audio/wav' && Number.isFinite(audio.長さms) && audio.長さms>=1000 ? audio : null;
}
export function 設定モデル音声を作成({api,接続可能,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}){
 const 音声状態=ref({});let 世代=0;const requests=new Map();
 function 破棄(){世代++;for(const controller of requests.values())controller.abort();requests.clear();for(const state of Object.values(音声状態.value))if(state.url)revokeURL(state.url);音声状態.value={};}
 async function 読込(result){
  const audio=再生可能な音声(result);if(!audio||!接続可能()||requests.has(audio.id)||音声状態.value[audio.id]?.url)return;
  const current=世代,controller=new AbortController();requests.set(audio.id,controller);音声状態.value={...音声状態.value,[audio.id]:{読込中:true}};
  try{
   const blob=await api(`api/モデル試行/音声/${encodeURIComponent(audio.id)}`,'GET',controller.signal,'blob');
   if(current!==世代||!接続可能())return;
   if(blob.type!=='audio/wav'||blob.size<44||blob.size>4*1024*1024)throw new Error('invalid audio');
   const url=createURL(blob);音声状態.value={...音声状態.value,[audio.id]:{url,読込中:false}};
  }catch{if(current===世代)音声状態.value={...音声状態.value,[audio.id]:{読込中:false,エラー:'音声を取得できませんでした。再読込するか、試行をやり直してください。'}};}
  finally{if(current===世代)requests.delete(audio.id);}
 }
 function 再生失敗(id){const state=音声状態.value[id];if(!state?.url)return;revokeURL(state.url);音声状態.value={...音声状態.value,[id]:{読込中:false,エラー:'この音声を再生できませんでした。再読込してください。'}};}
 return {音声状態,読込,破棄,再生失敗};
}
