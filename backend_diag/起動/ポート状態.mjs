// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {readFile} from 'node:fs/promises';
import portConnection from './ポート接続.cjs';

const ids=new Set(['local','tools','core','apps','taskteam','web']);
export const {checkPort,PORT_TIMEOUT_MS}=portConnection;
export function createPortStatusChecker({targets,probe=checkPort}={}){
 let catalog;
 async function load(){
  if(!catalog)catalog=(async()=>{
   const items=targets??JSON.parse(await readFile(new URL('../../scripts/起動対象.json',import.meta.url),'utf8'));
   return items.filter(item=>ids.has(item.id)&&item.起動管理!==false).map(({id,名前,ポート})=>{
    if(!Number.isInteger(ポート)||ポート<1||ポート>65535)throw Error('invalid port');
    return {id,名前,ポート};
   });
  })().catch(error=>{catalog=undefined;throw error;});
  return catalog;
 }
 return async({signal}={})=>({対象:await Promise.all((await load()).map(async item=>({...item,開放:await probe(item.ポート,{signal})}))),確認日時:new Date().toISOString()});
}
