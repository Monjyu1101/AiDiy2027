// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUT_DIRECTORY, INSTALL_FILE } from './headless.mjs';
import { MODEL_PROVIDER_IDS, modelsInfoFile } from '../モデル情報/models_info.mjs';
import { INTEGRATION_IDS, INTEGRATION_FILE } from '../モデル情報/integration_info.mjs';

const 日時 = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const 最新日時 = values => values.map(日時).filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] || null;
// 表示専用。認証の証跡・キー・任意の追加フィールドを復元しない。
function 表示結果(value) {
  if (!value || typeof value.id !== 'string' || !['OK','NG','ERR','PASS','注意','未確認','未検出','未実施'].includes(value.状態)) return null;
  const result = {id:value.id,状態:value.状態,確認日時:日時(value.確認日時),前回結果:true};
  for (const key of ['パス','バージョン','説明','一覧範囲','補完']) if(typeof value[key]==='string') result[key]=value[key];
  for (const key of ['モデル','警告']) if(Array.isArray(value[key])) result[key]=value[key].filter(item=>typeof item==='string');
  if(Array.isArray(value.モデル詳細)) result.モデル詳細=value.モデル詳細.filter(item=>item&&typeof item.model_id==='string').map(item=>Object.fromEntries(['model_id','作成日','トークン数','モダリティ'].filter(key=>['string','number'].includes(typeof item[key])).map(key=>[key,item[key]])));
  return result;
}
async function 読込(file) { try { const value=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));return value && typeof value==='object' && !Array.isArray(value)?value:{}; } catch { return {}; } }

export function createPreviousResults({directory=OUTPUT_DIRECTORY}={}) {
  async function snapshot() {
    const [install,integration,...models]=await Promise.all([INSTALL_FILE,INTEGRATION_FILE,...MODEL_PROVIDER_IDS.map(modelsInfoFile)].map(file=>読込(path.join(directory,file))));
    const groups={導入状況:{結果:[],前回実行日時:null},モデル一覧:{結果:[],前回実行日時:null},外部連携:{結果:[],前回実行日時:null}};
    const merge=(group,values,date,ids)=>{
      const target=groups[group],byId=new Map(target.結果.map(item=>[item.id,item]));
      for(const value of Array.isArray(values)?values:[]) {
        const item=表示結果(value);if(!item || (ids&&!ids.includes(item.id)))continue;
        const old=byId.get(item.id);
        if(!old || Date.parse(item.確認日時||date||0)>=Date.parse(old.確認日時||target.前回実行日時||0))byId.set(item.id,item);
      }
      target.結果=[...byId.values()];
      if(target.結果.length)target.前回実行日時=最新日時([target.前回実行日時,date,...target.結果.map(item=>item.確認日時)]);
    };
    merge('導入状況',install.項目,install.完了日時);
    merge('外部連携',integration.項目,最新日時((Array.isArray(integration.項目)?integration.項目:[]).map(item=>item?.確認日時))||integration.保存日時,INTEGRATION_IDS);
    models.forEach((model,index)=>{const details=Array.isArray(model.chat?.モデル)?model.chat.モデル.filter(item=>item&&typeof item.model_id==='string'):[];merge('モデル一覧',[{...model,id:MODEL_PROVIDER_IDS[index],モデル:details.map(item=>item.model_id),モデル詳細:details}],model.確認日時||model.保存日時,MODEL_PROVIDER_IDS);});
    return groups;
  }
  return {snapshot};
}
