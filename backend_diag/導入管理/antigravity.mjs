// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Windows の公式 Antigravity CLI だけを扱う。認証・設定・履歴・PATH は変更しない。
// 公式資料: https://www.antigravity.google/docs/cli/install/
import {readFile,lstat,realpath,open,mkdtemp,readdir,writeFile,rename,unlink,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {resolveProgram} from '../診断/probes.mjs';

export const ANTIGRAVITY_INSTALLER_URL='https://antigravity.google/cli/install.cmd';
// 2026-10-19 に読んだ公式スクリプト。上流変更時は再レビューするまで実行しない。
export const ANTIGRAVITY_INSTALLER_SHA256='15aa0bd50ea4d4f53df35b96a6347567cf95231d327f69eae74ece23fde52509';
const MANIFEST_ORIGIN='https://antigravity-cli-auto-updater-974169037036.us-central1.run.app';
const RECEIPT='.aidiy-antigravity-install.json';
const failure=(message,status=409)=>Object.assign(new Error(message),{status});
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const envValue=(env,key)=>Object.entries(env).find(([name])=>name.toUpperCase()===key)?.[1];
const stopped=signal=>{if(signal?.aborted)throw failure('操作を中止しました。');};
const unsafe=value=>typeof value!=='string'||!path.isAbsolute(value)||/^[/\\]{2}/.test(value)||/["!%&|<>^;\r\n\0]/.test(value);
const success=result=>result?.code===0&&!result.error&&!result.cancelled&&!result.timedOut&&!result.overflow;

function environment(env,context,temporary) {
  const output={};
  for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','SYSTEMROOT','WINDIR','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY']){
    const value=envValue(env,key);if(value!==undefined)output[key]=value;
  }
  // 公式 cmd が実行する curl/findstr/certutil/ping も OS 標準ディレクトリだけから解決する。
  return {...output,SystemRoot:context.systemRoot,LOCALAPPDATA:context.local,PATH:path.join(context.systemRoot,'System32'),PATHEXT:'.COM;.EXE;.BAT;.CMD',
    COMSPEC:context.cmd,TEMP:temporary||os.tmpdir(),TMP:temporary||os.tmpdir(),PROCESSOR_ARCHITECTURE:context.architecture,NO_COLOR:'1',CI:'1',DO_NOT_TRACK:'1'};
}

export async function exists(file) {try{return await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
// ファイルだけでなく親の junction / symlink / 別実体も拒否する。存在しない末尾だけは許可する。
export async function plainPath(file,{fileOnly=false,allowHardlinks=false}={}) {
  const chain=[];let current=path.resolve(file);
  while(true){chain.unshift(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}
  let result=null;
  for(const candidate of chain){
    const info=await exists(candidate);if(!info)continue;
    if(info.isSymbolicLink()||!same(await realpath(candidate),candidate))throw failure('リンク・junction・外部配置は自動操作しません。');
    if(candidate!==path.resolve(file)&&!info.isDirectory())throw failure('導入先の親フォルダを確認できません。');
    if(candidate===path.resolve(file))result=info;
  }
  if(result&&fileOnly&&(!result.isFile()||(!allowHardlinks&&result.nlink!==1)))throw failure('通常の単独ファイル以外は自動操作しません。');
  return result;
}

export async function digest(file,algorithm='sha512',{signal,executable=false}={}) {
  await plainPath(file,{fileOnly:true});const handle=await open(file,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>512*1024*1024)throw failure('実行ファイルの形式・サイズを確認できません。');
    const hash=createHash(algorithm),buffer=Buffer.alloc(1024*1024);let position=0;
    while(true){stopped(signal);const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;
      if(executable&&position===0&&(bytesRead<2||buffer[0]!==0x4d||buffer[1]!==0x5a))throw failure('Windows 実行ファイルの形式を確認できません。');
      hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
    }
    const after=await handle.stat(),current=await lstat(file);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.dev!==current.dev||before.ino!==current.ino||after.size!==current.size||after.mtimeMs!==current.mtimeMs)throw failure('確認中にファイルが変更されました。');
    if(executable&&position<2)throw failure('Windows 実行ファイルを確認できません。');
    return hash.digest('hex');
  }finally{await handle.close();}
}

// 固定スクリプト。パスはコードへ埋め込まず環境変数で渡す。プロファイル・権限回避は使わない。
const INSPECT_SCRIPT=String.raw`$ErrorActionPreference='Stop';
$paths=@($env:AIDIY_AGY_BINARY,$env:AIDIY_AGY_RECEIPT,$env:AIDIY_AGY_STAGING);
foreach($p in $paths){while($p){if(Test-Path -LiteralPath $p){$item=Get-Item -LiteralPath $p -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Reparse point'}};$parent=[IO.Path]::GetDirectoryName($p);if($parent -eq $p){break};$p=$parent}}
$processes=@(Get-CimInstance Win32_Process -Filter "Name='agy.exe' OR Name='antigravity.exe'");
$identity=$null;
if(Test-Path -LiteralPath $env:AIDIY_AGY_BINARY -PathType Leaf){$s=Get-AuthenticodeSignature -LiteralPath $env:AIDIY_AGY_BINARY;$v=(Get-Item -LiteralPath $env:AIDIY_AGY_BINARY).VersionInfo;$identity=@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject;company=[string]$v.CompanyName;product=[string]$v.ProductName;original=[string]$v.OriginalFilename}}
@{processCount=$processes.Count;identity=$identity}|ConvertTo-Json -Compress -Depth 4`;

async function inspectWindows(context,{env,run,signal}) {
  if(typeof run!=='function')throw failure('Windows の安全確認を実行できません。');
  let output='';stopped(signal);
  const result=await run({executable:context.powershell,args:['-NoProfile','-NonInteractive','-Command',INSPECT_SCRIPT],cwd:os.tmpdir(),
    env:{...environment(env,context),AIDIY_AGY_BINARY:context.binary,AIDIY_AGY_RECEIPT:context.receipt,AIDIY_AGY_STAGING:context.staging},
    signal,timeout:10000,outputLimit:65536,onData:text=>output+=text,platform:'win32'});
  stopped(signal);if(!success(result))throw failure('実行中プロセス・署名・Windows の配置を確認できないため、自動操作しません。');
  let data;try{data=JSON.parse(output.replace(/^\uFEFF/,'').trim());}catch{throw failure('Windows の安全確認結果が不正です。');}
  if(!Number.isInteger(data.processCount)||data.processCount<0)throw failure('実行中プロセスを確認できません。');
  if(data.processCount)throw failure('Antigravity が実行中です。アプリ・CLI を終了してから再確認してください。');
  return data.identity;
}

// 公式 agy.exe は製品情報（VersionInfo）を持たない版がある。空の場合は署名だけで判定し、
// 値がある場合は従来どおり会社名・製品名・元ファイル名の一致も求める。
export function officialIdentity(identity) {
  if(identity?.status!=='Valid'||!/(?:^|,\s*)CN=Google (?:LLC|Inc\.?)(?:,|$)/.test(identity.subject||''))return false;
  if(!identity.company&&!identity.product&&!identity.original)return true;
  return /^Google (?:LLC|Inc\.?)$/.test(identity.company||'')&&/Antigravity/i.test(identity.product||'')&&/^agy\.exe$/i.test(identity.original||'');
}

async function receiptFor(context) {
  const info=await plainPath(context.receipt,{fileOnly:true});if(!info)return null;
  if(info.size>4096)throw failure('導入記録を確認できません。');
  let receipt;try{receipt=JSON.parse(await readFile(context.receipt,'utf8'));}catch{throw failure('導入記録が不正なため、自動操作しません。');}
  if(receipt.schema!==1||receipt.id!=='agy'||receipt.installer!==ANTIGRAVITY_INSTALLER_URL||receipt.installerSha256!==ANTIGRAVITY_INSTALLER_SHA256||!/^[a-f0-9]{128}$/.test(receipt.sha512||''))throw failure('導入記録の所有情報が一致しません。');
  return receipt;
}

export async function inspectAntigravity(entry,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal}={}) {
  const item={id:entry.id,パッケージ:'Antigravity CLI (agy)',説明:'公式 Windows インストーラーを使用します。設定・認証・履歴・PATH・既存エイリアスは残します。',
    再導入説明:'旧バイナリを退避してから公式インストーラーで更新・再導入します。失敗・中止時は旧バイナリを復元します。',
    確認説明:'標準配置の agy.exe だけを導入・再導入・削除します。再導入は旧バイナリを退避し、失敗・中止時に復元します。公式インストーラーには --skip-path / --skip-aliases を指定します。設定・認証・OS の資格情報は変更せず、フォルダ全体の削除や PATH 編集はしません。',操作:[]};
  let context=null;
  try{
    if(entry.id!=='agy')throw failure('未対応の導入操作です。');
    if(platform!=='win32')throw failure('Antigravity の自動導入・削除は Windows のみ対応しています。');
    const local=envValue(env,'LOCALAPPDATA'),systemRoot=envValue(env,'SYSTEMROOT');
    if(unsafe(local)||unsafe(systemRoot))throw failure('標準のユーザー導入先・Windows ディレクトリを安全に確認できません。');
    const architecture=process.arch==='x64'?'AMD64':process.arch==='arm64'?'ARM64':null;
    if(!architecture)throw failure('この CPU の公式 Windows インストーラーには対応していません。');
    const prefix=path.join(local,'agy','bin');context={prefix,local,systemRoot,architecture,binary:path.join(prefix,'agy.exe'),receipt:path.join(prefix,RECEIPT),staging:path.join(local,'antigravity','staging','agy.exe'),
      cmd:path.join(systemRoot,'System32','cmd.exe'),curl:path.join(systemRoot,'System32','curl.exe'),powershell:path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')};
    for(const command of [context.cmd,context.curl,context.powershell])if(!await plainPath(command,{fileOnly:true,allowHardlinks:true}))throw failure('必要な Windows 標準コマンドを確認できません。');
    if(!(await plainPath(local))?.isDirectory())throw failure('LOCALAPPDATA の実体を確認できません。');
    const binaryInfo=await plainPath(context.binary,{fileOnly:true});
    const receipt=await receiptFor(context);context.receiptPresent=Boolean(receipt);
    context.receiptHash=receipt?await digest(context.receipt,'sha256',{signal}):null;
    const leftovers=await readdir(prefix).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(leftovers.some(name=>/^agy\.exe\.aidiy-(?:backup|failed)-/.test(name)))throw failure('前回の退避・復旧ファイルが残っています。手動で復旧状態を確認してください。');
    if(await plainPath(context.staging,{fileOnly:true}))throw failure('公式インストーラーの作業ファイルが残っています。既存の処理を確認してから再試行してください。');
    const selected=await resolve(entry,{env,platform});
    if(selected&&!same(selected,context.binary))throw failure('別の導入先の agy が検出されました。元の方法で管理してください。');
    const identity=await inspectWindows(context,{env,run,signal});
    if(!binaryInfo){if(receipt)throw failure('導入記録はありますがバイナリがありません。手動で配置を確認してください。');item.操作=['導入'];return {item,context};}
    context.sha512=await digest(context.binary,'sha512',{signal,executable:true});
    if(receipt?.sha512!==context.sha512&&!officialIdentity(identity))throw failure('公式バイナリの署名・製品情報、または一致する導入記録を確認できないため、自動削除しません。');
    context.ownership=receipt?.sha512===context.sha512?'receipt':'signature';item.操作=['再導入','削除'];return {item,context};
  }catch(error){item.理由=error.status?error.message:'Antigravity の導入元を確認できません。';return {item,context};}
}

async function checkedRun(command,options) {
  stopped(options.signal);const result=await options.run({...command,signal:options.signal,timeout:options.timeout,onData:options.onData,onUncertain:options.onUncertain,platform:'win32'});
  if(result?.cancelled||options.signal?.aborted)throw failure('操作を中止しました。');
  if(result?.timedOut)throw failure('実行時間の上限に達したため停止しました。');
  if(result?.overflow)throw failure('出力の上限に達したため停止しました。');
  if(!success(result))throw failure(`公式インストーラーの処理が失敗しました（終了コード ${result?.code??'起動不可'}）。`);
  return result;
}

async function unchangedReceipt(context,signal) {
  const info=await plainPath(context.receipt,{fileOnly:true});
  if(context.receiptHash?( !info||await digest(context.receipt,'sha256',{signal})!==context.receiptHash):Boolean(info))throw failure('確認後に導入記録が変更されました。');
}

async function unchanged(context,signal) {
  if(!context.sha512||await digest(context.binary,'sha512',{signal,executable:true})!==context.sha512)throw failure('確認後に実行ファイルが変更されました。操作せず再確認します。');
}

export async function executeAntigravity(entry,action,context,{env=process.env,platform=process.platform,run,resolve=resolveProgram,signal,timeout=300000,onData=()=>{},onUncertain=()=>{}}={}) {
  if(entry.id!=='agy'||!['導入','再導入','削除'].includes(action))throw failure('未対応の導入操作です。',400);
  stopped(signal);const options={run,signal,timeout,onData,onUncertain};
  // manager のロック下でも配置・プロセス・所有情報を独立に取り直す。
  const fresh=await inspectAntigravity(entry,{env,platform,run,resolve,signal});
  if(!fresh.item.操作.includes(action)||!context||!same(context.prefix,fresh.context?.prefix||os.tmpdir())||(context.sha512&&context.sha512!==fresh.context.sha512))throw failure(fresh.item.理由||'導入状況または所有元が変わりました。操作せず再確認します。');
  context=fresh.context;let directory,backup,installedHash,committed=false,receiptChanged=false,publishedReceiptHash=null,installerStarted=false;
  const originalReceipt=context.receiptPresent?await readFile(context.receipt):null;
  if(originalReceipt&&createHash('sha256').update(originalReceipt).digest('hex')!==context.receiptHash)throw failure('確認後に導入記録が変更されました。');
  const restoreReceipt=async()=>{
    if(!receiptChanged)return;
    const current=await plainPath(context.receipt,{fileOnly:true});
    if(publishedReceiptHash?(!current||await digest(context.receipt,'sha256')!==publishedReceiptHash):Boolean(current))throw failure('復旧中に導入記録が変更されました。');
    if(originalReceipt){
      const temporary=path.join(context.prefix,`.aidiy-agy-receipt-${randomUUID()}.tmp`);
      try{await writeFile(temporary,originalReceipt,{flag:'wx',mode:0o600});await rename(temporary,context.receipt);}finally{await unlink(temporary).catch(()=>{});}
    }else if(current)await unlink(context.receipt);
    receiptChanged=false;
  };
  try{
    if(action!=='削除'){
      directory=await mkdtemp(path.join(os.tmpdir(),'aidiy-agy-'));
      if(unsafe(directory))throw failure('一時フォルダを安全に使用できません。');
      await plainPath(directory);
      const installer=path.join(directory,'install.cmd'),manifestFile=path.join(directory,'manifest.json');
      const commandEnv=environment(env,context,directory);
      const download=async(url,target)=>checkedRun({executable:context.curl,args:['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-redirs','3','--connect-timeout','15','--output',target,url],cwd:directory,env:commandEnv},options);
      onData('公式インストーラーと配布情報を確認します。\n');
      await download(ANTIGRAVITY_INSTALLER_URL,installer);
      if(await digest(installer,'sha256',{signal})!==ANTIGRAVITY_INSTALLER_SHA256)throw failure('公式インストーラーが更新されています。安全確認の更新が必要なため実行しません。');
      await download(`${MANIFEST_ORIGIN}/manifests/windows_${context.architecture==='ARM64'?'arm64':'amd64'}.json`,manifestFile);
      const manifestInfo=await plainPath(manifestFile,{fileOnly:true});if(!manifestInfo||manifestInfo.size>65536)throw failure('公式配布情報の形式が不正です。');
      let manifest;try{manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch{throw failure('公式配布情報を読み取れません。');}
      const arch=context.architecture==='ARM64'?'arm64':'x64';
      if(!/^[a-fA-F0-9]{128}$/.test(manifest.sha512||'')||typeof manifest.url!=='string'||!new RegExp(`^https://storage\\.googleapis\\.com/antigravity-public/antigravity-cli/[A-Za-z0-9._-]+/windows-${arch}/cli_windows_${arch}\\.exe$`).test(manifest.url))throw failure('公式配布情報の URL・SHA512 が想定と一致しません。');
      installedHash=manifest.sha512.toLowerCase();
      // ダウンロード中に外部更新・起動・リンクへの差し替えが起きた場合も退避しない。
      await inspectWindows(context,{env,run,signal});await plainPath(context.staging,{fileOnly:true});
      if(await exists(context.staging))throw failure('別の公式インストーラーが実行中の可能性があります。');
      await plainPath(context.binary,{fileOnly:true});
      if(action==='導入'&&await exists(context.binary))throw failure('別の処理によりバイナリが作成されました。');
      if(action==='再導入'){await unchanged(context,signal);stopped(signal);const destination=`${context.binary}.aidiy-backup-${randomUUID()}`;await rename(context.binary,destination);backup=destination;}
      stopped(signal);onData('公式インストーラーを実行します（PATH・エイリアス変更なし）。\n');
      installerStarted=true;
      await checkedRun({executable:context.cmd,windowsVerbatimArguments:true,args:['/d','/v:off','/s','/c',`""${installer}" --dir "${context.prefix}" --skip-path --skip-aliases"`],cwd:directory,env:commandEnv},options);
      let actual;try{actual=await digest(context.binary,'sha512',{signal,executable:true});}catch(error){if(error.status)throw error;throw failure('インストーラーは終了しましたが、実行ファイルを確認できません。');}
      if(actual!==installedHash)throw failure('インストーラーは終了しましたが、公式 SHA512 と一致するバイナリを確認できません。');
      // バイナリが確認できたときだけ、自分の導入記録を置く。設定保存先には触れない。
      const receipt=JSON.stringify({schema:1,id:'agy',installer:ANTIGRAVITY_INSTALLER_URL,installerSha256:ANTIGRAVITY_INSTALLER_SHA256,sha512:installedHash});
      const temporary=path.join(context.prefix,`.aidiy-agy-receipt-${randomUUID()}.tmp`);
      await unchangedReceipt(context,signal);stopped(signal);
      try{await writeFile(temporary,receipt,{flag:'wx',mode:0o600});stopped(signal);await rename(temporary,context.receipt);receiptChanged=true;publishedReceiptHash=createHash('sha256').update(receipt).digest('hex');}finally{await unlink(temporary).catch(()=>{});}
    }else{
      await unchanged(context,signal);await inspectWindows(context,{env,run,signal});stopped(signal);
      const destination=`${context.binary}.aidiy-backup-${randomUUID()}`;await rename(context.binary,destination);backup=destination;
      stopped(signal);if(context.receiptPresent){await unchangedReceipt(context,signal);await unlink(context.receipt);receiptChanged=true;}
    }
    onData('変更を確認しました。確定します。\n');stopped(signal);committed=true;
    if(backup){await plainPath(backup,{fileOnly:true});if(await digest(backup,'sha512',{executable:true})!==context.sha512)throw failure('操作は反映済みですが退避ファイルが変更されています。自動削除せず保持します。');await unlink(backup);backup=null;}
    onData(action==='削除'?'所有を確認した agy.exe だけを削除しました。設定・認証・PATH は保持しています。\n':'公式バイナリと導入記録を確認しました。設定・認証・PATH は保持しています。\n');
    return {code:0};
  }catch(error){
    if(!committed&&(backup||receiptChanged||(action==='導入'&&installerStarted))){
      try{
        await restoreReceipt();
        if(!backup){
          if(await plainPath(context.binary,{fileOnly:true})){
            if(installedHash&&await digest(context.binary,'sha512',{executable:true})===installedHash)await unlink(context.binary);
            else{await rename(context.binary,`${context.binary}.aidiy-failed-${randomUUID()}`);onData('未確認の導入ファイルは .aidiy-failed として保持しました。\n');}
          }
        }else{
          await plainPath(context.binary,{fileOnly:true});await plainPath(backup,{fileOnly:true});
          if(await digest(backup,'sha512',{executable:true})!==context.sha512)throw failure('退避ファイルが変更されています。');
          // 部分ダウンロードや検証不一致でも元を戻せるよう、失敗時の出力は削除せず別名に退避する。
          // リンク・junction・hardlink はこの前の plainPath で拒否して手動復旧へ回す。
          if(await exists(context.binary)){
            const failed=`${context.binary}.aidiy-failed-${randomUUID()}`;
            await rename(context.binary,failed);onData('失敗した導入ファイルを .aidiy-failed として保持しました。手動で確認してください。\n');
          }
          await rename(backup,context.binary);backup=null;onData('退避した元の agy.exe を復元しました。\n');
        }
      }catch{throw failure('処理に失敗し、元の配置の自動復元を確認できません。退避・復旧ファイルは削除せず保持しています。手動確認が必要です。');}
    }
    throw error;
  }finally{
    // 自分で作った一時フォルダだけ。導入先・設定・公式の共用 staging は再帰削除しない。
    if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>onData('一時ファイルの後片付けに失敗しました。\n'));
  }
}
