// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 明示操作専用の導入管理。登録済みの固定プロバイダーだけを実行します。
import {acquireProcessInstallLock} from './process_lock.mjs';
import {createInstallProcessTracker,readWindowsInstallProcesses} from './process_state.mjs';
import {spawn,execFile} from 'node:child_process';
import {readFile,realpath,stat,lstat,mkdtemp,writeFile,rm,open,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {stripVTControlCharacters} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
import os from 'node:os';
import {resolveProgram,resolveProgramPaths,probe} from '../診断/probes.mjs';
import {WINGET_PACKAGES,inspectWinget,executeWinget} from './winget.mjs';
import {inspectAntigravity,executeAntigravity} from './antigravity.mjs';
import {inspectGrok,executeGrok} from './grok.mjs';
import {inspectRust,executeRust,inspectLlvmMingw,executeLlvmMingw} from './rust.mjs';
import {CODEX_COMPILE_ID,inspectCodexCompile,executeCodexCompile} from './codex_compile.mjs';
import {OPENCODE_LEGACY_PACKAGE,inspectOpenCodeNpm} from '../../../scripts/opencode-npm.mjs';

// _setup.py の共通セットアップと同じ4パッケージ。クライアントから名前・コマンドを受け取らない。
// OpenCode は 2.x から公式パッケージ名が opencode-ai から @opencode/cli へ変わった。
export const NPM_PACKAGES=Object.freeze({claude:'@anthropic-ai/claude-code',codex:'@openai/codex',copilot:'@github/copilot',opencode:'@opencode/cli'});
const packageFor=id=>typeof id==='string'&&Object.hasOwn(NPM_PACKAGES,id)?NPM_PACKAGES[id]:null;
const ACTIONS=['導入','再導入','削除'];
const providerFor=id=>packageFor(id)?'npm':typeof id==='string'&&Object.hasOwn(WINGET_PACKAGES,id)?'winget':id==='agy'?'antigravity':id==='grok'?'grok':id==='rust'?'rust':id==='llvm-mingw'?'llvmMingw':id===CODEX_COMPILE_ID?'codexCompile':null;
const affectedIds=id=>['ffmpeg','ffprobe','ffplay'].includes(id)?['ffmpeg','ffprobe','ffplay']:[id];
// 排他は項目（FFmpeg は3つ一式）単位。別の項目は同じ導入元でも並行して操作できる。
const lockScopeFor=id=>packageFor(id)||affectedIds(id)[0];
const overlaps=(a,b)=>affectedIds(a).some(id=>affectedIds(b).includes(id));
const JOB_LIMIT=40;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const noop=()=>{};
export const LOG_LIMIT=120000;

// 複数の Diag からも同じ導入先の同じパッケージを同時変更しない。異常終了で残ったロックを推測で削除しない。
export async function acquireInstallLock(prefix,{platform=process.platform,directory=os.tmpdir(),scope='',env=process.env,inspectProcesses}={}) {
  const resolved=await realpath(prefix).catch(()=>path.resolve(prefix));
  const key=createHash('sha256').update((platform==='win32'?resolved.toLowerCase():resolved)+(scope?`\0${scope}`:'')).digest('hex').slice(0,32);
  const file=path.join(directory,`aidiy-npm-${key}.lock`);
  if(platform==='win32'&&['rust','llvm-mingw'].includes(scope))return acquireProcessInstallLock(file,{scope,inspectProcesses:inspectProcesses||(()=>readWindowsInstallProcesses({env}))});
  let handle;
  try{handle=await open(file,'wx',0o600);await handle.writeFile(String(process.pid));}
  catch(error){if(handle){await handle.close();await unlink(file).catch(noop);}throw failure(error.code==='EEXIST'?'同じ導入先で別の操作が実行中、または前回の停止確認が必要です。':'導入操作の排他ロックを作成できません。',409);}
  let released=false;return async()=>{if(released)return;released=true;await handle.close();await unlink(file);};
}

export function installEnvironment(env=process.env,{discovery=false,ollama=false}={}) {
  const output={};
  for(const [key,value] of Object.entries(env))if(/^(PATH|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|SYSTEMROOT|WINDIR|SYSTEMDRIVE|COMSPEC|PROGRAMFILES(?:\(X86\))?|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY)$/i.test(key)||(discovery&&/^NPM_CONFIG_(PREFIX|USERCONFIG|GLOBALCONFIG)$/i.test(key))||(ollama&&/^OLLAMA_MODELS$/i.test(key)))output[key]=value;
  return {...output,NO_COLOR:'1',CI:'1',DO_NOT_TRACK:'1'};
}
export function safeInstallLog(text,env=process.env) {
  let value=stripVTControlCharacters(String(text)).replace(/\r(?!\n)/g,'\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
  for(const [key,secret] of Object.entries(env))if(/token|secret|password|api.?key|authorization/i.test(key)&&typeof secret==='string'&&secret.length>=6)value=value.split(secret).join('[非表示]');
  return value.replace(/(https?:\/\/)[^\s/@]+@/gi,'$1[非表示]@').replace(/(Bearer\s+)[\w.+/=-]+/gi,'$1[非表示]').replace(/((?:_authToken|password|token)\s*[=:]\s*)[^\s]+/gi,'$1[非表示]');
}

// shell は使用しない。中止・期限超過後も終了確認まで待ち、停止未確認では排他を解除しない。
export function runInstallCommand({executable,args,cwd,env,signal,onData=noop,onUncertain=noop,timeout=300000,outputLimit=4*1024*1024,spawnFn=spawn,platform=process.platform,killTree,isTreeRunning,readProcesses,windowsVerbatimArguments=false}) {
  return new Promise(resolve=>{
    let child,done=false,timedOut=false,stopped=false,overflow=false,processError=false,parentClosed=false,closeCode=null,bytes=0,timer,forceTimer,uncertainTimer,treeTimer,processTracker;
    const treeGone=async()=>{
      if(!child?.pid)return true;
      if(isTreeRunning){try{return (await isTreeRunning(child))===false;}catch{return false;}}
      if(processTracker)return (await processTracker.running())===false;
      try{process.kill(-child.pid,0);return false;}catch(error){return error.code==='ESRCH';}
    };
    const check=async()=>{
      if(done)return;
      const gone=await treeGone();
      if(done)return;
      if(parentClosed&&gone){finish(closeCode,processError);return;}
      clearTimeout(treeTimer);treeTimer=setTimeout(check,1000);
    };
    const kill=force=>{
      if(!child?.pid)return;
      if(killTree){try{Promise.resolve(killTree(child,force)).then(()=>{check();},noop);}catch{}return;}
      if(platform==='win32'){
        if(parentClosed)return; // 終了済み親 PID を再利用した別プロセスを停止しない。
        const taskkill=path.join(env?.SystemRoot||env?.SYSTEMROOT||process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
        execFile(taskkill,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000},()=>{check();});
      }else try{process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}catch{}
    };
    const stop=()=>{if(done||stopped)return;stopped=true;kill(false);forceTimer=setTimeout(()=>kill(true),1000);uncertainTimer=setTimeout(()=>{if(!done)onUncertain();},6000);};
    const finish=(code,error=false)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(forceTimer);clearTimeout(uncertainTimer);clearTimeout(treeTimer);signal?.removeEventListener('abort',stop);resolve({code,error,cancelled:Boolean(signal?.aborted),timedOut,overflow});};
    if(signal?.aborted){finish(null);return;}
    try{child=spawnFn(executable,args,{cwd,env,shell:false,windowsHide:true,...(platform==='win32'&&windowsVerbatimArguments?{windowsVerbatimArguments:true}:{}),detached:platform!=='win32',stdio:['ignore','pipe','pipe']});}
    catch{finish(null,true);return;}
    if(platform==='win32'&&!isTreeRunning&&child.pid){processTracker=createInstallProcessTracker(child.pid,{read:readProcesses||(()=>readWindowsInstallProcesses({env}))});check();}
    signal?.addEventListener('abort',stop,{once:true});
    for(const stream of [child.stdout,child.stderr])if(stream){
      const decoder=new StringDecoder('utf8');
      stream.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>outputLimit){overflow=true;stop();return;}onData(decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));});
      stream.once('end',()=>{if(!overflow)onData(decoder.end());});
    }
    child.once('error',()=>{processError=true;if(child.pid)stop();else finish(null,true);});
    child.once('close',code=>{parentClosed=true;closeCode=code;check();});
    timer=setTimeout(()=>{timedOut=true;stop();},timeout);
    if(signal?.aborted)stop();
  });
}

export async function findNpm({env=process.env,platform=process.platform,resolve=resolveProgram,run=runInstallCommand}={}) {
  const selected=await resolve({id:'npm',commands:['npm','npm.cmd']},{env,platform});
  if(!selected)throw failure('npm が見つかりません。Node.js / npm を導入してから再確認してください。',409);
  const cli=platform==='win32'?path.join(path.dirname(selected),'node_modules','npm','bin','npm-cli.js'):await realpath(selected);
  if(path.basename(cli)!=='npm-cli.js')throw failure('npm の固定 CLI 本体を確認できません。',409);
  const manifest=JSON.parse(await readFile(path.join(path.dirname(cli),'..','package.json'),'utf8'));
  if(manifest.name!=='npm')throw failure('npm の配置を確認できません。',409);
  const environment=installEnvironment(env,{discovery:true});
  const read=async args=>{
    let text='';const result=await run({executable:process.execPath,args:[cli,...args],cwd:os.tmpdir(),env:environment,timeout:10000,outputLimit:65536,onData:chunk=>text+=chunk});
    if(result.code!==0||result.error||result.timedOut||result.overflow)throw failure('npm の導入先を確認できません。',409);
    const value=text.trim();if(!path.isAbsolute(value)||value.includes('\n')||value.includes('\r'))throw failure('npm の導入先が不正です。',409);
    return value;
  };
  const prefix=await read(['prefix','--global','--loglevel=error']);
  const root=await read(['root','--global','--loglevel=error']);
  // 異なる導入先を推測で操作しない。
  const expected=platform==='win32'?path.join(prefix,'node_modules'):path.join(prefix,'lib','node_modules');
  if(path.resolve(root)!==path.resolve(expected))throw failure('npm の導入先が標準構成ではないため、自動操作しません。',409);
  return {executable:process.execPath,cli,prefix,root};
}

// 現在の npm prefix と、既に PATH にある Windows npm shim の prefix は異なる場合がある。
// 任意の場所を探索せず、検出済み shim と同じ prefix の package/bin 所有を再検証する。
export async function npmCapability(entry,npm,{env=process.env,platform=process.platform,resolve=resolveProgram,resolveCandidates=resolveProgramPaths}={}) {
  if(!packageFor(entry.id))return {id:entry.id,操作:[],理由:'安全な導入・削除コマンドが登録されていません。'};
  const executable=await resolve(entry,{env,platform});
  const inspect=(target,context=npm)=>inspectNpmAtPrefix(entry,context,{env,platform,resolve:async()=>target});
  const current=await inspect(executable);
  if(current.操作.length||platform!=='win32'||!executable)return current;
  const equivalent=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
  const atShimPrefix=async target=>{
    const prefix=path.dirname(target);
    const alternate=equivalent(prefix,npm.prefix)?npm:{...npm,prefix,root:path.join(prefix,'node_modules')};
    const verified=await inspect(target,alternate).catch(()=>null);
    if(!verified?.操作.includes('再導入'))return null;
    return equivalent(prefix,npm.prefix)?verified:{...verified,npmPrefix:prefix,npmRoot:alternate.root,
      説明:`${verified.説明} 検出した npm ランチャーの導入先: ${prefix}`};
  };
  if(!equivalent(path.dirname(executable),npm.prefix)){
    const primary=await atShimPrefix(executable);
    if(primary)return primary;
  }
  // PATH で先に見つかる exe が別配布でも、並存する正規 npm shim を検証して更新できる。
  // 元の exe は操作しない。確認できた Copilot の npm 版だけは削除も可能。複数の所有元は推測しない。
  const commands=[`${entry.id}.cmd`,`${entry.id}.ps1`];
  const appData=Object.entries(env).find(([key])=>key.toUpperCase()==='APPDATA')?.[1];
  const standardCopilotPrefix=entry.id==='copilot'&&typeof appData==='string'&&path.isAbsolute(appData)
    ? path.join(appData,'npm') : null;
  if(standardCopilotPrefix&&!equivalent(standardCopilotPrefix,npm.prefix)){
    const alternate={...npm,prefix:standardCopilotPrefix,root:path.join(standardCopilotPrefix,'node_modules')};
    const native=await inspect(executable,alternate).catch(()=>null);
    if(native?.操作.includes('再導入'))return {...native,npmPrefix:alternate.prefix,npmRoot:alternate.root};
  }
  const candidates=new Set([...(await resolveCandidates({...entry,commands},{env,platform})),
    ...[npm.prefix,standardCopilotPrefix].filter(Boolean).flatMap(prefix=>commands.map(name=>path.join(prefix,name)))]);
  const alternatives=new Map();
  for(const target of candidates){
    if(equivalent(target,executable)||!/\.(cmd|ps1)$/i.test(target))continue;
    const verified=await atShimPrefix(target);
    if(!verified||verified.移行元)continue;
    const prefix=verified.npmPrefix||npm.prefix;
    const copilot=entry.id==='copilot';
    alternatives.set(path.resolve(prefix).toLowerCase(),{...verified,操作:copilot?['再導入','削除']:['再導入'],
      ...(copilot?{npmCopilot別経路:true,確認説明:`対象は npm 版 @github/copilot（${prefix}）のみです。PATH で先に見つかる別配布の Copilot は残ります。`}:{}),
      説明:`${verified.説明} PATH 上の別の実行ファイルは変更しません。`,
      再導入説明:`${verified.再導入説明} PATH で先に見つかる別の実行ファイルは更新されません。`});
  }
  if(alternatives.size===1)return [...alternatives.values()][0];
  if(!alternatives.size&&entry.id==='copilot'&&await isVsCodeCopilotShim(executable,env)){
    const fresh=await inspect(null);
    if(fresh.操作.includes('導入')&&await copilotNpmLaunchersAbsent(npm.prefix)){
      return {...fresh,npmCopilotVsCode導入:true,状況:'VS Code の起動用ファイルを検出。npm 版は未導入です。',
        確認説明:`npm 版 @github/copilot を ${npm.prefix} に追加します。VS Code の起動用ファイル・PATH 順序は変更しません。`};
    }
    return {...current,理由:'VS Code の起動用ファイルを検出しましたが、npm 版の状態を確定できません。npm の導入先と残っている起動ファイルを確認してください。'};
  }
  return current;
}

// VS Code 同梱の起動用ファイルは npm の実体と別物。既知の Windows 配置だけを区別する。
async function isVsCodeCopilotShim(executable,env){
  if(!['copilot','copilot.exe'].includes(path.basename(executable).toLowerCase()))return false;
  const paths=Object.fromEntries(Object.entries(env).map(([key,value])=>[key.toUpperCase(),value]));
  const roots=[[paths.LOCALAPPDATA,'Programs'],[paths.PROGRAMFILES],[paths['PROGRAMFILES(X86)']]];
  return roots.some(([root,...relative])=>typeof root==='string'&&path.isAbsolute(root)
    &&path.resolve(path.dirname(executable)).toLowerCase()===path.resolve(root,...relative,'Microsoft VS Code','bin','copilot-shim').toLowerCase())
    &&(await lstat(executable).catch(()=>null))?.isFile()===true;
}

async function copilotNpmLaunchersAbsent(prefix){
  for(const name of ['copilot','copilot.cmd','copilot.ps1','copilot.exe','copilot.bat','copilot.com']){
    try{await lstat(path.join(prefix,name));return false;}catch(error){if(error.code!=='ENOENT')return false;}
  }
  return true;
}

// Copilot の npm 親パッケージが Windows 向け native package を同梱する配布形式。
async function ownsCopilotNative(manifest,directory,executable){
  if(!executable||path.basename(executable).toLowerCase()!=='copilot.exe')return false;
  for(const arch of ['x64','arm64']){
    const name=`@github/copilot-win32-${arch}`;
    const version=manifest.optionalDependencies?.[name];
    if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))continue;
    const child=path.join(directory,'node_modules',...name.split('/')),bin=path.join(child,'copilot.exe');
    if(path.resolve(executable).toLowerCase()!==path.resolve(bin).toLowerCase())continue;
    try{
      const binary=await lstat(bin);
      if(!binary.isFile()||binary.nlink!==1||await realpath(bin)!==path.join(await realpath(directory),'node_modules',...name.split('/'),'copilot.exe'))return false;
      const metadata=JSON.parse(await readFile(path.join(child,'package.json'),'utf8'));
      return metadata.name===name&&metadata.version===version&&metadata.bin?.[`copilot-win32-${arch}`]==='copilot.exe';
    }catch{return false;}
  }
  return false;
}

async function inspectNpmAtPrefix(entry,npm,{env=process.env,platform=process.platform,resolve=resolveProgram}={}) {
  const pkg=packageFor(entry.id);
  if(!pkg)return {id:entry.id,操作:[],理由:'安全な導入・削除コマンドが登録されていません。'};
  const base={id:entry.id,パッケージ:pkg,説明:'npm のグローバルパッケージだけを操作します。認証・設定・履歴は削除しません。',再導入説明:`npm install --global ${pkg}@latest を1回実行して更新・再導入します。事前のアンインストールは行いません。`};
  const executable=await resolve(entry,{env,platform});
  if(entry.id==='opencode'){
    try{
      const {installed}=await inspectOpenCodeNpm(npm,{platform,executable});
      const legacy=installed.includes(OPENCODE_LEGACY_PACKAGE);
      return {...base,導入済みパッケージ:installed,操作:installed.length?['再導入','削除']:['導入'],
        ...(legacy?{移行元:OPENCODE_LEGACY_PACKAGE,
          説明:`${base.説明} 導入済み: ${installed.join(' / ')}。削除は導入済みパッケージだけを対象にします。`,
          再導入説明:`所有を確認した ${OPENCODE_LEGACY_PACKAGE} を npm uninstall --global で削除してから、npm install --global ${pkg}@latest で V2 へ移行します。導入に失敗すると OpenCode が利用できなくなる場合があります。`}:{}),};
    }catch{return {...base,操作:[],理由:'OpenCode のパッケージ・実行ファイルの所有元を確認できないため、自動操作しません。元の導入方法と配置を確認してください。'};}
  }
  const directory=path.join(npm.root,...pkg.split('/'));
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));}
  catch(error){
    if(error.code==='ENOENT'&&!executable){
      try{await lstat(directory);}catch(missing){if(missing.code==='ENOENT')return {...base,操作:['導入']};}
    }
    return {...base,操作:[],理由:executable?'npm 管理外の実行ファイルのため、自動操作しません。':'導入済みパッケージの所有情報を確認できません。'};
  }
  if(manifest.name!==pkg)return {...base,操作:[],理由:'パッケージの所有情報が一致しません。'};
  const realRoot=await realpath(npm.root),realDirectory=await realpath(directory);
  const relativeDirectory=path.relative(realRoot,realDirectory);
  if(!relativeDirectory||relativeDirectory.startsWith('..')||path.isAbsolute(relativeDirectory))return {...base,操作:[],理由:'npm link 等の外部配置は自動操作しません。'};
  if(entry.id==='copilot'&&platform==='win32'&&await ownsCopilotNative(manifest,directory,executable))return {...base,操作:['再導入','削除']};
  // 欠損したランチャーも、所有が確認できるパッケージとして再導入・削除できる。
  if(!executable)return {...base,操作:['再導入','削除']};
  const bins=typeof manifest.bin==='string'?{[pkg.split('/').pop()]:manifest.bin}:manifest.bin;
  if(!bins||typeof bins!=='object')return {...base,操作:[],理由:'実行ファイルの所有元を確認できません。'};
  for(const [name,relative] of Object.entries(bins)){
    if(typeof relative!=='string'||!/^[-\w.]+$/.test(name)||path.isAbsolute(relative))continue;
    const target=path.resolve(directory,relative),within=path.relative(directory,target);
    if(within.startsWith('..')||path.isAbsolute(within))continue;
    try{
      const realTarget=await realpath(target),relativeTarget=path.relative(realDirectory,realTarget);
      if(!relativeTarget||relativeTarget.startsWith('..')||path.isAbsolute(relativeTarget))continue;
      if(await realpath(executable)===realTarget)return {...base,操作:['再導入','削除']};
      if(platform==='win32'&&['', '.cmd', '.ps1'].some(ext=>path.resolve(executable).toLowerCase()===path.join(npm.prefix,name+ext).toLowerCase())){
        const launcher=await lstat(executable);
        if(!launcher.isFile()||launcher.nlink!==1)continue;
        const shim=(await readFile(executable,'utf8')).split(/\r?\n/).filter(line=>!/^\s*(?:@?rem\b|::|#)/i.test(line)).join('\n').replaceAll('\\','/').toLowerCase();
        // bin の "./bin/x.exe" 表記も、npm の shim と同じ正規化済みパスで照合する。
        const packageTarget=`node_modules/${pkg}/${path.posix.normalize(relative.replaceAll('\\','/'))}`.toLowerCase();
        const pattern=executable.toLowerCase().endsWith('.cmd')?/"%(?:~dp0|dp0%)\/([^"\r\n]+)"\s+%\*/g:executable.toLowerCase().endsWith('.ps1')?/"\$basedir\/([^"\r\n]+)"\s+\$args/g:/"\$basedir\/([^"\r\n]+)"\s+"\$@"/g;
        const targets=[...shim.matchAll(pattern)].map(match=>match[1]);
        if((await stat(target)).isFile()&&targets.length&&targets.every(value=>value===packageTarget))return {...base,操作:['再導入','削除']};
      }
    }catch{}
  }
  return {...base,操作:[],理由:'検出された実行ファイルは別の導入元です。元の方法で管理してください。'};
}

export function npmCommands(npm,id,action,configFile,capability) {
  const pkg=packageFor(id);if(!pkg||!ACTIONS.includes(action))throw failure('未対応の導入操作です。');
  const options=['--global',`--prefix=${npm.prefix}`,'--registry=https://registry.npmjs.org/',`--userconfig=${configFile}`,`--globalconfig=${configFile}.global`,'--no-audit','--no-fund','--no-update-notifier','--foreground-scripts'];
  const command=(step,packages)=>({executable:npm.executable,args:[npm.cli,step,...options,...packages],表示:`npm ${step} --global ${packages.join(' ')}`});
  // 名前変更を伴う OpenCode V1 だけは、直前に所有確認した旧パッケージを先に除く。
  if(id==='opencode'&&capability?.移行元===OPENCODE_LEGACY_PACKAGE){
    const installed=capability.導入済みパッケージ;
    if(!Array.isArray(installed)||!installed.includes(OPENCODE_LEGACY_PACKAGE)||installed.some(name=>![pkg,OPENCODE_LEGACY_PACKAGE].includes(name)))throw failure('OpenCode の移行元を確認できません。',409);
    if(action==='削除')return [command('uninstall',installed)];
    return [command('uninstall',[OPENCODE_LEGACY_PACKAGE]),command('install',[pkg+'@latest'])];
  }
  // 通常の npm 再導入は既存パッケージを削除せず、install だけで更新する。
  const step=action==='削除'?'uninstall':'install';
  return [command(step,[step==='install'?pkg+'@latest':pkg])];
}

export function createInstallManager({entries,probeFn=probe,onResult=()=>({}),env=process.env,platform=process.platform,findNpmFn=findNpm,capabilityFn=npmCapability,inspectWingetFn=inspectWinget,executeWingetFn=executeWinget,inspectAntigravityFn=inspectAntigravity,executeAntigravityFn=executeAntigravity,inspectGrokFn=inspectGrok,executeGrokFn=executeGrok,inspectRustFn=inspectRust,executeRustFn=executeRust,inspectLlvmMingwFn=inspectLlvmMingw,executeLlvmMingwFn=executeLlvmMingw,inspectCodexCompileFn=inspectCodexCompile,executeCodexCompileFn=executeCodexCompile,run=runInstallCommand,timeout=300000,acquireLock=acquireInstallLock}={}) {
  // 実行は項目ごとに独立して持つ。同じ項目（関連項目を含む）だけを排他し、別項目は並行して実行する。
  const jobs=[],tasks=new Set();let closed=false,cache=null,loading=null,generation=0;
  // Diag の外で動く独立プロセス（aidiy_codex のコンパイル）の終了を検知し、自動で確認するための記録。
  let externalRunning=false,externalChecked=false;
  const active=job=>Boolean(job?.実行中);
  const busy=()=>jobs.some(active);
  const append=(job,text)=>{job.raw=(job.raw+String(text)).slice(-LOG_LIMIT*2);};
  async function inspect(){
    let npm,reason,winget,antigravity,grok,rust,llvmMingw,codexCompile;
    const windowsEntries=entries.filter(entry=>providerFor(entry.id)==='winget');
    const agy=entries.find(entry=>entry.id==='agy'),grokEntry=entries.find(entry=>entry.id==='grok');
    const rustEntry=entries.find(entry=>entry.id==='rust'),llvmEntry=entries.find(entry=>entry.id==='llvm-mingw'),codexEntry=entries.find(entry=>entry.id===CODEX_COMPILE_ID);
    // 導入元ごとの読み取り確認は互いに独立しているため並行して行う。
    await Promise.all([
      (async()=>{if(entries.some(entry=>packageFor(entry.id)))try{npm=await findNpmFn({env,platform,run});}catch(error){reason=error.status?error.message:'npm の導入先を確認できません。';}})(),
      (async()=>{if(windowsEntries.length)try{winget=await inspectWingetFn({entries:windowsEntries,env:installEnvironment(env,{ollama:windowsEntries.some(entry=>entry.id==='ollama')}),platform,run});}catch{winget={items:windowsEntries.map(entry=>({id:entry.id,操作:[],理由:'WinGet の導入元を確認できません。'}))};}})(),
      (async()=>{if(agy)try{antigravity=await inspectAntigravityFn(agy,{env:installEnvironment(env),platform,run});}catch{antigravity={item:{id:'agy',操作:[],理由:'Antigravity の導入元を確認できません。'}};}})(),
      (async()=>{if(grokEntry)try{grok=await inspectGrokFn(grokEntry,{env:installEnvironment(env),platform,run});}catch{grok={item:{id:'grok',操作:[],理由:'Grok Build の導入元を確認できません。'}};}})(),
      (async()=>{if(rustEntry)try{rust=await inspectRustFn(rustEntry,{env:installEnvironment(env),platform,run});}catch{rust={item:{id:'rust',操作:[],理由:'Rust の導入元を確認できません。'}};}})(),
      (async()=>{if(llvmEntry)try{llvmMingw=await inspectLlvmMingwFn(llvmEntry,{env:installEnvironment(env),platform,run});}catch{llvmMingw={item:{id:'llvm-mingw',操作:[],理由:'llvm-mingw の導入元を確認できません。'}};}})(),
      (async()=>{if(codexEntry)try{codexCompile=await inspectCodexCompileFn(codexEntry,{env:installEnvironment(env),platform,run});}catch{codexCompile={item:{id:CODEX_COMPILE_ID,操作:[],理由:'コンパイルの前提を確認できません。'}};}})(),
    ]);
    const items=await Promise.all(entries.map(async entry=>{
      const provider=providerFor(entry.id);
      if(provider==='winget')return winget.items.find(item=>item.id===entry.id)||{id:entry.id,操作:[],理由:'WinGet の導入元を確認できません。'};
      if(provider==='antigravity')return antigravity.item;
      if(provider==='grok')return grok.item;
      if(provider==='rust')return rust.item;
      if(provider==='llvmMingw')return llvmMingw.item;
      if(provider==='codexCompile')return codexCompile.item;
      if(provider!=='npm')return {id:entry.id,操作:[],理由:'安全な導入・削除コマンドが登録されていません。'};
      if(!npm)return {id:entry.id,パッケージ:NPM_PACKAGES[entry.id],操作:[],理由:reason};
      try{return await capabilityFn(entry,npm,{env,platform});}catch{return {id:entry.id,操作:[],理由:'導入元を確認できません。'};}
    }));
    // 独立プロセスのコンパイルが終わったら（起動直後は完了済みの状態を一度だけ）、確認ボタンと同じ処理で再確認する。
    const codexItem=items.find(item=>item.id===codexEntry?.id),nowRunning=Boolean(codexItem?.外部実行中);
    if(codexItem&&((externalRunning&&!nowRunning)||(!externalChecked&&codexCompile?.context?.status?.状態==='完了'))){
      try{const result=await probeFn(codexEntry);onResult(result);codexItem.最終確認=result;}catch{}
    }
    if(codexItem){externalRunning=nowRunning;externalChecked=true;}
    return {npm,winget:winget?.context,antigravity:antigravity?.context,grok:grok?.context,rust:rust?.context,llvmMingw:llvmMingw?.context,codexCompile:codexCompile?.context,items};
  }
  async function capabilities(){
    if(cache)return cache;
    if(!loading){const version=generation;loading=inspect().then(value=>{if(version===generation)cache=value;}).finally(()=>{loading=null;});}
    await loading;return cache||capabilities();
  }
  const publicJob=job=>{const {raw,controller,...rest}=job;return {...rest,ログ:safeInstallLog(raw,env).slice(-LOG_LIMIT)};};
  async function snapshot(){
    // 実行中は確認処理を待たず、直近の確認結果で応答する（開始・中止・ポーリングを遅らせない）。
    // 独立プロセスが動いている間は、直前の確認結果を使わず毎回その状態を読み直す。
    if(!busy()&&cache?.items?.some(item=>item.外部実行中)){cache=null;generation++;}
    const state=busy()&&cache?cache:busy()?null:await capabilities();
    const list=jobs.map(publicJob);
    // 実行 は互換のため最後に開始した1件。全件は 実行一覧 で返す。
    return {項目:state?.items||entries.map(entry=>({id:entry.id,操作:[],理由:'導入元を確認しています。'})),実行:list.at(-1)||null,実行一覧:list};
  }
  function invalidate(){if(!busy()){cache=null;generation++;}}
  const ensureAllowed=(state,entry,action)=>{
    if(!state.items.find(item=>item.id===entry.id)?.操作?.includes(action))throw failure('導入状況または所有元が変わりました。操作せず再確認します。',409);
  };
  async function execute(job,entry,action,expectedCapability){
    let directory,releaseLock,lockedCapability,scopedCopilotRemoval=false,status='完了',message='操作が完了しました。',detached=false;
    const provider=providerFor(entry.id),controller=job.controller,log=text=>append(job,text);
    const onUncertain=()=>{job.状態='停止未確認';job.説明='停止の完了を確認できません。実行中の処理が終了するまで、この項目の新しい操作はできません。';};
    const operationRun=async command=>{
      if(command.表示)log(`$ ${command.表示}\n`);
      const result=await run({...command,platform,cwd:command.cwd||directory,env:command.env||installEnvironment(env),signal:controller.signal,timeout:command.timeout??timeout,onData:command.onData||log,onUncertain});
      // 変更後の読み取り照会（未導入等のコード）で、実操作の終了コードを上書きしない。
      if(command.表示||!command.onData||command.onData===log)job.終了コード=result.code;
      return result;
    };
    const checkedRun=async command=>{
      const result=await operationRun(command);
      if(result.cancelled||controller.signal.aborted)throw failure('操作を中止しました。');
      if(result.timedOut)throw failure('実行時間の上限に達したため停止しました。');
      if(result.overflow)throw failure('出力の上限に達したため停止しました。');
      if(result.error||result.code!==0)throw failure(`コマンドが失敗しました（終了コード ${result.code??'起動不可'}）。`);
      return result;
    };
    try{
      await loading;
      let fresh=await inspect();cache=fresh;ensureAllowed(fresh,entry,action);
      if(controller.signal.aborted)throw failure('操作を中止しました。');
      const selectedCapability=fresh.items.find(item=>item.id===entry.id);
      const context=provider==='npm'&&selectedCapability?.npmPrefix?{...fresh.npm,prefix:selectedCapability.npmPrefix,root:selectedCapability.npmRoot}:fresh[provider];
      const lockKey=context?.lockKey||context?.prefix;
      if(entry.id==='copilot'&&action==='削除'&&(selectedCapability?.npmCopilot別経路||expectedCapability?.npmCopilot別経路)
        &&(!expectedCapability||Boolean(selectedCapability?.npmCopilot別経路)!==Boolean(expectedCapability.npmCopilot別経路)
          ||(expectedCapability.npmPrefix||fresh.npm.prefix)!==lockKey)){
        throw failure('確認時と npm 版 Copilot の削除対象が変わりました。導入状況を再確認してください。',409);
      }
      if(!lockKey)throw failure('導入先の排他を確認できません。',409);
      releaseLock=await acquireLock(lockKey,{platform,scope:lockScopeFor(entry.id),env:installEnvironment(env)});
      // ロック取得を待つ間に別の操作が完了していても、古い所有判定では実行しない。
      if(provider==='npm'){
        lockedCapability=await capabilityFn(entry,fresh.npm,{env,platform});
        if((lockedCapability.npmPrefix||fresh.npm.prefix)!==lockKey)throw failure('導入先が変わりました。操作せず再確認します。',409);
        if(!lockedCapability.操作?.includes(action))throw failure('導入状況または所有元が変わりました。操作せず再確認します。',409);
        if(entry.id==='copilot'&&action==='削除'&&Boolean(lockedCapability.npmCopilot別経路)!==Boolean(selectedCapability?.npmCopilot別経路))
          throw failure('確認時と npm 版 Copilot の削除対象が変わりました。導入状況を再確認してください。',409);
        if(entry.id==='opencode'&&(lockedCapability.移行元||expectedCapability?.移行元)
          &&JSON.stringify(lockedCapability.導入済みパッケージ)!==JSON.stringify(expectedCapability?.導入済みパッケージ)){
          throw failure('OpenCode の移行対象が確認時から変わりました。移行説明を再確認してから操作してください。',409);
        }
      }else{
        fresh=await inspect();cache=fresh;ensureAllowed(fresh,entry,action);
        const lockedKey=fresh[provider]?.lockKey||fresh[provider]?.prefix;
        if(lockedKey!==lockKey)throw failure('導入先が変わりました。操作せず再確認します。',409);
      }
      if(controller.signal.aborted)throw failure('操作を中止しました。');
      directory=await mkdtemp(path.join(os.tmpdir(),'aidiy-install-'));
      if(provider==='npm'){
        const configFile=path.join(directory,'npmrc');await writeFile(configFile,'',{mode:0o600});await writeFile(configFile+'.global','',{mode:0o600});
        const commands=npmCommands(context,entry.id,action,configFile,lockedCapability);
        for(const [index,command] of commands.entries()){
          if(index>0){
            // V1 削除後に未知の shim が残った・所有元が変わった場合は V2 を上書きしない。
            const next=await capabilityFn(entry,context,{env,platform});
            if(next.移行元||!next.操作?.some(value=>['導入','再導入'].includes(value)))throw failure('OpenCode V1 の削除後の所有元を確認できません。V2 の導入は行いません。',409);
          }
          await checkedRun(command);
        }
        if(action==='導入'&&lockedCapability.npmCopilotVsCode導入){
          const after=await capabilityFn(entry,fresh.npm,{env,platform});
          if(!after.操作?.includes('再導入')||(after.npmPrefix||fresh.npm.prefix)!==lockKey)
            throw failure('指定先で npm 版 Copilot の導入を確認できません。');
          message='npm 版 Copilot を導入しました。VS Code の起動用ファイルは変更していません。';
        }
        if(action==='削除'&&lockedCapability.npmCopilot別経路){
          const packageDirectory=path.join(context.root,'@github','copilot');
          try{await lstat(packageDirectory);throw failure('指定した npm 版 Copilot の削除を確認できません。');}
          catch(error){if(error.code!=='ENOENT')throw error;}
          scopedCopilotRemoval=true;
          message='指定した npm 版 Copilot を削除しました。別経路の Copilot は変更していません。';
        }
      }else{
        const executeProvider=provider==='winget'?executeWingetFn:provider==='grok'?executeGrokFn:provider==='rust'?executeRustFn:provider==='llvmMingw'?executeLlvmMingwFn:provider==='codexCompile'?executeCodexCompileFn:executeAntigravityFn;
        // 実コマンドは共通の期限・中止・終了確認を通す。プロバイダー内の照会も実行中として排他する。
        const result=await executeProvider(entry,action,fresh[provider],{env:installEnvironment(env,{ollama:entry.id==='ollama'}),platform,run:operationRun,signal:controller.signal,timeout,cwd:directory,onData:log,onUncertain});
        if(result?.code!==undefined)job.終了コード=result.code;
        // 独立プロセスを開始しただけの操作は、ここでは導入確認の合否を判定しない（完了後に自動確認する）。
        if(result?.非同期){detached=true;message=result.メッセージ||message;}
        if(controller.signal.aborted)throw failure('操作を中止しました。');
      }
    }catch(error){status=controller.signal.aborted?'中止':'失敗';message=error.status?error.message:'導入操作でエラーが発生しました。';}
    finally{
      if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>log('一時ファイルの後片付けに失敗しました。\n'));
      job.状態='確認中';log(`\n${message}\n導入状況を再確認します。\n`);
      const checked=[];
      // FFmpeg は一度のパッケージ操作の後、3つとも個別確認と全く同じ probe / 結果反映を呼ぶ。
      for(const target of entries.filter(item=>affectedIds(entry.id).includes(item.id))){
        try{
          const result=await probeFn(target);checked.push(result);Object.assign(job,onResult(result));
          if(target.id===entry.id)job.結果=result;
          log(`確認結果 [${target.name||target.id}]: ${result.状態}\n${result.説明||''}\n`);
          if(status==='完了'&&!detached&&((action==='削除'&&result.パス&&!scopedCopilotRemoval)||(action!=='削除'&&result.状態!=='OK'))){status='失敗';message=action==='削除'?'別の導入先を含め、実行ファイルが残っています。確認結果を参照してください。':'コマンドは終了しましたが、導入を確認できませんでした。PATH の反映や確認結果を参照してください。';log(`${message}\n`);}
        }catch{status='失敗';message='操作後の導入確認に失敗しました。確認ボタンで再試行してください。';log(`${target.name||target.id}: ${message}\n`);}
      }
      job.結果一覧=checked;
      // 並行中の別項目があっても、終わった項目の操作可否は最新の確認結果で表示する。
      // 確認中も直前の結果を表示し続け、新しい結果がそろってから置き換える。
      {const version=++generation;try{const value=await inspect();if(version===generation)cache=value;}catch{if(version===generation)cache=null;}}
      if(releaseLock)await releaseLock().catch(()=>{status='失敗';message='導入操作の排他ロックを解除できませんでした。';log(`${message}\n`);});
      job.状態=status;job.説明=message;job.終了日時=new Date().toISOString();job.実行中=false;
    }
  }
  function prune(){
    // 終了済みは項目ごとに最新だけ残す。実行中は必ず残す。
    for(let index=jobs.length-1;index>=0;index--){
      const job=jobs[index];
      if(active(job))continue;
      if(jobs.some((other,later)=>later>index&&other.対象===job.対象)||jobs.length>JOB_LIMIT)jobs.splice(index,1);
    }
  }
  async function start(id,action){
    const entry=entries.find(item=>item.id===id);
    if(!entry||!providerFor(id)||!ACTIONS.includes(action))throw failure('未対応の導入操作です。',404);
    if(closed)throw failure('導入操作は終了しています。',409);
    if(jobs.some(job=>active(job)&&overlaps(job.対象,id)))throw failure('この項目の導入操作を実行中です。完了後に再試行してください。',409);
    // Diag の外で動くコンパイル中は、新しいコンパイルを受け付けない（状態ファイルをその場で読み直す）。
    if(providerFor(id)==='codexCompile'){
      const current=await inspectCodexCompileFn(entry,{env:installEnvironment(env),platform,run}).catch(()=>null);
      if(current?.item?.外部実行中)throw failure(current.item.理由||'コンパイル中です。完了を待ってください。',409);
    }
    const job={実行ID:randomUUID(),対象:id,関連項目:affectedIds(id),操作:action,状態:'実行中',実行中:true,開始日時:new Date().toISOString(),終了日時:null,raw:`${entry.name||id}: ${action}\n導入元を確認しています。\n`,controller:new AbortController()};
    jobs.push(job);prune();
    const task=execute(job,entry,action,cache?.items.find(item=>item.id===id)).finally(()=>tasks.delete(task));tasks.add(task);
    const state=await snapshot();
    return {...state,実行:publicJob(job)};
  }
  async function cancel(id){
    const job=jobs.find(item=>item.実行ID===id);
    if(!job)throw failure('実行が見つかりません。',404);
    if(active(job)&&!job.controller.signal.aborted){append(job,'\n中止を要求しました。終了確認後に導入状況を再確認します。\n');job.controller.abort();}
    const state=await snapshot();
    return {...state,実行:publicJob(job)};
  }
  async function close(){closed=true;for(const job of jobs)if(active(job))job.controller.abort();await Promise.all([...tasks]);}
  return {snapshot,start,cancel,busy,invalidate,close};
}
