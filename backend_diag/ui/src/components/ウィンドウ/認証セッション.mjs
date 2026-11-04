// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 起動キーはタブ・origin・公開パスごとの一時領域だけに保持する。
// Electronの非永続sessionも同じ経路を使い、永続ストレージへは書き込まない。
export function 認証セッションを作成({location,storage=()=>globalThis.sessionStorage}){
 const name='aidiy-diag-auth:'+location.origin+location.pathname;
 const access=(operation,...args)=>{try{return storage()?.[operation](name,...args);}catch{return undefined;}};
 const 破棄=()=>{access('removeItem');};
 const parameters=new URLSearchParams(location.hash.slice(1));
 // 新しい起動URLは、同じポートに残った前回のキーより優先する。
 let 初期キー;
 if(parameters.has('token')){破棄();初期キー=parameters.get('token')||'';}
 else 初期キー=access('getItem')||'';
 // 認証成功後だけ保存する。手入力失敗・401で以前のキーを復活させない。
 return {初期キー,破棄,保存(value){if(typeof value==='string'&&value)access('setItem',value);else 破棄();}};
}
