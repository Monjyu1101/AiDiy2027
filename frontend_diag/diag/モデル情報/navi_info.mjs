// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 候補はCodeの合成結果から派生。実行権限を付与するファイルではない。
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {NAVI_PROVIDERS} from './navi_providers.mjs';
export const NAVI_MODELS_FILE='navi_models_info.json';
const nestedCLI=/^(?:[a-z0-9_-]*_cli|codex|copilot|claude|claude-code|codex-cli|copilot-cli|opencode|opencode-cli|antigravity|grok)[/:]/i;
export async function naviHermesInstalled(){
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const python=process.platform==='win32'?'Scripts/python.exe':'bin/python';
 try{await Promise.all(['backend_tools/.venv','command_hermes/.venv'].map(folder=>access(path.join(root,folder,python))).concat(access(path.join(root,'command_hermes','prediction_main.py'))));return true;}catch{return false;}
}
export function naviModelsInfo(code,{now=()=>new Date(),naviHermesAvailable=true}={}){
 const result={_meta:{schema:1,readOnly:true,generatedAt:now().toISOString()}};
 for(const provider of Object.keys(code||{})){
  if(!NAVI_PROVIDERS.includes(provider))continue;
  if(provider==='aidiy_hermes'&&!naviHermesAvailable)continue;
  const source=code?.[provider]?.models;if(!source||typeof source!=='object'||Array.isArray(source))continue;
  const models=Object.fromEntries(Object.entries(source).filter(([id,label])=>id&&id.length<=300&&!/[\x00-\x1f]/.test(id)&&typeof label==='string'&&(!['aidiy_hermes','aidiy_pi'].includes(provider)||!nestedCLI.test(id))));
  if(Object.keys(models).length)result[provider]={models};
 }
 return result;
}
