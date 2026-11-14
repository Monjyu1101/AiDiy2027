// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Windows で MSVC / Visual Studio を使わずに Rust（command_codex 等）をビルドする開発ツールだけを扱う。
// - rust: 公式 rustup-init（固定版・SHA-256 照合）で x86_64-pc-windows-gnullvm 向け stable を ~/.cargo・~/.rustup に導入。
// - llvm-mingw: 公式リリース zip（固定版・SHA-256 照合）を %LOCALAPPDATA%\Programs\llvm-mingw に展開し、bin をユーザー PATH へ登録。
// 公式: https://rust-lang.github.io/rustup/ / https://github.com/mstorsjo/llvm-mingw
import {mkdir,readdir,readFile,writeFile,rename,rm,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {resolveProgram} from '../診断/probes.mjs';
import {exists,plainPath,digest} from './antigravity.mjs';

// 2026-11-14 に winget マニフェスト・static.rust-lang.org の .sha256 と照合した固定版。
export const RUSTUP_INIT=Object.freeze({version:'1.29.3',url:'https://static.rust-lang.org/rustup/archive/1.29.3/x86_64-pc-windows-msvc/rustup-init.exe',sha256:'38027d51d69a5d05493627a0634dbea52d6cd793c8f072d2373d3f4163eec7db'});
// MSVC のリンカーを使わない LLVM 系の Windows ターゲット。リンク・C コンパイルは llvm-mingw を使う。
export const RUST_HOST='x86_64-pc-windows-gnullvm';
// 2026-11-14 に GitHub Releases の digest と照合した固定版（UCRT・x86_64）。
export const LLVM_MINGW=Object.freeze({version:'20261020',name:'llvm-mingw-20261020-ucrt-x86_64',url:'https://github.com/mstorsjo/llvm-mingw/releases/download/20261020/llvm-mingw-20261020-ucrt-x86_64.zip',sha256:'fd5462b7f5d93b2ff981fcd3f9c7e427e47f3203c64ea91c27bcc444eebd74cd',size:190612575});
export const LLVM_MINGW_RECEIPT='.aidiy-llvm-mingw.json';
const ACTIONS=['導入','再導入','削除'];
// rustup のツールチェーン（約300MB）・llvm-mingw（約190MB）の取得と展開は期限を延ばす。
const INSTALL_TIMEOUT=30*60*1000;
const failure=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const envValue=(env,key)=>Object.entries(env).find(([name])=>name.toUpperCase()===key)?.[1];
const stopped=signal=>{if(signal?.aborted)throw failure('操作を中止しました。');};
const unsafe=value=>typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/["!%&|<>^;\r\n\0]/.test(value);
const success=result=>result?.code===0&&!result.error&&!result.cancelled&&!result.timedOut&&!result.overflow;

// 子プロセスには OS 標準ディレクトリと必要な利用者フォルダ・プロキシだけを渡す。
function environment(env,context,temporary) {
  const output={};
  for(const key of ['APPDATA','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY'])
    {const value=envValue(env,key);if(value!==undefined)output[key]=value;}
  const powershellHome=path.join(context.systemRoot,'System32','WindowsPowerShell','v1.0');
  return {...output,USERPROFILE:context.home,HOME:context.home,LOCALAPPDATA:context.local,SystemRoot:context.systemRoot,WINDIR:context.systemRoot,
    PATH:[path.join(context.systemRoot,'System32'),powershellHome].join(';'),PATHEXT:'.COM;.EXE;.BAT;.CMD',PSModulePath:path.join(powershellHome,'Modules'),
    COMSPEC:path.join(context.systemRoot,'System32','cmd.exe'),TEMP:temporary,TMP:temporary,PROCESSOR_ARCHITECTURE:'AMD64',NO_COLOR:'1',CI:'1',DO_NOT_TRACK:'1'};
}

// ユーザー PATH（HKCU\Environment）の1項目だけを追加・解除する固定スクリプト。
// 既存の %VAR% を展開せずに値の型（REG_EXPAND_SZ 等）を保ち、変更時だけ環境変数の変更を通知する。
export const USER_PATH_SCRIPT=String.raw`$ErrorActionPreference='Stop';
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);
function N($p){try{return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($p.Trim().Trim('"'))).TrimEnd('\')}catch{return $null}}
$dir=$env:AIDIY_PATH_DIR;$mode=$env:AIDIY_PATH_MODE;$target=N $dir;if(-not $target){throw 'Invalid directory'}
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');
try{
$kind=[Microsoft.Win32.RegistryValueKind]::ExpandString;$value='';
if($key.GetValueNames() -contains 'Path'){$kind=$key.GetValueKind('Path');if($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString){throw 'Path type'};$value=[string]$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
$entries=@($value -split ';');$has=@($entries|Where-Object{$_.Trim() -and ((N $_) -ieq $target)}).Count -gt 0;$changed=$false;
if($mode -eq 'add' -and -not $has){$sep='';if($value -and -not $value.EndsWith(';')){$sep=';'};$value=$value+$sep+$dir;$changed=$true}
elseif($mode -eq 'remove' -and $has){$value=@($entries|Where-Object{-not ($_.Trim() -and ((N $_) -ieq $target))}) -join ';';$changed=$true}
if($changed){$key.SetValue('Path',$value,$kind);[Environment]::SetEnvironmentVariable('AIDIY_PATH_NOTIFY','1','User');[Environment]::SetEnvironmentVariable('AIDIY_PATH_NOTIFY',$null,'User')}
@{changed=$changed;had=$has}|ConvertTo-Json -Compress
}finally{$key.Dispose()}`;

// 共通の前提確認（Windows x64・標準のユーザーフォルダ・OS 標準コマンド）。
async function baseContext(env,platform) {
  if(platform!=='win32')throw failure('Rust / llvm-mingw の自動導入は Windows のみ対応しています。');
  if(process.arch!=='x64')throw failure('この CPU（x64 以外）の自動導入には対応していません。');
  const home=envValue(env,'USERPROFILE'),local=envValue(env,'LOCALAPPDATA'),systemRoot=envValue(env,'SYSTEMROOT');
  if(unsafe(home)||unsafe(local)||unsafe(systemRoot))throw failure('標準のユーザー導入先・Windows ディレクトリを安全に確認できません。');
  const context={home,local,systemRoot,curl:path.join(systemRoot,'System32','curl.exe'),tar:path.join(systemRoot,'System32','tar.exe'),
    powershell:path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')};
  for(const command of [context.curl,context.tar,context.powershell])if(!await plainPath(command,{fileOnly:true,allowHardlinks:true}))throw failure('必要な Windows 標準コマンド（curl / tar / PowerShell）を確認できません。');
  if(!(await plainPath(home))?.isDirectory())throw failure('ユーザーフォルダの実体を確認できません。');
  return context;
}

async function checkedRun(command,options) {
  stopped(options.signal);
  const result=await options.run({...command,signal:options.signal,timeout:command.timeout??options.timeout,onData:command.onData||options.onData,onUncertain:options.onUncertain,platform:'win32'});
  if(result?.cancelled||options.signal?.aborted)throw failure('操作を中止しました。');
  if(result?.timedOut)throw failure('実行時間の上限に達したため停止しました。');
  if(result?.overflow)throw failure('出力の上限に達したため停止しました。');
  if(!success(result))throw failure(`${command.label||'コマンド'}が失敗しました（終了コード ${result?.code??'起動不可'}）。`);
  return result;
}

// 固定 URL から取得し、固定の SHA-256 と一致したファイルだけを使う。
async function download(context,{url,sha256,file,label},env,directory,options) {
  options.onData(`${label}を取得します: ${url}\n`);
  await checkedRun({label:`${label}の取得`,executable:context.curl,args:['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-redirs','5','--connect-timeout','15','--retry','2','--output',file,url],
    cwd:directory,env:environment(env,context,directory),timeout:INSTALL_TIMEOUT},options);
  if(await digest(file,'sha256',{signal:options.signal})!==sha256)throw failure(`${label}の SHA-256 が固定値と一致しません。安全確認の更新が必要なため使用しません。`);
  options.onData(`${label}の SHA-256 を確認しました。\n`);
}

async function userPath(context,mode,directory,env,options) {
  let output='';
  await checkedRun({label:'ユーザー PATH の更新',executable:context.powershell,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',USER_PATH_SCRIPT],cwd:context.local,
    env:{...environment(env,context,context.local),AIDIY_PATH_DIR:directory,AIDIY_PATH_MODE:mode},timeout:30000,onData:text=>output+=text},options);
  let data;try{data=JSON.parse(output.replace(/^﻿/,'').trim());}catch{throw failure('ユーザー PATH の更新結果を確認できません。');}
  if(typeof data?.changed!=='boolean'||typeof data?.had!=='boolean')throw failure('ユーザー PATH の更新結果が不正です。');
  return data;
}

// ---------------------------------------------------------------- Rust（rustup）
export async function inspectRust(entry,{env=process.env,platform=process.platform,resolve=resolveProgram,rawEnv=process.env}={}) {
  const item={id:entry.id,パッケージ:`Rust（rustup ${RUSTUP_INIT.version} / ${RUST_HOST}）`,
    説明:`公式 rustup で MSVC 不要の ${RUST_HOST} 向け stable（minimal）を導入します。Visual Studio / MSVC は使用しません。C のコンパイルとリンクには llvm-mingw が必要です。`,
    再導入説明:'rustup update で導入済みのツールチェーンと rustup 自身を更新します。ツールチェーン・cargo のキャッシュは削除しません。',
    確認説明:`公式 rustup-init ${RUSTUP_INIT.version}（SHA-256 照合済みの固定版）を実行し、~/.cargo と ~/.rustup に導入します。rustup の標準動作として ~/.cargo/bin をユーザー PATH に追加します。既定ホスト ${RUST_HOST}・stable・minimal で約300MB を取得します。プロジェクトが rust-toolchain.toml で別の版を指定している場合は、初回ビルド時に rustup が自動取得します。削除（rustup self uninstall）は ~/.cargo 全体を消すため自動実行しません。`,操作:[]};
  let context=null;
  try{
    if(entry.id!=='rust')throw failure('未対応の導入操作です。');
    // 別の導入先を指定した環境は推測で操作しない。
    if(envValue(rawEnv,'CARGO_HOME')||envValue(rawEnv,'RUSTUP_HOME'))throw failure('CARGO_HOME / RUSTUP_HOME が設定されています。標準以外の配置のため自動操作しません。');
    const base=await baseContext(env,platform);
    const cargoHome=path.join(base.home,'.cargo'),bin=path.join(cargoHome,'bin');
    context={...base,prefix:bin,lockKey:bin,bin,rustup:path.join(bin,'rustup.exe'),cargo:path.join(bin,'cargo.exe'),rustupHome:path.join(base.home,'.rustup')};
    await plainPath(bin);await plainPath(context.rustupHome);
    const selected=await resolve(entry,{env,platform});
    if(selected&&!same(selected,context.cargo))throw failure('別の導入先の cargo が検出されました。元の方法で管理してください。');
    // rustup のプロキシ（cargo.exe 等）は rustup.exe のハードリンクのため、ハードリンクを許可する。
    if(await plainPath(context.rustup,{fileOnly:true,allowHardlinks:true})){item.操作=['再導入'];return {item,context};}
    if(await exists(context.cargo))throw failure('rustup の管理外の cargo が ~/.cargo/bin にあります。元の方法で管理してください。');
    item.操作=['導入'];return {item,context};
  }catch(error){item.理由=error.status?error.message:'Rust の導入元を確認できません。';return {item,context};}
}

export async function executeRust(entry,action,context,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal,timeout=300000,onData=()=>{},onUncertain=()=>{},rawEnv=process.env}={}) {
  if(entry.id!=='rust'||!ACTIONS.includes(action))throw failure('未対応の導入操作です。',400);
  stopped(signal);const options={run,signal,timeout,onData,onUncertain};
  // manager のロック下でも配置を取り直す。
  const fresh=await inspectRust(entry,{env,platform,resolve,rawEnv});
  if(!fresh.item.操作.includes(action)||!context||!same(context.bin,fresh.context?.bin||context.home))throw failure(fresh.item.理由||'導入状況または所有元が変わりました。操作せず再確認します。');
  context=fresh.context;
  if(action==='導入'){
    const directory=path.join(context.local,'Temp',`aidiy-rustup-${randomUUID()}`);
    try{
      await mkdir(directory,{recursive:true});await plainPath(directory);
      const installer=path.join(directory,'rustup-init.exe');
      await download(context,{url:RUSTUP_INIT.url,sha256:RUSTUP_INIT.sha256,file:installer,label:'公式 rustup-init'},env,directory,options);
      onData(`rustup-init を実行します（${RUST_HOST} / stable / minimal）。\n`);
      await checkedRun({label:'rustup-init',executable:installer,args:['-y','--default-host',RUST_HOST,'--default-toolchain','stable','--profile','minimal'],
        cwd:directory,env:environment(env,context,directory),timeout:Math.max(timeout,INSTALL_TIMEOUT)},options);
    }finally{await rm(directory,{recursive:true,force:true}).catch(()=>onData('一時ファイルの後片付けに失敗しました。\n'));}
    if(!await plainPath(context.rustup,{fileOnly:true,allowHardlinks:true})||!await exists(context.cargo))throw failure('rustup-init は終了しましたが、~/.cargo/bin の rustup / cargo を確認できません。');
    onData('Rust を導入しました。新しく開いたターミナルで cargo を使用できます。\n');
  }else if(action==='再導入'){
    onData('rustup update を実行します。\n');
    await checkedRun({label:'rustup update',executable:context.rustup,args:['update'],cwd:context.home,env:environment(env,context,path.join(context.local,'Temp')),timeout:Math.max(timeout,INSTALL_TIMEOUT)},options);
    onData('Rust を更新しました。\n');
  }else throw failure('Rust の削除は自動実行しません。rustup self uninstall を手動で実行してください。');
  return {code:0};
}

// ---------------------------------------------------------------- llvm-mingw
export async function inspectLlvmMingw(entry,{env=process.env,platform=process.platform,resolve=resolveProgram}={}) {
  const item={id:entry.id,パッケージ:`llvm-mingw ${LLVM_MINGW.version}（UCRT・x86_64）`,
    説明:'MSVC を使わない C / C++ コンパイラとリンカー（clang / lld / mingw-w64）です。Rust の gnullvm ターゲットで C を含む依存をビルドするときに使います。',
    再導入説明:'旧フォルダを退避してから同じ固定版を展開し直します。失敗・中止時は旧フォルダを復元します。',
    確認説明:`公式 GitHub Releases の ${LLVM_MINGW.name}.zip（約190MB、SHA-256 照合済みの固定版）を %LOCALAPPDATA%\\Programs\\llvm-mingw に展開し、その bin をユーザー PATH に追加します。インストーラーや管理者権限は使いません。削除は AiDiy が展開したフォルダと、AiDiy が追加した PATH 登録だけを戻します。`,操作:[]};
  let context=null;
  try{
    if(entry.id!=='llvm-mingw')throw failure('未対応の導入操作です。');
    const base=await baseContext(env,platform);
    const programs=path.join(base.local,'Programs'),root=path.join(programs,'llvm-mingw'),bin=path.join(root,'bin');
    context={...base,prefix:root,lockKey:root,programs,root,bin,clang:path.join(bin,'x86_64-w64-mingw32-clang.exe'),receipt:null};
    await plainPath(root);
    const names=await readdir(programs).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(names.some(name=>/^llvm-mingw\.aidiy-(?:backup|staging)-/i.test(name)))throw failure('前回の退避・展開途中のフォルダが %LOCALAPPDATA%\\Programs に残っています。手動で状態を確認してください。');
    if(await exists(root)){
      let receipt;
      try{receipt=JSON.parse(await readFile(path.join(root,LLVM_MINGW_RECEIPT),'utf8'));}catch{receipt=null;}
      if(!receipt||typeof receipt.name!=='string'||typeof receipt.directory!=='string'||!same(receipt.directory,root))throw failure('AiDiy 以外で配置された llvm-mingw フォルダです。元の方法で管理してください。');
      context.receipt=receipt;item.操作=['再導入','削除'];return {item,context};
    }
    const selected=await resolve(entry,{env,platform});
    if(selected)throw failure('別の導入先の llvm-mingw（clang）が検出されました。元の方法で管理してください。');
    item.操作=['導入'];return {item,context};
  }catch(error){item.理由=error.status?error.message:'llvm-mingw の導入元を確認できません。';return {item,context};}
}

export async function executeLlvmMingw(entry,action,context,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal,timeout=300000,onData=()=>{},onUncertain=()=>{}}={}) {
  if(entry.id!=='llvm-mingw'||!ACTIONS.includes(action))throw failure('未対応の導入操作です。',400);
  stopped(signal);const options={run,signal,timeout,onData,onUncertain};
  const fresh=await inspectLlvmMingw(entry,{env,platform,resolve});
  if(!fresh.item.操作.includes(action)||!context||!same(context.root,fresh.context?.root||context.home))throw failure(fresh.item.理由||'導入状況または所有元が変わりました。操作せず再確認します。');
  context=fresh.context;
  const backup=path.join(context.programs,`llvm-mingw.aidiy-backup-${randomUUID()}`);
  // 同じボリュームで rename できるよう、展開は導入先と同じ Programs 配下で行う。
  const staging=path.join(context.programs,`llvm-mingw.aidiy-staging-${randomUUID()}`);
  let backedUp=false,placed=false,committed=false;
  try{
    if(action==='削除'){
      await rename(context.root,backup);backedUp=true;
      if(context.receipt?.pathAdded){const data=await userPath(context,'remove',context.bin,env,options);if(data.changed)onData('AiDiy が追加したユーザー PATH の登録を解除しました。\n');}
      committed=true;await rm(backup,{recursive:true,force:true});backedUp=false;
      onData('AiDiy が展開した llvm-mingw を削除しました。\n');
      return {code:0};
    }
    await mkdir(staging,{recursive:true});await plainPath(staging);
    const archive=path.join(staging,`${LLVM_MINGW.name}.zip`);
    await download(context,{url:LLVM_MINGW.url,sha256:LLVM_MINGW.sha256,file:archive,label:'llvm-mingw'},env,staging,options);
    onData('zip を展開します。\n');
    await checkedRun({label:'zip の展開',executable:context.tar,args:['-xf',archive,'-C',staging],cwd:staging,env:environment(env,context,staging),timeout:Math.max(timeout,INSTALL_TIMEOUT)},options);
    await unlink(archive);
    const extracted=path.join(staging,LLVM_MINGW.name);
    const top=await readdir(staging);
    if(top.length!==1||top[0]!==LLVM_MINGW.name||!await plainPath(path.join(extracted,'bin','x86_64-w64-mingw32-clang.exe'),{fileOnly:true,allowHardlinks:true}))throw failure('展開結果が想定した構成（bin/x86_64-w64-mingw32-clang.exe）と一致しません。');
    stopped(signal);
    if(action==='再導入'){await rename(context.root,backup);backedUp=true;}
    else if(await exists(context.root))throw failure('別の処理により導入先フォルダが作成されました。');
    await rename(extracted,context.root);placed=true;
    // PATH の登録状況は前回の記録を引き継ぐ（再導入で利用者が追加した登録を AiDiy 登録として扱わない）。
    let pathAdded=Boolean(context.receipt?.pathAdded);
    const data=await userPath(context,'add',context.bin,env,options);
    if(data.changed){pathAdded=true;onData(`ユーザー PATH に追加しました: ${context.bin}\n`);}
    await writeFile(path.join(context.root,LLVM_MINGW_RECEIPT),JSON.stringify({name:LLVM_MINGW.name,version:LLVM_MINGW.version,sha256:LLVM_MINGW.sha256,directory:context.root,pathAdded,installedAt:new Date().toISOString()},null,2),'utf8');
    committed=true;
    if(backedUp){await rm(backup,{recursive:true,force:true});backedUp=false;}
    onData('llvm-mingw を展開しました。新しく開いたターミナルで clang / x86_64-w64-mingw32-clang を使用できます。\n');
    return {code:0};
  }catch(error){
    if(!committed){
      try{
        if(placed)await rm(context.root,{recursive:true,force:true});
        if(backedUp){await rename(backup,context.root);backedUp=false;onData('退避した元のフォルダを復元しました。\n');}
      }catch{throw failure('処理に失敗し、元の配置の自動復元を確認できません。退避フォルダは削除せず保持しています。手動確認が必要です。');}
    }
    throw error;
  }finally{
    // 自分で作った展開用フォルダだけを再帰削除する。
    await rm(staging,{recursive:true,force:true}).catch(()=>onData('展開用フォルダの後片付けに失敗しました。\n'));
  }
}
