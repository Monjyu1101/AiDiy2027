// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileAnalysisStatus,fileAnalysisBusy,notifyFileAnalysisChanged} from '../src/components/ファイル閲覧/ファイル解析状態.js';
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
function fixture(){
 const requests=[],updates=[],timers=new Map(),channels=new Set();let id=0;
 const channelFactory=()=>{const channel={postMessage(data){for(const other of channels)if(other!==channel)other.onmessage?.({data});},close(){channels.delete(channel);}};channels.add(channel);return channel;};
 const monitor=createFileAnalysisStatus({read:(path,signal)=>new Promise((resolve,reject)=>requests.push({path,signal,resolve,reject})),changed:value=>updates.push(value),setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),channelFactory});
 return{monitor,requests,updates,timers,channels,channelFactory,get last(){return updates.at(-1);},reply(data,index=requests.length-1){requests[index].resolve(data);},tick(){const [id,{fn}]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('ファイル解析状態: 別ファイルへ移動後もサーバー解析は止めず、戻ると進行中・完了を復元する',async()=>{
 const f=fixture();f.monitor.setFile('src/日本語 & #.vue','/project');f.reply({path:'src/日本語 & #.vue',job:{id:'running',status:'waiting'},result:null});await flush();assert.equal(f.last.status,'waiting');assert.equal(f.timers.size,1);
 f.monitor.setFile('b.py','/project');assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.timers.size,0);f.reply({path:'b.py',job:null,result:null});await flush();assert.equal(f.last.status,'idle');
 f.monitor.setFile('src/日本語 & #.vue','/project');f.reply({path:'src/日本語 & #.vue',job:{status:'waiting'},result:{id:'partial'}});await flush();assert.equal(f.last.status,'waiting');f.tick();f.reply({path:'src/日本語 & #.vue',job:{status:'complete',monitoring:false},result:{id:'done'},stale:true});await flush();assert.equal(f.last.status,'complete');assert.equal(f.last.stale,true);assert.equal(f.timers.size,0);f.monitor.dispose();
});
test('ファイル解析状態: 3件の保存後も実行応答の監視中は解析中を保つ',async()=>{
 const f=fixture();f.monitor.setFile('a.vue','/project');f.reply({path:'a.vue',job:{status:'complete',monitoring:true},result:{id:'partial'}});await flush();assert.equal(f.last.status,'waiting');assert.equal(f.timers.size,1);
 assert.equal(fileAnalysisBusy({status:'waiting',monitoring:false}),true);assert.equal(fileAnalysisBusy({status:'complete',monitoring:false}),false);f.tick();f.reply({path:'a.vue',job:{status:'complete',monitoring:false},result:{id:'done'}});await flush();assert.equal(f.last.status,'complete');assert.equal(f.timers.size,0);f.monitor.dispose();
});
test('ファイル解析状態: A→B→A・プロジェクト切替の遅い応答を反映しない',async()=>{
 const f=fixture();f.monitor.setFile('a.vue','/one');f.monitor.setFile('b.vue','/one');f.monitor.setFile('a.vue','/two');f.reply({path:'a.vue',job:{status:'waiting'}},0);f.reply({path:'b.vue',result:{id:'other'}},1);await flush();assert.equal(f.last.status,'idle');assert.equal(f.last.root,'/two');
 f.reply({path:'a.vue',job:{id:'right',status:'waiting'}});await flush();assert.equal(f.last.jobId,'right');f.monitor.dispose();assert.equal(f.timers.size,0);assert.equal(f.channels.size,0);
});
test('ファイル解析状態: 初回・実行中の通信失敗を再確認し、過去結果と失敗を区別する',async()=>{
 const f=fixture();f.monitor.setFile('a.vue','/project');f.requests[0].reject(Error('offline'));await flush();assert.equal(f.last.status,'unavailable');assert.equal([...f.timers.values()][0].delay,10000);
 f.tick();f.reply({path:'a.vue',job:{status:'waiting'}});await flush();assert.equal(f.last.status,'waiting');f.tick();f.requests.at(-1).reject(Error('offline again'));await flush();assert.equal(f.last.status,'unavailable');assert.equal(f.timers.size,1);
 for(const status of ['failed','timeout','invalid','interrupted']){await f.monitor.setFile(status+'.vue','/project');f.reply({path:status+'.vue',job:{id:'failed',status,message:'確認が必要'},result:{id:'previous'}});await flush();assert.equal(f.last.status,'failed');assert.equal(f.last.resultId,'previous');assert.equal(f.timers.size,0);}
 f.monitor.dispose();
});
test('ファイル解析状態: 通知は対象の再取得だけ行い、同名の別プロジェクト・別ファイルは無視する',async()=>{
 const f=fixture();f.monitor.setFile('a.vue','/project');f.reply({path:'a.vue',job:null,result:null});await flush();
 notifyFileAnalysisChanged('a.vue','/other',f.channelFactory);notifyFileAnalysisChanged('b.vue','/project',f.channelFactory);assert.equal(f.requests.length,1);
 notifyFileAnalysisChanged('a.vue','/project',f.channelFactory);assert.equal(f.requests.length,2);assert.equal(f.channels.size,1);assert.equal(f.last.status,'idle');f.reply({path:'a.vue',job:{status:'waiting'}});await flush();assert.equal(f.last.status,'waiting');
 f.monitor.dispose();notifyFileAnalysisChanged('a.vue','/project',f.channelFactory);assert.equal(f.requests.length,2);assert.equal(f.channels.size,0);
});
test('ファイル解析状態: 閉鎖・無効化はGETだけ中止し、別対象応答を受け付けない',async()=>{
 const f=fixture();f.monitor.setFile('a.vue','/project');f.monitor.setFile('a.vue','/project',false);f.reply({path:'a.vue',job:{status:'waiting'}});await flush();assert.equal(f.last.status,'idle');assert.equal(f.last.path,'');assert.equal(f.requests[0].signal.aborted,true);
 f.monitor.setFile('a.vue','/project');f.reply({path:'a.vue',job:{path:'b.vue',status:'waiting'}});await flush();assert.equal(f.last.status,'unavailable');const read=f.monitor.refresh();f.monitor.dispose();f.reply({path:'a.vue',result:{id:'late'}});await read;assert.equal(f.last.status,'unavailable');assert.equal(f.timers.size,0);f.monitor.setFile('b.vue','/project');await f.monitor.refresh();assert.equal(f.requests.length,3);
});
test('ファイル解析状態: 通知機能が使えなくても取得と待機監視は続ける',async()=>{
 assert.doesNotThrow(()=>notifyFileAnalysisChanged('a.vue','/project',()=>{throw Error('unavailable');}));let updates=[];
 const monitor=createFileAnalysisStatus({channelFactory:()=>{throw Error('unavailable');},read:async path=>({path,result:{id:'done'}}),changed:value=>updates.push(value)});monitor.setFile('a.vue','/project');await flush();assert.equal(updates.at(-1).status,'complete');monitor.dispose();
});

test('ファイル解析状態: 実BroadcastChannelは送信元を閉じても別購読へ再取得を届ける',async()=>{
 const name='file-analysis-test-'+Math.random(),channelFactory=channel=>new BroadcastChannel(channel+'-'+name);let reads=0,changed;
 const monitor=createFileAnalysisStatus({channelFactory,read:async path=>{reads++;return{path,result:reads>1?{id:'completed'}:null};},changed:value=>{changed=value;}});
 try{
  monitor.setFile('a.vue','/project');await flush();assert.equal(reads,1);notifyFileAnalysisChanged('a.vue','/project',channelFactory);
  for(let n=0;n<100&&reads<2;n++)await new Promise(resolve=>setTimeout(resolve,10));await flush();assert.equal(reads,2);assert.equal(changed.status,'complete');assert.equal(changed.resultId,'completed');
 }finally{monitor.dispose();}
});
