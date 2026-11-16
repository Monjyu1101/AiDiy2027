// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {processLockIsStale,acquireProcessInstallLock} from '../diag/導入管理/process_lock.mjs';
const owner={pid:101,parentPid:1,created:1000,name:'node.exe'};
const current={pid:202,parentPid:1,created:2000,name:'node.exe'};
const options={scope:'rust',pid:202,inspectProcesses:async()=>[current]};
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'aidiy-process-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}));return path.join(dir,'install.lock');}

test('所有者終了・PID再利用は回収対象、生存/不明は拒否',()=>{
  assert.equal(processLockIsStale(owner,[current],options),true);
  assert.equal(processLockIsStale(owner,[owner,current],options),false);
  assert.equal(processLockIsStale(owner,[{...owner,created:1500},current],options),true);
  assert.equal(processLockIsStale({pid:101},[owner,current],options),false);
  assert.equal(processLockIsStale(owner,[{...owner,created:null},current],options),false);
  for(const rows of [null,[]])assert.equal(processLockIsStale(owner,rows,options),false);
});
test('親終了後の子・rustup 子孫・取得/展開/PATH処理は残存扱い',()=>{
  const cases=[
    {pid:303,parentPid:101,created:1100,name:'child.exe'},
    {pid:303,parentPid:999,created:1100,name:'rustup-init.exe'},
    {pid:303,parentPid:999,created:1100,name:'rustup.exe'},
    {pid:303,name:'curl.exe',commandLine:'curl --output C:\\Temp\\aidiy-rustup-abc\\rustup-init.exe'},
    {pid:303,name:'tar.exe',commandLine:'tar -xf llvm-mingw.aidiy-staging-test/a.zip'},
    {pid:303,name:'powershell.exe',commandLine:'$dir=$env:AIDIY_PATH_DIR;'},
    {pid:303,name:'powershell.exe',commandLine:null},
  ];
  for(const p of cases)assert.equal(processLockIsStale(owner,[current,p],options),false,JSON.stringify(p));
  assert.equal(processLockIsStale(owner,[current,{pid:303,name:'curl.exe',commandLine:'curl https://example.test'}],options),true);
});
test('新規排他・解放・同時取得拒否',async t=>{
  const file=await fixture(t),release=await acquireProcessInstallLock(file,options);
  await assert.rejects(acquireProcessInstallLock(file,options),{status:409});
  await release();await release();await assert.rejects(access(file),{code:'ENOENT'});
});
test('異常終了ロックと旧PIDロックをプロセス確認後回収',async t=>{
  const file=await fixture(t);
  for(const record of [owner,101]){
    await writeFile(file,JSON.stringify(record));
    const release=await acquireProcessInstallLock(file,options);
    assert.equal(JSON.parse(await readFile(file,'utf8')).pid,202);await release();
  }
});
test('不正ロック・照会失敗・Rust残存は保持',async t=>{
  const file=await fixture(t);
  for(const [text,opts] of [
    ['not-json',options],
    [JSON.stringify(owner),{...options,inspectProcesses:async()=>{throw Error('denied');}}],
    [JSON.stringify(owner),{...options,inspectProcesses:async()=>[current,{pid:303,name:'rustup.exe'}]}],
  ]){
    await writeFile(file,text);await assert.rejects(acquireProcessInstallLock(file,opts),{status:409});assert.equal(await readFile(file,'utf8'),text);
  }
});
test('回収が競合しても取得成功は一つ',async t=>{
  const file=await fixture(t);await writeFile(file,JSON.stringify(owner));
  const results=await Promise.allSettled(Array.from({length:8},()=>acquireProcessInstallLock(file,options)));
  const succeeded=results.filter(r=>r.status==='fulfilled');assert.equal(succeeded.length,1);await succeeded[0].value();
});
test('LLVMもプロセス確認で復旧、別scopeは受け付けない',async t=>{
  const file=await fixture(t);await writeFile(file,JSON.stringify(owner));
  const release=await acquireProcessInstallLock(file,{...options,scope:'llvm-mingw'});await release();
  await assert.rejects(acquireProcessInstallLock(file,{...options,scope:'npm'}),{status:409});
});
