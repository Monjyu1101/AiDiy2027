// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 高コストなOS一覧だけ共有・間引きする。起動前の安全確認には使わない。
function createChildProcessMonitor({scan,now=Date.now,interval=30000}){
 let cached=null,checkedAt=0,pending=null;
 return async()=>{
  if(pending)return new Set(await pending);
  if(cached&&now()-checkedAt<interval)return new Set(cached);
  pending=Promise.resolve().then(scan);
  try{
   const result=await pending;
   cached=new Set(result);checkedAt=now();
   return new Set(cached);
  }finally{pending=null;}
 };
}
module.exports={createChildProcessMonitor};
