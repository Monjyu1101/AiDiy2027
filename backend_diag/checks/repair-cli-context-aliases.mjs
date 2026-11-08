// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 保存済み候補の限定修復。API取得・設定・保存済みモデル選択は変更しない。
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withoutHermesContextAliases} from '../モデル情報/models_info.mjs';
const directory=resolve(process.argv[2]||fileURLToPath(new URL('../../_AIDIY/aidiy_diag/',import.meta.url)));
const files=['openai_models_info.json','openai_oauth_models_info.json','code_models_info.json','navi_models_info.json','prediction_models_info.json','hermes_models_info.json'];
const native=new Set(['codex_cli','copilot_cli','opencode_cli']);
for(const name of files){
 const file=join(directory,name);let data;
 try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 const changed=[];
 const visit=(value,path='')=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  for(const [key,entry] of Object.entries(value)){
   if(native.has(key)&&entry?.models&&typeof entry.models==='object'){
    const cleaned=withoutHermesContextAliases(entry.models),removed=Object.keys(entry.models).filter(id=>!Object.hasOwn(cleaned,id));
    if(removed.length){entry.models=cleaned;changed.push({section:path+key,removed});}
   }
   visit(entry,path+key+'.');
  }
 };
 visit(data);
 if(changed.length){
  const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(data,null,2)+'\n','utf8');await rename(temporary,file);
  console.log(JSON.stringify({file:name,changed}));
 }
}
