// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const http=require('node:http');
// CommonJS 終了処理でも runtime/transport_limit.ts と同じ 20 MiB を byte で数える。
const STATUS_RESPONSE_LIMIT=20*1024*1024;

function 起動状態を読む(value){
 const url=new URL(value),token=new URLSearchParams(url.hash.slice(1)).get('token');
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||!token)throw new Error('invalid status URL');
 const endpoint=new URL('api/'+encodeURIComponent('起動'),url);endpoint.hash='';
 return new Promise((resolve,reject)=>{
  let request,response,done=false,size=0;const chunks=[];
  const finish=(error,value)=>{
   if(done)return;done=true;clearTimeout(timer);chunks.length=0;
   response?.destroy();request?.destroy();error?reject(error):resolve(value);
  };
  const timer=setTimeout(()=>finish(new Error('status timeout')),3000);
  try{
   request=http.get(endpoint,{agent:false,headers:{Authorization:'Bearer '+token}},incoming=>{
    response=incoming;if(done){response.destroy();return;}
    if(response.statusCode!==200)return finish(new Error('status unavailable'));
    response.on('data',chunk=>{
     if(done)return;size+=Buffer.byteLength(chunk);
     if(size>STATUS_RESPONSE_LIMIT)return finish(new Error('status too large'));
     chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
    });
    response.on('error',error=>finish(error));
    response.on('aborted',()=>finish(new Error('status interrupted')));
    response.on('close',()=>{if(!response.complete)finish(new Error('status interrupted'));});
    response.on('end',()=>{
     if(done)return;
     try{const state=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof state.終了時停止あり!=='boolean')throw new Error('invalid status');finish(null,state);}catch(error){finish(error);}
    });
   });
   request.on('error',error=>finish(error));
  }catch(error){finish(error);}
 });
}

function 終了確認を作成({window,状態取得,確認,終了前確認=()=>true}){
 let allowed=false,pending=false;
 async function check(){
  try{
   let running;
   try{const state=await 状態取得();if(typeof state?.終了時停止あり!=='boolean')throw new Error('invalid status');running=state.終了時停止あり;}catch{running=null;}
   if(allowed||window.isDestroyed())return;
   if(running!==false){
    const result=await 確認(window,{
     type:'question',title:'AiDiy Diag の終了',
     message:running===true?'起動中のプロセスを停止して Diag を閉じますか？':'起動状態を確認できません。Diag を閉じますか？',
     detail:'「システム起動」で管理するプロセスを停止します。「アプリ起動」で開いたアプリは動作を続けます。',
     buttons:['停止して閉じる','キャンセル'],defaultId:1,cancelId:1,noLink:true,
    });
    if(result.response!==0)return;
   }
   if(!window.isDestroyed()&&await 終了前確認()){allowed=true;window.close();}
  }catch{
   // 確認画面を表示できなければ閉じず、次の操作で再試行する。
  }finally{pending=false;}
 }
 window.on('close',event=>{if(allowed)return;event.preventDefault();if(!pending){pending=true;void check();}});
 return {許可(){allowed=true;}};
}

module.exports={起動状態を読む,終了確認を作成};
