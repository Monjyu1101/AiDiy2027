// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 外部ページにDOMやpreloadを追加しない。ソースは専用の非特権窓でtextContent表示だけにする。
const PANEL_HTML=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>要素連携</title><style>body{margin:0;padding:14px;background:#101923;color:#dce6f4;font:13px system-ui}h1{font-size:16px;margin:0 0 8px;color:#80dcff}p{line-height:1.5;margin:6px 0;overflow-wrap:anywhere}pre{font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#080f17;border:1px solid #344b60;padding:9px;max-height:200px;overflow:auto}h2{font-size:13px;margin-bottom:4px}.note{font-size:11px;color:#aec0d0}#selector{color:#8fe6dc}</style><h1>要素連携</h1><p>画面にマウスを重ねて確認 → クリックでCode / Liveの下書きへ。Escまたはこの窓の×で終了。</p><p id="selector">要素にマウスを重ねてください。</p><p class="note" id="notice">入力値は取得しません。表示文章に残る個人情報は連携前に確認してください。</p><h2>HTML（表示中DOM）</h2><pre id="html"></pre><h2>CSS（計算済み）</h2><pre id="css"></pre></html>`;
function createBrowserElementPanel({BrowserWindow,screen,record,onClose,onKey}){
 let popup,ready,disposed=false,pending;
 function open(){
  if(popup||disposed||!BrowserWindow)return;
  const parent=record.window.getBounds(),area=screen.getDisplayMatching(parent).workArea;
  const width=Math.min(500,area.width),height=Math.min(640,area.height);
  popup=new BrowserWindow({parent:record.window,title:'要素連携',show:false,width,height,x:Math.max(area.x,Math.min(parent.x+parent.width-width-12,area.x+area.width-width)),y:Math.max(area.y,Math.min(parent.y+110,area.y+area.height-height)),backgroundColor:'#101923',autoHideMenuBar:true,roundedCorners:false,minimizable:false,maximizable:false,skipTaskbar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  popup.webContents.on('will-navigate',event=>event.preventDefault());
  popup.webContents.on('before-input-event',onKey);
  popup.on('closed',()=>{popup=undefined;if(!disposed)onClose();});
  ready=popup.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(PANEL_HTML)).then(()=>{if(!disposed&&popup&&!popup.isDestroyed()){popup.showInactive();if(pending)update(pending);}});
  void ready.catch(()=>{if(!disposed)onClose();});
 }
 function update(value){
  pending=value;if(!popup||popup.isDestroyed())return;
  void ready.then(()=>{if(disposed||!popup||popup.isDestroyed())return;return popup.webContents.executeJavaScript(`(()=>{const value=${JSON.stringify(value)};document.getElementById('selector').textContent=value.selector+' · '+value.rect.width+' × '+value.rect.height;document.getElementById('notice').textContent=value.notice+(value.truncated?' HTMLは上限で省略。':'');document.getElementById('html').textContent=value.html;document.getElementById('css').textContent=Object.entries(value.css).map(([key,text])=>key+': '+text+';').join('\\n');})()`);}).catch(()=>{});
 }
 return{open,update,close(){disposed=true;pending=undefined;if(popup&&!popup.isDestroyed())popup.destroy();}};
}
module.exports={createBrowserElementPanel,PANEL_HTML};
