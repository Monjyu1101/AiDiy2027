// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
// Web 起動も管理画面・空の付箋を作らず、保存済みの各付箋だけを開く。
export async function openBrowserMemos({url,open,fetchFn=fetch,isClosed=()=>false}){
 const base=new URL(url),token=new URLSearchParams(base.hash.slice(1)).get('token');
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.username||base.password||base.search||!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw Error('起動情報を確認できません。');
 const endpoint=new URL('api/メモ',base);endpoint.hash='';
 const response=await fetchFn(endpoint,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('メモを読み込めませんでした。');
 const data=await response.json();
 if(!Array.isArray(data.メモ))throw Error('メモ一覧を確認できません。');
 const seen=new Set();let count=0;
 for(const note of data.メモ){
  if(isClosed())break;
  if(typeof note?.id!=='string'||typeof note?.保存先!=='string')continue;
  const key=JSON.stringify([note.保存先,note.id]);if(seen.has(key))continue;seen.add(key);
  const target=new URL('memo.html',base);target.hash=new URLSearchParams({token,source:note.保存先,id:note.id}).toString();
  open(target.href);count++;
 }
 return count;
}
