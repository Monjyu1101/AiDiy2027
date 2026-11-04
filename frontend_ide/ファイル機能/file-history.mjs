// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {open,readdir,realpath,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import { hasAlwaysExcludedDirectory } from './フォルダ除外規則.mjs';
import {isInternalCredentialPath} from './内部認証ファイル.mjs';

const MAX_TEXT=1024*1024,MAX_SNAPSHOTS=5000;
const within=(root,path)=>{const back=relative(root,path);return back!== '..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};
const failure=(status,message)=>Object.assign(Error(message),{status});
const validPath=path=>typeof path==='string'&&path.length<=2000&&!/[\\:\0]/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!['.aidiy_backup','.backup_local','.aidiy_cache'].includes(part.toLowerCase()));
async function safe(root,path){if(isInternalCredentialPath(path)||hasAlwaysExcludedDirectory(relative(root,path)))return null;try{const full=await realpath(path);return within(root,full)&&!isInternalCredentialPath(full)&&!hasAlwaysExcludedDirectory(relative(root,full))?full:null;}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return null;throw e;}}
async function directories(path){return (await readdir(path,{withFileTypes:true})).filter(entry=>entry.isDirectory());}

export function createFileHistory(project,{state}={}) {
  async function source(path){
    if(!validPath(path))throw failure(400,'ファイルパスが不正です。');
    const root=await realpath(project),full=await safe(root,join(root,path));
    if(!full||!(await stat(full)).isFile())throw failure(404,'ファイルが見つかりません。');
    return {root,full};
  }
  async function list(path){
    const {root}=await source(path),parts=path.split('/'),versions=[];let checked=0,truncated=false;
    // 対象ファイルの祖先だけを調べる。バックアップの中を再帰走査しない。
    outer:for(let depth=0;depth<parts.length;depth++){
      const base=parts.slice(0,depth),backup=await safe(root,join(root,...base,'.aidiy_backup'));
      if(!backup)continue;
      const days=(await directories(backup)).filter(d=>/^\d{8}$/.test(d.name)).sort((a,b)=>b.name.localeCompare(a.name));
      for(const day of days){
        const dayPath=await safe(backup,join(backup,day.name));if(!dayPath)continue;
        const times=(await directories(dayPath)).filter(d=>/^\d{6}(?:\..+)?$/.test(d.name)).sort((a,b)=>b.name.localeCompare(a.name));
        for(const time of times){
          if(++checked>MAX_SNAPSHOTS){truncated=true;break outer;}
          const snapshot=await safe(backup,join(dayPath,time.name));if(!snapshot)continue;
          const full=await safe(snapshot,join(snapshot,...parts.slice(depth)));if(!full)continue;
          const info=await stat(full);if(!info.isFile())continue;
          const backupPath=[...base,'.aidiy_backup',day.name,time.name,...parts.slice(depth)].join('/');
          const stamp=day.name+time.name.slice(0,6);
          versions.push({id:createHash('sha256').update(backupPath).digest('hex'),backupPath,stamp,
            label:`${stamp.slice(0,4)}/${stamp.slice(4,6)}/${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}`,
            fullBackup:/^\d{6}\.all(?:\.|$)/.test(time.name),size:info.size,mtime:info.mtimeMs});
        }
      }
    }
    versions.sort((a,b)=>b.stamp.localeCompare(a.stamp)||a.backupPath.localeCompare(b.backupPath));
    return {path,versions,truncated};
  }
  async function text(full){
    const handle=await open(full,'r');
    try{
      const info=await handle.stat();if(!info.isFile())throw failure(404,'ファイルが見つかりません。');
      if(info.size>MAX_TEXT)throw failure(413,'比較できるサイズは旧版・現在の各ファイル1MBまでです。');
      const bytes=Buffer.alloc(MAX_TEXT+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0),data=bytes.subarray(0,bytesRead);
      if(bytesRead>MAX_TEXT)throw failure(413,'比較できるサイズは各ファイル1MBまでです。');
      if(data.includes(0))throw failure(415,'このファイルはテキストとして比較できません。');
      for(const [encoding,label] of [['utf-8','UTF-8'],['shift_jis','Shift_JIS']]){
        try{return {text:new TextDecoder(encoding,{fatal:true}).decode(data),encoding:label,size:bytesRead,mtime:info.mtimeMs};}catch{}
      }
      throw failure(415,'文字コードを読み取れないため比較できません。');
    }finally{await handle.close();}
  }
  async function compare(path,id){
    const history=await list(path),version=history.versions.find(v=>v.id===id);
    if(!version)throw failure(404,'選択したバックアップが見つかりません。');
    const {root,full}=await source(path);
    const segments=version.backupPath.split('/');
    const snapshotRelative=segments.slice(0,segments.indexOf('.aidiy_backup')+3).join('/');
    const snapshot=await safe(root,join(root,snapshotRelative));
    const previous=snapshot&&await safe(snapshot,join(root,version.backupPath));
    if(!previous)throw failure(404,'バックアップが見つかりません。');
    const [original,modified]=await Promise.all([text(previous),text(full)]);
    return {path,version,original,modified};
  }
  return {list,compare,async handle(req,res,url){
    if(url.pathname!=='/api/file-history')return false;
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));};
    const session=state();
    try{
      if(req.method!=='GET')throw failure(405,'GETで取得してください。');
      if(!session.active)throw failure(503,'利用を開始してください。');
      const path=url.searchParams.get('path'),id=url.searchParams.get('version');
      const value=id?await compare(path,id):await list(path);
      if(!state().active||state().startedAt!==session.startedAt)throw failure(503,'利用が終了しました。');
      reply(200,value);
    }catch(e){reply(e.status||500,{error:e.status?e.message:'更新履歴を取得できません。'});}
    return true;
  }};
}
