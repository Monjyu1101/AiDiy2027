// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {resolve,join,isAbsolute}=require('node:path');
const {lstatSync,mkdirSync,readFileSync,writeFileSync}=require('node:fs');

// 空のプロジェクトだけがAiDiy配置元を表す。ユーザーホームや旧保存先は探索しない。
function projectRoot(project,aidiyRoot){
  if(typeof project!=='string')throw Error('プロジェクトを指定してください。');
  if(!project.trim()){
    if(typeof aidiyRoot!=='string'||!isAbsolute(aidiyRoot))throw Error('AiDiyの配置元を指定してください。');
    return resolve(aidiyRoot);
  }
  return resolve(aidiyRoot||process.cwd(),project);
}
function programDataDirectory(project,programName,aidiyRoot,children=[]){
  if(!/^aidiy_[a-z][a-z0-9_]*$/.test(programName))throw Error('プログラム名が不正です。');
  if(!Array.isArray(children)||children.some(part=>typeof part!=='string'||!/^[a-z][a-z0-9_-]*$/.test(part)))throw Error('保存先のサブフォルダ名が不正です。');
  const root=projectRoot(project,aidiyRoot);
  let folder=root;
  for(const part of ['_AIDIY',programName,...children]){
    folder=join(folder,part);
    try{const info=lstatSync(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('保存先がプロジェクト外へのリンク、または通常フォルダではありません。');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return folder;
}

// 履歴・ブラウザprofileは外部プロジェクトでもGitへ混入させない。
// 利用者のルート.gitignore・Git設定は変更せず、専用保存先だけで除外する。
function preparePrivateDirectory(directory){
  try{const info=lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('保存先が通常フォルダではありません。');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  mkdirSync(directory,{recursive:true,mode:0o700});
  const ignore=join(directory,'.gitignore');
  const content='# AiDiy private generated data. Do not commit.\n*\n';
  try{writeFileSync(ignore,content,{encoding:'utf8',flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  // 既存ファイルを上書きしない。否定規則などがあれば保護を保証できないので停止する。
  const info=lstatSync(ignore);
  if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error('専用保存先の.gitignoreを安全に確認できません。');
  // Gitでは先頭空白もパターンの一部。「 *」を「*」とみなしてはいけない。
  const rules=readFileSync(ignore,'utf8').split(/\r?\n/).filter(line=>line!==''&&!line.startsWith('#'));
  if(!rules.length||rules.some(line=>line!=='*'))throw Error('専用保存先の.gitignoreで生成物すべてを除外してください（*）。既存設定は変更していません。');
  return directory;
}
module.exports={projectRoot,programDataDirectory,preparePrivateDirectory};
