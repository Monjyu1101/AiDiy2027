// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {mkdir,open,unlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
// 永続状態の番号を並行起動間で分離。終了後は同じ最小番号を再利用する。
export async function reserveNavigationSlot(project,{root=join(tmpdir(),'aidiy-navigation-slots')}={}){
 const path=await realpath(project),key=createHash('sha256').update(process.platform==='win32'?path.toLowerCase():path).digest('hex');
 const dir=join(root,key);await mkdir(dir,{recursive:true});
 for(let number=1;number<10000;number++){
  const file=join(dir,number+'.json');let handle;
  try{handle=await open(file,'wx');}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   // 他プロセスの予約は削除しない。異常終了の予約も飛ばし、競合回収で他窓を壊さない。
   continue;
  }
  await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();let released=false;
  return {instance:'navi-'+number,async close(){if(released)return;released=true;await unlink(file).catch(()=>{});}};
 }
 throw Error('Naviの作業番号を確保できません。');
}
