// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// step-9: node frontend_ide/checks/navigation-failure-audit.mjs <evidence-folder>
// 秘密のないREADMEだけをHermes/autoへ1回送信。300秒/280秒は製品の値を維持する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {startDevelopment} from '../server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const base=mkdtempSync(join(tmpdir(),'aidiy-nav-step9-')),project=join(base,'公開試験');mkdirSync(project);
writeFileSync(join(project,'README.md'),'# Naviの公開試験資料\nTask A: READMEの内容を確認して報告する。\nTask B: 利用者の別途の手動承認を待つ。承認は未実施で、AIは代行しない。\nこのフォルダの外は読まず、ファイルを変更・作成しない。\n','utf8');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const before=hash(join(project,'README.md'));
const log=(kind,data={})=>appendFileSync(join(output,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n');
const scope={active:true,mode:'online',connected:true,startedAt:Date.now(),project:{name:'公開試験',path:project}};
const connection={state:()=>scope,connect:async()=>scope,close(){},disconnect:()=>scope};
const python=join(root,'backend_tools/.venv/Scripts/python.exe');
let child,childExit,agentCalls=0;
const server=await startDevelopment(project,{kind:'navi',connection,navigationOptions:{stateRoot:join(base,'state'),modelFile:join(base,'model.json'),defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),runAgent:args=>{
 agentCalls++;log('runagent-start',{call:agentCalls,selection:args.selection});
 return new Promise((resolve,reject)=>{
  child=spawn(python,['-B',join(root,'backend_tools/tools_proc/process_lifetime.py'),'--parent-pid',String(process.pid),'--',python,'-B',fileURLToPath(new URL('./navigation-failure-hermes.py',import.meta.url))],{cwd:root,windowsHide:true,stdio:['pipe','pipe','ignore'],signal:args.signal,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1',AIDIY_NAV_AUDIT_LOG:join(output,'python.jsonl')}});
  log('adapter-spawned',{pid:child.pid});let chunks=[],size=0;
  const aborted=()=>log('runagent-abort');args.signal.addEventListener('abort',aborted,{once:true});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576)child.kill();else chunks.push(chunk);});
  child.on('error',error=>{log('adapter-error',{name:error.name});reject(error);});child.stdin.on('error',()=>{});
  childExit=new Promise(done=>child.once('close',code=>{args.signal.removeEventListener('abort',aborted);log('adapter-exit',{code,stdoutBytes:size});done();try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(code!==0||value.error||typeof value.content!=='string')throw Error('読取専用AI呼出しの失敗');log('runagent-return',{provider:value.provider,model:value.model});resolve(value);}catch(error){reject(error);}}));
  child.stdin.end(JSON.stringify({project,prompt:args.prompt,selection:args.selection}));
 });
}}});
const config=await(await fetch(new URL('development/config',server.url))).json();
const endpoint=new URL('api/navigation?instance='+config.navigationInstance,server.url);
let last='';
try{
 log('post-navigation');
 const accepted=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'navigate',goal:'README.mdだけを読みTask Aの確認と未実施の手動承認を評価してください。外部フォルダ参照、承認の代行、ファイルの変更・作成はしません。',clientRequestId:'step9-hermes-once'})});
 const started=await accepted.json();log('navigation-accepted',{httpStatus:accepted.status,job:started.job});assert.equal(accepted.status,202);
 const deadline=Date.now()+330000;let data;
 while(Date.now()<deadline){
  data=await(await fetch(endpoint)).json();
  const status=data.job?.status;if(status!==last){last=status;log('navigation-state',{job:data.job,resultRequestId:data.result?.requestId});}
  if(status!=='running')break;await new Promise(done=>setTimeout(done,1000));
 }
 assert.notEqual(data.job?.status,'running','観測用上限に到達');
 await childExit;
 const clean=value=>JSON.stringify(value,null,2).replaceAll(project,'<専用一時領域>/公開試験').replaceAll(project.replaceAll('\\','/'),'<専用一時領域>/公開試験');
 writeFileSync(join(output,'hermes-result.json'),clean({job:data.job,result:data.result,agentCalls,readmeUnchanged:before===hash(join(project,'README.md')),reproductionOfHistoricalFailure:false,instrumentation:'navigation_readonly.run/CodeAgents/CodeAIは現行製品を使用。観測入口のみ追加。標準入口のstderr破棄と汎用エラー処理も維持。',sourceHashes:Object.fromEntries(['frontend_ide/ファイル機能/navigation.mjs','frontend_ide/ファイル機能/navigation_readonly.py','backend_server/AIコア/AIコード_cli.py','command_hermes/prediction_main.py'].map(path=>[path,hash(join(root,path))]))}));
 console.log(JSON.stringify({status:data.job?.status,agentCalls,readmeUnchanged:before===hash(join(project,'README.md'))}));
}finally{await server.close();await childExit;log('closed');}
