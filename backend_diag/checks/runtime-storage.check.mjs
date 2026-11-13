// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createAppLauncher} from '../diag/起動/アプリ起動.mjs';
import {createCliLauncher} from '../diag/起動/CLI起動.mjs';
import {createStartManager} from '../diag/起動/サービス管理.mjs';

async function fixture(t,existing){
 const root=await mkdtemp(join(tmpdir(),'diag-runtime-日本語 空白-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const project=join(root,'別の project');await mkdir(project);
 const saved=join(root,'_AIDIY','aidiy_diag'),legacy=join(saved,'起動');
 if(existing){
  await mkdir(legacy,{recursive:true});await mkdir(join(saved,'アプリ起動'));
  await writeFile(join(saved,'install_info.json'),'saved diagnostic result');
  await writeFile(join(saved,'アプリ起動','previous.log'),'old launch log');
  await writeFile(join(legacy,'local.json'),'old run descriptor');
  await writeFile(join(legacy,'local.lock'),'old lock');
 }
 async function preserved(){
  if(!existing){await assert.rejects(stat(saved),{code:'ENOENT'});return;}
  assert.deepEqual((await readdir(saved)).sort(),['install_info.json','アプリ起動','起動'].sort());
  for(const [file,content] of [['install_info.json','saved diagnostic result'],['アプリ起動/previous.log','old launch log'],['起動/local.json','old run descriptor'],['起動/local.lock','old lock']])assert.equal(await readFile(join(saved,file),'utf8'),content);
  assert.deepEqual(await readdir(join(saved,'アプリ起動')),['previous.log']);
  assert.deepEqual((await readdir(legacy)).sort(),['local.json','local.lock']);
 }
 return {root,project,preserved};
}

for(const existing of [false,true]){
 const context=existing?'existing legacy files remain untouched':'no legacy directory is created';
 test(`app launch logs use repository temp; ${context}`,async t=>{
  const {root,project,preserved}=await fixture(t,existing),paths=[];
  const manager=createAppLauncher({root,tasks:async()=>[],taskTeamStatus:async()=>({利用可能:true}),portStatusFn:async()=>({対象:[{id:'tools',開放:true}]}),spawnFn(){
   const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
  }});
  for(const id of ['avatar','task','team','ide','console','code','live','discord','browser','console']){
   const result=await manager.launch(id,project);paths.push(result.ログ);
   assert.equal(dirname(result.ログ),join(root,'temp','aidiy_diag','アプリ起動'));
   assert.ok((await stat(result.ログ)).isFile());
  }
  assert.equal(new Set(paths).size,paths.length);await preserved();
 });

 test(`concurrent CLI logs use repository temp; ${context}`,async t=>{
  const {root,project,preserved}=await fixture(t,existing);
  const manager=createCliLauncher({root,resolveCli:async()=>({}),spawnFn(){
   const child=new EventEmitter();child.connected=true;child.disconnect=()=>{child.connected=false;};child.unref=()=>{};child.kill=()=>assert.fail('successful fixture must not be killed');
   queueMicrotask(()=>child.emit('message',{launchReady:true}));return child;
  }});
  const results=await Promise.all(['claude','codex','copilot','agy','grok','opencode','aidiy_hermes','copilot'].map(id=>manager.launch(id,project,true)));
  assert.equal(new Set(results.map(result=>result.ログ)).size,results.length);
  for(const result of results){assert.equal(dirname(result.ログ),join(root,'temp','aidiy_diag','アプリ起動'));assert.ok((await stat(result.ログ)).isFile());}
  await preserved();
 });

 test(`service run descriptors are replaced in repository temp and match Python environment; ${context}`,async t=>{
  const {root,preserved}=await fixture(t,existing),calls=[];
  await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts','起動対象.json'),await readFile(new URL('../../scripts/起動対象.json',import.meta.url)));
  const manager=createStartManager({root,python:'fixture-python',spawnFn(command,args,options){
   calls.push(options.env.AIDIY_DIAG_RUN);
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.stdin.on('data',()=>queueMicrotask(()=>child.emit('close',0)));
   queueMicrotask(()=>child.stdout.write('{"type":"ready"}\n'));return child;
  }});
  t.after(()=>manager.close());
  for(let index=0;index<2;index++){
   await manager.restart('local');await manager.settled();
   assert.deepEqual(JSON.parse(await readFile(join(root,'temp','aidiy_diag','起動','local.json'),'utf8')),{run:calls[index]});
   assert.deepEqual(await readdir(join(root,'temp','aidiy_diag','起動')),['local.json']);
  }
  assert.notEqual(calls[0],calls[1]);await manager.stop('local');await manager.close();await preserved();
 });
}
