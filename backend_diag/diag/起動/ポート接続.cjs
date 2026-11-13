// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {createConnection}=require('node:net');
const PORT_TIMEOUT_MS=500;
// ループバックへのTCP接続だけ。HTTP・認証・コマンド実行は行わない。
function checkPort(port,{signal,timeoutMs=PORT_TIMEOUT_MS,connect=createConnection}={}){
 return new Promise(resolve=>{
  let socket,finished=false;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket?.destroy();resolve(value);};
  const abort=()=>finish(null),timer=setTimeout(abort,timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return finish(null);
  try{
   socket=connect({host:'127.0.0.1',port});
   socket.once('connect',()=>finish(true));
   socket.once('error',error=>finish(error.code==='ECONNREFUSED'?false:null));
   socket.once('close',()=>finish(null));
  }catch{finish(null);}
 });
}
module.exports={checkPort,PORT_TIMEOUT_MS};
