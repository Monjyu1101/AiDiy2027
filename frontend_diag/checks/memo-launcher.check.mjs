// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {memoArgs} from '../memo_main.mjs';
import {parseArgs,createServer} from '../diag_main.mjs';
import {openDesktop} from '../diag/起動/desktop.mjs';
test('aidiy_memo引数は固定modeだけでproject/cwd/auto/headlessを受け取らない',()=>{
 assert.deepEqual(memoArgs(['--new','--foreground']),['--memo-only','--new','--foreground']);
 assert.equal(parseArgs(memoArgs([])).memoOnly,true);
 for(const args of [['--project','/other'],['/other'],['--headless'],['--auto'],['--browser'],['--port','0'],['--base-path','/x/']]){assert.throws(()=>memoArgs(args));assert.throws(()=>parseArgs(['--memo-only',...args]));}
 assert.throws(()=>parseArgs(['--new']));
});
test('単体modeは非秘密flags、URLはIPCのみ、昇格要求は検証してACKする',async()=>{
 let spawned,promoted;const messages=[];
 const child=Object.assign(new EventEmitter(),{stderr:new EventEmitter(),connected:true,send:(value,done)=>{messages.push(value);done?.();},kill:()=>{}});
 const url='http://127.0.0.1:44444/#token='+'x'.repeat(43);
 openDesktop('electron',url,()=>{},(_bin,args,options)=>{spawned={args,options};return child;},15000,()=>{},()=>{},{memoOnly:true,newMemo:true,onPromote:async cwd=>{promoted=cwd;return true;}});
 child.emit('message',{type:'diag-ready'});assert.equal(spawned.args.includes('--aidiy-memo-only'),true);assert.equal(spawned.args.includes('--aidiy-memo-new'),true);assert.ok(!JSON.stringify(spawned).includes('token='));
 assert.deepEqual(messages[0],{type:'diag-start',url,memoOnly:true,newMemo:true});
 child.emit('message',{type:'diag-shown'});
 child.emit('message',{type:'diag-promote',requestId:'bad',cwd:'/unexpected'});await new Promise(r=>setImmediate(r));assert.equal(promoted,undefined);
 const requestId='a'.repeat(8)+'-aaaa-4aaa-8aaa-'+'a'.repeat(12);
 child.emit('message',{type:'diag-promote',requestId,cwd:'/normal-cwd'});await new Promise(r=>setImmediate(r));assert.equal(promoted,'/normal-cwd');assert.deepEqual(messages.at(-1),{type:'diag-promoted',requestId,ok:true});child.emit('exit',0,null);
});
test('単体サーバーはsystemroot限定でプロジェクトを読まず、昇格後だけ通常APIを開く',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'memo-mode-'));t.after(()=>rm(root,{recursive:true,force:true}));const system=path.join(root,'system'),cwd=path.join(root,'external-cwd'),project=path.join(root,'project');for(const p of [system,cwd,project])await mkdir(p);
 let enabled=false,calls=0;const token='test';const server=createServer({token,systemRoot:system,isNormalEnabled:()=>enabled,getLaunchRoot:()=>cwd,appLauncher:{catalog:async()=>{calls++;return {起動フォルダ:project};}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();server.closeAllConnections();});const base='http://127.0.0.1:'+server.address().port+'/';
 const request=route=>fetch(base+route,{headers:{Authorization:'Bearer '+token}});
 const first=await request('api/メモ/単体');assert.equal(first.status,200);const data=await first.json();assert.equal(data.保存先.length,1);assert.equal(data.保存先[0].パス,path.join(system,'_AIDIY','aidiy_memo'));assert.equal(calls,0);
 for(const route of ['api/メモ','api/アプリ起動','api/起動','api/status'])assert.equal((await request(route)).status,403);
 assert.equal(calls,0);enabled=true;const normal=await(await request('api/メモ')).json();assert.equal(calls,1);assert.deepEqual(normal.保存先.map(s=>s.パス),[cwd,project].map(p=>path.join(p,'_AIDIY','aidiy_memo')));
 await request('api/メモ/単体');assert.equal(calls,1);
});
