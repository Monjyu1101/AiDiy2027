// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Windows の固定 WinGet パッケージ。list の掲載だけを所有元の証明にしません。
// 所有登録: microsoft/winget-cli src/AppInstallerCLICore/PortableInstaller.cpp, AppInstallerCommonCore/PortableARPEntry.cpp
// OBS は https://github.com/obsproject/bouf/blob/master/extra/nsis/mp-installer.nsi の通常 /S（任意の設定削除を選択しない）。
import * as filesystem from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {resolveProgram} from '../診断/probes.mjs';

export const WINGET_PACKAGES=Object.freeze({ffmpeg:'Gyan.FFmpeg',ffprobe:'Gyan.FFmpeg',ffplay:'Gyan.FFmpeg',ollama:'Ollama.Ollama',obs:'OBSProject.OBSStudio',chrome:'Google.Chrome'});
const SOURCE='Microsoft.Winget.Source_8wekyb3d8bbwe',SOURCE_URL='https://cdn.winget.microsoft.com/cache';
const ACTIONS=['導入','再導入','削除'],contexts=new WeakMap(),win=path.win32;
const failure=message=>Object.assign(Error(message),{status:409});
const packageFor=id=>typeof id==='string'&&Object.hasOwn(WINGET_PACKAGES,id)?WINGET_PACKAGES[id]:null;
const environment=(env,key)=>Object.entries(env).find(([name])=>name.toUpperCase()===key.toUpperCase())?.[1];
const normal=value=>typeof value==='string'?win.normalize(value).replace(/\\+$/,'').toLowerCase():'';
const same=(a,b)=>Boolean(a&&b)&&normal(a)===normal(b);
const absolute=value=>typeof value==='string'&&/^[a-z]:[\\/]/i.test(value)&&!/[\x00-\x1f<>|?*]/.test(value)&&!value.slice(2).includes(':');
const join=(root,...parts)=>absolute(root)?win.join(root,...parts):null;
const groups=Object.freeze({ffmpeg:['ffmpeg','ffprobe','ffplay'],ollama:['ollama'],obs:['obs'],chrome:['chrome']});
// 利用者データ（モデル・ブラウザープロファイル）を抱えるため、未導入時の新規導入だけを行う。
const INSTALL_ONLY=new Set(['ollama','chrome']);
const groupFor=id=>['ffmpeg','ffprobe','ffplay'].includes(id)?'ffmpeg':id;
const processNames=Object.freeze({ffmpeg:['ffmpeg.exe','ffprobe.exe','ffplay.exe'],ollama:['ollama.exe','ollama app.exe'],obs:['obs64.exe','obs32.exe','obs-browser-page.exe'],chrome:['chrome.exe']});
const descriptions={ffmpeg:'FFmpeg 一式（ffmpeg / ffprobe / ffplay）をまとめて操作します。',ollama:'モデル保持を保証できないため、Ollama は新規導入だけに対応します。',obs:'OBS 本体だけを操作し、設定・プロファイル・シーン・録画は削除しません。アプリ内に追加したプラグインは再導入が必要になる場合があります。',chrome:'Google Chrome の新規導入だけに対応します。プロファイル・拡張機能・同期データを守るため、再導入・削除は自動実行しません。'};
const terms={ffmpeg:'https://ffmpeg.org/legal.html',ollama:'https://github.com/ollama/ollama/blob/main/LICENSE',obs:'https://github.com/obsproject/obs-studio/blob/master/COPYING',chrome:'https://www.google.com/chrome/terms/'};
const baseFor=id=>({id,パッケージ:packageFor(id),説明:descriptions[groupFor(id)],関連項目:groups[groupFor(id)],規約URL:terms[groupFor(id)],確認説明:'公式の winget 配布元を使用します。導入先・PATH が標準インストーラーにより変更され、管理者の承認画面が出る場合があります。利用規約の追加承諾や昇格が必要な場合は自動回避せず停止します。再導入は削除後に導入するため、途中で失敗すると本体が未導入になります。'});

// 固定の読み取りだけ。入力値の連結、コマンドラインの取得、ExecutionPolicy 変更はしない。
export const WINGET_INSPECTION_SCRIPT=String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rows = @(); $registryKnown = $true; $processKnown = $true; $names = @()
$specs = @(@('CurrentUser','Registry64','user'),@('LocalMachine','Registry64','machine'),@('LocalMachine','Registry32','machine'))
foreach ($spec in $specs) {
  $base = $null; $root = $null
  try {
    $hive = [System.Enum]::Parse([Microsoft.Win32.RegistryHive],[string]$spec[0]); $view = [System.Enum]::Parse([Microsoft.Win32.RegistryView],[string]$spec[1])
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
    $root = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall',$false)
    if ($null -eq $root) { continue }
    foreach ($key in $root.GetSubKeyNames()) {
      $item = $null
      try {
        $item = $root.OpenSubKey($key,$false)
        if ($null -eq $item) { throw 'Registry entry changed' }
        $name = [string]$item.GetValue('DisplayName',''); $pkg = [string]$item.GetValue('WinGetPackageIdentifier','')
        if ($name -notmatch '(?i)ffmpeg|ollama|obs studio|^google chrome$' -and $pkg -notin @('Gyan.FFmpeg','Ollama.Ollama','OBSProject.OBSStudio','Google.Chrome')) { continue }
        $rows += [pscustomobject]@{scope=$spec[2];view=$spec[1];key=$key;name=$name;publisher=[string]$item.GetValue('Publisher','');version=[string]$item.GetValue('DisplayVersion','');installLocation=[string]$item.GetValue('InstallLocation','');uninstallString=[string]$item.GetValue('UninstallString','');quietUninstallString=[string]$item.GetValue('QuietUninstallString','');packageIdentifier=$pkg;sourceIdentifier=[string]$item.GetValue('WinGetSourceIdentifier','');installerType=[string]$item.GetValue('WinGetInstallerType','')}
      } finally { if ($null -ne $item) { $item.Dispose() } }
    }
  } catch { $registryKnown = $false } finally { if ($null -ne $root) { $root.Dispose() }; if ($null -ne $base) { $base.Dispose() } }
}
try {
  $names = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe' OR Name='ffprobe.exe' OR Name='ffplay.exe' OR Name='ollama.exe' OR Name='ollama app.exe' OR Name='obs64.exe' OR Name='obs32.exe' OR Name='obs-browser-page.exe' OR Name='chrome.exe'" | ForEach-Object { [string]$_.Name })
} catch { $processKnown = $false }
[pscustomobject]@{schema=1;registryKnown=$registryKnown;processKnown=$processKnown;registrations=@($rows);processes=@($names)} | ConvertTo-Json -Depth 5 -Compress
`;

function commandOK(result){return result&&result.code===0&&!result.error&&!result.cancelled&&!result.timedOut&&!result.overflow;}
function checkResult(result){
  if(result?.cancelled)throw failure('操作を中止しました。');
  if(result?.timedOut)throw failure('実行時間の上限に達したため停止しました。');
  if(result?.overflow)throw failure('出力の上限に達したため停止しました。');
  if(!commandOK(result))throw failure(`winget が完了しませんでした（終了コード ${result?.code??'起動不可'}）。利用規約・権限・配布元・実行ログを確認してください。`);
}
async function readCommand(run,executable,args,env){
  let text='';const result=await run({executable,args,env,platform:'win32',timeout:20000,outputLimit:1024*1024,onData:chunk=>{text+=chunk;}});
  return {result,text:stripVTControlCharacters(text).replace(/^\uFEFF/,'').trim()};
}
function registryMatches(row,group){
  if(row.packageIdentifier===WINGET_PACKAGES[groups[group][0]])return true;
  const names={ffmpeg:/ffmpeg/i,ollama:/ollama/i,obs:/obs studio/i,chrome:/^google chrome$/i};
  return names[group].test(row.name||'');
}
function rootsFor(group,env,scope){
  const local=environment(env,'LOCALAPPDATA'),program=environment(env,'PROGRAMFILES'),program86=environment(env,'PROGRAMFILES(X86)');
  if(group==='ffmpeg')return (scope==='user'?[join(local,'Microsoft','WinGet','Packages')]:[join(program,'WinGet','Packages'),join(program86,'WinGet','Packages')]).filter(Boolean).map(root=>join(root,`${WINGET_PACKAGES[groups[group][0]]}_${SOURCE}`));
  if(group==='obs')return scope==='machine'?[join(program,'obs-studio')].filter(Boolean):[];
  if(group==='chrome')return (scope==='user'?[join(local,'Google','Chrome','Application')]:[join(program,'Google','Chrome','Application'),join(program86,'Google','Chrome','Application')]).filter(Boolean);
  return [join(local,'Programs','Ollama')].filter(Boolean);
}
async function plainDirectory(directory,io,{create=false,allowMissing=false}={}){
  if(!absolute(directory))throw failure('標準の導入先を確認できません。');
  const root=win.parse(directory).root,parts=win.relative(root,directory).split('\\').filter(Boolean);let current=root;
  for(const part of parts){
    current=win.join(current,part);let info;
    try{info=await io.lstat(current);}catch(error){if(error.code==='ENOENT'&&allowMissing)return directory;if(error.code!=='ENOENT'||!create)throw error;await io.mkdir(current,{mode:0o700});info=await io.lstat(current);}
    if(!info.isDirectory()||info.isSymbolicLink()||!same(await io.realpath(current),current))throw failure('リンク・ジャンクションを含む導入先は自動操作しません。');
  }
  return directory;
}
async function fileIdentity(filename,io,{hash=true}={}){
  await plainDirectory(win.dirname(filename),io);const info=await io.lstat(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink>1||info.size>512*1024*1024||!same(await io.realpath(filename),filename))throw failure('実行ファイルの実体を確認できません。');
  return hash?{path:normal(filename),sha256:createHash('sha256').update(await io.readFile(filename)).digest('hex')}:{path:normal(filename),size:info.size};
}
function nativeIdentity(row,group){
  return group==='obs'&&row.scope==='machine'&&row.key==='OBS Studio'&&row.publisher==='OBS Project'&&/^OBS Studio(?: \([^)]+\))?$/.test(row.name);
}
function uninstallPath(value){const match=typeof value==='string'&&value.match(/^"([^"\r\n]+\.exe)"(?:\s+(?:\/SILENT|\/VERYSILENT|\/SUPPRESSMSGBOXES|\/NORESTART|\/S))*\s*$/i);return match?.[1]||null;}
async function candidateProof(group,row,resolved,env,io){
  const declaredRoot=row.installLocation||(group==='obs'?win.dirname(uninstallPath(row.uninstallString)||''):null);
  if(!['user','machine'].includes(row.scope)||!['Registry32','Registry64'].includes(row.view)||!rootsFor(group,env,row.scope).some(root=>same(root,declaredRoot)))return null;
  const root=win.normalize(declaredRoot);await plainDirectory(root,io);
  const files=[];let portable=false;
  if(group==='ffmpeg'){
    portable=true;
    if(row.packageIdentifier!==WINGET_PACKAGES[groups[group][0]]||row.sourceIdentifier!==SOURCE||row.installerType!=='portable'||row.key!==`${row.packageIdentifier}_${SOURCE}`||row.uninstallString!==`winget uninstall --product-code ${row.key}`)return null;
    let parent;
    for(const id of groups[group]){
      if(!resolved[id])return null;
      const target=await io.realpath(resolved[id]),relative=win.relative(root,target);
      if(!/^ffmpeg-[\w.+-]+-full_build\\bin\\(?:ffmpeg|ffprobe|ffplay)\.exe$/i.test(relative))return null;
      if(win.basename(target).toLowerCase()!==`${id}.exe`)return null;
      if(parent&&!same(parent,win.dirname(target)))return null;parent=win.dirname(target);files.push(await fileIdentity(target,io,{hash:false}));
    }
  }else{
    if(!nativeIdentity(row,group)||!resolved[group])return null;
    // 後から portable 化した配置は本体内に設定を持つため、通常の削除保証を適用しない。
    for(const marker of ['portable_mode','portable_mode.txt','config']){
      try{await io.lstat(win.join(root,marker));return null;}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const cli=win.join(root,'bin\\64bit\\obs64.exe');
    if(!same(await io.realpath(resolved[group]),cli))return null;
    const uninstaller=uninstallPath(row.uninstallString);
    if(!uninstaller||!same(win.dirname(uninstaller),root)||win.basename(uninstaller).toLowerCase()!=='uninstall.exe')return null;
    if(!same(uninstallPath(row.uninstallString),uninstaller))return null;
    if(row.quietUninstallString&&!same(uninstallPath(row.quietUninstallString),uninstaller))return null;
    files.push(await fileIdentity(cli,io));
    files.push(await fileIdentity(uninstaller,io));
  }
  return {schema:1,package:WINGET_PACKAGES[groups[group][0]],source:SOURCE,scope:row.scope,view:row.view,key:row.key,name:row.name,publisher:row.publisher,version:row.version,root:normal(root),uninstallString:row.uninstallString,quietUninstallString:row.quietUninstallString||'',portable,files};
}
const receiptRoot=env=>join(environment(env,'LOCALAPPDATA'),'AiDiy','diag-install-receipts');
async function receiptExists(group,env,io){
  try{const root=receiptRoot(env);await plainDirectory(root,io,{allowMissing:true});await io.lstat(win.join(root,`${group}.json`));return true;}catch(error){return error.code!=='ENOENT';}
}
async function readReceipt(group,env,io){
  try{const root=receiptRoot(env);await plainDirectory(root,io);const file=win.join(root,`${group}.json`),info=await io.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink>1||info.size>16384||!same(await io.realpath(file),file))return null;return JSON.parse(await io.readFile(file,'utf8'));}catch{return null;}
}
async function saveReceipt(group,proof,env,io){
  const root=receiptRoot(env);await plainDirectory(root,io,{create:true});const file=win.join(root,`${group}.json`);
  // 古い記録を推測で上書きしない。削除成功後の記録だけを回収する。
  const handle=await io.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(proof));}finally{await handle.close();}
}
async function removeReceipt(group,proof,env,io){
  const receipt=await readReceipt(group,env,io);if(!receipt)return;
  if(JSON.stringify(receipt)!==JSON.stringify(proof))throw failure('導入記録が変わったため、自動削除しません。');
  await io.unlink(win.join(receiptRoot(env),`${group}.json`));
}

export async function inspectWinget({entries=[],env=process.env,platform=process.platform,run,resolve=resolveProgram,io=filesystem}={}){
  const supported=entries.filter(entry=>packageFor(entry.id)),disabled=reason=>({items:supported.map(entry=>({...baseFor(entry.id),操作:[],理由:reason})),context:null});
  if(!supported.length)return {items:[],context:null};
  if(platform!=='win32')return disabled('winget による操作は Windows 専用です。');
  if(typeof run!=='function')return disabled('winget の実行環境を確認できません。');
  try{
    let executable=await resolve({id:'winget',commands:['winget.exe'],paths:{win32:['$LOCALAPPDATA/Microsoft/WindowsApps/winget.exe']}},{env,platform});
    const alias=join(environment(env,'LOCALAPPDATA'),'Microsoft','WindowsApps','winget.exe');
    // App Installer の実行エイリアスは stat が EACCES になり探索で見つからない。標準位置だけ lstat で存在を確認して使う。
    if(!executable&&alias){try{const info=await io.lstat(alias);if(info.isFile()||info.isSymbolicLink())executable=alias;}catch{}}
    if(!executable||!same(executable,alias))return disabled('標準の winget が見つかりません。Windows の App Installer を確認してください。');
    const sourceRead=await readCommand(run,executable,['source','export','--name','winget','--disable-interactivity'],env);
    if(!commandOK(sourceRead.result))return disabled('winget の配布元を確認できません。利用規約や権限を確認してください。');
    const source=JSON.parse(sourceRead.text);
    if(source.Name!=='winget'||(source.Argument??source.Arg)!==SOURCE_URL||source.Type!=='Microsoft.PreIndexed.Package'||source.Identifier!==SOURCE)return disabled('winget という名前の配布元が公式と一致しないため、自動操作しません。');
    const system=environment(env,'SystemRoot');if(!absolute(system))return disabled('Windows の標準システムパスを確認できません。');
    const metadataRead=await readCommand(run,win.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',WINGET_INSPECTION_SCRIPT],env);
    if(!commandOK(metadataRead.result))return disabled('Windows の導入元と実行中プロセスを確認できません。');
    const metadata=JSON.parse(metadataRead.text);
    if(metadata.schema!==1||metadata.registryKnown!==true||!Array.isArray(metadata.registrations)||!Array.isArray(metadata.processes)||metadata.registrations.length>1024)return disabled('Windows の導入登録を完全に確認できません。');
    const list=await readCommand(run,executable,['list','--source','winget','--disable-interactivity'],env);
    const noApplications=Number.isInteger(list.result?.code)&&(list.result.code>>>0)===0x8a150014&&!list.result.error&&!list.result.cancelled&&!list.result.timedOut&&!list.result.overflow;
    if(!commandOK(list.result)&&!noApplications)return disabled('winget の導入一覧を確認できません。利用規約・権限・ネットワークを確認してください。');
    const resolved={};
    // FFmpeg は1行だけの要求でも全3本の別導入元・実行状態を検査する。
    for(const id of Object.keys(WINGET_PACKAGES)){
      const entry=entries.find(item=>item.id===id)||{id,commands:[id==='obs'?'obs64.exe':`${id}.exe`]};
      resolved[id]=await resolve(entry,{env,platform});
    }
    const evidence={},items=[];
    for(const [group,ids] of Object.entries(groups)){
      if(!ids.some(id=>supported.some(entry=>entry.id===id)))continue;
      const pkg=WINGET_PACKAGES[ids[0]],rows=metadata.registrations.filter(row=>registryMatches(row,group));
      const listed=list.text.split(/\r?\n/).filter(line=>line.split(/\s+/).includes(pkg)).length;
      const running=metadata.processes.some(name=>processNames[group].includes(String(name).toLowerCase()));
      let proof=null,owned=false,actions=[],reason;
      if(!rows.length&&!listed&&!ids.some(id=>resolved[id])){
        // 既存の標準配置・記録を未導入と誤認しない。
        let residual=false;
        for(const scope of ['user','machine'])for(const root of rootsFor(group,env,scope))try{await plainDirectory(root,io,{allowMissing:true});await io.lstat(root);residual=true;}catch(error){if(error.code!=='ENOENT')residual=true;}
        if(residual||await receiptExists(group,env,io))reason='標準導入先または導入記録が残っています。状態を確認してから操作してください。';
        else actions=['導入'];
      }else if(INSTALL_ONLY.has(group))reason={ollama:'モデル・設定の保持を保証できないため、Ollama の再導入・削除は自動実行しません。',chrome:'プロファイル・拡張機能を保護するため、Chrome の再導入・削除は自動実行しません。'}[group];
      else if(rows.length!==1||listed!==1)reason='複数の導入先、手動導入、または一致しない登録があるため、自動操作しません。';
      else{
        try{proof=await candidateProof(group,rows[0],resolved,env,io);}catch{}
        const receipt=proof&&!proof.portable?await readReceipt(group,env,io):null;
        owned=Boolean(proof&&(proof.portable||receipt&&JSON.stringify(receipt)===JSON.stringify(proof)));
        if(!owned)reason=proof?'この Diag での導入記録を確認できません。手動・他方式の導入は元の方法で管理してください。':'導入登録と実行ファイルの所有元が一致しないため、自動操作しません。';
        else if(metadata.processKnown!==true)reason='実行中プロセスの確認に失敗したため、再導入・削除はできません。';
        else if(running)reason='対象アプリまたは関連プロセスが実行中です。終了後に再確認してください。';
        else actions=['再導入','削除'];
      }
      if(actions.length&&metadata.processKnown!==true){actions=[];reason='実行中プロセスを確認できないため、自動操作しません。';}
      if(actions.length&&running){actions=[];reason='対象アプリまたは関連プロセスが実行中です。終了後に再確認してください。';}
      evidence[group]={proof,owned,absent:!rows.length&&!listed&&!ids.some(id=>resolved[id]),scope:proof?.scope||(['obs','chrome'].includes(group)?'machine':'user'),actions};
      for(const id of ids)if(supported.some(entry=>entry.id===id))items.push({...baseFor(id),操作:actions,...reason?{理由:reason}:{}});
    }
    const context=Object.freeze({executable,lockKey:win.join(system,'AiDiy-winget-package-management'),evidence});
    contexts.set(context,{env,io,entries,resolve,run,refresh:(reader=run)=>inspectWinget({entries,env,platform,run:reader,resolve,io})});
    return {items,context};
  }catch{return disabled('winget の導入元を安全に確認できません。Windows の権限と登録情報を確認してください。');}
}

export async function executeWinget(entry,action,context,{env,platform=process.platform,run,signal,timeout=300000,onData=()=>{},onUncertain=()=>{}}={}){
  const pkg=packageFor(entry?.id),privateContext=contexts.get(context),group=groupFor(entry?.id),initial=context?.evidence?.[group];
  if(platform!=='win32'||!pkg||!ACTIONS.includes(action)||!privateContext||!initial?.actions.includes(action)||typeof run!=='function')throw failure('未対応または所有元未確認の winget 操作です。');
  env=env||privateContext.env;
  const cancelled=()=>{if(signal?.aborted)throw failure('操作を中止しました。');};
  const refresh=()=>privateContext.refresh(command=>run({...command,signal,onUncertain,timeout:Math.min(command.timeout??timeout,timeout)}));
  const steps=action==='再導入'?['uninstall','install']:[action==='削除'?'uninstall':'install'];let last;
  for(const step of steps){
    cancelled();
    // 表示後だけでなく、各変更の直前にも全登録・所有元・プロセスを取り直す。
    const fresh=await refresh(),current=fresh.context?.evidence?.[group];
    const needed=step==='uninstall'?'削除':'導入';
    if(!current?.actions.includes(needed)||(current.proof&&current.scope!==initial.scope))throw failure('導入状況・所有元・実行状態が変わりました。操作せず再確認します。');
    cancelled();
    const args=[step,'--id',pkg,'--exact','--source','winget','--scope',initial.scope,'--disable-interactivity','--silent'];
    if(step==='install')args.push('--no-upgrade');else if(current.proof?.portable)args.push('--preserve');
    last=await run({executable:fresh.context.executable,args,表示:`winget ${args.join(' ')}`,env,platform,signal,timeout,onData,onUncertain});checkResult(last);
    const after=await refresh(),post=after.context?.evidence?.[group];
    if(step==='uninstall'){
      if(!post?.absent)throw failure('削除後の登録または実行ファイルが残っています。再導入を続行しません。');
      if(!current.proof.portable)await removeReceipt(group,current.proof,privateContext.env,privateContext.io);
    }else if(group==='ffmpeg'){
      if(!post?.proof||!post.owned||post.proof.scope!==initial.scope)throw failure('導入は終了しましたが、標準の winget 所有情報を確認できませんでした。');
    }else if(group==='obs'){
      if(!post?.proof||post.proof.scope!==initial.scope)throw failure('導入は終了しましたが、標準の導入元を確認できず管理記録を保存できませんでした。');
      try{await saveReceipt(group,post.proof,privateContext.env,privateContext.io);}catch(error){if(error.status)throw error;throw failure('導入は終了しましたが、安全な管理記録を保存できませんでした。');}
    }
  }
  return last;
}
