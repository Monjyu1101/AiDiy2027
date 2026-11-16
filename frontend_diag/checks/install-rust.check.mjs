// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Rust（rustup）・llvm-mingw の導入プロバイダー。ネットワーク・レジストリ・実インストールは行わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RUSTUP_INIT,RUST_HOST,LLVM_MINGW,LLVM_MINGW_RECEIPT,USER_PATH_SCRIPT,inspectRust,executeRust,inspectLlvmMingw,executeLlvmMingw} from '../diag/導入管理/rust.mjs';
import {createInstallManager} from '../diag/導入管理/導入管理.mjs';

const windows=process.platform==='win32'&&process.arch==='x64';
const rust={id:'rust',name:'Rust',commands:['cargo']},llvm={id:'llvm-mingw',name:'llvm-mingw',commands:['x86_64-w64-mingw32-clang']};
const none=async()=>null;

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'aidiy-rust-check-'));
  const home=path.join(root,'home'),local=path.join(home,'AppData','Local'),system=path.join(root,'Windows');
  await mkdir(local,{recursive:true});await mkdir(path.join(system,'System32','WindowsPowerShell','v1.0'),{recursive:true});
  for(const name of ['curl.exe','tar.exe'])await writeFile(path.join(system,'System32',name),'MZ');
  await writeFile(path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'),'MZ');
  return {root,home,local,env:{USERPROFILE:home,LOCALAPPDATA:local,SYSTEMROOT:system,PATH:''}};
}

test('pinned sources are official HTTPS URLs with SHA-256 and a non-MSVC host',()=>{
  assert.match(RUSTUP_INIT.url,/^https:\/\/static\.rust-lang\.org\/rustup\/archive\/[\d.]+\/x86_64-pc-windows-msvc\/rustup-init\.exe$/);
  assert.match(LLVM_MINGW.url,/^https:\/\/github\.com\/mstorsjo\/llvm-mingw\/releases\/download\/\d+\/llvm-mingw-\d+-ucrt-x86_64\.zip$/);
  for(const hash of [RUSTUP_INIT.sha256,LLVM_MINGW.sha256])assert.match(hash,/^[0-9a-f]{64}$/);
  assert.equal(RUST_HOST,'x86_64-pc-windows-gnullvm');
  // PATH は値の型を保持し、文字列連結でコマンドを組み立てない。
  assert.match(USER_PATH_SCRIPT,/DoNotExpandEnvironmentNames/);assert.match(USER_PATH_SCRIPT,/\$env:AIDIY_PATH_DIR/);
});

test('non-Windows and custom CARGO_HOME are not operated',async()=>{
  const linux=await inspectRust(rust,{env:{},platform:'linux',resolve:none,rawEnv:{}});
  assert.deepEqual(linux.item.操作,[]);assert.match(linux.item.理由,/Windows/);
  const custom=await inspectRust(rust,{env:{},platform:'win32',resolve:none,rawEnv:{CARGO_HOME:'D:\\cargo'}});
  assert.deepEqual(custom.item.操作,[]);assert.match(custom.item.理由,/CARGO_HOME/);
  const llvmLinux=await inspectLlvmMingw(llvm,{env:{},platform:'linux',resolve:none});
  assert.deepEqual(llvmLinux.item.操作,[]);
});

test('rust offers install, update and recoverable removal for rustup-managed cargo',{skip:!windows},async()=>{
  const {root,home,env}=await fixture();
  try{
    let state=await inspectRust(rust,{env,platform:'win32',resolve:none,rawEnv:{}});
    assert.deepEqual(state.item.操作,['導入']);assert.match(state.item.確認説明,/gnullvm/);
    const bin=path.join(home,'.cargo','bin');await mkdir(bin,{recursive:true});
    await writeFile(path.join(bin,'cargo.exe'),'MZ');
    state=await inspectRust(rust,{env,platform:'win32',resolve:none,rawEnv:{}});
    assert.deepEqual(state.item.操作,[]);assert.match(state.item.理由,/rustup の管理外/);
    await writeFile(path.join(bin,'rustup.exe'),'MZ');
    state=await inspectRust(rust,{env,platform:'win32',resolve:async()=>path.join(bin,'cargo.exe'),rawEnv:{}});
    assert.deepEqual(state.item.操作,['再導入','削除']);
    const other=await inspectRust(rust,{env,platform:'win32',resolve:async()=>'C:\\other\\cargo.exe',rawEnv:{}});
    assert.deepEqual(other.item.操作,[]);assert.match(other.item.理由,/別の導入先/);
    // 更新は rustup update だけを実行する。
    const calls=[];
    await executeRust(rust,'再導入',state.context,{env,platform:'win32',resolve:none,rawEnv:{},run:async command=>{calls.push(command);return {code:0};}});
    assert.equal(calls.length,1);assert.equal(path.basename(calls[0].executable),'rustup.exe');assert.deepEqual(calls[0].args,['update']);
    assert.equal(calls[0].env.PATH.toLowerCase().includes('.cargo'),false);
    assert.match(state.item.確認説明,/容量を解放/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('rust install stops on installer hash mismatch before running it',{skip:!windows},async()=>{
  const {root,env}=await fixture();
  try{
    const state=await inspectRust(rust,{env,platform:'win32',resolve:none,rawEnv:{}});
    const calls=[];
    const run=async command=>{calls.push(command);const output=command.args[command.args.indexOf('--output')+1];await writeFile(output,'MZ tampered');return {code:0};};
    await assert.rejects(executeRust(rust,'導入',state.context,{env,platform:'win32',resolve:none,rawEnv:{},run}),/SHA-256/);
    assert.equal(calls.length,1);assert.equal(path.basename(calls[0].executable),'curl.exe');
    assert.ok(calls[0].args.includes(RUSTUP_INIT.url));assert.ok(calls[0].args.includes('=https'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('llvm-mingw ownership requires the AiDiy receipt; leftovers block operation',{skip:!windows},async()=>{
  const {root,local,env}=await fixture();
  try{
    let state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    assert.deepEqual(state.item.操作,['導入']);
    const other=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:async()=>'C:\\msys64\\clang64\\bin\\x86_64-w64-mingw32-clang.exe'});
    assert.deepEqual(other.item.操作,[]);assert.match(other.item.理由,/別の導入先/);
    const target=path.join(local,'Programs','llvm-mingw');await mkdir(path.join(target,'bin'),{recursive:true});
    state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    assert.deepEqual(state.item.操作,[]);assert.match(state.item.理由,/AiDiy 以外/);
    await writeFile(path.join(target,LLVM_MINGW_RECEIPT),JSON.stringify({name:LLVM_MINGW.name,directory:target,pathAdded:true}));
    state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    assert.deepEqual(state.item.操作,['再導入','削除']);
    await mkdir(path.join(local,'Programs','llvm-mingw.aidiy-backup-x'));
    state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    assert.deepEqual(state.item.操作,[]);assert.match(state.item.理由,/退避/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('llvm-mingw reinstall restores the previous folder when the archive hash differs',{skip:!windows},async()=>{
  const {root,local,env}=await fixture();
  try{
    const target=path.join(local,'Programs','llvm-mingw');await mkdir(path.join(target,'bin'),{recursive:true});
    await writeFile(path.join(target,'bin','marker.txt'),'old');
    await writeFile(path.join(target,LLVM_MINGW_RECEIPT),JSON.stringify({name:LLVM_MINGW.name,directory:target,pathAdded:false}));
    const state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    const run=async command=>{const output=command.args[command.args.indexOf('--output')+1];await writeFile(output,'not the release');return {code:0};};
    await assert.rejects(executeLlvmMingw(llvm,'再導入',state.context,{env,platform:'win32',resolve:none,run}),/SHA-256/);
    // 元のフォルダはそのまま、展開用フォルダは残さない。
    assert.deepEqual((await readdir(path.join(local,'Programs'))).sort(),['llvm-mingw']);
    assert.deepEqual((await readdir(path.join(target,'bin'))),['marker.txt']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('llvm-mingw delete removes only the AiDiy folder and the PATH entry it added',{skip:!windows},async()=>{
  const {root,local,env}=await fixture();
  try{
    const target=path.join(local,'Programs','llvm-mingw');await mkdir(path.join(target,'bin'),{recursive:true});
    await writeFile(path.join(target,LLVM_MINGW_RECEIPT),JSON.stringify({name:LLVM_MINGW.name,directory:target,pathAdded:true}));
    const state=await inspectLlvmMingw(llvm,{env,platform:'win32',resolve:none});
    const calls=[];
    const run=async command=>{calls.push(command);command.onData('{"changed":true,"had":true}');return {code:0};};
    await executeLlvmMingw(llvm,'削除',state.context,{env,platform:'win32',resolve:none,run});
    assert.equal(calls.length,1);assert.equal(calls[0].env.AIDIY_PATH_MODE,'remove');assert.equal(calls[0].env.AIDIY_PATH_DIR,path.join(target,'bin'));
    assert.deepEqual(await readdir(path.join(local,'Programs')),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('install manager routes rust and llvm-mingw to their providers',async()=>{
  const entries=[rust,llvm];
  const manager=createInstallManager({entries,platform:'win32',probeFn:async entry=>({id:entry.id,状態:'OK',パス:'C:\\fixture'}),
    inspectRustFn:async()=>({item:{id:'rust',操作:['導入']},context:{lockKey:'C:\\fixture\\.cargo\\bin'}}),
    inspectLlvmMingwFn:async()=>({item:{id:'llvm-mingw',操作:['導入']},context:{lockKey:'C:\\fixture\\llvm-mingw'}}),
    executeRustFn:async()=>({code:0}),executeLlvmMingwFn:async()=>({code:0}),acquireLock:async()=>async()=>{}});
  try{
    const snapshot=await manager.snapshot();
    assert.deepEqual(snapshot.項目.map(item=>[item.id,item.操作]),[['rust',['導入']],['llvm-mingw',['導入']]]);
  }finally{await manager.close();}
});
