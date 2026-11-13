// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,lstat,symlink,link,rm} from 'node:fs/promises';
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
 for(const fields of [{位置:{x:-1,y:0}},{位置:{x:0,y:Infinity}},{位置:{x:0,y:0,extra:1}},{サイズ:{width:199,height:200}},{サイズ:{width:300,height:1601}}])await assert.rejects(store.save({...edit(note,'本文'),...fields}),{status:400});
});
test('既存textは本文を触らずsidecarへ配置・色保存、sidecar競合・リンクも保護',async t=>{
 const {launch,project}=await fixture(t),directory=path.join(launch,'_AIDIY','aidiy_memo');await mkdir(directory,{recursive:true});const file=path.join(directory,'既存.txt');await writeFile(file,'\uFEFF本文\r\n');const before=await lstat(file);
 const store=createMemoStore({launchRoot:launch});let note=(await store.list()).メモ[0],old=note;
 note=await store.save({...edit(note,note.本文),色:'blue',位置:{x:90,y:50},サイズ:{width:400,height:300}});assert.equal((await lstat(file)).mtimeMs,before.mtimeMs);assert.equal(await readFile(file,'utf8'),'\uFEFF本文\r\n');
 let restored=(await store.list()).メモ[0];assert.equal(restored.色,'blue');assert.deepEqual(restored.位置,{x:90,y:50});assert.notEqual(note.revision,old.revision);await assert.rejects(store.save(edit(old,'stale')),{status:409});
 const sidecar=path.join(directory,(await readdir(directory)).find(name=>name.startsWith('.memo-')));await writeFile(sidecar,'{"version":1,"色":"pink"}');await assert.rejects(store.save(edit(note,'stale')),{status:409});assert.equal(await readFile(file,'utf8'),'\uFEFF本文\r\n');
 await rm(sidecar);const outside=path.join(project,'保護.json');await writeFile(outside,'private');await symlink(outside,sidecar);assert.equal((await store.list()).メモ.length,0);assert.equal(await readFile(outside,'utf8'),'private');
});
