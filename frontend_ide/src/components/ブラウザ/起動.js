// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export async function openBrowser(path,displayId,win=window){
 if(win.aidiyWindow?.openBrowser)return win.aidiyWindow.openBrowser(path,displayId);
 // クリック中に予約し、非同期のプレビュー準備後もpopup blockerに阻まれないようにする。
 const popup=win.open('about:blank','_blank');
 if(!popup)return{ok:false,error:'ブラウザのポップアップを許可してください。'};
 popup.opener=null;
 try{
  const status=await win.fetch('/api/connection',{cache:'no-store'}),state=await status.json();
  if(!status.ok||!state.active||state.mode!=='online'||state.connected!==true)throw Error('tools接続中のみBrowserを起動できます。');
  if(!path){popup.location.replace('https://www.google.com/');return{ok:true};}
  const response=await win.fetch('/api/preview?'+new URLSearchParams({path}),{cache:'no-store'});
  if(!response.ok)throw Error(await response.text());
  const data=await response.json(),url=new URL(data.url);
  if(!['http:','https:'].includes(url.protocol))throw Error('表示URLを取得できませんでした。');
  if(!popup.closed)popup.location.replace(url.href);
  return{ok:true};
 }catch(error){popup.close();return{ok:false,error:error.message};}
}
