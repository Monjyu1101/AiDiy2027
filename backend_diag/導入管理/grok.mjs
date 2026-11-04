// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Windows の公式 Grok Build CLI だけを扱う。認証・設定・履歴・セッションは削除しない。
// 公式スクリプト: https://x.ai/cli/install.ps1（削除用のサブコマンドは提供されていない）
import {mkdtemp,readdir,rename,unlink,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {resolveProgram} from '../診断/probes.mjs';
import {exists,plainPath,digest} from './antigravity.mjs';

export const GROK_INSTALLER_URL='https://x.ai/cli/install.ps1';
// 2026-10-20 に読んだ公式スクリプト。上流変更時は再レビューするまで実行しない。
export const GROK_INSTALLER_SHA256='c83dac29885215c79137e48cbc034d3d7c8c11afba3082ff1df0e0769aa902a4';
// 公式インストーラーが ~/.grok/bin に置く実行ファイル。grove 系は配布がある版だけ置かれる。
export const GROK_FILES=Object.freeze(['grok.exe','agent.exe','grove.exe','grove-fsmonitor.exe','grove-credential.exe']);
const ACTIONS=['導入','再導入','削除'];
// 約170MBの本体を取得するため、インストーラーの実行だけ期限を延ばす。
const INSTALL_TIMEOUT=15*60*1000;
const failure=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const envValue=(env,key)=>Object.entries(env).find(([name])=>name.toUpperCase()===key)?.[1];
const stopped=signal=>{if(signal?.aborted)throw failure('操作を中止しました。');};
const unsafe=value=>typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/["!%&|<>^;\r\n\0]/.test(value);
const success=result=>result?.code===0&&!result.error&&!result.cancelled&&!result.timedOut&&!result.overflow;

// 2026-10-22 の配布から署名者が X.AI LLC から X Corp.（Bastrop, Texas）に変わった。
export function officialSigner(info) {
  return info?.status==='Valid'&&/(?:^|,\s*)CN=(?:X\.AI (?:LLC|Corp\.?)|X Corp\.)(?:,|$)/.test(info.subject||'');
}

function environment(env,context,temporary) {
  const output={};
  for(const key of ['APPDATA','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY']){
    const value=envValue(env,key);if(value!==undefined)output[key]=value;
  }
  // GROK_CHANNEL / GROK_BIN_DIR / GROK_VERSION / GROK_DEPLOYMENT_KEY は渡さず、公式既定の stable と ~/.grok/bin に固定する。
  // コマンドとモジュールは OS 標準ディレクトリだけから解決する。
  const powershellHome=path.join(context.systemRoot,'System32','WindowsPowerShell','v1.0');
  return {...output,USERPROFILE:context.home,HOME:context.home,LOCALAPPDATA:context.local,SystemRoot:context.systemRoot,WINDIR:context.systemRoot,
    PATH:[path.join(context.systemRoot,'System32'),powershellHome].join(';'),PATHEXT:'.COM;.EXE;.BAT;.CMD',PSModulePath:path.join(powershellHome,'Modules'),
    COMSPEC:path.join(context.systemRoot,'System32','cmd.exe'),TEMP:temporary||os.tmpdir(),TMP:temporary||os.tmpdir(),PROCESSOR_ARCHITECTURE:context.architecture,NO_COLOR:'1',CI:'1',DO_NOT_TRACK:'1'};
}

// 固定スクリプト。パスはコードへ埋め込まず環境変数で渡す。プロファイル・権限回避は使わない。
const INSPECT_SCRIPT=String.raw`$ErrorActionPreference='Stop';
$dir=$env:AIDIY_GROK_DIR;$p=$dir;
while($p){if(Test-Path -LiteralPath $p){$item=Get-Item -LiteralPath $p -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Reparse point'}};$parent=[IO.Path]::GetDirectoryName($p);if(-not $parent -or $parent -eq $p){break};$p=$parent}
$prefix=[IO.Path]::GetFullPath($dir).TrimEnd('\')+'\';$count=0;
foreach($proc in @(Get-CimInstance Win32_Process -Filter "Name='grok.exe' OR Name='agent.exe' OR Name='grove.exe' OR Name='grove-fsmonitor.exe' OR Name='grove-credential.exe'")){if($proc.Name -ieq 'grok.exe'){$count++;continue};$exe=[string]$proc.ExecutablePath;if(-not $exe -or $exe.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){$count++}}
$files=@{};
foreach($n in @('grok.exe','agent.exe','grove.exe','grove-fsmonitor.exe','grove-credential.exe')){$f=Join-Path $dir $n;if(Test-Path -LiteralPath $f -PathType Leaf){$s=Get-AuthenticodeSignature -LiteralPath $f;$files[$n]=@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject}}}
@{processCount=$count;files=$files}|ConvertTo-Json -Compress -Depth 4`;

// 実行直前にも取得済みファイルのハッシュを照合してから、公式手順と同じ scriptblock として実行する。
const RUN_SCRIPT=String.raw`$ErrorActionPreference='Stop';
$bytes=[IO.File]::ReadAllBytes($env:AIDIY_GROK_INSTALLER);
$hash=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant();
if($hash -ne $env:AIDIY_GROK_SHA256){[Console]::Error.WriteLine('installer hash mismatch');exit 2}
$text=(New-Object System.Text.UTF8Encoding($false)).GetString($bytes);
if($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF){$text=$text.Substring(1)}
& ([scriptblock]::Create($text));
exit 0`;

async function inspectWindows(context,{env,run,signal}) {
  if(typeof run!=='function')throw failure('Windows の安全確認を実行できません。');
  let output='';stopped(signal);
  const result=await run({executable:context.powershell,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',INSPECT_SCRIPT],cwd:os.tmpdir(),
    env:{...environment(env,context),AIDIY_GROK_DIR:context.prefix},signal,timeout:30000,outputLimit:65536,onData:text=>output+=text,platform:'win32'});
  stopped(signal);if(!success(result))throw failure('実行中プロセス・署名・Windows の配置を確認できないため、自動操作しません。');
  let data;try{data=JSON.parse(output.replace(/^﻿/,'').trim());}catch{throw failure('Windows の安全確認結果が不正です。');}
  if(!Number.isInteger(data.processCount)||data.processCount<0)throw failure('実行中プロセスを確認できません。');
  if(data.processCount)throw failure('Grok Build が実行中です。grok / agent を終了してから再確認してください。');
  return data;
}

export async function inspectGrok(entry,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal}={}) {
  const item={id:entry.id,パッケージ:'Grok Build CLI (grok)',説明:'公式 Windows インストーラー（stable）を使用します。認証・設定・履歴・セッションは削除しません。',
    確認説明:'~/.grok/bin の grok.exe / agent.exe（配布がある版は grove 系も）だけを導入・再導入・削除します。公式インストーラーは ~/.grok/config.toml の [cli] installer 行を更新し、ユーザー PATH に ~/.grok/bin が無ければ追加します。再導入は旧ファイルを退避し、失敗・中止時に復元します。削除では PATH・認証・設定・同梱 git（%LOCALAPPDATA%\\grok）を残します。',操作:[]};
  let context=null;
  try{
    if(entry.id!=='grok')throw failure('未対応の導入操作です。');
    if(platform!=='win32')throw failure('Grok Build の自動導入・削除は Windows のみ対応しています。');
    const home=envValue(env,'USERPROFILE'),local=envValue(env,'LOCALAPPDATA'),systemRoot=envValue(env,'SYSTEMROOT');
    if(unsafe(home)||unsafe(local)||unsafe(systemRoot))throw failure('標準のユーザー導入先・Windows ディレクトリを安全に確認できません。');
    const architecture=process.arch==='x64'?'AMD64':process.arch==='arm64'?'ARM64':null;
    if(!architecture)throw failure('この CPU の公式 Windows インストーラーには対応していません。');
    const prefix=path.join(home,'.grok','bin');
    context={prefix,lockKey:prefix,home,local,systemRoot,architecture,binary:path.join(prefix,'grok.exe'),files:{},
      curl:path.join(systemRoot,'System32','curl.exe'),powershell:path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')};
    for(const command of [context.curl,context.powershell])if(!await plainPath(command,{fileOnly:true,allowHardlinks:true}))throw failure('必要な Windows 標準コマンドを確認できません。');
    if(!(await plainPath(home))?.isDirectory())throw failure('ユーザーフォルダの実体を確認できません。');
    await plainPath(prefix);
    const names=await readdir(prefix).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(names.some(name=>/\.aidiy-(?:backup|failed)-/.test(name)))throw failure('前回の退避・復旧ファイルが残っています。手動で復旧状態を確認してください。');
    const selected=await resolve(entry,{env,platform});
    if(selected&&!same(selected,context.binary))throw failure('別の導入先の grok が検出されました。元の方法で管理してください。');
    const present=[];
    for(const name of GROK_FILES)if(await plainPath(path.join(prefix,name),{fileOnly:true}))present.push(name);
    const data=await inspectWindows(context,{env,run,signal});
    if(!present.includes('grok.exe')){
      if(present.length)throw failure('grok.exe が無く、関連ファイルだけが残っています。手動で配置を確認してください。');
      item.操作=['導入'];return {item,context};
    }
    for(const name of present)if(!officialSigner(data.files?.[name]))throw failure(`${name} の xAI 署名を確認できないため、自動操作しません。`);
    for(const name of present)context.files[name]=await digest(path.join(prefix,name),'sha512',{signal,executable:true});
    item.操作=['再導入','削除'];return {item,context};
  }catch(error){item.理由=error.status?error.message:'Grok Build の導入元を確認できません。';return {item,context};}
}

async function checkedRun(command,options) {
  stopped(options.signal);const result=await options.run({...command,signal:options.signal,timeout:command.timeout??options.timeout,onData:options.onData,onUncertain:options.onUncertain,platform:'win32'});
  if(result?.cancelled||options.signal?.aborted)throw failure('操作を中止しました。');
  if(result?.timedOut)throw failure('実行時間の上限に達したため停止しました。');
  if(result?.overflow)throw failure('出力の上限に達したため停止しました。');
  if(!success(result))throw failure(`公式インストーラーの処理が失敗しました（終了コード ${result?.code??'起動不可'}）。`);
  return result;
}

export async function executeGrok(entry,action,context,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal,timeout=300000,onData=()=>{},onUncertain=()=>{}}={}) {
  if(entry.id!=='grok'||!ACTIONS.includes(action))throw failure('未対応の導入操作です。',400);
  stopped(signal);const options={run,signal,timeout,onData,onUncertain};
  // manager のロック下でも配置・プロセス・署名・ハッシュを独立に取り直す。
  const fresh=await inspectGrok(entry,{env,platform,run,resolve,signal});
  if(!fresh.item.操作.includes(action)||!context||!same(context.prefix,fresh.context?.prefix||os.tmpdir())||JSON.stringify(context.files||{})!==JSON.stringify(fresh.context.files||{}))throw failure(fresh.item.理由||'導入状況または所有元が変わりました。操作せず再確認します。');
  context=fresh.context;
  const backups=new Map();let directory,committed=false,installerStarted=false;
  const backupAll=async()=>{
    for(const [name,hash] of Object.entries(context.files)){
      stopped(signal);const file=path.join(context.prefix,name);
      await plainPath(file,{fileOnly:true});
      if(await digest(file,'sha512',{signal,executable:true})!==hash)throw failure('確認後に実行ファイルが変更されました。操作せず再確認します。');
      const destination=`${file}.aidiy-backup-${randomUUID()}`;await rename(file,destination);backups.set(name,destination);
    }
  };
  try{
    if(action==='削除'){
      await inspectWindows(context,{env,run,signal});stopped(signal);
      await backupAll();
    }else{
      directory=await mkdtemp(path.join(os.tmpdir(),'aidiy-grok-'));
      if(unsafe(directory))throw failure('一時フォルダを安全に使用できません。');
      await plainPath(directory);
      const installer=path.join(directory,'install.ps1'),commandEnv=environment(env,context,directory);
      onData('公式インストーラーを確認します。\n');
      await checkedRun({executable:context.curl,args:['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-redirs','3','--connect-timeout','15','--output',installer,GROK_INSTALLER_URL],cwd:directory,env:commandEnv},options);
      if(await digest(installer,'sha256',{signal})!==GROK_INSTALLER_SHA256)throw failure('公式インストーラーが更新されています。安全確認の更新が必要なため実行しません。');
      // ダウンロード中に外部更新・起動が起きた場合も退避しない。
      await inspectWindows(context,{env,run,signal});
      if(action==='導入'){for(const name of GROK_FILES)if(await exists(path.join(context.prefix,name)))throw failure('別の処理により実行ファイルが作成されました。');}
      else await backupAll();
      stopped(signal);onData('公式インストーラーを実行します（stable・~/.grok/bin）。\n');
      installerStarted=true;
      await checkedRun({executable:context.powershell,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',RUN_SCRIPT],cwd:directory,
        env:{...commandEnv,AIDIY_GROK_INSTALLER:installer,AIDIY_GROK_SHA256:GROK_INSTALLER_SHA256},timeout:Math.max(timeout,INSTALL_TIMEOUT)},options);
      const data=await inspectWindows(context,{env,run,signal});
      if(!officialSigner(data.files?.['grok.exe']))throw failure('インストーラーは終了しましたが、xAI 署名の grok.exe を確認できません。');
      for(const [name,info] of Object.entries(data.files||{}))if(!officialSigner(info))throw failure(`インストーラーは終了しましたが、${name} の xAI 署名を確認できません。`);
    }
    onData('変更を確認しました。確定します。\n');stopped(signal);committed=true;
    for(const [name,backup] of backups){
      await plainPath(backup,{fileOnly:true});
      if(await digest(backup,'sha512',{executable:true})!==context.files[name])throw failure('操作は反映済みですが退避ファイルが変更されています。自動削除せず保持します。');
      await unlink(backup);backups.delete(name);
    }
    onData(action==='削除'?'所有を確認した Grok Build の実行ファイルだけを削除しました。認証・設定・PATH は保持しています。\n':'xAI 署名の実行ファイルを確認しました。認証・設定は保持しています。\n');
    return {code:0};
  }catch(error){
    if(!committed&&(backups.size||installerStarted)){
      try{
        // インストーラーが置いたファイルはこの操作で作成したものだけ。元のファイルは退避済み。
        if(installerStarted)for(const name of GROK_FILES){const file=path.join(context.prefix,name);if(await plainPath(file,{fileOnly:true}))await unlink(file);}
        const restored=backups.size;
        for(const [name,backup] of backups){
          await plainPath(backup,{fileOnly:true});
          if(await digest(backup,'sha512',{executable:true})!==context.files[name])throw failure('退避ファイルが変更されています。');
          await rename(backup,path.join(context.prefix,name));backups.delete(name);
        }
        if(restored)onData('退避した元の実行ファイルを復元しました。\n');
      }catch{throw failure('処理に失敗し、元の配置の自動復元を確認できません。退避ファイルは削除せず保持しています。手動確認が必要です。');}
    }
    throw error;
  }finally{
    // 自分で作った一時フォルダだけ。導入先・設定・公式の downloads は再帰削除しない。
    if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>onData('一時ファイルの後片付けに失敗しました。\n'));
  }
}
