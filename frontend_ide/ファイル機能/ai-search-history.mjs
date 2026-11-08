// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ideDataFolder } from './ide-data.mjs';

// 入力結果は1MiBのまま。派生from/toが各パスを最大2回追加する分とメタデータを含め、履歴は3MiBに制限する。
export const MAX_SEARCH_HISTORY_BYTES=3*1024*1024;

const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const within=(root,path)=>{const back=relative(root,path);return back!=='..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};
export function createSearchHistory(project,validate) {
  // 保存先は _AIDIY/aidiy_ide/file_searches/
  const folder=()=>ideDataFolder(project,'file_searches',{label:'検索履歴'});
  async function read(id){
    if(!validId(id))throw Error('検索履歴IDが不正です。');
    const directory=await folder(),path=await realpath(join(directory,id+'.json'));
    if(!within(directory,path)||(await stat(path)).size>MAX_SEARCH_HISTORY_BYTES)throw Error('検索履歴を読み取れません。');
    const entry=JSON.parse(await readFile(path,'utf8'));
    if(entry.id!==id)throw Error('検索履歴IDが一致しません。');
    if(entry.deleted)return entry;
    if(typeof entry.query!=='string'||entry.query.length>2000||!Number.isFinite(entry.createdAt))throw Error('検索履歴の形式が不正です。');
    return {...await validate(project,{...entry,requestId:id},{id,query:entry.query},{checkFiles:false}),id,createdAt:entry.createdAt};
  }
  async function save(entry,{replace=false}={}){
    if(!validId(entry.id))throw Error('検索履歴IDが不正です。');
    const serialized=JSON.stringify(entry);
    if(Buffer.byteLength(serialized,'utf8')>MAX_SEARCH_HISTORY_BYTES)throw Error('検索履歴は3MB以下にしてください。');
    const directory=await folder(),target=join(directory,entry.id+'.json');
    if(!replace&&await stat(target).catch(()=>null))return;
    const temp=join(directory,randomUUID()+'.tmp');
    await writeFile(temp,serialized,{encoding:'utf8',flag:'wx'});await rename(temp,target);
  }
  return {
    save,
    async list(){
      const directory=await folder(),entries=[];
      for(const name of await readdir(directory)){
        if(!name.endsWith('.json')||!validId(name.slice(0,-5)))continue;
        try{const entry=await read(name.slice(0,-5));if(!entry.deleted)entries.push({id:entry.id,title:entry.title,query:entry.query,createdAt:entry.createdAt,count:entry.files.length});}catch{/* 壊れた1件で他の履歴を隠さない。 */}
      }
      return entries.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
    },
    async get(id){const entry=await read(id);if(entry.deleted)throw Error('この検索履歴は削除されています。');return entry;},
    async remove(id){await read(id);await save({id,deleted:true},{replace:true});},
  };
}

