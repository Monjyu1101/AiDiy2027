import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,rename,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {retireRust,inspectRust,executeRust} from '../diag/導入管理/rust.mjs';
async function fixture(fn){const home=await mkdtemp(path.join(os.tmpdir(),'rust-removal-'));try{
 await mkdir(path.join(home,'.cargo','bin'),{recursive:true});await mkdir(path.join(home,'.rustup','toolchains','stable'),{recursive:true});await writeFile(path.join(home,'.rustup','toolchains','stable','rustc.exe'),'compiler');
 await writeFile(path.join(home,'.cargo','credentials.toml'),'private-fixture');await writeFile(path.join(home,'.cargo','bin','extra.exe'),'tool');
 await writeFile(path.join(home,'.rustup','settings.toml'),'fixture');await fn({home,bin:path.join(home,'.cargo','bin')});
}finally{await rm(home,{recursive:true,force:true});}}
test('removal retains all credentials, settings and third-party cargo tools',()=>fixture(async context=>{
 let calls=0;const backup=await retireRust(context,{removePath:async()=>{calls++;},onData:()=>{}});
 assert.equal(calls,1);await assert.rejects(access(path.join(backup,'.rustup','toolchains')));await assert.rejects(access(path.join(context.home,'.cargo')));
 assert.equal(await readFile(path.join(backup,'.cargo','credentials.toml'),'utf8'),'private-fixture');
 assert.equal(await readFile(path.join(backup,'.cargo','bin','extra.exe'),'utf8'),'tool');
 assert.equal(await readFile(path.join(backup,'.rustup','settings.toml'),'utf8'),'fixture');
}));
test('PATH failure rolls directories back without deleting data',()=>fixture(async context=>{
 await assert.rejects(retireRust(context,{removePath:async()=>{throw Error('PATH failed');}}),/PATH failed/);
 assert.equal(await readFile(path.join(context.home,'.cargo','credentials.toml'),'utf8'),'private-fixture');
 assert.deepEqual((await readdir(context.home)).sort(),['.cargo','.rustup']);
}));
test('locked second directory rolls first back and never changes PATH',()=>fixture(async context=>{
 let called=false;await assert.rejects(retireRust(context,{removePath:async()=>{called=true;},move:async(a,b)=>{
 if(a===path.join(context.home,'.rustup'))throw Error('locked');await rename(a,b);
 }}),/locked/);assert.equal(called,false);await access(path.join(context.home,'.cargo','credentials.toml'));
}));
test('cancel before removal preserves folders',()=>fixture(async context=>{
 const c=new AbortController();c.abort();await assert.rejects(retireRust(context,{signal:c.signal,removePath:async()=>{throw Error('must not run');}}),/中止/);
 await access(path.join(context.home,'.cargo'));
}));
test('linked cargo directory is rejected without touching target',()=>fixture(async context=>{
 await rename(path.join(context.home,'.cargo'),path.join(context.home,'saved'));
 await symlink(path.join(context.home,'saved'),path.join(context.home,'.cargo'),'junction');
 await assert.rejects(retireRust(context,{removePath:async()=>{throw Error('must not run');}}));
 await access(path.join(context.home,'saved','credentials.toml'));
}));

test('toolchain links never delete external targets',()=>fixture(async context=>{
 const outside=path.join(context.home,'external');await mkdir(outside);await writeFile(path.join(outside,'keep'),'user-data');
 await symlink(outside,path.join(context.home,'.rustup','toolchains','custom'),'junction');
 await retireRust(context,{removePath:async()=>{}});assert.equal(await readFile(path.join(outside,'keep'),'utf8'),'user-data');
}));
test('cancel after PATH change retains backup and reports incomplete deletion',()=>fixture(async context=>{
 const c=new AbortController();await assert.rejects(retireRust(context,{signal:c.signal,removePath:async()=>{c.abort();}}),/ツールチェーン削除に失敗/);
 const names=await readdir(context.home);const backup=names.find(n=>n.startsWith('.aidiy-rust-backup-'));
 await access(path.join(context.home,backup,'.rustup','toolchains','stable','rustc.exe'));
 await access(path.join(context.home,backup,'.cargo','credentials.toml'));
}));

test('provider enables removal, executes fixed PATH update, and reports uninstalled',()=>fixture(async context=>{
 const local=path.join(context.home,'AppData','Local'),system=path.join(context.home,'Windows');
 await mkdir(local,{recursive:true});await mkdir(path.join(system,'System32','WindowsPowerShell','v1.0'),{recursive:true});
 for(const command of ['curl.exe','tar.exe','WindowsPowerShell/v1.0/powershell.exe'])await writeFile(path.join(system,'System32',command),'fixture');
 for(const command of ['rustup.exe','cargo.exe'])await writeFile(path.join(context.bin,command),'fixture');
 const env={USERPROFILE:context.home,LOCALAPPDATA:local,SYSTEMROOT:system,PATH:''};
 const options={env,rawEnv:{},platform:'win32',resolve:async()=>null};const entry={id:'rust'};
 const state=await inspectRust(entry,options);assert.ok(state.item.操作.includes('削除'));
 let calls=0;
 await executeRust(entry,'削除',state.context,{...options,run:async command=>{
  calls++;assert.equal(path.basename(command.executable),'powershell.exe');assert.equal(command.env.AIDIY_PATH_MODE,'remove');
  assert.equal(command.env.AIDIY_PATH_DIR,context.bin);command.onData('{"changed":true,"had":true}');return {code:0};
 }});
 assert.equal(calls,1);assert.deepEqual((await inspectRust(entry,options)).item.操作,['導入']);
}));
test('rollback collision preserves new folder and reports saved original',()=>fixture(async context=>{
 let log='';await assert.rejects(retireRust(context,{onData:text=>log+=text,removePath:async()=>{
  await mkdir(path.join(context.home,'.cargo'));await writeFile(path.join(context.home,'.cargo','new'),'keep');throw Error('PATH failure');
 }}),/退避先を保持/);
 assert.equal(await readFile(path.join(context.home,'.cargo','new'),'utf8'),'keep');
 const backup=(await readdir(context.home)).find(n=>n.startsWith('.aidiy-rust-backup-'));
 assert.equal(await readFile(path.join(context.home,backup,'.cargo','credentials.toml'),'utf8'),'private-fixture');
 assert.match(log,/復元が必要/);
}));
