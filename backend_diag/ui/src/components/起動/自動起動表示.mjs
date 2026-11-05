// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// --auto の正常完了だけを一度反映する。途中のタブ・表示・コンソール操作を優先する。
// 通常／ミニ／アイコンの表示モードは変更しない。
export function 自動起動表示を作成({tab,接続済み}){
 let 操作済み=false;
 const 反映済み=new Set();
 function 利用者操作(){操作済み=true;}
 function 反映(progress){
  if(!接続済み.value||progress?.自動起動!==true||progress.種別!=='start'||progress.状態!=='done'||!progress.実行ID||反映済み.has(progress.実行ID))return false;
  反映済み.add(progress.実行ID);
  if(操作済み||tab.value!=='start')return false;
  tab.value='apps';return true;
 }
 return {利用者操作,反映};
}
