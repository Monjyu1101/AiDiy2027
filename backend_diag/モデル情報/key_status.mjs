// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 設定値を返さず、UI用の固定スキーマだけを公開する。
import {oauthModelFallback} from './model_fallbacks.mjs';
import {safeRouterMetadata} from '../runtime/model_catalog.mjs';
import {KEY_PROVIDERS,INTEGRATION_PROBES,carryOpenRouterProof,carryDecisionsProof} from '../runtime/model_probe.mjs';
import {runModels,cancelKeyProbes,createModelRunner} from '../runtime/model_runner.mjs';
export {KEY_PROVIDERS,INTEGRATION_PROBES,runModels,cancelKeyProbes,createModelRunner};
const reason=code=>({timeout:'モデル確認がタイムアウトしました。',output:'モデル確認の応答が上限を超えました。',busy:'別のキー確認が実行中です。',stopped:'診断を終了しました。'}[code] || 'モデル確認処理を利用できません。配布ファイルと通信状態を確認してください。');
const text=(value,limit=1000)=>typeof value==='string'?value.slice(0,limit):'';
export async function getKeyStatus(options={}) {
  const response=await (options.run || runModels)('status');
  if(response.error || !Array.isArray(response.data?.項目))return {設定状態:'確認不可',説明:reason(response.error),項目:KEY_PROVIDERS.map(p=>({id:p.id,名前:p.名前,キー名:p.キー名,設定済み:null,状態:'未実施',キー不要:false,説明:'設定有無は未確認です。',テスト可能:false,理由:reason(response.error)})),モデル:[]};
  return {設定状態:['読込済み','未作成','読込不可'].includes(response.data.設定状態)?response.data.設定状態:'読込不可',項目:KEY_PROVIDERS.map(p=>{
    const row=response.data.項目.find(r=>r && r.id===p.id) || {};
    return {id:p.id,名前:p.名前,キー名:p.キー名,設定済み:typeof row.設定済み==='boolean'?row.設定済み:null,状態:'未実施',キー不要:row.キー不要===true,ローカル:row.ローカル===true,説明:text(row.説明),テスト可能:row.テスト可能===true,理由:text(row.理由)};
  }),モデル:[]};
}
export async function testKey(id,options={}) {
  const result={id,状態:'未実施',説明:'未対応の項目です。',モデル:[],モデル詳細:[],確認日時:null};
  if(!KEY_PROVIDERS.some(p=>p.id===id && p.probe))return result;
  // 未確認・検出エラーは未導入と見なさず、今回のインストール確認で未検出の場合だけ省略する。
  if(id==='ollama' && options.installResults?.some(row=>row?.id==='ollama' && row.状態==='未検出'))return {...result,スキップ:true,説明:'Ollama が未検出のため、モデル一覧の取得をスキップしました。'};
  const response=await (options.run || runModels)('test',id,{input:options.publicCache || {公開モデル:{},公開状態:'未取得'},signal:options.signal,onState:options.onState});
  if(response.error)return {...result,説明:reason(response.error)};
  const data=response.data;
  if(!data || data.id!==id || !['未実施','OK','NG','PASS'].includes(data.状態) || !Array.isArray(data.モデル))return {...result,説明:reason('invalid')};
  const models=[...new Set(data.モデル.filter(v=>typeof v==='string' && /^~?[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,199}$/.test(v)))].slice(0,500);
  const details=Array.isArray(data.モデル詳細)?data.モデル詳細.filter(row=>row && models.includes(row.model_id)).slice(0,500).map(row=>({model_id:row.model_id,作成日:text(row.作成日,20),トークン数:text(String(row.トークン数 ?? ''),30),モダリティ:text(row.モダリティ,200),...safeRouterMetadata(row)})):[];
  const safe = carryOpenRouterProof(data,{...result,認証確認:data.認証確認===true,状態:data.状態,説明:text(data.説明),モデル:models,モデル詳細:details,確認日時:typeof data.確認日時==='string' && Number.isFinite(Date.parse(data.確認日時))?data.確認日時:null,一覧範囲:text(data.一覧範囲),ライブ候補作成日:data.ライブ候補作成日&&typeof data.ライブ候補作成日==='object'&&!Array.isArray(data.ライブ候補作成日)?Object.fromEntries(Object.entries(data.ライブ候補作成日).filter(([id,date])=>/^~?[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,199}$/.test(id)&&(date===null||/^\d{4}\/\d{2}\/\d{2}$/.test(date))).slice(0,200)):{},ライブ候補:Array.isArray(data.ライブ候補)?data.ライブ候補.filter(v=>typeof v==='string' && /^~?[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,199}$/.test(v)).slice(0,200):[],補完:text(data.補完),警告:Array.isArray(data.警告)?data.警告.map(v=>text(v)).slice(0,5):[]});
  return carryDecisionsProof(data,oauthModelFallback(safe));
}
