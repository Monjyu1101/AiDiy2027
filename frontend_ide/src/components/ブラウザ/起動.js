// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {normalizeDisplayUrls,isPageSource} from '../../../viewer/表示URL.mjs';

function displayAddress(value){
 const url=typeof value==='string'&&normalizeDisplayUrls([{url:value}])[0]?.url;
 if(!url)throw Error('表示URLには認証情報を含まない http / https のURLを指定してください。');
 return url;
}
function previewAddress(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('表示URLを取得できませんでした。');
 return url.href;
}
function validSource(path){
 return typeof path==='string'&&path.length>0&&path.length<=4096&&!/[\\:\x00-\x1f\x7f]/.test(path)
  &&path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&isPageSource(path);
}
export async function openBrowser(path,displayId,win=window,displayUrl='',reuseSingleBrowser=false){
 if(win.aidiyWindow?.openBrowser)return win.aidiyWindow.openBrowser(path,displayId,displayUrl,reuseSingleBrowser);
 // クリック中に予約し、非同期のプレビュー準備後もpopup blockerに阻まれないようにする。
 const popup=win.open('about:blank','_blank');
 if(!popup)return{ok:false,error:'ブラウザのポップアップを許可してください。'};
 popup.opener=null;
 try{
  const connected=async()=>{
   const status=await win.fetch('/api/connection',{cache:'no-store'}),state=await status.json();
   if(!status.ok||!state.active)throw Error('利用を開始してください。');
  };
  await connected();
  let target='http://127.0.0.1:8090/';
  if(displayUrl!==''){
   if(!validSource(path))throw Error('表示URLはプロジェクト内のページ関連ソースで利用できます。');
   target=displayAddress(displayUrl);
   // 任意URLを使う場合も、元ファイルの存在とプロジェクト境界をサーバーで確認する。
   const source=await win.fetch('/api/file?'+new URLSearchParams({path}),{cache:'no-store'});
   if(!source.ok)throw Error('プロジェクト内のファイルを確認できません。');
  }else if(path){
   const response=await win.fetch('/api/preview?'+new URLSearchParams({path}),{cache:'no-store'});
   if(!response.ok)throw Error(await response.text());
   const data=await response.json();
   if(data.error)throw Error(data.error);
   // 既存の静的HTML・メディアURLには起動時tokenと任意の正当なファイル名が含まれる。
   // AI保存用の秘密値・動的ルート検査をそれらへ流用しない。
   target=data.kind==='analysis'?displayAddress(data.routes?.[0]?.url):previewAddress(data.url||(data.kind==='vue'&&data.routes?.[0]?.url));
  }
  await connected();
  if(!popup.closed)popup.location.replace(target);
  return{ok:true};
 }catch(error){popup.close();return{ok:false,error:error.message};}
}
