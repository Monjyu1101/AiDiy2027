// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実ページのURL・履歴・CDP接続を変更せず、ページ本体の範囲だけに失敗を表示する。
const ERROR_HTML=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light dark"><title>ページを読み込めませんでした</title><style>html,body{margin:0;width:100%;height:100%;background:#15191f;color:#dce5ed;font:16px system-ui,sans-serif}body{display:grid;place-items:center}main{max-width:34rem;padding:32px}h1{font-size:22px;font-weight:600}p{line-height:1.8;color:#aab8c4}</style><main><h1>ページを読み込めませんでした</h1><p>URLや接続を確認して、上部の再読み込みボタンでもう一度お試しください。</p><p>全画面表示では、マウスを画面上端へ移動すると操作パネルが表示されます。</p></main></html>`;
function createBrowserStatusView({WebContentsView,session,window,onKey}){
 let view,contents,bounds,visible=false,disposed=false;
 function ensure(){
  if(view)return;
  view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true}});
  contents=view.webContents;
  for(const event of ['will-navigate','will-redirect','will-frame-navigate','will-attach-webview'])contents.on(event,event=>event.preventDefault());
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('before-input-event',onKey);
  window.contentView.addChildView(view);view.setVisible(false);
  if(bounds)view.setBounds(bounds);
  void contents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(ERROR_HTML)).catch(()=>{});
 }
 return{
  setBounds(value){bounds=value;if(view&&!disposed&&!window.isDestroyed())view.setBounds(value);},
  show(value){
   if(disposed||window.isDestroyed())return;
   if(value){ensure();if(!visible){window.contentView.removeChildView?.(view);window.contentView.addChildView(view);}}
   visible=value;if(view)view.setVisible(value);
  },
  dispose(){if(disposed)return;disposed=true;if(contents){contents.removeListener('before-input-event',onKey);if(!contents.isDestroyed())contents.close({waitForBeforeUnload:false});}}
 };
}
module.exports={createBrowserStatusView};
