// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,readFile,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createFileAnalysis} from '../ファイル機能/file-analysis.mjs';
import {startDevelopment} from '../server.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-analysis-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));return rm(root,{recursive:true,force:true});});await writeFile(join(root,'main.js'),'export const hello=1;');await writeFile(join(root,'other.js'),'other');return root;}
const options={state:()=>({active:true,startedAt:1}),runAgent:()=>new Promise(()=>{}),pollMs:100000};
const result=(job,instruction='概要')=>({requestId:job.id,path:job.path,instruction,content:'# 機能概要\n入口の処理です。'});

test('ファイル解析: 指示・結果の永続化、ファイル/プロジェクト分離、変更検出、失敗時の前回結果保持',async t=>{
 const root=await fixture(t),other=await fixture(t);let clock=Date.now();const service=createFileAnalysis(root,{...options,now:()=>clock});t.after(()=>service.close());
 await service.save('main.js','概要');const job=await service.start('main.js','概要');await assert.rejects(()=>service.start('main.js','重複'),/解析中/);
 await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));
 const completed=await service.get('main.js');assert.equal(completed.job.status,'complete');assert.match(completed.result.content,/入口/);
 assert.equal((await service.get('other.js')).result,null);
 const separate=createFileAnalysis(other,options);t.after(()=>separate.close());assert.equal((await separate.get('main.js')).result,null);
 const restarted=createFileAnalysis(root,options);t.after(()=>restarted.close());assert.equal((await restarted.get('main.js')).instruction,'概要');assert.equal((await restarted.get('main.js')).result.id,job.id);
 await writeFile(join(root,'main.js'),'export const changed=true;');assert.equal((await restarted.get('main.js')).stale,true);
 const second=await service.start('main.js','詳しく');clock+=300001;assert.equal((await service.get('main.js')).job.status,'timeout');assert.equal((await service.get('main.js')).result.id,job.id);
 await writeFile(join(root,second.resultPath),JSON.stringify(result(second,'詳しく')));assert.equal((await service.get('main.js')).result.id,second.id);
});

test('ファイル解析: 古い結果・壊れたJSONを採用せず、編集中の指示と結果を両方保持する',async t=>{
 const root=await fixture(t),service=createFileAnalysis(root,options);t.after(()=>service.close());const job=await service.start('main.js','概要');
 for(const data of ['{',JSON.stringify({...result(job),path:'other.js'}),JSON.stringify({...result(job),requestId:'old'})]){await writeFile(join(root,job.resultPath),data);assert.equal((await service.get('main.js')).job.status,'invalid');assert.equal((await service.get('main.js')).result,null);}
 await writeFile(join(root,job.resultPath),JSON.stringify(result(job)));
 await Promise.all([service.get('main.js'),service.save('main.js','次回は詳しく')]);const value=await service.get('main.js');assert.equal(value.instruction,'次回は詳しく');assert.equal(value.result.instruction,'概要');
});

test('ファイル解析: ダイアログから再取得しなくても完了結果を内部保存する',async t=>{
 const root=await fixture(t);const service=createFileAnalysis(root,{...options,pollMs:10,runAgent:async({prompt})=>{
   const spec=JSON.parse(prompt.split('形式: ')[1].split('\n')[0]);const target=prompt.match(/結果は (temp\/[^ ]+)\.tmp に/)[1];await writeFile(join(root,target+'.tmp'),JSON.stringify({...spec,content:'自動保存した結果'}));await rename(join(root,target+'.tmp'),join(root,target));
 }});t.after(()=>service.close());await service.start('main.js','概要');
 const folder=join(root,'_AIDIY','aidiy_ide','file_analyses');let stored;
 for(const deadline=Date.now()+10000;Date.now()<deadline;){const name=(await readdir(folder)).find(x=>x.endsWith('.json'));stored=JSON.parse(await readFile(join(folder,name),'utf8'));if(stored.result)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(stored.result.content,'自動保存した結果');
});

test('ファイル解析: 外部パス・リンク・外部保存先と利用終了を拒否する',async t=>{
 const root=await fixture(t),outside=await fixture(t);let active=true;const service=createFileAnalysis(root,{...options,state:()=>({active,startedAt:1})});t.after(()=>service.close());
 for(const path of ['../main.js','/absolute','C:/Windows/file','src\\main.js'])await assert.rejects(()=>service.start(path,'概要'));
 await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.get('linked/main.js'),/プロジェクト外/);
 await symlink(outside,join(root,'_AIDIY'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>service.save('main.js','概要'),/プロジェクト外/);
 active=false;await assert.rejects(()=>service.start('main.js','概要'),/利用/);
});

test('ファイル解析API: 利用状態と同一オリジン、GET/PUT/POST',async t=>{
 const root=await fixture(t),app=await startDevelopment(root,{fileAnalysisOptions:options});t.after(()=>app.close());const url=app.url+'api/file-analysis';
 assert.equal((await fetch(url+'?path=main.js')).status,503);await fetch(app.url+'api/connection/offline',{method:'POST'});
 assert.equal((await fetch(url,{method:'PUT',headers:{origin:'https://foreign.invalid'},body:'{}'})).status,403);
 const put=await fetch(url,{method:'PUT',body:JSON.stringify({path:'main.js',instruction:'処理を説明'})});assert.equal(put.status,200);
 assert.equal((await fetch(url+'?path=main.js').then(r=>r.json())).instruction,'処理を説明');
 const job=await fetch(url,{method:'POST',body:JSON.stringify({path:'main.js',instruction:'概要'})}).then(r=>r.json());assert.equal(job.status,'waiting');
});
