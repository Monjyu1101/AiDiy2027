// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 状態通知は同じ公開元のビューアへ再取得を促すだけ。結果は必ずサーバーから読む。
const analysisChannel='aidiy-file-analysis';
const openChannel=name=>typeof window==='undefined'||!window.BroadcastChannel?null:new window.BroadcastChannel(name);
export const fileAnalysisBusy=job=>job?.status==='waiting'||!!job?.monitoring;
export function notifyFileAnalysisChanged(path,root,channelFactory=openChannel){
 if(!path||!root)return;
 let channel;
 try{channel=channelFactory(analysisChannel);channel?.postMessage({path,root});}
 catch{/* 受理済みの解析は通知失敗でも継続する。再表示時にも状態を確認する。 */}
 finally{channel?.close();}
}
// 表示中のファイルだけを監視する。移動・閉鎖で解除するのはGETで、解析は止めない。
export function createFileAnalysisStatus({read,changed,setTimer=setTimeout,clearTimer=clearTimeout,pollMs=2000,retryMs=10000,channelFactory=openChannel}){
 let target=null,revision=0,controller,timer,disposed=false,channel;
 const clear=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;controller?.abort();controller=undefined;};
 function schedule(delay){timer=setTimer(()=>{timer=undefined;void refresh();},delay);}
 async function refresh(){
  if(disposed||!target)return;
  clear();const run=++revision,current=target;controller=new AbortController();const signal=controller.signal;
  const valid=()=>!disposed&&run===revision&&target===current&&!signal.aborted;
  try{
   const data=await read(current.path,signal);if(!valid())return;
   if(data?.path!==current.path||[data.job,data.result].some(item=>item?.path&&item.path!==current.path))throw Error('解析対象が変わりました。');
   const status=fileAnalysisBusy(data.job)?'waiting':['failed','timeout','invalid','interrupted'].includes(data.job?.status)?'failed':data.result?'complete':'idle';
   changed({...current,status,message:data.job?.message||'',stale:!!data.stale,resultId:data.result?.id||'',jobId:data.job?.id||''});
   if(status==='waiting')schedule(pollMs);
  }catch{
   if(!valid())return;
   changed({...current,status:'unavailable',message:'解析状況を確認できません。「AI解析」から再確認してください。'});
   schedule(retryMs);
  }
 }
 try{
  channel=channelFactory(analysisChannel);
  if(channel)channel.onmessage=event=>{if(!disposed&&target&&event.data?.path===target.path&&event.data?.root===target.root)void refresh();};
 }catch{/* 通知が使えなくても再表示・待機中の監視は続ける。 */}
 return{
  setFile(path,root,enabled=true){
   if(disposed)return;
   const key=enabled&&typeof path==='string'&&typeof root==='string'&&root?path:'';
   if(target?.path===key&&target.root===root||!target&&!key)return;
   clear();++revision;target=key?{path:key,root}:null;changed({path:key,root,status:'idle'});
   if(target)void refresh();
  },
  refresh,
  dispose(){if(disposed)return;disposed=true;++revision;target=null;clear();channel?.close();},
 };
}
