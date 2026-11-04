// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// VS Codeのメッセージ境界を模擬する。外部AIには接続しない。
(()=>{
 const kind=window.fixtureKind, original=window.fetch;
 const settings={LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'test-model',LIVE_FREEAI_VOICE:'Zephyr'};
 window.fixtureMessages=[];window.fixtureSession=0;window.fixtureReplies=[];window.fixtureSettings=settings;
 const notify=packet=>{if(window.fixtureHold?.(packet)){window.fixtureReplies.push(packet);return;}setTimeout(()=>window.postMessage(packet,'*'),0);};
 window.fixtureFlush=()=>{const replies=window.fixtureReplies.splice(0);for(const packet of replies)notify(packet);};
 window.fixtureNotify=notify;
 window.fetch=(input,...rest)=>input==='/development/config'?Promise.resolve(new Response(JSON.stringify({kind,host:true,icon:'/development/AiDiy.png',live:{host:true,captureUrl:window.fixtureCaptureUrl,作業フォルダ:{名前:'fixture',パス:'/fixture'},保存モデル設定:settings}}))):original(input,...rest);
 const state={type:'state',会話ID:'fixture-code',信頼済み:true,接続済み:true,実行モード:'online',作業フォルダ:{名前:'fixture',パス:'/fixture'},メッセージ:[],履歴:[],進捗:[],provider:'codex_cli',model:'auto'};
 window.fixtureState=state;
 let draft={下書き:'保存された依頼'};
 window.acquireVsCodeApi=()=>({getState:()=>draft,setState:value=>draft=value,postMessage(message){
  window.fixtureMessages.push(message);
  if(kind==='code'){
   if(message.type==='ready')notify(state);
   if(message.type==='input_text'&&!window.fixtureManual){state.メッセージ=[{種別:'user',本文:message.メッセージ内容},{種別:'assistant',本文:'**テスト回答**'}];notify({type:'accepted'});notify({...state});}
   if(message.type==='chooseModel')notify({type:'modelCatalog',provider:message.provider||'',items:message.provider?[{id:'auto',label:'自動'}]:[{id:'codex_cli',label:'Codex'}]});
   // 現在の会話を削除したホストは、切替完了と新しい状態を両方通知する。
   if(message.type==='deleteHistory'){
    state.履歴=state.履歴.filter(item=>item.id!==message.id);
    if(message.id===state.会話ID){state.会話ID='fixture-code-after-delete';state.メッセージ=[];notify({type:'conversationChangeResult',requestId:message.requestId,ok:true,会話ID:state.会話ID,projectPath:state.作業フォルダ.パス});}
    notify({...state});
   }
  }else{
   if(message.type==='mic-start')notify({type:'reply',id:message.id,value:{ok:true}});
   if(message.type==='api'&&window.fixtureApiError)notify({type:'reply',id:message.id,error:window.fixtureApiError});
   else if(message.type==='api')notify({type:'reply',id:message.id,value:{status:'OK',data:{モデル設定:window.fixtureSettings,available_models:{live_models:{freeai_live:{'test-model':'試験モデル','other-model':'別の試験モデル'}},live_voices:{freeai_live:{Zephyr:'Zephyr',Puck:'Puck'}}}}}});
   if(message.type==='save-model'&&window.fixtureSaveError)notify({type:'reply',id:message.id,error:window.fixtureSaveError});
   else if(message.type==='save-model'){window.fixtureSettings={...window.fixtureSettings,...message.settings};notify({type:'reply',id:message.id,value:{ok:true}});}
   if(message.type==='socket-open')notify({type:'socket-opened',id:message.id});
   if(message.type==='socket-close')notify({type:'socket-closed',id:message.id});
   if(message.type==='socket-send'){
    const packet=JSON.parse(message.data);
    if(packet.type==='connect'){
     if(packet.ソケット番号==='input')window.fixtureSession++;
     notify({type:'socket-data',id:message.id,data:JSON.stringify({メッセージ識別:'init',セッションID:'fixture-'+window.fixtureSession})});
    }
    if(packet.メッセージ識別==='input_text')notify({type:'socket-data',id:message.id,data:JSON.stringify({メッセージ識別:'output_text',チャンネル:'0',メッセージ内容:'Liveテスト回答'})});
   }
  }
 }});
})();
