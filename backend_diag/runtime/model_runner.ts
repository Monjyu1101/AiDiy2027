// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 期限・同時実行・キャンセルをすべてのモデル処理に適用。子プロセスやPython不要。
import {status,probe,publicCatalog,KEY_PROVIDERS,RESPONSE_LIMIT,type Reader,type Fetch} from './model_probe';
export type RunOptions={reader?:Reader;fetch?:Fetch;input?:unknown;now?:Date;timeout?:number;signal?:AbortSignal;onState?:(state:'待機中'|'確認中')=>void};
type Response={data?:unknown;error?:string};
export function createModelRunner(){
 const active=new Set<AbortController>();let stopping=false;
 type Job={start:()=>void;stop:()=>void};
 const queue:Job[]=[];
 const pending=new Map<string,{promise:Promise<Response>;state:'待機中'|'確認中';listeners:Set<NonNullable<RunOptions['onState']>>}>();
 const notify=(callback:RunOptions['onState'],state:'待機中'|'確認中')=>{try{callback?.(state);}catch{/* 表示側の失敗では処理を止めない。 */}};
 const drain=()=>{while(!stopping&&active.size<2&&queue.length)queue.shift()!.start();};
 const cancel=()=>{stopping=true;for(const job of [...queue])job.stop();for(const controller of active)controller.abort();};
 const execute=async(action:string,id?:string,options:RunOptions={}):Promise<Response>=>{
  if(!['status','public','test'].includes(action)||(action==='test'&&!KEY_PROVIDERS.some(p=>p.id===id)))return {error:'unsupported'};
  if(stopping||options.signal?.aborted)return {error:'stopped'};
  const controller=new AbortController();active.add(controller);
  let timeout=false,timer:ReturnType<typeof setTimeout>|undefined;
  const externalAbort=()=>controller.abort();options.signal?.addEventListener('abort',externalAbort,{once:true});
  try {
   if(action==='test'&&Buffer.byteLength(JSON.stringify(options.input??{}))>RESPONSE_LIMIT)return {error:'input'};
   return await new Promise<Response>(resolve=>{
    let ended=false;
    const finish=(result:Response)=>{if(ended)return;ended=true;controller.signal.removeEventListener('abort',aborted);resolve(result);};
    const aborted=()=>finish({error:timeout?'timeout':'stopped'});
    controller.signal.addEventListener('abort',aborted,{once:true});
    timer=setTimeout(()=>{timeout=true;controller.abort();},options.timeout??25000);
    const injected={...options,cache:options.input,signal:controller.signal};
    Promise.resolve().then<unknown>(()=>action==='status'?status(injected):action==='public'?publicCatalog(injected):probe(id!,injected)).then(data=>{
     try {if(Buffer.byteLength(JSON.stringify(data))>RESPONSE_LIMIT)return finish({error:'output'});finish({data});}catch{finish({error:'output'});}
    },()=>finish({error:'failed'}));
   });
  }catch{return {error:'input'};}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',externalAbort);active.delete(controller);controller.abort();}
 };
 const run=(action:string,id?:string,options:RunOptions={}):Promise<Response>=>{
  if(!['status','public','test'].includes(action)||(action==='test'&&!KEY_PROVIDERS.some(p=>p.id===id)))return Promise.resolve({error:'unsupported'});
  if(stopping||options.signal?.aborted)return Promise.resolve({error:'stopped'});
  // 同じ操作は共有し、連打で待機列が増え続けることを防ぐ。
  const key=action==='test'?`${action}:${id}`:action,existing=pending.get(key);
  if(existing){if(options.onState)existing.listeners.add(options.onState);notify(options.onState,existing.state);return existing.promise;}
  let resolve!:(result:Response)=>void;
  const entry={promise:new Promise<Response>(r=>{resolve=r;}),state:'待機中' as '待機中'|'確認中',listeners:new Set<NonNullable<RunOptions['onState']>>()};
  if(options.onState)entry.listeners.add(options.onState);
  pending.set(key,entry);
  let started=false,finished=false;
  const finish=(result:Response)=>{if(finished)return;finished=true;options.signal?.removeEventListener('abort',job.stop);pending.delete(key);resolve(result);drain();};
  const job:Job={
   stop:()=>{if(started)return;const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);finish({error:'stopped'});},
   start:()=>{started=true;options.signal?.removeEventListener('abort',job.stop);entry.state='確認中';
    // execute が同じ同期ターン内で枠を確保してから、表示を通知する。
    const execution=execute(action,id,options);for(const listener of entry.listeners)notify(listener,entry.state);
    execution.then(finish,()=>finish({error:'failed'}));}
  };
  queue.push(job);options.signal?.addEventListener('abort',job.stop,{once:true});
  for(const listener of entry.listeners)notify(listener,'待機中');
  if(options.signal?.aborted)job.stop();else drain();
  return entry.promise;
 };
 return {run,cancel};
}
const runner=createModelRunner();
export const runModels=runner.run,cancelKeyProbes=runner.cancel;
