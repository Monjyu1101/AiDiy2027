// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_codex（command_codex の Codex CLI エンジン）を固定スクリプト command_codex/_compile.py でコンパイルする。
// ボタンは `_compile.py --yes --detach` で独立プロセスを開始してすぐ戻る。Diag を閉じてもコンパイルは続き、
// 進み具合は _compile.py が target/ に書く状態ファイルとログから表示する。任意の引数・コマンドは受け付けない。
import {readFile,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolveProgram} from '../診断/probes.mjs';
import {exists} from './antigravity.mjs';

export const CODEX_COMPILE_ID='aidiy_codex';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
export const CODEX_DIR=path.join(ROOT,'command_codex');
export const COMPILE_SCRIPT=path.join(CODEX_DIR,'_compile.py');
// Codex CLI の部品群（Rust ワークスペース）は一段下の codex-rs/ に置く。
export const WORKSPACE_DIR=path.join(CODEX_DIR,'codex-rs');
// ビルド作業フォルダ・状態・ログは _compile.py と同じく利用者のホーム（~/.aidiy/cache/codex）。
export const BUILD_DIR=path.join(os.homedir(),'.aidiy','cache','codex');
export const STATUS_FILE=path.join(BUILD_DIR,'aidiy_codex_compile.json');
// 独立プロセスを開始するだけなので短時間で戻る。
const START_TIMEOUT=60*1000;
const failure=(message,status=409)=>Object.assign(new Error(message),{status});
const envValue=(env,key)=>Object.entries(env).find(([name])=>name.toUpperCase()===key)?.[1];
const LABELS=Object.freeze({導入:'コンパイル',再導入:'再コンパイル'});

export function codexTargets(platform=process.platform,arch=process.arch) {
  if(platform==='win32')return [arch==='arm64'?'aarch64-pc-windows-gnullvm':'x86_64-pc-windows-gnullvm'];
  return [''];
}
// _compile.py が配置する ~/.aidiy/bin/aidiy_codex(.exe)。プロジェクトの外なので clone・コピーの影響を受けない。
export function codexBinaries(platform=process.platform,home=os.homedir()) {
  return [path.join(home,'.aidiy','bin',platform==='win32'?'aidiy_codex.exe':'aidiy_codex')];
}

async function firstExisting(files){for(const file of files)if(await exists(file))return file;return null;}

export function pidAlive(pid,kill=process.kill.bind(process)) {
  if(!Number.isInteger(pid)||pid<=0)return false;
  try{kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}
}

// 状態ファイル（_compile.py が書く）。コンパイル中でもプロセスが無ければ中断として扱う。
export async function readCompileStatus({file=STATUS_FILE,alive=pidAlive}={}) {
  let value;
  try{value=JSON.parse((await readFile(file,'utf8')).replace(/^﻿/,''));}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const status={状態:typeof value.状態==='string'?value.状態:null,pid:Number.isInteger(value.pid)?value.pid:null,
    開始日時:typeof value.開始日時==='string'?value.開始日時:null,終了日時:typeof value.終了日時==='string'?value.終了日時:null,
    ログ:typeof value.ログ==='string'?value.ログ:null,メッセージ:typeof value.メッセージ==='string'?value.メッセージ:null};
  if(status.状態==='コンパイル中'&&!alive(status.pid))status.状態='中断';
  return status;
}

// ログ末尾の空でない1行（進み具合の表示用）。大きなログも末尾だけ読む。
export async function lastLogLine(file) {
  if(!file)return null;
  let handle;
  try{
    handle=await open(file,'r');const {size}=await handle.stat();const length=Math.min(size,8192);
    const buffer=Buffer.alloc(length);await handle.read(buffer,0,length,size-length);
    // 制御文字（色・進捗表示）を除き、最後の意味のある行を返す。
    const lines=buffer.toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g,'').split(/[\r\n]+/).map(line=>line.trim()).filter(Boolean);
    return lines.at(-1)?.slice(0,160)||null;
  }catch{return null;}finally{await handle?.close().catch(()=>{});}
}

const time=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});};

export async function inspectCodexCompile(entry,{env=process.env,platform=process.platform,arch=process.arch,resolve=resolveProgram,statusReader=readCompileStatus,logReader=lastLogLine}={}) {
  const item={id:entry.id,パッケージ:'command_codex（Codex CLI エンジン）→ aidiy_codex',表示名:LABELS,
    説明:'同梱の OpenAI Codex ソース（Apache-2.0）から python command_codex/_compile.py で aidiy_codex をコンパイルします。',
    再導入説明:'_compile.py をもう一度実行し、変更のあったクレートだけを再コンパイルします。成果物以外は変更しません。',
    確認説明:'独立したプロセスで aidiy_codex をビルドし、~/.aidiy/bin に配置して PATH に登録します（Windows は MSVC 不要の gnullvm＋llvm-mingw）。Diag を閉じてもコンパイルは続きます。初回は Rust の固定版・依存（V8 のサブモジュールを含む）を取得し、数十分〜1時間程度かかります。認証・設定・会話履歴は変更しません。',操作:[]};
  let context=null;
  try{
    if(entry.id!==CODEX_COMPILE_ID)throw failure('未対応の導入操作です。');
    const status=await statusReader();
    if(status?.状態==='コンパイル中'){
      const progress=await logReader(status.ログ);
      item.外部実行中=true;
      item.状況=`コンパイル中（${time(status.開始日時)} 開始・Diag を閉じても続行）${progress?`: ${progress}`:''}`;
      context={prefix:BUILD_DIR,lockKey:BUILD_DIR,status};
      throw failure('コンパイル中です。完了すると自動で確認します。');
    }
    if(status&&['失敗','中断'].includes(status.状態))item.状況=`前回のコンパイルは${status.状態}しました（${time(status.終了日時||status.開始日時)}）。ログ: ~/.aidiy/cache/codex/aidiy_codex_compile.log`;
    if(!await exists(COMPILE_SCRIPT)||!await exists(path.join(WORKSPACE_DIR,'Cargo.toml')))throw failure('command_codex のソースまたは _compile.py が見つかりません。');
    const python=await resolve({id:'python',commands:['python','python3']},{env,platform});
    if(!python)throw failure('Python が見つかりません。Python を導入してから再確認してください。');
    const home=envValue(env,'USERPROFILE')||envValue(env,'HOME');
    const cargo=await resolve({id:'cargo',commands:['cargo'],paths:{[platform]:[path.join(home||'',`.cargo/bin/cargo${platform==='win32'?'.exe':''}`)]}},{env,platform});
    if(!cargo)throw failure('cargo が見つかりません。先に「開発環境等 › Rust」を導入してください。');
    if(platform==='win32'){
      const local=envValue(env,'LOCALAPPDATA')||'';
      const prefix=codexTargets(platform,arch)[0].replace('-pc-windows-gnullvm','-w64-mingw32');
      const clang=await resolve({id:'llvm-mingw',commands:[`${prefix}-clang`],paths:{win32:[path.join(local,'Programs','llvm-mingw','bin',`${prefix}-clang.exe`)]}},{env,platform});
      if(!clang)throw failure('llvm-mingw が見つかりません。先に「開発環境等 › llvm-mingw」を導入してください。');
    }
    const binary=await firstExisting(codexBinaries(platform,home||os.homedir()));
    context={prefix:BUILD_DIR,lockKey:BUILD_DIR,python,binary,status};
    item.操作=[binary?'再導入':'導入'];
    return {item,context};
  }catch(error){item.理由=error.status?error.message:'コンパイルの前提を確認できません。';return {item,context};}
}

export async function executeCodexCompile(entry,action,context,{env=process.env,platform=process.platform,arch=process.arch,run,resolve=resolveProgram,signal,onData=()=>{},onUncertain=()=>{},statusReader=readCompileStatus,logReader=lastLogLine}={}) {
  if(entry.id!==CODEX_COMPILE_ID||!['導入','再導入'].includes(action))throw failure('未対応の導入操作です。',400);
  const fresh=await inspectCodexCompile(entry,{env,platform,arch,resolve,statusReader,logReader});
  if(!fresh.item.操作.includes(action)||!fresh.context?.python)throw failure(fresh.item.理由||'コンパイル状況が変わりました。操作せず再確認します。');
  onData(`${LABELS[action]}を独立プロセスで開始します（python command_codex/_compile.py --yes --detach）。\n`);
  const result=await run({executable:fresh.context.python,args:['-X','utf8',COMPILE_SCRIPT,'--yes','--detach'],cwd:CODEX_DIR,
    env:{...env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1',NO_COLOR:'1'},signal,timeout:START_TIMEOUT,onData,onUncertain,platform});
  if(result?.cancelled||signal?.aborted)throw failure('操作を中止しました。');
  if(result?.timedOut)throw failure('コンパイルの開始を確認できませんでした（時間切れ）。');
  if(result?.code===2)throw failure('すでにコンパイル中です。完了を待ってください。');
  if(result?.code!==0||result?.error)throw failure(`コンパイルを開始できませんでした（終了コード ${result?.code??'起動不可'}）。`);
  // 完了は待たない。manager は導入確認を行わず、状態表示と完了後の自動確認に任せる。
  return {code:0,非同期:true,メッセージ:'コンパイルを独立プロセスで開始しました。Diag を閉じても続行し、完了すると自動で確認します。'};
}
