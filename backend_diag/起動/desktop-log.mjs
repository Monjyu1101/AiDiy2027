// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 起動 URL、秘密情報、生 stderr、例外本文は保存しない。固定分類だけの容量制限ログ。
import {openSync,closeSync,fstatSync,ftruncateSync,writeSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const DESKTOP_LOG=new URL('../.desktop-errors.log',import.meta.url);
const codes=new Set(['IPC','TIMEOUT','URL','WINDOW','LOAD','RENDERER','SPAWN','EXIT']);
function resetLog(fd,file) {
  if(process.platform!=='win32')return ftruncateSync(fd,0);
  // Windows の追記専用ハンドルは切り詰め不可。同じファイルの書込ハンドルを使う。
  const resetFd=openSync(file,constants.O_WRONLY|(constants.O_NOFOLLOW || 0)|(constants.O_NONBLOCK || 0));
  try {
    const original=fstatSync(fd),target=fstatSync(resetFd);
    if(!target.isFile() || original.dev!==target.dev || original.ino!==target.ino)throw Error('Log file changed');
    ftruncateSync(resetFd,0);
  }finally{closeSync(resetFd);}
}
function appendSafeLine(body,file=DESKTOP_LOG) {
  let fd;
  try {
    fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW || 0)|(constants.O_NONBLOCK || 0),0o600);
    if(!fstatSync(fd).isFile())return false;
    const line=new Date().toISOString()+' '+body+'\n';
    if(fstatSync(fd).size+Buffer.byteLength(line)>65536)resetLog(fd,file);
    writeSync(fd,line);return true;
  }catch{return false;}finally{if(fd!==undefined){try{closeSync(fd);}catch{}}}
}
export const desktopLogPath=fileURLToPath(DESKTOP_LOG);

export function recordDesktopFailure(code,file=DESKTOP_LOG) {
  return codes.has(code)?appendSafeLine('Electron '+code,file):false;
}
export function recordProbeFailure(value,file=DESKTOP_LOG) {
  if(!['spawn_error','timeout','output_limit','nonzero_exit','resolve_error','npm_cli_missing','below_minimum_version','probe_setup_error'].includes(value?.reason))return false;
  const safeCode=value=>typeof value==='string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value)?value:null;
  const record={id:typeof value.id==='string' && /^[a-z0-9_-]{1,40}$/.test(value.id)?value.id:'unknown',reason:value.reason,
    args:Array.isArray(value.args)?value.args.filter(arg=>['--version','-version','-3'].includes(arg)).slice(0,3):[]};
  if(value.reason==='below_minimum_version')record.severity='warning';
  if(Object.hasOwn(value,'errorCode'))record.errorCode=safeCode(value.errorCode);
  if(Object.hasOwn(value,'exitCode'))record.exitCode=Number.isSafeInteger(value.exitCode)?value.exitCode:null;
  if(Object.hasOwn(value,'signal'))record.signal=safeCode(value.signal);
  return appendSafeLine('[aidiy-diag:probe] '+JSON.stringify(record),file);
}
