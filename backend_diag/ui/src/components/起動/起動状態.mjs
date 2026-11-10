// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {ref,computed,watch} from 'vue';

export function 起動状態を作成({api,setTimer=setTimeout,clearTimer=clearTimeout}){
 const 項目=ref([]),選択=ref(''),読込中=ref(false),保存中=ref(false),処理中=ref(false),起動中=ref(false),通知=ref(''),保存表示=ref('');
 const 更新失敗=ref(false);
 const 一括進捗=ref(null),閉じた進捗=ref(''),自動起動完了=ref(null);
 // 成功・取消の結果は残さない。失敗だけは確認できるまで表示する。
 const 進捗表示=computed(()=>['running','error'].includes(一括進捗.value?.状態)&&一括進捗.value.実行ID!==閉じた進捗.value?一括進捗.value:null);
 let lifecycle=0,pendingBatch=false,localRun=0,lastServerRun='',requestPreviousRun='';
 function 進捗を閉じる(){if(一括進捗.value?.状態!=='running')閉じた進捗.value=一括進捗.value?.実行ID||'';}
 function 受付表示(種別){requestPreviousRun=lastServerRun;一括進捗.value={実行ID:`request-${++localRun}`,種別,状態:'running',通知:種別==='stop'?'強制停止を受け付けています…':'一括起動を受け付けています…'};}
 function 受付失敗(error){if(一括進捗.value)一括進捗.value={...一括進捗.value,状態:'error',通知:error.message};}
 const ポート項目=ref([]);
 const 停止警告対象=computed(()=>new Set(ポート項目.value.some(item=>item.開放===true)||起動中.value&&!一括停止中.value?項目.value.filter(item=>item.設定.起動対象&&ポート項目.value.some(port=>port.id===item.id&&port.開放===false)).map(item=>item.id):[]));
 const 一括停止中=ref(false);
 const 稼働あり=computed(()=>起動中.value||項目.value.some(item=>item.管理中||!['未起動','停止済み','エラー'].includes(item.状態))||ポート項目.value.some(item=>item.開放===true));
 const 設定起動可能=computed(()=>!更新失敗.value&&!稼働あり.value&&項目.value.length>0&&項目.value.every(item=>ポート項目.value.some(port=>port.id===item.id&&port.開放===false)));
 // 接続バーはTools単体ではなく、起動チェックと全サーバーの現在のポート状態で判定する。
 const サーバー表示状態=computed(()=>{
  if(更新失敗.value||!項目.value.length)return 'unknown';
  const states=項目.value.map(item=>ポート項目.value.find(port=>port.id===item.id)?.開放);
  if(states.some(value=>typeof value!=='boolean'))return 'unknown';
  if(states.every(value=>value===false))return 'offline';
  const targets=項目.value.filter(item=>item.設定?.起動対象===true);
  return targets.length>0&&targets.every(item=>ポート項目.value.some(port=>port.id===item.id&&port.開放===true))?'online':'disconnected';
 });
 const Core利用可能=computed(()=>!更新失敗.value&&ポート項目.value.some(item=>item.id==='core'&&item.開放===true));
 const ブラウザ起動中=ref(false),ブラウザ通知=ref('');
 const ブラウザ起動可能=computed(()=>!更新失敗.value&&['tools','web'].every(id=>ポート項目.value.some(item=>item.id===id&&item.開放===true)));
 const ログ=ref({}),位置=new Map();let visible=false,logsVisible=true,timer,controller,version=0,最後の起動表示='';
 const 選択対象=computed(()=>項目.value.find(item=>item.id===選択.value));
 const コンソール=computed(()=>ログ.value[選択.value]||'コンソールのログは、起動後にここへ表示されます。\n');
 async function refresh(){
  if(!visible)return;const revision=version,operation=localRun;controller=new AbortController();
  try{
   const data=await api('api/起動','GET',controller.signal);if(revision!==version||operation!==localRun)return;
   const incoming=data.一括進捗||null;
   // POST 前の応答や直前の実行結果で、新しい受付表示を消さない。
   const awaitingRun=一括進捗.value?.実行ID.startsWith('request-');
   if(!pendingBatch&&(!awaitingRun||(incoming&&incoming.実行ID!==requestPreviousRun)))一括進捗.value=incoming;
   lastServerRun=incoming?.実行ID||'';
   const ports=await api('api/起動/ポート','GET',controller.signal);if(revision!==version||operation!==localRun)return;
   if(!Array.isArray(data?.対象))throw Error('サーバー状態を取得できませんでした。');
   更新失敗.value=false;ポート項目.value=Array.isArray(ports?.対象)?ports.対象:[];
   項目.value=data.対象.map(item=>保存中.value?{...item,設定:項目.value.find(old=>old.id===item.id)?.設定||item.設定}:item);
   起動中.value=data.実行中;一括停止中.value=Boolean(data.一括停止中);if(data.通知)通知.value=['done','cancelled'].includes(incoming?.状態)&&data.通知===incoming.通知?'':data.通知;
   // 起動・ポート取得が成功した現在の応答だけを使う。手動受付中や前回の完了は流用しない。
   // 完了直後に終了した場合も表示を奪わないよう、実際に起動した対象の現状を確認する。
   const 自動起動対象=incoming?.対象;
   const 自動起動稼働中=Array.isArray(自動起動対象)&&自動起動対象.length>0&&自動起動対象.every(id=>data.対象.some(item=>item.id===id&&item.状態==='稼働中')&&ports?.対象?.some(item=>item.id===id&&item.開放===true));
   自動起動完了.value=!pendingBatch&&!処理中.value&&!data.実行中&&!data.一括停止中&&一括進捗.value?.実行ID===incoming?.実行ID&&incoming?.自動起動===true&&incoming.種別==='start'&&incoming.状態==='done'&&自動起動稼働中?incoming:null;
   const follow=data.起動表示;
   if(follow?.実行ID&&follow.実行ID!==最後の起動表示&&項目.value.some(item=>item.id===follow.対象)){
    最後の起動表示=follow.実行ID;選択.value=follow.対象;
   }
   if(!選択.value&&項目.value.length)選択.value=項目.value[0].id;
   const id=選択.value;if(id&&logsVisible){const tail=await api('api/起動/ログ','POST',controller.signal,'json',{対象:id,位置:位置.get(id)||0});if(revision!==version||operation!==localRun)return;
    ログ.value={...ログ.value,[id]:((tail.切替?'':ログ.value[id]||'')+tail.ログ).slice(-120000)};位置.set(id,tail.位置);
   }
  }catch(error){if(error.name!=='AbortError'&&revision===version&&operation===localRun){通知.value=error.message;更新失敗.value=true;}}
  finally{if(revision===version){読込中.value=false;controller=undefined;if(visible)timer=setTimer(refresh,logsVisible||一括進捗.value?.状態==='running'?800:5000);}}
 }
 function 表示(value,logs=true){if(!value){lifecycle++;pendingBatch=false;処理中.value=false;一括進捗.value=null;自動起動完了.value=null;ポート項目.value=[];}visible=value;logsVisible=logs;version++;clearTimer(timer);controller?.abort();if(value){読込中.value=!項目.value.length;void refresh();}}
 watch(選択,()=>{if(visible){version++;clearTimer(timer);controller?.abort();void refresh();}});
 async function 設定変更(id,key,value){
  if(保存中.value)return;const item=項目.value.find(item=>item.id===id);if(!item)return;
  const old={...item.設定};item.設定={...old,[key]:value};保存中.value=true;保存表示.value='保存中…';
  try{await api('api/起動/設定','POST',undefined,'json',{対象:id,設定:{...item.設定}});保存表示.value='設定を保存しました';}
  catch(error){item.設定=old;保存表示.value='保存できませんでした';通知.value=error.message;}
  finally{保存中.value=false;}
 }
 async function 再起動(id){
  if(保存中.value||処理中.value||起動中.value||(!id&&!設定起動可能.value))return;処理中.value=true;const current=lifecycle;
  if(!id){pendingBatch=true;受付表示('start');}
  try{await api('api/起動/再起動','POST',undefined,'json',id?{対象:id}:{});if(current!==lifecycle)return;pendingBatch=false;if(id){ログ.value={...ログ.value,[id]:''};位置.delete(id);}起動中.value=true;通知.value='順番に再起動しています。';if(visible)表示(true,logsVisible);return true;}
  catch(error){if(current===lifecycle){通知.value=error.message;if(!id)受付失敗(error);}}finally{if(current===lifecycle){pendingBatch=false;処理中.value=false;}}
 }
 async function 一括操作(){
  if(読込中.value||保存中.value||処理中.value||一括停止中.value)return;
  if(!稼働あり.value){if(await 再起動())return 'start';return;}
  処理中.value=true;const current=lifecycle;pendingBatch=true;受付表示('stop');
  try{await api('api/起動/強制停止','POST',undefined,'json',{});if(current!==lifecycle)return;pendingBatch=false;一括停止中.value=true;通知.value='タブの逆順で停止しています。';if(visible)表示(true,logsVisible);return 'stop';}
  catch(error){if(current===lifecycle){通知.value=error.message;受付失敗(error);}}finally{if(current===lifecycle){pendingBatch=false;処理中.value=false;}}
 }
 async function 停止(){
  const id=選択.value;if(!id||処理中.value)return;処理中.value=true;
  const item=項目.value.find(item=>item.id===id);if(item)item.状態='停止中';
  try{await api('api/起動/停止','POST',undefined,'json',{対象:id});通知.value=(item?.名前||id)+' を停止しました。';}
  catch(error){通知.value=error.message;}finally{処理中.value=false;}
 }
 async function ブラウザで開く(){
  if(選択.value!=='web'||!ブラウザ起動可能.value||ブラウザ起動中.value)return;
  ブラウザ起動中.value=true;ブラウザ通知.value='ブラウザを開いています…';
  try{const result=await api('api/起動/ブラウザ','POST',undefined,'json',{});ブラウザ通知.value=result.メッセージ;}
  catch(error){ブラウザ通知.value=error.message;}finally{ブラウザ起動中.value=false;}
 }
 function 終了(){表示(false);}
 return {サーバー表示状態,Core利用可能,進捗表示,進捗を閉じる,自動起動完了,項目,ポート項目,停止警告対象,選択,選択対象,読込中,保存中,処理中,起動中,一括停止中,稼働あり,設定起動可能,一括操作,通知,保存表示,更新失敗,コンソール,表示,設定変更,再起動,停止,終了,ブラウザ起動中,ブラウザ通知,ブラウザ起動可能,ブラウザで開く};
}
