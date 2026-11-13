// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Console と同じ ping のみ。無効化・切断・画面破棄時は古い応答を反映しない。
export function Tools接続を作成({api,反映,間隔=10000,setTimer=setTimeout,clearTimer=clearTimeout}) {
 let enabled=true,connected=false,disposed=false,online=false,generation=0,timer,controller;
 const reset=(通知=true)=>{generation++;clearTimer(timer);controller?.abort();controller=undefined;if(通知){online=false;反映({online:false,checking:false});}};
 async function refresh(){
  reset(false);if(disposed||!enabled||!connected){online=false;反映({online:false,checking:false});return;}
  const current=generation;controller=new AbortController();反映({online,checking:true});
  try{const data=await api('api/tools-status','GET',controller.signal);if(current===generation&&!disposed){online=data.online===true;反映({online,checking:false});}}
  catch{if(current===generation&&!disposed){online=false;反映({online,checking:false});}}
  finally{if(current===generation&&!disposed&&enabled&&connected){controller=undefined;timer=setTimer(refresh,間隔);}}
 }
 return {refresh,接続(value){connected=value;void refresh();},有効(value){enabled=value;void refresh();},終了(){disposed=true;reset();}};
}
