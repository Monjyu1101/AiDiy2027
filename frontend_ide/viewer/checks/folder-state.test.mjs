// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanTree,resolveScanFolder} from '../file-scan.mjs';
import {startServer} from '../server.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-state-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('状態: 最大mtimeと件数が同じでも別ファイルの変更・追加削除・改名を検出する',async t=>{
 const root=await fixture(t);await mkdir(join(root,'sub'));await writeFile(join(root,'latest.txt'),'latest');await utimes(join(root,'latest.txt'),2000000000,2000000000);await writeFile(join(root,'sub/a.txt'),'one');
 const a=await scanTree(root);await writeFile(join(root,'sub/a.txt'),'updated');const b=await scanTree(root);assert.equal(a.latest,b.latest);assert.equal(a.files,b.files);assert.notEqual(a.revision,b.revision);
 await rm(join(root,'sub/a.txt'));await writeFile(join(root,'sub/b.txt'),'updated');const c=await scanTree(root);assert.equal(b.files,c.files);assert.notEqual(b.revision,c.revision);
 const d=await scanTree(root,{folder:'sub'});assert.equal(d.files,1);assert.equal(d.tree.n,'sub');assert.equal(d.tree.f[0][0],'b.txt');assert.equal(d.revision,(await scanTree(root,{folder:'sub'})).revision);
 await mkdir(join(root,'sub/empty'));assert.notEqual(d.revision,(await scanTree(root,{folder:'sub'})).revision);
});
test('状態: 既存除外規則・親パス・絶対パス・リンク・走査上限を守る',async t=>{
 const root=await fixture(t),outside=await fixture(t);await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules/a.txt'),'no');await writeFile(join(root,'a.txt'),'yes');await writeFile(join(root,'package.json'),'{}');
 assert.equal((await scanTree(root,{filter:'backup'})).files,1);assert.equal((await scanTree(root)).files,2);
 for(const folder of ['../','/','..','node_modules','a.txt','C:/','a\\b'])assert.equal(await resolveScanFolder(root,folder,''),null,folder);
 await symlink(outside,join(root,'link'),'junction');assert.equal(await resolveScanFolder(root,'link',''),null);
 const capped=await scanTree(root,{limits:{maxFiles:1}});assert.equal(capped.truncated,true);assert.equal(capped.truncationReason,'files');
});
test('状態API: 既存の利用開始・Origin・GET境界、差分応答、フィルターとパスを確認する',async t=>{
 const root=await fixture(t);await writeFile(join(root,'a.txt'),'one');let active=false;
 const app=await startServer(root,0,{connection:{state:()=>({active,mode:'offline'}),close(){},disconnect(){active=false;return {active};}}});t.after(()=>app.close());
 const url=app.url+'api/folder-state';assert.equal((await fetch(url)).status,503);active=true;
 assert.equal((await fetch(url,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal((await fetch(url+'?filter=bad')).status,400);
 const first=await (await fetch(url)).json();assert.equal(first.files,1);assert.equal(first.fileList.length,first.files);assert.equal(first.latest,Math.max(...first.fileList.map(file=>file.mtime)));assert.deepEqual(Object.keys(first.fileList[0]).sort(),["mtime","name","path","size"]);assert.equal(first.scope,'recursive');assert.ok(first.tree);
 const same=await (await fetch(url+'?since='+first.revision)).json();assert.equal(same.tree,undefined);assert.equal(same.fileList,undefined);assert.equal(same.unchanged,true);
 assert.equal((await (await fetch(url+'?path=..')).json()).missing,true);
});


test('backupフィルター: 非表示ファイルの更新・追加・削除は親mtimeが変わっても指紋/件数/一覧/日時を変えない',async t=>{
 const root=await fixture(t);await writeFile(join(root,'visible.txt'),'visible');await writeFile(join(root,'package.json'),'{}');
 const before=await scanTree(root,{filter:'backup'}), all=await scanTree(root);
 const stable=async()=>{const next=await scanTree(root,{filter:'backup'});for(const key of ['files','latest','revision','fileList'])assert.deepEqual(next[key],before[key],key);};
 await writeFile(join(root,'package.json'),'updated hidden');await stable();assert.notEqual((await scanTree(root)).revision,all.revision);
 await writeFile(join(root,'hidden.log'),'log');await stable();await rm(join(root,'hidden.log'));await stable();
 await mkdir(join(root,'temp'));await writeFile(join(root,'temp/hidden.txt'),'hidden subtree');await stable();
 await rm(join(root,'visible.txt'));await writeFile(join(root,'replacement.txt'),'visible');const replaced=await scanTree(root,{filter:'backup'});assert.equal(replaced.files,before.files);assert.notEqual(replaced.revision,before.revision);assert.equal(replaced.fileList.length,replaced.files);
});
