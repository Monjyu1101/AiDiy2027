// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import {open,readFile,unlink,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const blocked=()=>Object.assign(new Error('導入プロセスの終了を確認できません。実行中または確認不能のため、新しい操作は開始しません。'),{status:409});
const valid=p=>Number.isInteger(p?.pid)&&p.pid>0&&Number.isFinite(p.created)&&p.created>0;
const name=p=>String(p.name||p.executable||'').split(/[\\/]/).at(-1).toLowerCase();

// PID 単独では再利用を区別できない。旧ロックの生存 PID は保守的に実行中とする。
export function processLockIsStale(record,processes,{scope}={}) {
  if(!Array.isArray(processes)||!processes.length||!Number.isInteger(record?.pid)||record.pid<=0)return false;
  const owner=processes.find(p=>p.pid===record.pid);
  if(owner&&(!record.created||!valid(owner)||owner.created===record.created))return false;
  for(const p of processes){
    if(p.parentPid===record.pid&&(!record.created||!p.created||p.created>=record.created))return false;
    const n=name(p),cmd=p.commandLine;
    // 同じ利用者の別コピーや、親が消えた rustup 子も排他する。
    if(scope==='rust'&&/^rustup(?:-init)?(?:\.exe)?$/.test(n))return false;
    if(/^(?:curl|tar|powershell|pwsh)(?:\.exe)?$/.test(n)){
      if(typeof cmd!=='string'||!cmd.trim())return false;
      if(/aidiy-rustup-|llvm-mingw\.aidiy-(?:staging|backup)-|AIDIY_PATH_(?:DIR|MODE)/i.test(cmd))return false;
    }
  }
  return true;
}

async function readRecord(file){
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw blocked();
  const text=await readFile(file,'utf8');
  try{return {text,record:JSON.parse(text)};}catch{return {text,record:null};}
}

// Rust / llvm-mingw 専用。既存ファイルと同じパスを使い、停止証拠のないロックは削除しない。
export async function acquireProcessInstallLock(file,{scope,inspectProcesses,pid=process.pid}={}) {
  if(!['rust','llvm-mingw'].includes(scope)||typeof inspectProcesses!=='function')throw blocked();
  let processes;
  try{processes=await inspectProcesses();}catch{throw blocked();}
  const owner=processes?.find(p=>p.pid===pid);
  if(!valid(owner))throw blocked();
  const record={version:1,pid,created:owner.created,token:randomUUID()};
  const create=async()=>{
    const handle=await open(file,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(record));}catch(error){await handle.close();await unlink(file).catch(()=>{});throw error;}
    await handle.close();
    let released=false;
    return async()=>{if(released)return;released=true;const current=await readRecord(file);if(current.record?.token!==record.token)throw blocked();await unlink(file);};
  };
  try{return await create();}catch(error){if(error.code!=='EEXIST')throw blocked();}
  // 回収者同士を直列化する。回収中の強制終了で guard が残る場合は安全側で停止する。
  const guard=file+'.recovery';let handle;
  try{handle=await open(guard,'wx',0o600);await handle.writeFile(JSON.stringify(record));}catch{if(handle)await handle.close();throw blocked();}
  try{
    let old;try{old=await readRecord(file);}catch(error){if(error.code==='ENOENT')return await create();throw error;}
    const prior=typeof old.record==='number'?{pid:old.record}:old.record;
    let current;try{current=await inspectProcesses();}catch{throw blocked();}
    if(!processLockIsStale(prior,current,{scope}))throw blocked();
    // 生存所有者は上で拒否される。guard 保有中は他の回収者は置換しない。
    if((await readRecord(file)).text!==old.text)throw blocked();
    await unlink(file);
    return await create();
  }catch(error){if(error.status)throw error;throw blocked();}
  finally{await handle.close();await unlink(guard).catch(()=>{});}
}
