// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Core 認証はこの画面のメモリだけに保持。Diag 認証とは分離する。
import {ref} from 'vue';
const routes=new Map([
 ['/core/AIコア/モデル情報/取得','取得'],
 ['/core/AIコア/モデル情報/設定','設定'],
 ['/core/AIコア/フォルダ参照','フォルダ参照'],
]);
export function AI設定状態を作成({api,利用可能=()=>true,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const 認証済み=ref(false),処理中=ref(false),通知=ref(''),セッションID=ref(''),待機秒=ref(0),画面版=ref(0),変更中=ref(false);
 let token='',revision=0,controller=new AbortController(),timer,disposed=false;
 function clear(){revision++;controller.abort();controller=new AbortController();clearTimer(timer);timer=undefined;token='';認証済み.value=false;処理中.value=false;変更中.value=false;セッションID.value='';待機秒.value=0;画面版.value++;}
 function ログアウト(){clear();通知.value='';}
 async function call(action,data,run=revision){
  if(disposed||run!==revision||!利用可能())throw Error('Diagへ接続してください。');
  const value=await api(`api/AI設定/${action}`,'POST',controller.signal,'json',{token,data});
  if(disposed||run!==revision)throw Error('操作を中止しました。');
  if(value?.authExpired){clear();通知.value='Core認証の有効期限が切れました。再ログインしてください。';throw Error(通知.value);}
  return value;
 }
 async function 初期化(run=revision){
  const result=await call('初期化',{},run);
  if(result?.status!=='OK'||!result.data?.セッションID)throw Error('Coreの設定画面を初期化できませんでした。');
  セッションID.value=result.data.セッションID;認証済み.value=true;画面版.value++;
 }
 async function ログイン(id,password){
  if(処理中.value||disposed||!利用可能())return false;
  clear();const run=revision;処理中.value=true;通知.value='';
  try{
   const result=await call('ログイン',{利用者ID:id,パスワード:password},run);
   if(result?.status!=='OK'||!result.data?.access_token)throw Error('利用者IDまたはパスワードを確認してください。');
   token=result.data.access_token;
   await 初期化(run);return true;
  }catch{if(run===revision){clear();通知.value='Coreへログインできませんでした。起動状態と利用者ID・パスワードを確認してください。';}return false;}
  finally{if(run===revision)処理中.value=false;}
 }
 async function request(path,body){
  if(!認証済み.value||待機秒.value||!routes.has(path))throw Error('Coreへログインして設定を再読込してください。');
  const run=revision,mutation=routes.get(path)==='設定';
  if(変更中.value)throw Error('設定操作が処理中です。');
  if(mutation)変更中.value=true;
  try{return {data:await call(routes.get(path),body,run)};}
  finally{if(run===revision&&mutation)変更中.value=false;}
 }
 async function 再読込(){
  if(処理中.value||変更中.value||!token||待機秒.value||disposed)return;
  const run=revision;処理中.value=true;通知.value='';
  try{await 初期化(run);}catch{if(run===revision){clear();通知.value='Coreへ再接続できませんでした。再ログインしてください。';}}
  finally{if(run===revision)処理中.value=false;}
 }
 function 保存後(seconds){
  const run=revision;clearTimer(timer);待機秒.value=Math.min(120,Math.max(1,Number(seconds)||15));
  通知.value='設定・再起動要求を受け付けました。再接続までお待ちください。';
  const tick=()=>{if(disposed||run!==revision)return;if(--待機秒.value>0){timer=setTimer(tick,1000);return;}通知.value='再起動の待機時間が終了しました。設定を再読込します。';void 再読込();};
  timer=setTimer(tick,1000);
 }
 function 切断(reason='Diagへ接続してください。'){clear();通知.value=reason;}
 function 終了(){clear();disposed=true;}
 return {認証済み,処理中,通知,セッションID,待機秒,画面版,変更中,ログイン,ログアウト,request,再読込,保存後,切断,終了};
}
