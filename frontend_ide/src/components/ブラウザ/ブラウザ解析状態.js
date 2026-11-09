// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {normalizeDisplayUrls} from '../../../viewer/表示URL.mjs';
export function browserAnalysisPageKey(value){
 if(typeof value!=='string'||value.length>4096)return '';
 if(!/^file:/i.test(value))return normalizeDisplayUrls([{url:value}])[0]?.url||'';
 try{const url=new URL(value);return url.hostname||url.search||url.hash||url.username||url.password?'':url.href.replace(/%[0-9a-f]{2}/gi,part=>part.toUpperCase());}catch{return '';}
}
// 同じ公開元（プロジェクト）の解析子窓から状態の再取得だけを知らせる。
// ジョブ・解析結果を通知の内容で更新せず、必ずサーバーに照会する。
const analysisChannel='aidiy-browser-analysis';
const openChannel=name=>typeof window==='undefined'||!window.BroadcastChannel?null:new window.BroadcastChannel(name);
export function notifyBrowserAnalysisChanged(url,channelFactory=openChannel){
 const key=browserAnalysisPageKey(url);if(!key)return;
 let channel;
 try{channel=channelFactory(analysisChannel);channel?.postMessage({url:key});}
 catch{/* 通知失敗で受理済みの解析を失敗扱いにしない。再表示時にも状態を取得する。 */}
 finally{channel?.close();}
}
// 表示中URLだけを監視する。離脱はGETの購読解除であり、サーバーの解析を取り消さない。
export function createBrowserAnalysisStatus({read,changed,setTimer=setTimeout,clearTimer=clearTimeout,pollMs=2000,retryMs=10000,channelFactory=openChannel}){
 let target=null,revision=0,controller,timer,disposed=false,channel;
 const clear=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;controller?.abort();controller=undefined;};
 const publish=value=>changed(value);
 function schedule(delay){timer=setTimer(()=>{timer=undefined;void refresh();},delay);}
 async function refresh(){
  if(disposed||!target)return;
  clear();const run=++revision,current=target;controller=new AbortController();const signal=controller.signal;
  const valid=()=>!disposed&&run===revision&&target===current&&!signal.aborted;
  try{
   const data=await read(current.url,signal);if(!valid())return;
   if(browserAnalysisPageKey(data?.url)!==current.url||[data?.job,data?.result].some(item=>item?.url&&browserAnalysisPageKey(item.url)!==current.url))throw Error('解析対象が変わりました。');
   const status=data.job?.status==='waiting'?'waiting':['failed','timeout','invalid'].includes(data.job?.status)?'failed':data.result?'complete':'idle';
   publish({url:current.url,status,message:data.job?.message||'',resultId:data.result?.id||'',jobId:data.job?.id||''});
   if(status==='waiting')schedule(pollMs);
  }catch(error){
   if(!valid())return;
   publish({url:current.url,status:'unavailable',message:'解析状況を確認できません。「AI解析」から再確認してください。'});
   schedule(retryMs);
  }
 }
 try{
  channel=channelFactory(analysisChannel);
  if(channel)channel.onmessage=event=>{if(!disposed&&target&&browserAnalysisPageKey(event.data?.url)===target.url)void refresh();};
 }catch{/* 通知を使えない環境でも、ページ復帰時の取得・待機中の監視は続ける。 */}
 return{
  setPage(url,enabled=true,session=''){
   if(disposed)return;
   const key=enabled?browserAnalysisPageKey(url):'';
   if(target?.url===key&&target.session===session||!target&&!key)return;
   clear();++revision;target=key?{url:key,session}:null;publish({url:key,status:'idle'});
   if(target)void refresh();
  },
  refresh,
  dispose(){if(disposed)return;disposed=true;++revision;target=null;clear();channel?.close();},
 };
}
