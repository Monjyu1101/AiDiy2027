// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {createHash}=require('node:crypto');
const {realpathSync,statSync}=require('node:fs');
const path=require('node:path');
const {programDataDirectory}=require('../host/scripts/project-storage.cjs');

// プロジェクト名ではなく実フォルダの完全パスで区別する。リンク・相対表記は同じ実体へ揃える。
function projectIdentity(project,{platform=process.platform,realpath=realpathSync.native,stat=statSync}={}){
 const paths=platform==='win32'?path.win32:path;
 const canonical=paths.normalize(realpath(paths.resolve(project)));
 const info=stat(canonical,{bigint:true});
 if(!info.isDirectory())throw Error(`作業フォルダがありません: ${canonical}`);
 let identity=canonical;
 if(platform==='win32'){
  // Windowsの区切り・大文字小文字・長いパス表記を統一する。
  identity=canonical.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'').toLowerCase();
  // 大文字小文字を区別するWindowsフォルダは別の実体。同名扱いで他のプロジェクトを閉じない。
  identity+=`\0${info.dev}:${info.ino}`;
 }
 return{path:canonical,key:createHash('sha256').update(identity).digest('hex')};
}

function projectProfile(appData,project,options){
 return path.join(programDataDirectory(projectIdentity(project,options).path,'aidiy_ide'),'electron');
}

module.exports={projectIdentity,projectProfile};
