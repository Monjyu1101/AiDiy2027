// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {computed,ref} from 'vue';
export function CLI状態を作成({api,アプリ,接続可能=()=>true,確認=message=>globalThis.confirm(message)}){
 const 項目=ref([]),全項目=ref([]),読込中=ref(false),処理中=ref(''),読込エラー=ref(null),起動エラー=ref(null);let revision=0;
 // 通常画面への復帰で一覧を再取得しても、ミニで発生した起動エラーは保持する。
 const 通知=computed(()=>起動エラー.value??読込エラー.value??''),失敗=computed(()=>起動エラー.value!==null||読込エラー.value!==null);
 const 起動待ち=new Map();let 起動番号=0,確認待ち=0,接続番号=0;
 function 処理を反映(){
  処理中.value=[...起動待ち.values()].at(-1)||'';
  if(!アプリ.処理中.value||アプリ.処理中.value.startsWith('cli:'))アプリ.処理中.value=処理中.value?'cli:'+処理中.value:'';
 }
 async function 読込(){
  if(読込中.value||!接続可能())return;const version=++revision;読込中.value=true;
  try{const data=await api('api/CLI起動');if(version===revision){全項目.value=data.対象;項目.value=data.対象.filter(item=>item.利用可能===true);読込エラー.value=null;}}
  catch(error){if(version===revision){全項目.value=[];項目.value=[];読込エラー.value=error.message;}}
  finally{if(version===revision)読込中.value=false;}
 }
 async function 起動(id,{確認省略=false,開始時}={}){
  if(!接続可能()||確認待ち||アプリ.処理中.value&&!アプリ.処理中.value.startsWith('cli:')||アプリ.選択中.value||!アプリ.フォルダ.value)return;
  const item=項目.value.find(value=>value.id===id);if(!item||item.利用可能===false)return;
  const project=アプリ.フォルダ.value,launchProject=アプリ.起動フォルダ?.()??project,run=++起動番号,connection=接続番号;
  起動待ち.set(run,id);処理を反映();起動エラー.value=null;読込エラー.value=null;
  if(確認省略!==true)確認待ち=run;
  try{
   // 確認ダイアログだけは重ねない。確認後の起動は同じCLIも並行して受け付ける。
   // 通常画面・ミニの明示クリックは確認を省き、固定の起動条件は共用する。
   const accepted=item.種類==='editor'||確認省略===true?true:await 確認(`${item.名前} を aidiy_console で開始しますか？\n\nプロジェクト: ${project}\nモード: ${item.モード}\nモデル: 指定なし（CLI の既定設定）\n\nファイルの変更やコマンド実行が自動承認されます。CLIによってはサンドボックスも解除されます。信頼できるプロジェクトだけで使用してください。CLIの契約や設定によって利用料金が発生する場合があります。ログイン・組織の制限・初回の信頼確認はCLI側に残る場合があります。`);
   if(確認待ち===run)確認待ち=0;
   if(accepted!==true||!接続可能()||connection!==接続番号||project!==アプリ.フォルダ.value)return;
   開始時?.();
   // 成功通知は保持しない。古いサーバーが通知文を返しても画面を押し下げない。
   if(item.種類==='editor')await api('api/VSCode起動/開始','POST',undefined,'json',{フォルダ:launchProject});
   else await api('api/CLI起動/開始','POST',undefined,'json',{対象:id,フォルダ:launchProject,自動承認確認:true});
  }catch(error){if(run===起動番号&&connection===接続番号)起動エラー.value=error.message;}
  finally{if(確認待ち===run)確認待ち=0;起動待ち.delete(run);処理を反映();}
 }
 function 切断(){revision++;接続番号++;全項目.value=[];項目.value=[];読込中.value=false;読込エラー.value=null;起動エラー.value=null;}
 return {項目,全項目,読込中,処理中,通知,失敗,読込,起動,切断};
}
