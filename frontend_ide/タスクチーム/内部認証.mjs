// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

// Code/Liveと同じ配置先優先・毎要求再読込。秘密はNode側に留める。
export function internalAuthorization(target,folders){
 return ()=>{
  try{
   const url=new URL(target);
   if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();
   const visited=new Set();let root;
   for(const folder of folders){
    let current=resolve(folder);
    while(!visited.has(current)){
     visited.add(current);const config=join(current,'_config/AiDiy_key.json');
     if(existsSync(config)){
      const settings=JSON.parse(readFileSync(config,'utf8').replace(/^\uFEFF/,''));
      const port=Number(settings.PORT_CORE??8091);
      if(!Number.isInteger(port)||port<1||port>65535||url.origin!==`http://127.0.0.1:${port}`||!existsSync(join(current,'backend_server/core_main.py')))throw Error();
      root=realpathSync(current);break;
     }
     const parent=dirname(current);if(parent===current)break;current=parent;
    }
    if(root)break;
   }
   if(!root)throw Error();
   let file=root;
   for(const part of ['_AIDIY','backend_core','internal_auth.json']){file=join(file,part);if(lstatSync(file).isSymbolicLink())throw Error();}
   const stat=lstatSync(file);if(!stat.isFile()||stat.size>16384)throw Error();
   const value=JSON.parse(readFileSync(file,'utf8'));
   if(value.token_type!=='bearer'||typeof value.access_token!=='string'||!/^[A-Za-z0-9._~-]{16,12000}$/.test(value.access_token)||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now())throw Error();
   return {authorization:`Bearer ${value.access_token}`};
  }catch{throw Error('ローカルCoreの内部認証を確認できません。Coreの起動状態を確認してください。');}
 };
}
