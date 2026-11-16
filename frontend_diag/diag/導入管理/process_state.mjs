// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// Windows の導入状態は taskkill の戻り値ではなくプロセス一覧で確認する。
import {execFile} from 'node:child_process';
import path from 'node:path';

export async function readWindowsInstallProcesses({env=process.env,execFileFn=execFile}={}) {
  const powershell=path.win32.join(env.SystemRoot||env.SYSTEMROOT||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const script="$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;created=$(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 });executable=$_.ExecutablePath;name=$_.Name;commandLine=$_.CommandLine} }) | ConvertTo-Json -Compress";
  const stdout=await new Promise((resolve,reject)=>execFileFn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,env},(error,stdout)=>error?reject(error):resolve(stdout)));
  const rows=JSON.parse(String(stdout).replace(/^\uFEFF/,''));
  if(!Array.isArray(rows)||!rows.length||rows.some(row=>!Number.isInteger(row.pid)||!Number.isInteger(row.parentPid)||!Number.isFinite(row.created)))throw Error('プロセス一覧を確認できません。');
  return rows;
}

// PID と生成時刻の組で追跡。親終了後も確認済み子孫を追い、PID 再利用は別プロセスとして扱う。
export function createInstallProcessTracker(pid,{started=Date.now(),read=readWindowsInstallProcesses}={}) {
  const known=new Map();let pending;
  async function inspect(){
    const rows=await read();
    const root=rows.find(row=>row.pid===pid);
    if(!known.has(pid)&&root&&root.created>=started-2000&&root.created<=started+2000)known.set(pid,root.created);
    let added=true;
    while(added){
      added=false;
      for(const row of rows){
        if(known.has(row.pid))continue;
        // Windows の子は終了済み親 PID を保持する。未観測の短命親も開始時刻で範囲を絞る。
        const parentTime=known.get(row.parentPid)??(row.parentPid===pid&&!root?started-2000:undefined);
        if(parentTime===undefined||row.created<parentTime)continue;
        const currentParent=rows.find(value=>value.pid===row.parentPid);
        if(currentParent&&known.has(row.parentPid)&&currentParent.created!==known.get(row.parentPid))continue;
        known.set(row.pid,row.created);added=true;
      }
    }
    return rows.some(row=>known.get(row.pid)===row.created);
  }
  return {async running(){
    if(!pending)pending=inspect().finally(()=>{pending=null;});
    try{return await pending;}catch{return null;}
  }};
}
