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
// 表示中URLだけを監視する。離脱はGETの購読解除であり、サーバーの解析を取り消さない。
export function createBrowserAnalysisStatus({read,changed,setTimer=setTimeout,clearTimer=clearTimeout,pollMs=2000,retryMs=10000}){
 let target=null,revision=0,controller,timer,disposed=false,last={status:'idle'};
 const clear=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;controller?.abort();controller=undefined;};
 const publish=value=>{last=value;changed(value);};
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
   const retry=last.status==='waiting'||last.status==='unavailable';
   publish({url:current.url,status:'unavailable',message:'解析状況を確認できません。「AI解析」から再確認してください。'});
   if(retry)schedule(retryMs);
  }
 }
 return{
  setPage(url,enabled=true,session=''){
   if(disposed)return;
   const key=enabled?browserAnalysisPageKey(url):'';
   if(target?.url===key&&target.session===session||!target&&!key)return;
   clear();++revision;target=key?{url:key,session}:null;publish({url:key,status:'idle'});
   if(target)void refresh();
  },
  refresh,
  dispose(){if(disposed)return;disposed=true;++revision;target=null;clear();},
 };
}
