// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 畳んだ31pxをミニ/アイコンの復帰寸法として保存しない。先に現在モードを開く。
export async function 表示切替前にパネルを開く({折畳み,非表示,世代,要素,api,nextTick}){
 if(!折畳み.value)return true;
 if(api?.collapsePanel){
  const result=await api.collapsePanel(false);
  if(!result?.ok)return false;
 }
 折畳み.value=false;非表示.value=false;
 // 外から開いた後も、共通トグル内の次回操作を「閉じる」に戻す。
 世代.value++;
 await nextTick();
 if(要素.value)要素.value.style.maxHeight='';
 return true;
}
