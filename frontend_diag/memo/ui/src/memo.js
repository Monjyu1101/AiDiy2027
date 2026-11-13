// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createApp} from 'vue';
import メモ画面 from './メモ画面.vue';
import {認証セッションを作成} from '../../../shared/ui/認証セッション.mjs';
import {表示対象を作成} from './表示対象.mjs';
const {initialNew,initialSource,initialId,initialScope,onSaved}=表示対象を作成({location});
const session=認証セッションを作成({location});
const token=session.初期キー;
if(location.hash)history.replaceState(null,'',location.pathname);
async function api(route,{method='GET',body}={}){
 const url=new URL(route,new URL('./',location.href));
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();
 if(!response.ok){if(response.status===401)session.破棄();throw Object.assign(Error(data.エラー||'メモの操作に失敗しました。'),{status:response.status});}
 session.保存(token);return data;
}
const onNew=()=>{const target=new URL('memo.html',location.href);target.hash=new URLSearchParams({token,new:'1',...(initialScope==='system'?{scope:'system'}:{})}).toString();return !!window.open(target.href,'_blank','popup,width=320,height=260');};
createApp(メモ画面,{api,onNew,initialNew,initialSource,initialId,initialScope,onSaved}).mount('#app');
