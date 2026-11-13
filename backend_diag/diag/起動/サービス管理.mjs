// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {readFile,writeFile,mkdir,rename,unlink,realpath} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {stripVTControlCharacters} from 'node:util';
import {createPortStatusChecker} from './ポート状態.mjs';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
// 起動対象外のLocalやTask/Teamの旧名も含む。再起動時だけ使う補助パスも残さない。
const 再起動ファイル=Object.freeze([
 ['backend_server','reboot_core.txt'],['backend_server','reboot_apps.txt'],
 ['backend_server','reboot_apps_code_base_path.txt'],['backend_tools','reboot_tools.txt'],
 ['backend_local','reboot_local.txt'],['backend_taskteam','reboot_taskteam.txt'],
 ['backend_taskteam','reboot_task.txt'],['backend_taskteam','reboot_team.txt'],
]);
async function clearRebootFiles(root){
 const base=await realpath(root);
 for(const [folder,name] of 再起動ファイル){
  try{
   const parent=await realpath(join(base,folder,'temp')),within=relative(base,parent);
   if(within==='..'||within.startsWith('..\\')||within.startsWith('../../')||isAbsolute(within))throw Error('outside root');
   await unlink(join(parent,name));
  }catch(error){
   if(error.code!=='ENOENT')throw failure('再起動ファイルを除去できないため一括起動を中止しました: '+folder+'/temp/'+name,500);
  }
 }
}
export function validateSettings(target,value){
 const keys=Object.keys(target.初期設定);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>typeof value[key]!=='boolean'))throw failure('起動設定は指定の項目を真偽値で設定してください。');
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
export function createStartManager({root=ROOT,spawnFn=spawn,python,readyTimeout=300000,stopTimeout=30000,portStatusFn,forceStopFn}={}){
 let targets,settings,loading,writing=Promise.resolve(),busy=false,stopping=false,closed=false,operation='',work=Promise.resolve(),focus=null,portChecker;
 const sessions=new Map(),cancelled=new Set(),logs=new Map();
 // 明示操作は待機中の --auto を世代ごと無効にする。内部の停止では世代を変えない。
 let startRevision=0,batchProgress=null,autoProgressRevision=null;
 const beginBatch=(kind,text)=>{batchProgress={実行ID:randomUUID(),種別:kind,状態:'running',通知:text};return batchProgress;};
 const updateBatch=(progress,text,state='running')=>{if(progress&&progress===batchProgress){progress.通知=text;progress.状態=state;}};
 function beginAutoStart(revision){if(revision!==startRevision||busy||stopping||closed)return;autoProgressRevision=revision;beginBatch('start','自動起動の準備・ポート解放を待っています。').自動起動=true;}
 function failAutoStart(revision,text){if(revision!==startRevision||autoProgressRevision!==revision)return;updateBatch(batchProgress,text,'error');autoProgressRevision=null;}
 function cancelAutoProgress(){if(autoProgressRevision!==null||batchProgress?.自動起動===true){batchProgress=null;autoProgressRevision=null;}}
 const checkRevision=revision=>{if(revision!==startRevision)throw failure('起動操作は取り消されました。',499);};
 const settingsFile=join(root,'_config','AiDiy_diag_start.json'),runtime=join(root,'temp','aidiy_diag','起動');
 const log=(id,text)=>{const old=logs.get(id)||{text:'',offset:0};old.text+=stripVTControlCharacters(String(text));if(old.text.length>120000){const size=old.text.length-120000;old.offset+=size;old.text=old.text.slice(size);}logs.set(id,old);};
 async function load(){
  if(loading)return loading;
  loading=(async()=>{
   targets=JSON.parse(await readFile(join(root,'scripts','起動対象.json'),'utf8')).filter(target=>target.起動管理!==false);
   settings=Object.fromEntries(targets.map(target=>[target.id,{...target.初期設定}]));
   let saved;try{saved=JSON.parse(await readFile(settingsFile,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw failure('起動設定を読み込めません。_config/AiDiy_diag_start.json を確認してください。',500);}
   if(saved?.version!==1||!saved.設定||typeof saved.設定!=='object')throw failure('保存済みの起動設定が不正です。',500);
   for(const target of targets)if(Object.hasOwn(saved.設定,target.id)){
    const value={...target.初期設定,...saved.設定[target.id]};
    if(target.id==='web')delete value['chrome_devtoolsで開く']; // 統合前の保存設定との互換。
    settings[target.id]=validateSettings(target,value);
   }
  })();
  try{return await loading;}catch(error){loading=undefined;throw error;}
 }
 function targetFor(id){const target=targets?.find(item=>item.id===id);if(!target)throw failure('起動対象が不正です。');return target;}
 const hasOwned=()=>[...sessions.values()].some(session=>session.child&&!session.exited);
 async function ports(){await load();portChecker??=portStatusFn||createPortStatusChecker({targets});return (await portChecker()).対象;}
 async function snapshot(){await load();return {対象:targets.map(target=>({...target,設定:{...settings[target.id]},状態:sessions.get(target.id)?.state||'未起動',管理中:Boolean(sessions.get(target.id)?.child&&!sessions.get(target.id)?.exited)})),実行中:busy||stopping,一括停止中:stopping,一括進捗:batchProgress?structuredClone(batchProgress):null,通知:operation,起動表示:focus?{...focus}:null,終了時停止あり:busy||stopping||hasOwned()};}
 async function save(id,value){
  await load();const target=targetFor(id),validated=validateSettings(target,value);
  const task=writing.catch(()=>{}).then(async()=>{
   const updated={...settings,[id]:validated};
   await mkdir(join(root,'_config'),{recursive:true});
   const temp=settingsFile+'.'+randomUUID()+'.tmp';
   await writeFile(temp,JSON.stringify({version:1,設定:updated},null,2)+'\n',{encoding:'utf8',flag:'wx'});
   await rename(temp,settingsFile);settings=updated;return {設定:{...validated}};
  });writing=task;return task;
 }
 async function pythonCommand(){
  if(python)return [python,[]];
  for(const [command,args] of [[process.env.DIAG_START_PYTHON||'python',[]],['python3',[]],['py',['-3']]]){
   if(await new Promise(resolve=>execFile(command,[...args,'--version'],{windowsHide:true,timeout:15000},(error,stdout)=>resolve(!error&&/^Python 3\./.test(stdout.trim())))))return [command,args];
  }throw failure('Python 3 が見つかりません。Python を導入してターミナルを開き直してください。',503);
 }
 async function stop(id,{cancel=true}={}){
  if(cancel){startRevision++;if(!busy)cancelAutoProgress();}
  await load();targetFor(id);if(cancel)cancelled.add(id);
  const session=sessions.get(id);if(!session?.child||session.exited)return {停止済み:true};
  session.stopping=true;session.state='停止中';
  try{session.child.stdin.write(JSON.stringify({action:'stop'})+'\n');}catch{}
  let timer;
  await Promise.race([session.done,new Promise(resolve=>{timer=setTimeout(async()=>{
   if(process.platform==='win32')await new Promise(done=>execFile('taskkill.exe',['/F','/T','/PID',String(session.child.pid)],{windowsHide:true,timeout:10000},done));
   else try{process.kill(-session.child.pid,'SIGTERM');}catch{}
   resolve();
  },stopTimeout);})]);clearTimeout(timer);
  if(!session.exited){let grace;await Promise.race([session.done,new Promise(resolve=>{grace=setTimeout(resolve,5000);})]);clearTimeout(grace);}
  if(!session.exited)throw failure('停止の完了を確認できませんでした。コンソールを確認してください。',500);
  return {停止済み:true};
 }
 async function startOne(id,runSettings){
  const target=targetFor(id);await stop(id,{cancel:false});
  if(closed||cancelled.has(id))return;
  const [command,args]=await pythonCommand();if(closed||cancelled.has(id))return;
  const run=randomUUID();await mkdir(runtime,{recursive:true});
  const temp=join(runtime,id+'.'+run+'.tmp');await writeFile(temp,JSON.stringify({run}),'utf8');await rename(temp,join(runtime,id+'.json'));
  if(closed||cancelled.has(id))return;
  const session={state:'起動中',child:null,exited:false,stopping:false};sessions.set(id,session);
  log(id,'\n──────── '+new Date().toLocaleString('ja-JP')+' 再起動 ────────\npython '+target.フォルダ+'/_start.py\n');
  let readyResolve,readyReject,doneResolve,ready=false;
  const started=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  session.done=new Promise(resolve=>{doneResolve=resolve;});
  const env={...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',AIDIY_DIAG_RUN:run,AIDIY_DIAG_SETTINGS:JSON.stringify(runSettings)};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawnFn(command,[...args,'-u','-X','utf8',join(root,target.フォルダ,'_start.py'),'--diag-start',id],{cwd:root,env,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,detached:process.platform!=='win32'});session.child=child;
  let pending='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   pending+=chunk;
   if(pending.length>256000){pending='';session.state='エラー';log(id,'起動ログの形式が不正です。\n');readyReject(failure('起動ログを読み込めませんでした。',500));return;}
   let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(!line)continue;
    let event;try{event=JSON.parse(line);}catch{log(id,line+'\n');continue;}
    if(event.type==='log')log(id,event.data);
    else if(event.type==='status'&&['確認中','再起動中','起動中','稼働中','再起動待ち','停止中','停止済み'].includes(event.state))session.state=event.state;
    else if(event.type==='ready'){session.state='稼働中';ready=true;readyResolve();}
    else if(event.type==='error'){session.state='エラー';log(id,'エラー: '+event.message+'\n');readyReject(failure(event.message||'起動に失敗しました。',500));}
   }
  });
  child.stderr.on('data',chunk=>log(id,chunk));
  child.stdin.on('error',()=>{});
  child.once('error',()=>{session.state='エラー';log(id,'Python の起動に失敗しました。\n');readyReject(failure('Python の起動に失敗しました。',503));});
  child.once('close',code=>{session.exited=true;if(session.state!=='エラー')session.state=session.stopping||code===0?'停止済み':'エラー';if(!ready)readyReject(failure('起動が完了する前にプロセスが終了しました。',500));log(id,'\n[コンソール終了: '+String(code)+']\n');doneResolve();});
  const timeout=setTimeout(()=>readyReject(failure('起動完了の確認がタイムアウトしました。',504)),readyTimeout);
  try{await started;}catch(error){await stop(id);throw error;}finally{clearTimeout(timeout);}
 }
 async function restart(id,{revision=++startRevision}={}){
  if(autoProgressRevision!==revision)cancelAutoProgress();
  checkRevision(revision);
  await load();await writing.catch(()=>{});checkRevision(revision);if(closed)throw failure('起動画面を終了しています。',409);if(busy||stopping)throw failure('起動・停止処理の完了を待ってください。',409);
  if(!id){if(hasOwned()||(await ports()).some(item=>item.開放!==false))throw failure('稼働中または未確認の機能があります。強制停止してから一括起動してください。',409);checkRevision(revision);if(busy||stopping||closed)throw failure('起動・停止処理の完了を待ってください。',409);}
  const ids=id?[targetFor(id).id]:targets.filter(target=>settings[target.id].起動対象).map(target=>target.id);
  if(!ids.length)throw failure('起動対象を選択してください。');
  if(id){const old=logs.get(id)||{text:'',offset:0};logs.set(id,{text:'',offset:old.offset+old.text.length+1});}
  const selected=structuredClone(settings);cancelled.clear();busy=true;operation='設定した順序で起動します。';
  const progress=id?null:(autoProgressRevision===revision&&batchProgress?.状態==='running'?batchProgress:beginBatch('start',operation));
  if(progress?.自動起動)progress.対象=[...ids];
  autoProgressRevision=null;updateBatch(progress,operation);
  work=(async()=>{
   try{
    if(!id){operation='残っている再起動ファイルを除去しています。';updateBatch(progress,operation);await clearRebootFiles(root);checkRevision(revision);}
    for(const current of ids){
     if(progress?.自動起動)checkRevision(revision);
     if(closed)break;if(cancelled.has(current))continue;
     focus={対象:current,実行ID:randomUUID()};operation=targetFor(current).名前+' を再起動しています。';updateBatch(progress,operation);await startOne(current,selected[current]);
    }
    // 自動起動の完了は画面切替の根拠になる。途中の停止・手動操作や、先に起動した対象の終了を成功扱いにしない。
    if(progress?.自動起動){
     checkRevision(revision);
     if(closed||ids.some(current=>{const session=sessions.get(current);return cancelled.has(current)||!session?.child||session.exited||session.stopping||session.state!=='稼働中';}))throw failure('自動起動したすべての機能の稼働を確認できませんでした。',500);
    }
    if(!closed){operation='起動処理が完了しました。';updateBatch(progress,operation,'done');}
   }
   catch(error){operation=error.message||'起動に失敗したため後続の起動を中止しました。';updateBatch(progress,operation,'error');}
   finally{busy=false;}
  })();return {受理:true};
 }
 async function forceStopAll(){
  startRevision++;
  await load();if(closed||stopping)throw failure('停止処理の完了を待ってください。',409);
  stopping=true;for(const target of targets)cancelled.add(target.id);
  const previous=work;operation='タブの逆順で停止しています。';autoProgressRevision=null;const progress=beginBatch('stop',operation);
  work=(async()=>{
   const errors=[];
   for(const target of [...targets].reverse()){
    try{
     const owned=sessions.get(target.id);const before=(await ports()).find(item=>item.id===target.id);
     if(!owned?.child||owned.exited){if(before?.開放===false)continue;}
     focus={対象:target.id,実行ID:randomUUID()};operation=target.名前+' を停止しています。';updateBatch(progress,operation);
     await stop(target.id);
     if((await ports()).find(item=>item.id===target.id)?.開放!==false){
      if(forceStopFn)await forceStopFn(target);
      else{
       const [command,args]=await pythonCommand();
       await new Promise((resolve,reject)=>execFile(command,[...args,'-u','-X','utf8',join(root,'scripts','_diag_stop.py'),target.id],{cwd:root,windowsHide:true,timeout:180000,maxBuffer:256000,env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout,stderr)=>{log(target.id,stdout||'');log(target.id,stderr||'');error?reject(failure(target.名前+' の停止に失敗しました。コンソールを確認してください。',500)):resolve();}));
      }
     }
     if((await ports()).find(item=>item.id===target.id)?.開放!==false)throw failure(target.名前+' のポート解放を確認できませんでした。',500);
     if(owned)owned.state='停止済み';else sessions.set(target.id,{state:'停止済み',exited:true});
    }catch(error){errors.push(error.message);log(target.id,'停止エラー: '+error.message+'\n');}
   }
   await previous;
   operation=errors.length?'停止できない機能があります。'+errors.join(' '):'稼働中の機能をすべて停止しました。';updateBatch(progress,operation,errors.length?'error':'done');
  })().finally(()=>{stopping=false;});
  return {受理:true};
 }
 async function logSnapshot(id,cursor=0){await load();targetFor(id);if(!Number.isSafeInteger(cursor)||cursor<0)throw failure('ログ位置が不正です。');const value=logs.get(id)||{text:'',offset:0},end=value.offset+value.text.length;return {対象:id,ログ:value.text.slice(Math.max(0,Math.min(cursor,end)-value.offset)),位置:end,切替:cursor<value.offset||cursor>end};}
 // 画面の通知欄へ出す。起動・停止の処理中は、その進捗表示を優先する。
 function notify(text){if(!busy&&!stopping)operation=String(text);}
 async function close(){startRevision++;cancelAutoProgress();batchProgress=null;closed=true;await Promise.allSettled([...sessions.keys()].map(stop));await work;}
 return {snapshot,save,restart,stop,forceStopAll,logSnapshot,notify,beginAutoStart,failAutoStart,close,settled:()=>work,startRevision:()=>startRevision};
}
