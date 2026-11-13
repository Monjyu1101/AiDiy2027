// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 判断用候補は認証付き取得一覧だけから合成する。生成・課金APIは呼ばない。
import {readConfig,configured,currentDecisionModels} from '../../runtime/model_probe.mjs';

// backend_server/AIコア/AI判断共通.py と同じ既定モデル（parity testで照合）。
export const FREEAI_DECISION_MODEL = 'gemini-3.5-flash-lite';
export const OPENAI_DECISION_MODEL = 'gpt-6-luna';
// 候補の絞り込みは書き出し側だけで管理する。モデル変更時はこの配列を調整する。
export const DECISION_MODEL_CANDIDATES = Object.freeze({openai_oauth:[OPENAI_DECISION_MODEL],freeai_chat:[FREEAI_DECISION_MODEL],openai_decisions:[OPENAI_DECISION_MODEL],gemini_chat:[FREEAI_DECISION_MODEL]});
export const DECISIONS_MODELS_FILE = 'decisions_models_info.json';
const hasKey = (config,id) => configured(config[`${id}_key_id`],id)
  && !['""',"''",'“”','‘’'].includes(config[`${id}_key_id`].trim());
const preferred = (config, first, second) => hasKey(config,first) ? first
  : hasKey(config,second) ? second : first;
// 一覧APIはJSON/Decisions対応可否を保証しない。選択対象が一覧にある場合だけ候補にし、
// 実行可否は既存の判断起動チェックが決める。公開モデルや設定値の補充は行わない。
export async function decisionsModelsInfo(providers,results,{configReader,oauthReader}={}) {
  const [,config]=await readConfig(configReader);
  const sources={openai_oauth:'openai_oauth',freeai_chat:preferred(config,'freeai','gemini'),
    openai_decisions:'openai',gemini_chat:preferred(config,'gemini','freeai')};
  const output={};
  for (const [name,id] of Object.entries(sources)) {
    if (!providers.some(row=>row.id===id&&row.設定済み===true)) continue;
    if (id!=='openai_oauth'&&!hasKey(config,id)) continue;
    const rows=await currentDecisionModels(results[id],id,configReader,oauthReader);
    const models=Object.fromEntries(rows.filter(row=>DECISION_MODEL_CANDIDATES[name].includes(row.model_id))
      .map(row=>[row.model_id,`${/^\d{4}\/\d{2}\/\d{2}$/.test(row.作成日??'')?row.作成日:'yyyy/mm/dd'} - ${row.model_id}`]));
    if (Object.keys(models).length) output[name]={models};
  }
  return output;
}
