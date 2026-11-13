// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createPortStatusChecker} from './ポート状態.mjs';

const failure=(message,status=503)=>Object.assign(new Error(message),{status});
export function createWebBrowserOpener({portStatusFn=createPortStatusChecker(),fetchFn=fetch,timeoutMs=20000}={}){
 let opening=false;
 return async function openWebBrowser({signal}={}){
  if(opening)throw failure('ブラウザを開いています。完了を待ってください。',409);
  opening=true;
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,timeoutMs);
  try{
   const status=await portStatusFn({signal:controller.signal});
   const tools=status.対象.find(item=>item.id==='tools'),web=status.対象.find(item=>item.id==='web');
   if(tools?.開放!==true||web?.開放!==true)throw failure('Tools / MCP と Web が両方とも稼働中の場合だけ開けます。',409);
   if(!Number.isInteger(tools.ポート)||tools.ポート<1||tools.ポート>65535)throw failure('Tools / MCP のポート設定を確認してください。');
   if(controller.signal.aborted)throw failure('ブラウザを開く処理を中止しました。');
   const url='http://localhost:8090/';
   const response=await fetchFn(`http://127.0.0.1:${tools.ポート}/aidiy_chrome_devtools/new_page`,{
    method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:controller.signal,
    body:JSON.stringify({url,show_automation_banner:false})
   });
   if(!response.ok)throw failure('ブラウザを開けませんでした。Tools / MCP の状態を確認してください。');
   const result=await response.json();
   if(!result||!['string','number'].includes(typeof result.id)||!String(result.id))throw failure('ブラウザのページ作成を確認できませんでした。');
   return {URL:url,メッセージ:'ブラウザで http://localhost:8090/ を開きました。'};
  }catch(error){
   if(error.status)throw error;
   throw failure('ブラウザを開けませんでした。Tools / MCP の状態を確認してください。');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);opening=false;}
 };
}
