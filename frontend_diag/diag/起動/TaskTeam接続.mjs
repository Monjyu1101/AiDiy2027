// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import http from 'node:http';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../../runtime/transport_limit.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// 配置先の設定と匿名healthだけを読む。任意URL・proxy・認証情報は使用しない。
export function createTaskTeamStatus({root,reader=readFile,request=http.request,timeoutMs=1500}={}) {
 return async()=>{
  let port=8093;
  try {
   let config={};
   try{config=JSON.parse((await reader(join(root,'_config','AiDiy_key.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
   const value=config.PORT_TASKTEAM??8093;
   if(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value).trim()))throw Error();
   port=Number(value);if(!Number.isInteger(port)||port<1||port>65535)throw Error();
  }catch{return {利用可能:false,無効理由:'Task / Team バックエンドのポート設定を確認してください。'};}
  const online=await new Promise(resolve=>{
   let req,res,done=false,size=0;const chunks=[];
   const finish=ok=>{if(done)return;done=true;chunks.length=0;clearTimeout(timer);res?.destroy();req?.destroy();resolve(ok);};
   const timer=setTimeout(()=>finish(false),timeoutMs);
   try{
    req=request({hostname:'127.0.0.1',port,path:'/health',method:'GET',agent:false,maxHeaderSize:8192,headers:{Accept:'application/json'}},incoming=>{
     res=incoming;if(done){res.destroy();return;}if(res.statusCode!==200)return finish(false);
     res.on('error',()=>finish(false));res.on('aborted',()=>finish(false));
     res.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>DIAG_TRANSPORT_BYTE_LIMIT)return finish(false);chunks.push(chunk);});
     res.on('end',()=>{if(done)return;try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));finish(data.status==='OK'&&data.service==='backend_taskteam');}catch{finish(false);}});
    });req.on('error',()=>finish(false));req.end();
   }catch{finish(false);}
  });
  return {利用可能:online,ポート:port,無効理由:online?'':`Task / Team バックエンド（${port}）を起動してください。`};
 };
}
