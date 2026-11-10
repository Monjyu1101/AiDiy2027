// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {join,resolve}=require('node:path');
const fs=require('node:fs');
const {programDataDirectory,preparePrivateDirectory}=require('../host/scripts/project-storage.cjs');
function registry(root=resolve(__dirname,'../..')){return join(programDataDirectory(root,'aidiy_diag',root,['electron']),'mini-bounds.json');}
function valid(b){return b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width===360&&b.height>=80&&b.height<=360;}
function readDiagMiniBounds(file=null,alive=pid=>{process.kill(pid,0);return true;}){
 try{file=file||registry();const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>2048)return null;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Number.isSafeInteger(data.pid)||data.pid<=0||!valid(data.bounds)||!alive(data.pid))return null;
 return data.bounds;
 }catch{return null;}
}
// Diag自身の実寸だけを共有。通常表示・最小化・終了時は参照させない。
function trackDiagMiniBounds(window,active,{file=null,pid=process.pid}={}){
 try{file=file||registry();}catch{return{save(){},dispose(){}};}
 const remove=()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).pid===pid)fs.unlinkSync(file);}catch{}};
 const save=()=>{try{
  if(window.isDestroyed()||window.isMinimized?.()||window.isVisible?.()===false||!active()){remove();return;}
  const bounds=window.getBounds();if(!valid(bounds)){remove();return;}
  preparePrivateDirectory(require('node:path').dirname(file));
  try{if(fs.lstatSync(file).isSymbolicLink())return;}catch(error){if(error.code!=='ENOENT')return;}
  fs.writeFileSync(file,JSON.stringify({pid,bounds}),{mode:0o600});
 }catch{/* 保存不可でもDiagの操作は継続する。 */}};
 const events=['move','resize','show','hide','minimize','restore'];
 for(const event of events)window.on(event,save);
 const dispose=()=>{for(const event of events)window.removeListener(event,save);remove();};
 window.once('closed',dispose);save();return{save,dispose};
}
module.exports={readDiagMiniBounds,trackDiagMiniBounds};
