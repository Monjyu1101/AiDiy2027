// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,symlink,link,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMemoStore} from '../memo/保存.mjs';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'aidiy-memo-'));t.after(()=>rm(root,{recursive:true,force:true}));const launch=path.join(root,'launch'),project=path.join(root,'project');await mkdir(launch);await mkdir(project);return {root,launch,project};}
const memo=(保存先,本文='日本語の付箋')=>({保存先,タイトル:'メモ',本文,色:'yellow'});
const edit=(note,本文)=>({保存先:note.保存先,id:note.id,タイトル:note.タイトル,本文,色:note.色,revision:note.revision});
test('一覧は書込しない・同一保存先は重複しない',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch,getProjectRoot:()=>launch});
 const result=await store.list();assert.equal(result.保存先.length,1);assert.equal(result.保存先[0].名前,'起動・プロジェクト');assert.deepEqual(await readdir(launch),[]);
});
test('両保存先へ新規保存、再起動、編集・競合保護',async t=>{
 const {launch,project}=await fixture(t),options={launchRoot:launch,getProjectRoot:()=>project},store=createMemoStore(options);
 const {保存先}=await store.list();assert.equal(保存先.length,2);
 const notes=await Promise.all(保存先.map(source=>store.create(memo(source.id))));
 assert.notEqual(notes[0].id,notes[1].id);assert.equal((await createMemoStore(options).list()).メモ.length,2);
 const changed=await store.save(edit(notes[0],'編集後'));assert.equal(changed.本文,'編集後');assert.notEqual(changed.revision,notes[0].revision);
 await assert.rejects(store.save(edit(notes[0],'古い画面')),{status:409});
 const file=path.join(保存先[0].パス,notes[0].id);await writeFile(file,'outside');await assert.rejects(store.save(edit(changed,'上書き禁止')),{status:409});assert.equal(await readFile(file,'utf8'),'outside');
 assert.equal((await readdir(保存先[0].パス)).filter(file=>file.endsWith('.tmp')).length,0);
});
test('既存md/txtは本文をそのまま編集、壊れた形式は保持して警告',async t=>{
 const {launch}=await fixture(t),directory=path.join(launch,'_AIDIY','aidiy_memo');await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'手書き.md'),'\uFEFF# タイトル\r\n本文');await writeFile(path.join(directory,'unknown.memo.json'),'{"version":2}');await writeFile(path.join(directory,'bad.txt'),Buffer.from([0xff,0xfe]));
 const store=createMemoStore({launchRoot:launch}),list=await store.list();assert.equal(list.メモ.length,1);assert.equal(list.警告.length,2);const note=list.メモ[0];assert.equal(note.形式,'text');assert.equal(note.本文,'\uFEFF# タイトル\r\n本文');
 await assert.rejects(store.save({...edit(note,'new'),タイトル:'changed'}),{status:400});
 await store.save(edit(note,note.本文+'\r\n追記'));assert.equal(await readFile(path.join(directory,'手書き.md'),'utf8'),note.本文+'\r\n追記');assert.equal(await readFile(path.join(directory,'unknown.memo.json'),'utf8'),'{"version":2}');
});
test('プロジェクト変更後の旧保存先へは書かない',async t=>{
 const {launch,project}=await fixture(t);let selected=project;const store=createMemoStore({launchRoot:launch,getProjectRoot:()=>selected});const old=(await store.list()).保存先[1];selected=launch;
 await assert.rejects(store.create(memo(old.id)),{status:409});assert.deepEqual(await readdir(project),[]);
});
test('相対パス・パストラバーサル・不正サイズは拒否',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0];
 for(const id of ['../evil.md','x/evil.txt','x\\evil.txt','.hidden.md','evil.json'])await assert.rejects(store.save({...memo(source.id),id,revision:'a'.repeat(64)}),{status:400});
 await assert.rejects(store.create(memo(source.id,'x'.repeat(1024*1024))),{status:400});assert.deepEqual(await readdir(launch),[]);
 assert.equal((await createMemoStore({launchRoot:'relative'}).list()).保存先.length,0);
});
test('symlink保存先・ファイル・hardlinkを拒否',async t=>{
 const {launch,project}=await fixture(t);await symlink(project,path.join(launch,'_AIDIY'),'dir');let store=createMemoStore({launchRoot:launch}),list=await store.list();assert.equal(list.警告.length,1);await assert.rejects(store.create(memo(list.保存先[0].id)));assert.deepEqual(await readdir(project),[]);
 await rm(path.join(launch,'_AIDIY'));const directory=path.join(launch,'_AIDIY','aidiy_memo');await mkdir(directory,{recursive:true});const outside=path.join(project,'outside.txt');await writeFile(outside,'保護');await symlink(outside,path.join(directory,'link.txt'));await link(outside,path.join(directory,'hard.txt'));
 list=await store.list();assert.equal(list.メモ.length,0);assert.equal(list.警告.length,2);assert.equal(await readFile(outside,'utf8'),'保護');
});
test('同一revisionの並列保存で後続を競合扱いにする',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0],note=await store.create(memo(source.id));
 const results=await Promise.allSettled([store.save(edit(note,'A')),store.save(edit(note,'B'))]);assert.deepEqual(results.map(item=>item.status),['fulfilled','rejected']);assert.equal(results[1].reason.status,409);
});
test('位置・サイズ・色を再読込後も保持、未指定の更新は既存配置を保持',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0];
 let note=await store.create({...memo(source.id),位置:{x:10,y:20},サイズ:{width:300,height:250}});
 note=await store.save({...edit(note,'本文更新'),色:'pink'});const restored=(await store.list()).メモ[0];assert.deepEqual(restored.位置,{x:10,y:20});assert.deepEqual(restored.サイズ,{width:300,height:250});assert.equal(restored.色,'pink');
 for(const fields of [{位置:{x:-100001,y:0}},{位置:{x:0,y:Infinity}},{位置:{x:0,y:0,extra:1}},{サイズ:{width:199,height:200}},{サイズ:{width:300,height:1601}}])await assert.rejects(store.save({...edit(note,'本文'),...fields}),{status:400});
});
test('既存textは本文を触らずsidecarへ配置・色保存、sidecar競合・リンクも保護',async t=>{
 const {launch,project}=await fixture(t),directory=path.join(launch,'_AIDIY','aidiy_memo');await mkdir(directory,{recursive:true});const file=path.join(directory,'既存.txt');await writeFile(file,'\uFEFF本文\r\n');const before=await lstat(file);
 const store=createMemoStore({launchRoot:launch});let note=(await store.list()).メモ[0],old=note;
 note=await store.save({...edit(note,note.本文),色:'blue',位置:{x:90,y:50},サイズ:{width:400,height:300}});assert.equal((await lstat(file)).mtimeMs,before.mtimeMs);assert.equal(await readFile(file,'utf8'),'\uFEFF本文\r\n');
 let restored=(await store.list()).メモ[0];assert.equal(restored.色,'blue');assert.deepEqual(restored.位置,{x:90,y:50});assert.notEqual(note.revision,old.revision);await assert.rejects(store.save(edit(old,'stale')),{status:409});
 const sidecar=path.join(directory,(await readdir(directory)).find(name=>name.startsWith('.memo-')));await writeFile(sidecar,'{"version":1,"色":"pink"}');await assert.rejects(store.save(edit(note,'stale')),{status:409});assert.equal(await readFile(file,'utf8'),'\uFEFF本文\r\n');
 await rm(sidecar);const outside=path.join(project,'保護.json');await writeFile(outside,'private');await symlink(outside,sidecar);assert.equal((await store.list()).メモ.length,0);assert.equal(await readFile(outside,'utf8'),'private');
});
test('新規空メモは保存先も作成せず、既存を空にする編集は削除しない',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0];
 for(const text of ['','  \t\r\n','\u3000'])await assert.rejects(store.create({...memo(source.id,text),タイトル:'  '}),{status:400});assert.deepEqual(await readdir(launch),[]);
 const created=await store.create({...memo(source.id,''),タイトル:'タイトルのみ'});const saved=await store.save(edit(created,''));assert.equal(saved.本文,'');assert.equal((await store.list()).メモ.length,1);
});
test('clientIdは再起動や並列作成後の応答消失を再試行しても二重作成しない',async t=>{
 const {launch}=await fixture(t),options={launchRoot:launch},store=createMemoStore(options),source=(await store.list()).保存先[0];
 const body={...memo(source.id),clientId:'76a1bee4-8f12-44bc-a1d0-706fa0c58d96',位置:{x:-1920,y:-100},サイズ:{width:200,height:140}};
 const [first,second]=await Promise.all([store.create(body),createMemoStore(options).create({...body,位置:{y:-100,x:-1920}})]);assert.equal(first.id,body.clientId+'.memo.json');assert.deepEqual(first,second);
 assert.deepEqual(await createMemoStore(options).create(body),first);assert.equal((await readdir(source.パス)).length,1);
 await assert.rejects(store.create({...body,本文:'別内容'}),{status:409});await assert.rejects(store.create({...body,clientId:'../x'}),{status:400});
 const changed=await store.save(edit(first,'保存後の変更'));await assert.rejects(store.create(body),{status:409});assert.equal((await store.list()).メモ[0].本文,changed.本文);
});
test('一覧で認識済みの保存先は切替後も元の付箋のみ保存可能、新規作成は不可',async t=>{
 const {launch,project}=await fixture(t);let selected=project;const options={launchRoot:launch,getProjectRoot:()=>selected},store=createMemoStore(options),source=(await store.list()).保存先[1];
 const first=await store.create(memo(source.id));selected=launch;const saved=await store.save({...edit(first,'切替後保存'),位置:{x:-100,y:-200},サイズ:{width:200,height:140}});assert.equal(saved.本文,'切替後保存');assert.equal((await store.list()).保存先.length,1);
 await assert.rejects(store.create(memo(source.id)),{status:409});await assert.rejects(createMemoStore(options).save(edit(saved,'未知の旧root')),{status:409});
 assert.equal(JSON.parse(await readFile(path.join(source.パス,first.id),'utf8')).本文,'切替後保存');
});
test('既知rootが差し替わった場合は旧sourceの保存を拒否する',async t=>{
 const {launch,project}=await fixture(t);let selected=project;const store=createMemoStore({launchRoot:launch,getProjectRoot:()=>selected}),source=(await store.list()).保存先[1],note=await store.create(memo(source.id));selected=launch;
 await rename(project,project+'-old');await mkdir(project);await assert.rejects(store.save(edit(note,'wrong target')),{status:409});assert.deepEqual(await readdir(project),[]);
 await rm(project,{recursive:true});await symlink(project+'-old',project,'dir');await assert.rejects(store.save(edit(note,'wrong link')),{status:409});assert.equal(JSON.parse(await readFile(path.join(project+'-old','_AIDIY','aidiy_memo',note.id),'utf8')).本文,note.本文);
});
test('readは現在/既知の旧保存先だけに限定し、フォルダ越境・未知root・差替えを拒否',async t=>{
 const {launch,project}=await fixture(t);let selected=project;const options={launchRoot:launch,getProjectRoot:()=>selected},store=createMemoStore(options),sources=(await store.list()).保存先,note=await store.create(memo(sources[1].id)),body={保存先:note.保存先,id:note.id};
 assert.deepEqual(await store.read(body),note);selected=launch;assert.deepEqual(await store.read(body),note);
 await assert.rejects(createMemoStore(options).read(body),{status:409});await assert.rejects(store.read({...body,保存先:sources[0].id}),{status:404});
 for(const id of ['../project/outside.txt','..\\outside.txt','/absolute.txt','.hidden.txt','bad.json'])await assert.rejects(store.read({...body,id}),{status:400});
 await assert.rejects(store.read({...body,extra:true}),{status:400});await assert.rejects(store.read({...body,保存先:'project:unknown'}),{status:409});
 await rename(project,project+'-old');await mkdir(project);await assert.rejects(store.read(body),{status:409});assert.deepEqual(await readdir(project),[]);
});
test('JSONエスケープ後の1 MB超過をmkdir前に拒否し、既存ファイルも保全する',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0];
 for(const text of ['"'.repeat(530000),'\\'.repeat(530000),'\0'.repeat(180000)])await assert.rejects(store.create(memo(source.id,text)),{status:400});assert.deepEqual(await readdir(launch),[]);
 const title='\0'.repeat(200),base={...memo(source.id,''),タイトル:title};
 const encoded=body=>Buffer.from(JSON.stringify({version:1,タイトル:body.タイトル,本文:body.本文,色:body.色},null,2)+'\n');
 const quoteCount=Math.floor((1024*1024-encoded(base).length)/2),fit={...base,本文:'"'.repeat(quoteCount)};assert.ok(encoded(fit).length<=1024*1024);
 const note=await store.create(fit);assert.equal((await store.list()).メモ[0].本文,fit.本文);
 await assert.rejects(store.save({...edit(note,fit.本文+'"')}),{status:400});assert.equal((await store.read({保存先:note.保存先,id:note.id})).revision,note.revision);
 assert.equal((await readdir(source.パス)).length,1);
});
test('複数storeの同一ファイル更新は共有queueで直列化し、後続の古いrevisionは拒否',async t=>{
 const {launch}=await fixture(t),a=createMemoStore({launchRoot:launch}),b=createMemoStore({launchRoot:launch}),source=(await a.list()).保存先[0],note=await a.create(memo(source.id));
 const results=await Promise.allSettled([a.save(edit(note,'A')),b.save(edit(note,'B'))]);assert.deepEqual(results.map(result=>result.status),['fulfilled','rejected']);assert.equal(results[1].reason.status,409);assert.equal((await b.read({保存先:source.id,id:note.id})).本文,'A');
});
test('動的起動root変更後は新保存先へ作成し、既知旧rootのread/saveは保持',async t=>{
 const {launch,project}=await fixture(t);let current=launch,calls=0;const store=createMemoStore({launchRoot:launch,getLaunchRoot:async()=>{calls++;return current;}}),old=(await store.list()).保存先[0],note=await store.create(memo(old.id));current=project;
 const next=(await store.list()).保存先[0];assert.notEqual(next.id,old.id);assert.equal(next.パス,path.join(project,'_AIDIY','aidiy_memo'));await assert.rejects(store.create(memo(old.id)),{status:409});
 const saved=await store.save(edit(note,'保持'));assert.deepEqual(await store.read({保存先:old.id,id:note.id}),saved);await store.create(memo(next.id));assert.ok(calls>=6);
});
test('ゴミ箱は原本を復元可能に退避し一覧から除外、古いrevisionは拒否',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch});
 const source=(await store.list()).保存先[0],note=await store.create(memo(source.id));
 const file=path.join(source.パス,note.id),original=await readFile(file);
 await assert.rejects(store.trash({保存先:source.id,id:note.id,revision:'0'.repeat(64)}),{status:409});
 assert.deepEqual(await readFile(file),original);
 await store.trash({保存先:source.id,id:note.id,revision:note.revision});
 assert.equal((await store.list()).メモ.length,0);
 const trash=path.join(source.パス,'.trash'),entries=await readdir(trash);
 assert.equal(entries.length,1);assert.deepEqual(await readFile(path.join(trash,entries[0],note.id)),original);
 await rename(path.join(trash,entries[0],note.id),file);
 assert.equal((await store.list()).メモ[0].本文,note.本文);
 await assert.rejects(store.trash({保存先:source.id,id:'../bad.txt',revision:note.revision}),{status:400});
});
test('テキストメモの本文とsidecarを退避しリンクのゴミ箱を拒否',async t=>{
 const {launch,project}=await fixture(t),store=createMemoStore({launchRoot:launch});
 const source=(await store.list()).保存先[0];await mkdir(source.パス,{recursive:true});
 await writeFile(path.join(source.パス,'old.txt'),'legacy\r\n');
 let note=(await store.list()).メモ[0];note=await store.save({...edit(note,note.本文),色:'pink'});
 await symlink(project,path.join(source.パス,'.trash'));
 await assert.rejects(store.trash({保存先:source.id,id:note.id,revision:note.revision}),{status:400});
 await rm(path.join(source.パス,'.trash'));
 await store.trash({保存先:source.id,id:note.id,revision:note.revision});
 const trash=path.join(source.パス,'.trash'),folder=path.join(trash,(await readdir(trash))[0]);
 assert.equal((await readdir(folder)).length,2);
 assert.equal(await readFile(path.join(folder,note.id),'utf8'),'legacy\r\n');
});
test('原色6色と既存パステル色は保存・再読込できる',async t=>{
 const {launch}=await fixture(t),options={launchRoot:launch,getProjectRoot:()=>launch},store=createMemoStore(options);
 const {保存先}=await store.list();
 const colors=['yellow','blue','green','pink','purple','vivid-red','vivid-blue','vivid-green','vivid-orange','vivid-purple','vivid-cyan'];
 for(const 色 of colors)await store.create({...memo(保存先[0].id),色});
 const result=await createMemoStore(options).list();assert.deepEqual(result.メモ.map(note=>note.色).sort(),colors.sort());
});

test('最小高さ84pxを保存復元し、それ未満は拒否',async t=>{
 const {launch}=await fixture(t),store=createMemoStore({launchRoot:launch}),source=(await store.list()).保存先[0];
 const note=await store.create({...memo(source.id),サイズ:{width:200,height:84}});
 assert.equal((await createMemoStore({launchRoot:launch}).list()).メモ[0].サイズ.height,84);
 await assert.rejects(store.save({...edit(note,'小さすぎる'),サイズ:{width:200,height:83}}),{status:400});
});
