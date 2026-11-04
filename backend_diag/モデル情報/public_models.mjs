// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 起動中だけ保持する匿名公開メタデータ。キー設定・認証試験結果とは別管理。
// ネットワークで取得できない場合は、同梱の公開一覧（キャッシュ）を同じ絞り込みで使う。
import {runModels} from './key_status.mjs';
import {publicFailureDescription} from '../runtime/model_probe.mjs';
import {loadBundledModels} from './bundled_models.mjs';
export const SOURCES=Object.freeze({network:'ネットワーク',bundled:'キャッシュ'});
export function createPublicModelCache({run=runModels,warn=console.warn,loadBundled=loadBundledModels}={}) {
 let state='未取得',models={},checked=null,message='公開モデルはまだ取得していません。',revision=0,pending=null,source=null;
 const snapshot=()=>({状態:state,件数:Object.keys(models).length,確認日時:checked,説明:message,世代:revision,取得元:source});
 const input=()=>({公開モデル:state==='取得済'?models:{},公開状態:state,確認日時:checked});
 // 応答を検証し、画面とキー試験に渡す安全な形へ変換する。
 const accept=response=>{
  const data=response.data;
  if(response.error || data?.状態!=='OK' || !data.公開モデル || typeof data.公開モデル!=='object' || Array.isArray(data.公開モデル))throw new Error(publicFailureDescription(response.error || data?.失敗理由));
  const safe={};for(const [id,details] of Object.entries(data.公開モデル).slice(0,5000)){
   if(!/^~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(id) || !details || typeof details!=='object')continue;
   safe[id]={model_id:id,作成日:typeof details.作成日==='string'?details.作成日.slice(0,20):null,トークン数:String(details.トークン数 ?? '').slice(0,30),モダリティ:typeof details.モダリティ==='string'?details.モダリティ.slice(0,200):null};
  }
  return safe;
 };
 const refresh=()=>{
  if(pending)return pending;
  state='取得中';models={};checked=null;source=null;message='キーなしで公開モデル一覧を取得しています。';revision++;
  pending=(async()=>{
   let reason;
   try {
    const response=await run('public');
    if(response.error==='stopped')throw Object.assign(new Error(publicFailureDescription('stopped')),{stopped:true});
    models=accept(response);source=SOURCES.network;state='取得済';checked=new Date().toISOString();message='公開モデル取得済。キーの有効性は確認していません。';
   } catch(error) {
    // 例外本文・応答本文は出さず、固定文言だけを画面と診断ログへ返す。
    const allowed=['size','output','timeout','dns','tls','http','json','shape','network','response','stopped','busy'].map(publicFailureDescription);
    reason=allowed.includes(error?.message)?error.message:publicFailureDescription(null);
    try{warn('[公開モデル] '+reason);}catch{}
    if(!error?.stopped)try {
     const body=await loadBundled();
     models=accept(await run('public',undefined,{fetch:async()=>body}));source=SOURCES.bundled;state='取得済';checked=new Date().toISOString();
     message=reason+' 同梱の公開モデル一覧（キャッシュ）を使用しています。キーの有効性は確認していません。';
     try{warn('[公開モデル] 同梱キャッシュを使用します。');}catch{}
    } catch {}
    if(state!=='取得済'){models={};state='失敗';source=null;message=reason+' 再取得できます。キーの有効性とは別の結果です。';}
   }
   finally {revision++;pending=null;}
   return snapshot();
  })();
  return pending;
 };
 return {snapshot,input,refresh};
}
