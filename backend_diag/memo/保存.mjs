// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {lstat,realpath,readdir,mkdir,open,rename,unlink,link} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const 最大バイト数=1024*1024;
const 色一覧=new Set(['yellow','pink','blue','green','purple']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const 有効名=name=>typeof name==='string'&&name.length<=240&&!/[\\/\x00-\x1f]/.test(name)&&!name.startsWith('.')&&/\.(?:memo\.json|md|txt)$/i.test(name);
async function 安全読取(file){
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>最大バイト数)throw fail('通常のメモファイルではないか、1 MBを超えています。');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const now=await handle.stat();if(now.ino!==stat.ino||now.dev!==stat.dev)throw fail('ファイルが変更されました。再読込してください。',409);const data=await handle.readFile();if(data.length>最大バイト数)throw fail('メモが1 MBを超えています。');return data;}finally{await handle.close();}
}
const textFile=id=>!/\.memo\.json$/i.test(id);
const metadataFile=(directory,id)=>path.join(directory,'.memo-'+hash(id)+'.json');
const revision=(data,metadata)=>hash(metadata?Buffer.concat([data,Buffer.from('\0'),metadata]):data);
function 配置確認(fields){
 for(const [key,limits] of [['位置',{x:[0,100000],y:[0,100000]}],['サイズ',{width:[200,1200],height:[180,1600]}]]){
  const value=fields[key];if(value===undefined)continue;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(name=>!Object.hasOwn(limits,name))||Object.entries(limits).some(([name,[min,max]])=>!Number.isFinite(value[name])||value[name]<min||value[name]>max))throw fail('付箋の位置またはサイズが不正です。');
 }
}
function 表示(data,id,保存先,metadata){
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);let fields;
 if(!textFile(id)){
  fields=JSON.parse(text);
  if(fields?.version!==1||Object.keys(fields).some(key=>!['version','タイトル','本文','色','位置','サイズ'].includes(key))||typeof fields.タイトル!=='string'||typeof fields.本文!=='string'||!色一覧.has(fields.色))throw fail('メモ形式を確認してください。');
 }else{
  const extra=metadata?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata)):{};
  if(metadata&&(extra.version!==1||Object.keys(extra).some(key=>!['version','色','位置','サイズ'].includes(key))||!色一覧.has(extra.色)))throw fail('メモの表示設定を確認してください。');
  fields={タイトル:id.replace(/\.(md|txt)$/i,''),本文:text,色:'yellow',...extra};
 }
 配置確認(fields);
 return {id,保存先,タイトル:fields.タイトル,本文:fields.本文,色:fields.色,...(fields.位置?{位置:fields.位置}:{}),...(fields.サイズ?{サイズ:fields.サイズ}:{}),形式:textFile(id)?'text':'memo',revision:revision(data,metadata)};
}
async function メモ読取(directory,id,source,expected){
 const data=await 安全読取(path.join(directory,id));let metadata;
 if(textFile(id)){try{metadata=await 安全読取(metadataFile(directory,id));}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(expected&&revision(data,metadata)!==expected)throw fail('別の画面または外部で変更されています。再読込してください。',409);
 return {data,metadata,note:表示(data,id,source,metadata)};
}
function 入力(body,save){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!(save?['保存先','id','タイトル','本文','色','revision','位置','サイズ']:['保存先','タイトル','本文','色','位置','サイズ']).includes(key)))throw fail('メモの入力が不正です。');
 if(typeof body.保存先!=='string'||typeof body.タイトル!=='string'||body.タイトル.length>200||typeof body.本文!=='string'||Buffer.byteLength(body.本文)>最大バイト数-4096||!色一覧.has(body.色))throw fail('タイトルは200文字以内、本文は1 MB未満で入力してください。');
 if(save&&(!有効名(body.id)||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision)))throw fail('保存対象が不正です。');
 配置確認(body);
}
export function createMemoStore({launchRoot,getProjectRoot=async()=>''}={}){
 let queue=Promise.resolve();
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 async function 保存先一覧(){
  const roots=[],警告=[];
  let project;try{project=await getProjectRoot();}catch{警告.push('プロジェクトフォルダを確認できません。');}
  for(const [type,value,label] of [['launch',launchRoot,'起動フォルダ'],['project',project,'プロジェクト']]){
   if(!value)continue;
   try{
    if(typeof value!=='string'||!path.isAbsolute(value))throw Error();
    const root=await realpath(value);if(!(await lstat(root)).isDirectory())throw Error();
    const old=roots.find(item=>item.root===root);if(old){old.名前='起動・プロジェクト';continue;}
    roots.push({id:type+':'+hash(root).slice(0,24),名前:label,パス:path.join(root,'_AIDIY','aidiy_memo'),root});
   }catch{警告.push(`${label}を確認できません。`);}
  }
  return {roots,警告};
 }
 async function folder(source,create=false){
  let current=source.root;
  for(const part of ['_AIDIY','aidiy_memo']){
   current=path.join(current,part);
   try{const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw fail('メモ保存先がリンク、または通常フォルダではありません。');}
   catch(error){if(error.code!=='ENOENT')throw error;if(!create)return null;try{await mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw fail('メモ保存先を安全に作成できません。');}
  }
  if(await realpath(current)!==current)throw fail('メモ保存先が変更されました。');
  return current;
 }
 async function sourceFor(id){const {roots}=await 保存先一覧();const source=roots.find(value=>value.id===id);if(!source)throw fail('保存先が変わりました。メモを再読込してください。',409);return source;}
 async function list(){
  const {roots,警告}=await 保存先一覧(),メモ=[];
  for(const source of roots){
   try{
    const directory=await folder(source);if(!directory)continue;
    for(const id of (await readdir(directory)).filter(有効名).sort()){
     try{メモ.push((await メモ読取(directory,id,source.id)).note);}
     catch{警告.push(`${source.名前}: ${id} は読み込めません。元のファイルは変更していません。`);}
    }
   }catch{警告.push(`${source.名前}のメモ保存先を安全に読み込めません。`);}
  }
  return {保存先:roots.map(({root,...value})=>value),メモ,警告};
 }
 async function write(body,save){
  入力(body,save);const source=await sourceFor(body.保存先),directory=await folder(source,!save);
  if(!directory)throw fail('メモが削除されています。再読込してください。',409);
  const id=save?body.id:randomUUID()+'.memo.json',file=path.join(directory,id);let before;
  if(save){try{before=await メモ読取(directory,id,source.id,body.revision);}catch(error){if(error.code==='ENOENT')throw fail('メモが削除されています。再読込してください。',409);throw error;}if(before.note.revision!==body.revision)throw fail('別の画面または外部で変更されています。再読込してから保存してください。',409);}
  const textFormat=textFile(id);
  if(textFormat&&body.タイトル!==before.note.タイトル)throw fail('既存テキストメモのタイトルはファイル名です。');
  const 位置=body.位置??before?.note.位置,サイズ=body.サイズ??before?.note.サイズ;
  const display={色:body.色,...(位置?{位置}:{}),...(サイズ?{サイズ}:{})};
  const data=Buffer.from(textFormat?body.本文:JSON.stringify({version:1,タイトル:body.タイトル,本文:body.本文,...display},null,2)+'\n');
  const metadata=textFormat?Buffer.from(JSON.stringify({version:1,...display},null,2)+'\n'):undefined;
  const pending=[];
  async function prepare(target,content){
   const temp=path.join(directory,'.'+randomUUID()+'.tmp');pending.push(temp);
   const handle=await open(temp,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}return {target,temp};
  }
  try{
   const content=await prepare(file,data),meta=metadata?await prepare(metadataFile(directory,id),metadata):null;
   // ディレクトリ差替え・外部編集・配置変更を直前にも確認する。
   await sourceFor(body.保存先);await folder(source);
   if(save&&(await メモ読取(directory,id,source.id,body.revision)).note.revision!==body.revision)throw fail('保存中にメモが変更されました。再読込してください。',409);
   // 本文とsidecarは各々atomic。失敗時に外部編集を巻き戻すような復元はしない。
   // 表示設定のみの操作では既存テキストのinode/mtimeも変更しない。
   if(!textFormat||!before.data.equals(data)){if(save)await rename(content.temp,content.target);else await link(content.temp,content.target);}
   if(meta)await rename(meta.temp,meta.target);
  }finally{for(const temp of pending)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return 表示(data,id,source.id,metadata);
 }
 return {list,create:body=>serial(()=>write(body,false)),save:body=>serial(()=>write(body,true))};
}
