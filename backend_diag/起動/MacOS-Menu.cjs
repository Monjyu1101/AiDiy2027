// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {Macメニューを設定:共通メニュー}=require('../../frontend_ide/host/scripts/MacOS-Menu.cjs');

const アプリ名='AiDiy 診断';

function Macメニューを設定({app,Menu,window,icon,platform=process.platform}){
 if(platform!=='darwin')return;
 const 閉じる=()=>{if(!window.isDestroyed())window.close();};
 共通メニュー({app,Menu,名前:アプリ名,閉じる,icon,platform});
}

module.exports={アプリ名,Macメニューを設定};
