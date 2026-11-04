// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {ref,nextTick} from 'vue';

export function 起動ミニ表示を作成({利用可能,初期表示=false,切替=enabled=>globalThis.window?.aidiyWindow?.startMini?.(enabled)??true,反映=()=>globalThis.window?.aidiyWindow?.finishMini?.()??true}){
 const 表示中=ref(初期表示===true),切替中=ref(false),エラー=ref('');let desired=表示中.value;
 async function 変更(enabled){
  desired=enabled===true&&利用可能();
  if(切替中.value)return;
  切替中.value=true;エラー.value='';
  try{
   // IPC の待機中にタブを移動した場合も、最後の表示要求へ戻す。
   while(表示中.value!==desired){
    const next=desired;
    if(await 切替(next)!==true)throw Error('ウィンドウの表示を切り替えられませんでした。');
    表示中.value=next;
    await nextTick();await 反映();
   }
   return true;
  }catch(error){desired=表示中.value;エラー.value=error.message;return false;}
  finally{切替中.value=false;}
 }
 return {表示中,切替中,エラー,変更};
}
