// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {lstat,realpath,readdir,mkdir,open,rename,unlink,link,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {画像を検証,最大メモバイト数} from './画像.mjs';
const 最大バイト数=1024*1024;
const 色一覧=new Set(['yellow','pink','blue','green','purple']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const 有効名=name=>typeof name==='string'&&name.length<=240&&!/[\\/\x00-\x1f]/.test(name)&&!name.startsWith('.')&&/\.(?:memo\.json|md|txt)$/i.test(name);
async function 安全読取(file){
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>最大メモバイト数)throw fail('通常のメモファイルではないか、容量上限を超えています。');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const now=await handle.stat();if(now.ino!==stat.ino||now.dev!==stat.dev)throw fail('ファイルが変更されました。再読込してください。',409);const data=await handle.readFile();if(data.length>最大メモバイト数)throw fail('メモの容量上限を超えています。');return data;}finally{await handle.close();}
}
const textFile=id=>!/\.memo\.json$/i.test(id);
const metadataFile=(directory,id)=>path.join(directory,'.memo-'+hash(id)+'.json');
const revision=(data,metadata)=>hash(metadata?Buffer.concat([data,Buffer.from('\0'),metadata]):data);
function 配置確認(fields){
 for(const [key,limits] of [['位置',{x:[-100000,100000],y:[-100000,100000]}],['サイズ',{width:[200,1200],height:[140,1600]}]]){
  const value=fields[key];if(value===undefined)continue;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(name=>!Object.hasOwn(limits,name))||Object.entries(limits).some(([name,[min,max]])=>!Number.isFinite(value[name])||value[name]<min||value[name]>max))throw fail('付箋の位置またはサイズが不正です。');
 }
}
function 表示(data,id,保存先,metadata){
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);let fields;
 if(!textFile(id)){
  fields=JSON.parse(text);
  if(fields?.version!==1||Object.keys(fields).some(key=>!['version','タイトル','本文','色','位置','サイズ','画像'].includes(key))||typeof fields.タイトル!=='string'||typeof fields.本文!=='string'||!色一覧.has(fields.色))throw fail('メモ形式を確認してください。');
 }else{
  const extra=metadata?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata)):{};
  if(metadata&&(extra.version!==1||Object.keys(extra).some(key=>!['version','色','位置','サイズ','画像'].includes(key))||!色一覧.has(extra.色)))throw fail('メモの表示設定を確認してください。');
  fields={タイトル:id.replace(/\.(md|txt)$/i,''),本文:text,色:'yellow',...extra};
 }
 画像を検証(fields.画像);
 if(Buffer.byteLength(fields.本文)>最大バイト数)throw fail('本文は1 MB未満で入力してください。');
 配置確認(fields);
 return {id,保存先,タイトル:fields.タイトル,本文:fields.本文,...(fields.画像?{画像:fields.画像}:{}),色:fields.色,...(fields.位置?{位置:fields.位置}:{}),...(fields.サイズ?{サイズ:fields.サイズ}:{}),形式:textFile(id)?'text':'memo',revision:revision(data,metadata)};
}
async function メモ読取(directory,id,source,expected){
 const data=await 安全読取(path.join(directory,id));let metadata;
 if(textFile(id)){try{metadata=await 安全読取(metadataFile(directory,id));}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(expected&&revision(data,metadata)!==expected)throw fail('別の画面または外部で変更されています。再読込してください。',409);
 return {data,metadata,note:表示(data,id,source,metadata)};
}
function 入力(body,save){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!(save?['保存先','id','タイトル','本文','色','revision','位置','サイズ','画像']:['保存先','タイトル','本文','色','位置','サイズ','clientId','画像']).includes(key)))throw fail('メモの入力が不正です。');
 if(typeof body.保存先!=='string'||typeof body.タイトル!=='string'||body.タイトル.length>200||typeof body.本文!=='string'||Buffer.byteLength(body.本文)>最大バイト数-4096||!色一覧.has(body.色))throw fail('タイトルは200文字以内、本文は1 MB未満で入力してください。');
 if(save&&(!有効名(body.id)||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision)))throw fail('保存対象が不正です。');
 画像を検証(body.画像);
 if(!save&&!body.本文.trim()&&!body.タイトル.trim()&&!body.画像)throw fail('空の付箋は保存しません。');
 if(!save&&body.clientId!==undefined&&(typeof body.clientId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.clientId)))throw fail('付箋の作成IDが不正です。');
 配置確認(body);
 // JSON のエスケープで本文の実バイト数より大きくなるため、生成前にも検査する。
 // 新規は保存先フォルダを作る前に拒否する。既存textはJSON化しない。
 if(!save||!textFile(body.id)){
  const data=Buffer.from(JSON.stringify({version:1,タイトル:body.タイトル,本文:body.本文,色:body.色,...(body.位置?{位置:body.位置}:{}),...(body.サイズ?{サイズ:body.サイズ}:{})},null,2)+'\n');
  if(data.length>最大バイト数)throw fail('保存形式に変換したメモが1 MBを超えています。');
 }
}
// 通常起動と単体起動など複数storeが同じファイルを扱う場合も直列化する。
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
export function createMemoStore({launchRoot,getLaunchRoot=async()=>launchRoot,getProjectRoot=async()=>''}={}){
 const knownSources=new Map();
 async function 保存先一覧(){
  const roots=[],警告=[];
  let launch;try{launch=await getLaunchRoot();}catch{警告.push('起動フォルダを確認できません。');}
  let project;try{project=await getProjectRoot();}catch{警告.push('プロジェクトフォルダを確認できません。');}
  for(const [type,value,label] of [['launch',launch,'起動フォルダ'],['project',project,'プロジェクト']]){
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
 async function sourceFor(id,save=false){
  const {roots}=await 保存先一覧();const known=save?knownSources.get(id):null;
  const source=known?.source||roots.find(value=>value.id===id);
  if(!source)throw fail('保存先が変わりました。メモを再読込してください。',409);
  if(known){
   let info;try{info=await lstat(source.root);}catch{throw fail('元の保存先を確認できません。',409);}
   if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==known.dev||info.ino!==known.ino||await realpath(source.root)!==source.root)throw fail('元の保存先が変更されました。',409);
  }
  return source;
 }
 async function list(){
  const {roots,警告}=await 保存先一覧(),メモ=[];
  for(const source of roots){
   try{
    const info=await lstat(source.root);
    if(info.isSymbolicLink()||!info.isDirectory()||await realpath(source.root)!==source.root)throw fail('保存先が変更されました。');
    if(!knownSources.has(source.id))knownSources.set(source.id,{source,dev:info.dev,ino:info.ino});
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
  入力(body,save);const source=await sourceFor(body.保存先,save),directory=await folder(source,!save);
  if(!directory)throw fail('メモが削除されています。再読込してください。',409);
  const id=save?body.id:(body.clientId?.toLowerCase()||randomUUID())+'.memo.json',file=path.join(directory,id);let before;
  if(save){try{before=await メモ読取(directory,id,source.id,body.revision);}catch(error){if(error.code==='ENOENT')throw fail('メモが削除されています。再読込してください。',409);throw error;}if(before.note.revision!==body.revision)throw fail('別の画面または外部で変更されています。再読込してから保存してください。',409);}
  const textFormat=textFile(id);
  if(textFormat&&body.タイトル!==before.note.タイトル)throw fail('既存テキストメモのタイトルはファイル名です。');
  const 位置=body.位置??before?.note.位置,サイズ=body.サイズ??before?.note.サイズ;
  const 画像=body.画像===undefined?before?.note.画像:body.画像;
  const display={色:body.色,...(画像?{画像}:{}),...(位置?{位置}:{}),...(サイズ?{サイズ}:{})};
  const data=Buffer.from(textFormat?body.本文:JSON.stringify({version:1,タイトル:body.タイトル,本文:body.本文,...display},null,2)+'\n');
  const metadata=textFormat?Buffer.from(JSON.stringify({version:1,...display},null,2)+'\n'):undefined;
  if(data.length>最大メモバイト数||(metadata&&metadata.length>最大メモバイト数))throw fail('保存形式に変換したメモが容量上限を超えています。');
  async function existingCreation(){
   try{
    const existing=await メモ読取(directory,id,source.id),a=existing.note,b=表示(data,id,source.id);
    const same=['タイトル','本文','色','画像'].every(key=>a[key]===b[key])&&['位置','サイズ'].every(key=>a[key]===undefined?b[key]===undefined:b[key]!==undefined&&Object.keys(a[key]).every(name=>a[key][name]===b[key][name]));
    if(!same)throw fail('同じ作成IDの付箋が別の内容で保存されています。',409);
    return existing.note;
   }catch(error){if(error.code==='ENOENT')return null;throw fail('同じ作成IDの付箋を確認できないか、内容が異なります。',409);}
  }
  if(!save&&body.clientId){const existing=await existingCreation();if(existing)return existing;}
  const pending=[];
  async function prepare(target,content){
   const temp=path.join(directory,'.'+randomUUID()+'.tmp');pending.push(temp);
   const handle=await open(temp,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}return {target,temp};
  }
  try{
   const content=await prepare(file,data),meta=metadata?await prepare(metadataFile(directory,id),metadata):null;
   // ディレクトリ差替え・外部編集・配置変更を直前にも確認する。
   await sourceFor(body.保存先,save);await folder(source);
   if(save&&(await メモ読取(directory,id,source.id,body.revision)).note.revision!==body.revision)throw fail('保存中にメモが変更されました。再読込してください。',409);
   // 本文とsidecarは各々atomic。失敗時に外部編集を巻き戻すような復元はしない。
   // 表示設定のみの操作では既存テキストのinode/mtimeも変更しない。
   if(!textFormat||!before.data.equals(data)){if(save)await rename(content.temp,content.target);else {try{await link(content.temp,content.target);}catch(error){if(error.code==='EEXIST'&&body.clientId){const existing=await existingCreation();if(existing)return existing;}throw error;}}}
   if(meta)await rename(meta.temp,meta.target);
  }finally{for(const temp of pending)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return 表示(data,id,source.id,metadata);
 }
 async function read(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['保存先','id'].includes(key))||typeof body.保存先!=='string'||!有効名(body.id))throw fail('読込対象が不正です。');
  const source=await sourceFor(body.保存先,true),directory=await folder(source);
  if(!directory)throw fail('メモが見つかりません。',404);
  try{return (await メモ読取(directory,body.id,source.id)).note;}
  catch(error){if(error.code==='ENOENT')throw fail('メモが見つかりません。',404);throw error;}
 }
 async function trash(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['保存先','id','revision'].includes(key))||typeof body.保存先!=='string'||!有効名(body.id)||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))throw fail('削除対象が不正です。');
  const source=await sourceFor(body.保存先,true),directory=await folder(source);
  if(!directory)throw fail('メモが見つかりません。',404);
  const before=await メモ読取(directory,body.id,source.id,body.revision);
  // 永久削除しない。元の名前と本文を保存先内の非表示ゴミ箱に保持する。
  const trashRoot=path.join(directory,'.trash');
  try{await mkdir(trashRoot,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(trashRoot);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(trashRoot)!==trashRoot)throw fail('ゴミ箱を安全に確認できません。');
  const destination=path.join(trashRoot,randomUUID());await mkdir(destination,{mode:0o700});
  // textのsidecarは先に複製。本文移動に失敗しても元のメモは損なわない。
  if(before.metadata)await writeFile(metadataFile(destination,body.id),before.metadata,{flag:'wx',mode:0o600});
  await sourceFor(body.保存先,true);await folder(source);
  await メモ読取(directory,body.id,source.id,body.revision);
  await rename(path.join(directory,body.id),path.join(destination,body.id));
  return {削除:true};
 }
 return {list,trash:body=>serial(()=>trash(body)),read:body=>serial(()=>read(body)),create:body=>serial(()=>write(body,false)),save:body=>serial(()=>write(body,true))};
}
