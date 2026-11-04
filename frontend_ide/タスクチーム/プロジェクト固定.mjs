// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {isAbsolute} from 'node:path';
import profiles from '../デスクトップ/project-profile.cjs';
const writes=new Set(['/task/タスク要求/登録','/task/タスク要求/AI登録','/task/タスク要求/更新登録','/team/依頼/登録','/team/依頼/変更']);
export function createFixedProject(project){
 const fixed=profiles.projectIdentity(project);
 const matches=value=>{
  try{return typeof value==='string'&&isAbsolute(value)&&profiles.projectIdentity(value).key===fixed.key;}catch{return false;}
 };
 return {path:fixed.path,matches,validate(path,body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('JSONオブジェクトを指定してください。');
  if(writes.has(path)){
   if(!matches(body.プロジェクト))throw Error('IDE連携ではプロジェクトフォルダを変更できません。単独起動で対象を確認してください。');
   return {...body,プロジェクト:fixed.path};
  }
  return body;
 }};
}
