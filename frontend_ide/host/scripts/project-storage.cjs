// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {resolve,join,isAbsolute}=require('node:path');
const {lstatSync}=require('node:fs');

// 空のプロジェクトだけがAiDiy配置元を表す。ユーザーホームや旧保存先は探索しない。
function projectRoot(project,aidiyRoot){
  if(typeof project!=='string')throw Error('プロジェクトを指定してください。');
  if(!project.trim()){
    if(typeof aidiyRoot!=='string'||!isAbsolute(aidiyRoot))throw Error('AiDiyの配置元を指定してください。');
    return resolve(aidiyRoot);
  }
  return resolve(aidiyRoot||process.cwd(),project);
}
function programDataDirectory(project,programName,aidiyRoot){
  if(!/^aidiy_[a-z][a-z0-9_]*$/.test(programName))throw Error('プログラム名が不正です。');
  const root=projectRoot(project,aidiyRoot);
  let folder=root;
  for(const part of ['_AIDIY',programName]){
    folder=join(folder,part);
    try{const info=lstatSync(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('保存先がプロジェクト外へのリンク、または通常フォルダではありません。');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return folder;
}
module.exports={projectRoot,programDataDirectory};
