// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {BrowserWindow,ipcMain,screen,nativeImage}=require('electron');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {release}=require('node:os');
const glass=process.platform==='win32'&&Number(release().split('.')[2])>=22621;
function icon(key){
 const [kind,id]=key.split(':');
 const name=kind==='cli'?`CLI_${id}.${id==='aidiy_hermes'?'png':'svg'}`:id==='chrome'?'Chrome.svg':`AiDiy_${id}.png`;
 if(!/^[a-zA-Z_]+\.(svg|png)$/.test(name))return '';
 try{if(name.endsWith('.png'))return nativeImage.createFromPath(path.join(__dirname,'../../static',name)).resize({width:32,height:32}).toDataURL();return `data:image/${name.endsWith('.svg')?'svg+xml':'png'};base64,${readFileSync(path.join(__dirname,'../../static',name)).toString('base64')}`;}catch{return '';}
}
const aidiyKeys=new Set(['app:avatar','app:task','app:team','app:ide','app:memo','app:cpu','app:console','app:code','app:live','app:browser','app:navi','cli:aidiy_hermes','app:discord','app:slack']);
function メニュー範囲(cursor,area,items){
 const left=items.filter(item=>aidiyKeys.has(item.key)).length,rows=Math.max(left,items.length-left,1);
 const width=Math.min(264,area.width),height=Math.min(154+rows*32,area.height);
 const x=Math.max(area.x,Math.min(cursor.x-8,area.x+area.width-width));
 const y=Math.max(area.y,Math.min(cursor.y-8,area.y+area.height-height));
 return {x,y,width,height};
}
function アイコンメニューを作成(parent){
 let popup;
 const close=()=>{if(popup&&!popup.isDestroyed())popup.close();popup=undefined;};
 parent.once('closed',close);
 return {close,open(items,send){
  close();
  const cursor=screen.getCursorScreenPoint(),area=screen.getDisplayNearestPoint(cursor).workArea;
  const {x,y,width,height}=メニュー範囲(cursor,area,items);
  const target=new BrowserWindow({title:'AiDiy ランチャーメニュー',x,y,width,height,show:false,frame:false,transparent:true,backgroundColor:'#00000000',...(glass?{backgroundMaterial:'acrylic'}:process.platform==='darwin'?{vibrancy:'menu',visualEffectState:'active'}:{}),hasShadow:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:{preload:path.join(__dirname,'アイコンメニュー-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  popup=target;target.setAlwaysOnTop(true,process.platform==='win32'?'pop-up-menu':'floating');
  const action=(event,value)=>{
   if(event.sender!==target.webContents||event.senderFrame!==target.webContents.mainFrame)return;
   if(['mini','normal','memo','close','dismiss'].includes(value)||items.some(item=>item.key===value&&item.enabled!==false)){
    close();if(value==='close')parent.close();else if(value==='mini'||value==='normal'||value==='memo')send(value);else if(value!=='dismiss')send({type:'launch',key:value});
   }
  };
  ipcMain.on('diag:icon-menu-action',action);
  target.once('closed',()=>{ipcMain.removeListener('diag:icon-menu-action',action);if(popup===target)popup=undefined;});
  let blurTimer;
  target.on('blur',()=>{clearTimeout(blurTimer);blurTimer=setTimeout(()=>{if(!target.isDestroyed()&&!target.isFocused())close();},180);});
  target.on('focus',()=>clearTimeout(blurTimer));
  target.once('closed',()=>clearTimeout(blurTimer));
  target.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  target.webContents.on('will-navigate',event=>event.preventDefault());
  const css=readFileSync(path.join(__dirname,'アイコンメニュー.css'),'utf8');
  const rows='';
  target.webContents.once('did-finish-load',()=>target.webContents.send('diag:icon-menu-items',items.map(item=>({...item,icon:icon(item.key)}))));
  const html=`<!doctype html><html lang="ja" class="${glass||process.platform==='darwin'?'glass':''}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${css}</style><body><main><section class="panel main"><header><strong>AiDiy ランチャー</strong></header><div class="caption">表示サイズ</div><div class="sizes"><button data-action="mini" title="ミニサイズ" aria-label="ミニサイズ"><span class="size-icon mini"></span>ミニ</button><button data-action="normal" title="標準サイズ" aria-label="標準サイズ"><span class="size-icon normal"></span>標準</button></div><button class="close" data-action="close"><span>×</span>閉じる</button><footer><span class="key">esc</span> メニューを閉じる</footer></section><button class="memo-action" data-action="memo">+メモ</button><section class="panel apps" id="apps"><div class="apps-head"><div><strong>アプリを起動</strong><small>表示中のアイコン</small></div><span class="count">${items.length}</span></div><div class="app-list" role="menu" aria-label="ランチメニュー">${rows}</div></section></main></body></html>`;
  target.once('ready-to-show',()=>{if(!target.isDestroyed()){target.show();target.focus();}});
  target.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(close);
 }};
}
module.exports={アイコンメニューを作成,メニュー範囲};
