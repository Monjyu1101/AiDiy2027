// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {app,BrowserWindow,session}=require('electron');
process.once('message',async({url,profile})=>{
 let window;
 try{
  app.setPath('userData',profile);await app.whenReady();
  const isolated=session.fromPartition('markdown-pdf-'+process.pid,{cache:false}),origin=new URL(url).origin;
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.webRequest.onBeforeRequest((details,callback)=>{
   let allowed=false;
   try{const target=new URL(details.url);allowed=target.origin===origin||details.resourceType==='image'&&['data:','https:','http:'].includes(target.protocol);}catch{}
   callback({cancel:!allowed});
  });
  window=new BrowserWindow({show:false,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await window.loadURL(url);
  if(!await window.webContents.executeJavaScript("!!document.querySelector('article.markdown-body')"))throw Error('not markdown');
  await window.webContents.insertCSS(`:root{color-scheme:light !important}body{background:#fff !important;color:#20252b !important;font-size:11pt !important}article{max-width:none !important;padding:0 !important}a{color:#12649a !important}h1,h2{border-color:#bbc2cb !important}h1,h2,h3,h4{break-after:avoid !important}blockquote{color:#46515e !important;border-color:#adb8c4 !important}pre,code,th,tr:nth-child(even){background:#f3f5f7 !important;color:#20252b !important}pre{white-space:pre-wrap !important;overflow-wrap:anywhere !important;border-color:#ccd2da !important}table{display:table !important;width:100% !important;table-layout:fixed !important}th,td{border-color:#aab4c0 !important;overflow-wrap:anywhere !important}thead{display:table-header-group !important}tr,img{break-inside:avoid !important}img{max-height:245mm !important;object-fit:contain !important}a{text-decoration:none !important}@page{size:A4 !important;margin:16mm !important}`);
  await window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});})));if([...document.images].some(image=>!image.naturalWidth))throw Error('image failed');})()`);
  const pdf=await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4'});
  process.send({type:'pdf',data:pdf.toString('base64')});
 }catch{process.send?.({type:'error'});}
});
process.on('disconnect',()=>app.exit());
process.send?.({type:'ready'});
