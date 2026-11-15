// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under AiDiy 公開利用ライセンス v1.1. See LICENSE.
// _compile.py から呼ぶ Windows 専用入口。Diag と固定版・ハッシュ・排他を共用する。
import {inspectRust,executeRust,inspectLlvmMingw,executeLlvmMingw} from '../../frontend_diag/diag/導入管理/rust.mjs';
import {runInstallCommand,acquireInstallLock,safeInstallLog} from '../../frontend_diag/diag/導入管理/導入管理.mjs';

const id=process.argv[2];
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort());
try {
  if(!['rust','llvm-mingw'].includes(id))throw new Error('未対応の開発ツールです。');
  const entry={id,commands:[id==='rust'?'cargo':'x86_64-w64-mingw32-clang']};
  const inspect=id==='rust'?inspectRust:inspectLlvmMingw;
  const execute=id==='rust'?executeRust:executeLlvmMingw;
  const {item,context}=await inspect(entry);
  if(!item.操作.includes('導入'))throw new Error(item.理由||'既存の開発ツールは自動で再導入しません。');
  const release=await acquireInstallLock(context.lockKey,{scope:id});
  try {
    await execute(entry,'導入',context,{run:runInstallCommand,signal:controller.signal,
      onData:text=>process.stdout.write(safeInstallLog(text)),onUncertain:()=>{process.exitCode=1;}});
  } finally {await release();}
} catch(error) {
  console.error(safeInstallLog(error.message));process.exitCode=1;
}
