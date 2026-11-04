// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';

function Macメニューを設定({app,Menu,名前,閉じる,icon,platform=process.platform}){
 if(platform!=='darwin')return;
 // 見える項目はアプリ名と「閉じる」。編集は native role を残し、IME・エディタ・Console の入力を横取りしない。
 const 編集=[['undo','Command+Z'],['redo','Shift+Command+Z'],['cut','Command+X'],['copy','Command+C'],['paste','Command+V'],['pasteAndMatchStyle','Shift+Command+V'],['selectAll','Command+A']];
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:名前,submenu:[
  {label:'閉じる',accelerator:'Command+Q',click:閉じる},
  {label:'ウィンドウを閉じる',visible:false,accelerator:'Command+W',acceleratorWorksWhenHidden:true,
   click:(_item,window)=>{if(window&&!window.isDestroyed())window.close();else 閉じる();}},
  ...編集.map(([role,accelerator])=>({role,accelerator,visible:false,acceleratorWorksWhenHidden:true})),
 ]}]));
 app.dock?.setMenu(Menu.buildFromTemplate([{label:'閉じる',click:閉じる}]));
 if(icon)app.dock?.setIcon(icon);
}

module.exports={Macメニューを設定};
